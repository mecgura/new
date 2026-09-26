import { get, insert, run, update, now } from '../db.ts'
import { bad, HttpError } from '../lib/http.ts'
import { publish } from '../lib/events.ts'
import { decrypt, hmacHex, safeEqual } from '../lib/security.ts'
import { config } from '../config.ts'
import { call, previewOf, type OutMessage } from './whatsapp.ts'
import { autoAssign, messageRow, windowOpen, type Contact, type Conversation } from './messaging.ts'
import { checkLimit } from './plans.ts'
import { emitEvent } from './hooks.ts'
import { handleInbound } from './automation.ts'

/**
 * Non-WhatsApp inbound channels. Every channel lands in the same Team Inbox and runs the same bots, flows,
 * AI and auto-assign rules as WhatsApp:
 *   web       — the chat widget on the client's website (public key, polling)
 *   messenger — Facebook Page messages (Page access token)
 *   instagram — Instagram professional account DMs (via the linked Facebook Page token)
 *   api       — any external system (client's app/CRM) through the public REST API
 */
export const CHANNEL_TYPES = ['web', 'messenger', 'instagram', 'api'] as const
export type ChannelType = (typeof CHANNEL_TYPES)[number]
export type Channel = {
  id: number; workspace_id: number; type: ChannelType; name: string; external_id: string | null; public_key: string | null
  access_token: string | null; config: Record<string, unknown>; is_active: number; created_at: string
}
const PREFIX: Record<ChannelType, string> = { web: 'web', messenger: 'fb', instagram: 'ig', api: 'api' }

export const contactKey = (ch: Pick<Channel, 'id' | 'type'>, externalId: string) => `${PREFIX[ch.type]}:${ch.id}:${externalId}`
export const externalIdOf = (contact: Pick<Contact, 'wa_id'>) => contact.wa_id.split(':').slice(2).join(':')

export function publicChannel(c: Channel) {
  const { access_token, ...rest } = c
  return { ...rest, connected: !!access_token || c.type === 'web' || c.type === 'api' }
}

// ---------- Identity ----------
export function upsertChannelContact(ch: Channel, externalId: string, data: { name?: string; email?: string; phone?: string; attributes?: Record<string, unknown> } = {}) {
  const key = contactKey(ch, externalId)
  const existing = get<Contact>('SELECT * FROM contacts WHERE workspace_id = ? AND wa_id = ?', ch.workspace_id, key)
  const attrs = { ...(data.phone ? { phone: data.phone } : {}), ...(data.attributes ?? {}) }
  if (existing) {
    const patch: Record<string, unknown> = {}
    if (data.name && (!existing.name || existing.name === 'Website visitor')) patch.name = data.name
    if (data.email && !existing.email) patch.email = data.email
    if (Object.keys(attrs).length) patch.attributes = { ...existing.attributes, ...attrs }
    if (Object.keys(patch).length) update('contacts', existing.id, patch)
    return { contact: { ...existing, ...patch } as Contact, created: false }
  }
  checkLimit(ch.workspace_id, 'contacts')
  const cid = insert('contacts', {
    workspace_id: ch.workspace_id, wa_id: key, channel: ch.type, name: data.name ?? null, email: data.email ?? null, tags: [], attributes: attrs,
    stage: 'new', source: ch.type === 'web' ? 'website' : ch.type, created_at: now(),
  })
  const contact = get<Contact>('SELECT * FROM contacts WHERE id = ?', cid)!
  emitEvent(ch.workspace_id, 'contact.created', contact)
  publish(ch.workspace_id, 'contact', contact)
  return { contact, created: true }
}

export function channelConversation(ch: Channel, contactId: number): Conversation {
  const c = get<Conversation>('SELECT * FROM conversations WHERE workspace_id = ? AND contact_id = ? AND channel_id = ?', ch.workspace_id, contactId, ch.id)
  if (c) return c
  const cid = insert('conversations', { workspace_id: ch.workspace_id, contact_id: contactId, number_id: null, channel: ch.type, channel_id: ch.id, status: 'open', created_at: now(), last_message_at: now() })
  return get<Conversation>('SELECT * FROM conversations WHERE id = ?', cid)!
}

/** Conversation + channel a non-WhatsApp contact is reached on (used by sendToContact). */
export function channelFor(contact: Contact): { conv: Conversation; ch: Channel } {
  const conv = get<Conversation & { channel_id: number | null }>('SELECT * FROM conversations WHERE contact_id = ? AND channel_id IS NOT NULL ORDER BY id DESC LIMIT 1', contact.id)
  const ch = conv?.channel_id ? get<Channel>('SELECT * FROM channels WHERE id = ?', conv.channel_id) : undefined
  if (!conv || !ch) throw bad('This contact has no active chat channel')
  if (!ch.is_active) throw bad(`The ${ch.name} channel is turned off`)
  return { conv, ch }
}

export function assertChannelCanSend(ch: Channel, conv: Conversation, m: OutMessage) {
  if (m.type === 'template') throw bad('WhatsApp templates can only be sent to WhatsApp contacts. Send a normal message instead.')
  if ((ch.type === 'messenger' || ch.type === 'instagram') && !windowOpen(conv)) {
    throw new HttpError(409, `${ch.type === 'instagram' ? 'Instagram' : 'Messenger'} only allows replies within 24 hours of the customer's last message.`, 'window_closed')
  }
}

// ---------- Inbound (all channels) ----------
export type ChannelInbound = { externalId: string; text: string; buttonId?: string; mid?: string; type?: string; mediaUrl?: string; name?: string; email?: string; phone?: string }

export async function processChannelInbound(ch: Channel, m: ChannelInbound) {
  if (m.mid && get('SELECT id FROM messages WHERE wa_message_id = ?', m.mid)) return null
  const { contact, created } = upsertChannelContact(ch, m.externalId, { name: m.name, email: m.email, phone: m.phone })
  const conv = channelConversation(ch, contact.id)
  const type = m.type ?? (m.buttonId ? 'interactive' : 'text')
  const body = m.text || (m.mediaUrl ? `[${type}]` : '')
  const msgId = insert('messages', {
    workspace_id: ch.workspace_id, conversation_id: conv.id, contact_id: contact.id, number_id: null, direction: 'in', type, body,
    payload: { channel: ch.type, button_id: m.buttonId, media_url: m.mediaUrl }, wa_message_id: m.mid ?? null, status: 'received', created_at: now(),
  })
  const wasResolved = conv.status === 'resolved'
  update('conversations', conv.id, {
    last_message_at: now(), last_inbound_at: now(), last_preview: body.slice(0, 120), unread_count: conv.unread_count + 1,
    status: wasResolved ? 'open' : conv.status, ...(wasResolved ? { bot_paused: 0 } : {}),
  })
  update('contacts', contact.id, { last_seen_at: now() })
  const row = messageRow(msgId)
  publish(ch.workspace_id, 'message', { conversation_id: conv.id, message: row, contact })
  emitEvent(ch.workspace_id, 'message.received', { ...row, channel: ch.type, channel_id: ch.id, from: m.externalId, contact_name: contact.name })
  const agent = autoAssign(ch.workspace_id, conv.id)
  if (agent) emitEvent(ch.workspace_id, 'conversation.assigned', { conversation_id: conv.id, assigned_to: agent })
  const fresh = get<Conversation>('SELECT * FROM conversations WHERE id = ?', conv.id)!
  if (body && ['text', 'interactive', 'button'].includes(type)) {
    await handleInbound(ch.workspace_id, contact, fresh, { type, text: m.text, buttonId: m.buttonId }, created).catch((e) => console.error('automation error', e))
  }
  return { message_id: msgId, conversation_id: conv.id, contact_id: contact.id }
}

// ---------- Outbound transport ----------
type MetaMsg = Record<string, unknown>
function toMetaMessages(m: OutMessage): MetaMsg[] {
  const qr = (rows: { id: string; title: string }[]) => rows.slice(0, 13).map((r) => ({ content_type: 'text', title: r.title.slice(0, 20), payload: r.id }))
  switch (m.type) {
    case 'text': return [{ text: m.text.slice(0, 2000) }]
    case 'image': case 'video': case 'audio': case 'document': {
      const out: MetaMsg[] = [{ attachment: { type: m.type === 'document' ? 'file' : m.type, payload: { url: (m as { link?: string }).link, is_reusable: true } } }]
      const cap = (m as { caption?: string }).caption
      return cap ? [...out, { text: cap }] : out
    }
    case 'buttons': return [{ text: m.text.slice(0, 2000), quick_replies: qr(m.buttons) }]
    case 'list': {
      const rows = m.sections.flatMap((s) => s.rows)
      return [{ text: `${m.text}\n\n${rows.map((r, i) => `${i + 1}. ${r.title}`).join('\n')}`.slice(0, 2000), quick_replies: qr(rows) }]
    }
    case 'cta_url': return [{ text: `${m.text}\n${m.url}`.slice(0, 2000) }]
    default: return [{ text: previewOf(m).slice(0, 2000) || '…' }]
  }
}

/** Delivers a message on a non-WhatsApp channel. Returns the provider message id (if any). */
export async function deliverOnChannel(ch: Channel, contact: Contact, m: OutMessage): Promise<string | null> {
  if (ch.type === 'web' || ch.type === 'api') return null // widget polls; API consumers get the message.sent webhook
  const token = decrypt(ch.access_token)
  if (!token) throw new Error(`${ch.name} is not connected (missing Page access token)`)
  let last: string | null = null
  for (const msg of toMetaMessages(m)) {
    const r = await call<{ message_id?: string; id?: string }>(token, 'me/messages', {
      method: 'POST', body: JSON.stringify({ recipient: { id: externalIdOf(contact) }, messaging_type: 'RESPONSE', message: msg }),
    })
    last = r.message_id ?? r.id ?? last
  }
  return last
}

// ---------- Meta webhooks for Messenger & Instagram ----------
type MessagingEvent = {
  sender?: { id: string }; recipient?: { id: string }; timestamp?: number
  message?: { mid: string; text?: string; is_echo?: boolean; quick_reply?: { payload: string }; attachments?: { type: string; payload?: { url?: string } }[] }
  postback?: { title?: string; payload?: string; mid?: string }
}
export type MessagingWebhook = { object?: string; entry?: { id: string; messaging?: MessagingEvent[] }[] }

async function profileName(ch: Channel, psid: string) {
  const token = decrypt(ch.access_token)
  if (!token) return undefined
  try {
    const p = await call<{ name?: string; first_name?: string; last_name?: string; username?: string }>(token, `${psid}?fields=${ch.type === 'instagram' ? 'name,username' : 'first_name,last_name'}`, { signal: AbortSignal.timeout(4000) })
    return p.name || [p.first_name, p.last_name].filter(Boolean).join(' ') || (p.username ? `@${p.username}` : undefined)
  } catch { return undefined }
}

export async function processMessagingWebhook(body: MessagingWebhook) {
  const type: ChannelType = body.object === 'instagram' ? 'instagram' : 'messenger'
  for (const entry of body.entry ?? []) {
    const ch = get<Channel>('SELECT * FROM channels WHERE type = ? AND external_id = ? AND is_active = 1', type, entry.id)
    if (!ch) continue
    for (const ev of entry.messaging ?? []) {
      const psid = ev.sender?.id
      if (!psid || psid === entry.id || ev.message?.is_echo) continue
      const known = get('SELECT id FROM contacts WHERE workspace_id = ? AND wa_id = ?', ch.workspace_id, contactKey(ch, psid))
      const name = known ? undefined : await profileName(ch, psid)
      if (ev.postback) {
        await processChannelInbound(ch, { externalId: psid, name, text: ev.postback.title ?? '', buttonId: ev.postback.payload, mid: ev.postback.mid, type: 'button' })
      } else if (ev.message) {
        const att = ev.message.attachments?.[0]
        await processChannelInbound(ch, {
          externalId: psid, name, text: ev.message.text ?? '', buttonId: ev.message.quick_reply?.payload, mid: ev.message.mid,
          type: ev.message.quick_reply ? 'interactive' : att && !ev.message.text ? (att.type === 'file' ? 'document' : att.type) : 'text', mediaUrl: att?.payload?.url,
        })
      }
    }
  }
}

/** Checks a Page token and returns the Page (and linked Instagram account). */
export async function inspectPage(pageId: string, token: string) {
  const p = await call<{ id: string; name: string; instagram_business_account?: { id: string; username?: string } }>(token, `${pageId}?fields=id,name,instagram_business_account{id,username}`)
  return p
}
export async function subscribePage(pageId: string, token: string) {
  try {
    await call(token, `${pageId}/subscribed_apps?subscribed_fields=messages,messaging_postbacks`, { method: 'POST' })
    return true
  } catch (e) { console.warn('page subscribe failed', (e as Error).message); return false }
}

// ---------- Website widget visitor tokens ----------
export const visitorToken = (ch: Channel, vid: string) => hmacHex(config.appSecret, `widget:${ch.id}:${vid}`).slice(0, 40)
export const checkVisitor = (ch: Channel, vid: string, token: string) => /^[A-Za-z0-9_-]{8,64}$/.test(vid) && safeEqual(visitorToken(ch, vid), token)

export function markChannelDelivered(convId: number) {
  run("UPDATE messages SET status = 'delivered' WHERE conversation_id = ? AND direction = 'out' AND status = 'sent'", convId)
}
