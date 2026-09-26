import crypto from 'node:crypto'
import { get, insert, run, update, now } from '../db.ts'
import { publish } from '../lib/events.ts'
import { markRead, type WaNumber } from './whatsapp.ts'
import { upsertContact, getOrCreateConversation, applyStatus, messageRow, notify, type Conversation } from './messaging.ts'
import { handleInbound, type Inbound } from './automation.ts'
import { emitEvent } from './hooks.ts'

type WaMsg = {
  id: string; from: string; timestamp?: string; type: string
  text?: { body: string }
  image?: { id: string; caption?: string; mime_type?: string }; video?: { id: string; caption?: string }; audio?: { id: string }
  document?: { id: string; caption?: string; filename?: string }; sticker?: { id: string }
  location?: { latitude: number; longitude: number; name?: string; address?: string }
  interactive?: { type: string; button_reply?: { id: string; title: string }; list_reply?: { id: string; title: string; description?: string }; nfm_reply?: { response_json: string } }
  button?: { text: string; payload: string }
  order?: { catalog_id: string; text?: string; product_items: { product_retailer_id: string; quantity: number; item_price: number; currency: string }[] }
  reaction?: { message_id: string; emoji: string }
  contacts?: { name?: { formatted_name?: string }; phones?: { phone?: string }[] }[]
  context?: { id: string }
}

function extract(m: WaMsg): Inbound & { body: string } {
  switch (m.type) {
    case 'text': return { type: 'text', text: m.text?.body ?? '', body: m.text?.body ?? '' }
    case 'interactive': {
      const r = m.interactive?.button_reply ?? m.interactive?.list_reply
      if (r) return { type: 'interactive', text: r.title, buttonId: r.id, body: r.title }
      return { type: 'interactive', text: '', body: '[Form response]' }
    }
    case 'button': return { type: 'button', text: m.button?.text ?? '', buttonId: m.button?.payload, body: m.button?.text ?? '' }
    case 'image': case 'video': case 'document':
      return { type: m.type, text: m[m.type]?.caption ?? '', body: m[m.type]?.caption || `[${m.type}${m.type === 'document' && m.document?.filename ? `: ${m.document.filename}` : ''}]` }
    case 'audio': return { type: 'audio', text: '', body: '[Voice note]' }
    case 'sticker': return { type: 'sticker', text: '', body: '[Sticker]' }
    case 'location': return { type: 'location', text: '', body: `📍 ${m.location?.name || `${m.location?.latitude}, ${m.location?.longitude}`}` }
    case 'order': return { type: 'order', text: '', body: `🛒 Order: ${m.order?.product_items.length ?? 0} item(s)` }
    case 'reaction': return { type: 'reaction', text: '', body: `Reacted ${m.reaction?.emoji ?? ''}` }
    case 'contacts': return { type: 'contacts', text: '', body: `👤 ${m.contacts?.[0]?.name?.formatted_name ?? 'Contact card'}` }
    default: return { type: m.type, text: '', body: `[${m.type}]` }
  }
}

export async function processInboundMessage(num: WaNumber, m: WaMsg, profileName?: string) {
  if (get('SELECT id FROM messages WHERE wa_message_id = ?', m.id)) return // idempotency: Meta retries webhooks
  const workspaceId = num.workspace_id
  const { contact, created } = upsertContact(workspaceId, m.from, { name: profileName, source: 'whatsapp' })
  const conv = getOrCreateConversation(workspaceId, contact.id, num.id)
  const ex = extract(m)
  const mediaId = (m.image ?? m.video ?? m.audio ?? m.document ?? m.sticker)?.id
  const msgId = insert('messages', {
    workspace_id: workspaceId, conversation_id: conv.id, contact_id: contact.id, number_id: num.id, direction: 'in',
    type: ex.type, body: ex.body, payload: { ...m, media_id: mediaId }, wa_message_id: m.id, status: 'received', created_at: now(),
  })
  const wasResolved = conv.status === 'resolved'
  update('conversations', conv.id, {
    last_message_at: now(), last_inbound_at: now(), last_preview: ex.body.slice(0, 120), unread_count: conv.unread_count + 1,
    status: wasResolved ? 'open' : conv.status, ...(wasResolved ? { bot_paused: 0 } : {}),
  })
  update('contacts', contact.id, { last_seen_at: now() })
  const row = messageRow(msgId)
  publish(workspaceId, 'message', { conversation_id: conv.id, message: row, contact })
  emitEvent(workspaceId, 'message.received', { ...row, from: contact.wa_id, contact_name: contact.name })
  if (!num.is_demo) void markRead(num, m.id)

  if (m.type === 'order' && m.order) {
    const items = m.order.product_items.map((i) => {
      const p = get<{ name: string }>('SELECT name FROM products WHERE workspace_id = ? AND retailer_id = ?', workspaceId, i.product_retailer_id)
      return { retailer_id: i.product_retailer_id, name: p?.name ?? i.product_retailer_id, qty: i.quantity, price: i.item_price }
    })
    const total = items.reduce((s, i) => s + i.qty * i.price, 0)
    const oid = insert('orders', { workspace_id: workspaceId, contact_id: contact.id, items, total: Math.round(total), currency: m.order.product_items[0]?.currency || 'INR', source: 'whatsapp_cart', created_at: now() })
    notify(workspaceId, { title: 'New WhatsApp order', body: `${contact.name || contact.wa_id} ordered ${items.length} item(s)`, link: '/app/commerce', type: 'order' })
    emitEvent(workspaceId, 'order.created', get('SELECT * FROM orders WHERE id = ?', oid))
  }

  const freshConv = get<Conversation>('SELECT * FROM conversations WHERE id = ?', conv.id)!
  if (['text', 'interactive', 'button'].includes(ex.type) && ex.text) {
    await handleInbound(workspaceId, contact, freshConv, ex, created).catch((e) => console.error('automation error', e))
  }
}

type WebhookBody = { object?: string; entry?: { id: string; changes?: { field: string; value: Record<string, unknown> }[] }[] }

export async function processWebhook(body: WebhookBody) {
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const v = change.value as {
        metadata?: { phone_number_id: string }; contacts?: { wa_id: string; profile?: { name?: string } }[]
        messages?: WaMsg[]; statuses?: { id: string; status: string; errors?: { title?: string; message?: string; error_data?: { details?: string } }[] }[]
        event?: string; message_template_name?: string; message_template_language?: string; reason?: string; message_template_id?: number
      }
      if (change.field === 'message_template_status_update') {
        run('UPDATE templates SET status = ?, rejection_reason = ?, updated_at = ? WHERE wa_template_id = ? OR (name = ? AND language = ?)',
          v.event, v.reason && v.reason !== 'NONE' ? v.reason : null, now(), String(v.message_template_id ?? ''), v.message_template_name, v.message_template_language)
        continue
      }
      if (change.field !== 'messages' || !v.metadata) continue
      const num = get<WaNumber>('SELECT * FROM wa_numbers WHERE phone_number_id = ?', v.metadata.phone_number_id)
      if (!num) continue
      for (const s of v.statuses ?? []) {
        const e = s.errors?.[0]
        applyStatus(s.id, s.status, e ? (e.error_data?.details || e.message || e.title) : undefined)
      }
      for (const m of v.messages ?? []) {
        const profile = v.contacts?.find((c) => c.wa_id === m.from)?.profile?.name
        await processInboundMessage(num, m, profile)
      }
    }
  }
}

/** Lets teams test bots & flows without a live Meta number (used by the in-app simulator). */
export async function simulateInbound(num: WaNumber, from: string, text: string, name?: string, buttonId?: string) {
  const id = `wamid.sim.${crypto.randomBytes(8).toString('hex')}`
  const m: WaMsg = buttonId
    ? { id, from, type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: buttonId, title: text } } }
    : { id, from, type: 'text', text: { body: text } }
  await processInboundMessage(num, m, name)
}
