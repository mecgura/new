import { all, get, insert, run, update, now } from '../db.ts'
import { HttpError, bad } from '../lib/http.ts'
import { publish } from '../lib/events.ts'
import { normalizePhone, isValidPhone } from '../lib/util.ts'
import { sendMessage, previewOf, type OutMessage, type WaNumber, WhatsAppError } from './whatsapp.ts'
import { addUsage, checkLimit } from './plans.ts'
import { emitEvent } from './hooks.ts'
import { assertCanSend } from './subscription.ts'

export type Contact = {
  id: number; workspace_id: number; wa_id: string; name: string | null; email: string | null; tags: string[]
  attributes: Record<string, unknown>; stage: string; opted_out: number; owner_id: number | null; created_at: string
}
export type Conversation = {
  id: number; workspace_id: number; contact_id: number; number_id: number | null; status: string; assigned_to: number | null
  bot_paused: number; last_inbound_at: string | null; unread_count: number
}

export function getNumber(workspaceId: number, numberId?: number | null): WaNumber {
  const n = numberId
    ? get<WaNumber>('SELECT * FROM wa_numbers WHERE id = ? AND workspace_id = ?', numberId, workspaceId)
    : get<WaNumber>('SELECT * FROM wa_numbers WHERE workspace_id = ? ORDER BY is_default DESC, id LIMIT 1', workspaceId)
  if (!n) throw bad('Connect a WhatsApp number first (WhatsApp Numbers → Connect number).', 'no_number')
  return n
}

export function upsertContact(workspaceId: number, rawPhone: string, data: Partial<Pick<Contact, 'name' | 'email' | 'tags' | 'attributes' | 'stage'>> & { source?: string } = {}) {
  const wa_id = normalizePhone(rawPhone)
  if (!isValidPhone(wa_id)) throw bad(`Invalid phone number: ${rawPhone}`)
  const existing = get<Contact>('SELECT * FROM contacts WHERE workspace_id = ? AND wa_id = ?', workspaceId, wa_id)
  if (existing) {
    const patch: Record<string, unknown> = {}
    if (data.name && !existing.name) patch.name = data.name
    if (data.email) patch.email = data.email
    if (data.tags?.length) patch.tags = [...new Set([...existing.tags, ...data.tags])]
    if (data.attributes) patch.attributes = { ...existing.attributes, ...data.attributes }
    if (data.stage) patch.stage = data.stage
    if (Object.keys(patch).length) {
      update('contacts', existing.id, patch)
      emitEvent(workspaceId, 'contact.updated', { id: existing.id, wa_id, ...patch })
    }
    return { contact: { ...existing, ...patch } as Contact, created: false }
  }
  checkLimit(workspaceId, 'contacts')
  const idNew = insert('contacts', {
    workspace_id: workspaceId, wa_id, name: data.name ?? null, email: data.email ?? null, tags: data.tags ?? [],
    attributes: data.attributes ?? {}, stage: data.stage ?? 'new', source: data.source ?? 'whatsapp', created_at: now(),
  })
  const contact = get<Contact>('SELECT * FROM contacts WHERE id = ?', idNew)!
  emitEvent(workspaceId, 'contact.created', contact)
  publish(workspaceId, 'contact', contact)
  return { contact, created: true }
}

export function getOrCreateConversation(workspaceId: number, contactId: number, numberId: number): Conversation {
  const c = get<Conversation>('SELECT * FROM conversations WHERE workspace_id = ? AND contact_id = ? AND number_id = ?', workspaceId, contactId, numberId)
  if (c) return c
  const cid = insert('conversations', { workspace_id: workspaceId, contact_id: contactId, number_id: numberId, status: 'open', created_at: now(), last_message_at: now() })
  return get<Conversation>('SELECT * FROM conversations WHERE id = ?', cid)!
}

export const windowOpen = (conv: Pick<Conversation, 'last_inbound_at'>) =>
  !!conv.last_inbound_at && Date.now() - new Date(conv.last_inbound_at).getTime() < 24 * 3600 * 1000

type SendOpts = {
  workspaceId: number; contactId: number; numberId?: number | null; message: OutMessage
  sentBy: 'agent' | 'bot' | 'flow' | 'ai' | 'campaign' | 'api' | 'sequence' | 'system'; userId?: number | null; campaignId?: number | null
  marketing?: boolean
}

export function messageRow(id: number) {
  return get('SELECT m.*, u.name AS agent_name FROM messages m LEFT JOIN users u ON u.id = m.user_id WHERE m.id = ?', id)
}

/** Single entry point for every outbound WhatsApp message on the platform. */
export async function sendToContact(o: SendOpts) {
  assertCanSend(o.workspaceId)
  const contact = get<Contact>('SELECT * FROM contacts WHERE id = ? AND workspace_id = ?', o.contactId, o.workspaceId)
  if (!contact) throw bad('Contact not found')
  if (contact.opted_out && o.marketing) throw bad('Contact has opted out of messages', 'opted_out')
  const num = getNumber(o.workspaceId, o.numberId)
  const conv = getOrCreateConversation(o.workspaceId, contact.id, num.id)
  if (o.message.type !== 'template' && !windowOpen(conv) && !num.is_demo) {
    throw new HttpError(409, 'The 24-hour customer service window is closed. Send an approved template to restart the conversation.', 'window_closed')
  }
  checkLimit(o.workspaceId, 'messages')
  const body = previewOf(o.message)
  const msgId = insert('messages', {
    workspace_id: o.workspaceId, conversation_id: conv.id, contact_id: contact.id, number_id: num.id, direction: 'out',
    type: o.message.type, body, payload: o.message, status: 'queued', sent_by: o.sentBy, user_id: o.userId ?? null,
    campaign_id: o.campaignId ?? null, created_at: now(),
  })
  const convPatch: Record<string, unknown> = { last_message_at: now(), last_preview: body.slice(0, 120) }
  if (o.sentBy === 'agent') { convPatch.unread_count = 0; if (conv.status === 'resolved') convPatch.status = 'open' }
  if (o.sentBy === 'agent' && !get('SELECT first_response_at FROM conversations WHERE id = ? AND first_response_at IS NOT NULL', conv.id)) convPatch.first_response_at = now()
  update('conversations', conv.id, convPatch)
  try {
    const { wamid } = await sendMessage(num, contact.wa_id, o.message)
    run("UPDATE messages SET status = 'sent', wa_message_id = ? WHERE id = ?", wamid, msgId)
    addUsage(o.workspaceId, 'messages')
    if (o.sentBy === 'ai') addUsage(o.workspaceId, 'ai_replies')
    if (num.is_demo) simulateDemoStatuses(wamid)
  } catch (e) {
    const err = e instanceof WhatsAppError ? e.message : 'Failed to send message'
    run("UPDATE messages SET status = 'failed', error = ? WHERE id = ?", err, msgId)
  }
  const row = messageRow(msgId)
  publish(o.workspaceId, 'message', { conversation_id: conv.id, message: row })
  emitEvent(o.workspaceId, 'message.sent', { ...row, to: contact.wa_id })
  return row as Record<string, unknown> & { id: number; status: string; error: string | null }
}

const STATUS_RANK: Record<string, number> = { queued: 0, sent: 1, delivered: 2, read: 3, failed: 4 }

export function applyStatus(wamid: string, status: string, error?: string) {
  const m = get<{ id: number; workspace_id: number; status: string; campaign_id: number | null; conversation_id: number }>(
    'SELECT id, workspace_id, status, campaign_id, conversation_id FROM messages WHERE wa_message_id = ?', wamid)
  if (!m) return
  if ((STATUS_RANK[status] ?? 0) <= (STATUS_RANK[m.status] ?? 0) && status !== 'failed') return
  run('UPDATE messages SET status = ?, error = COALESCE(?, error) WHERE id = ?', status, error ?? null, m.id)
  if (m.campaign_id) {
    const col = status === 'failed' ? 'failed' : status
    if (['delivered', 'read', 'failed'].includes(col)) {
      run(`UPDATE campaigns SET ${col} = ${col} + 1 ${col === 'read' && m.status !== 'delivered' ? ', delivered = delivered + 1' : ''} WHERE id = ?`, m.campaign_id)
      if (col === 'failed') run('UPDATE campaigns SET sent = MAX(sent - 1, 0) WHERE id = ?', m.campaign_id)
    }
  }
  publish(m.workspace_id, 'status', { message_id: m.id, conversation_id: m.conversation_id, status, error })
  // Webhook consumers get every transition.
  emitEvent(m.workspace_id, 'message.status', { message_id: m.id, wa_message_id: wamid, status, error })
}

function simulateDemoStatuses(wamid: string) {
  setTimeout(() => applyStatus(wamid, 'delivered'), 1200)
  setTimeout(() => applyStatus(wamid, 'read'), 4000)
}

export function contactContext(contact: Contact) {
  return {
    name: contact.name || 'there', first_name: (contact.name || 'there').split(' ')[0], phone: contact.wa_id,
    email: contact.email || '', ...contact.attributes, contact: { ...contact, ...contact.attributes },
  }
}

export function notify(workspaceId: number, n: { title: string; body?: string; link?: string; type?: string; userId?: number | null }) {
  const nid = insert('notifications', { workspace_id: workspaceId, user_id: n.userId ?? null, type: n.type ?? 'info', title: n.title, body: n.body ?? '', link: n.link ?? '', created_at: now() })
  publish(workspaceId, 'notification', get('SELECT * FROM notifications WHERE id = ?', nid))
}

export function roundRobinAgent(workspaceId: number): number | null {
  const agents = all<{ user_id: number }>("SELECT user_id FROM memberships WHERE workspace_id = ? AND role IN ('agent','manager','admin','owner') AND is_online = 1 ORDER BY user_id", workspaceId)
  if (!agents.length) return null
  const ws = get<{ rr_cursor: number }>('SELECT rr_cursor FROM workspaces WHERE id = ?', workspaceId)!
  const pick = agents[ws.rr_cursor % agents.length].user_id
  run('UPDATE workspaces SET rr_cursor = rr_cursor + 1 WHERE id = ?', workspaceId)
  return pick
}
