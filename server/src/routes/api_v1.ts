import { Router } from 'express'
import { z } from 'zod'
import { all, get, insert, now } from '../db.ts'
import { h, parse, bad, id, notFound, paginate } from '../lib/http.ts'
import { requireApiKey } from '../lib/auth.ts'
import { upsertContact, sendToContact, getNumber, type Contact } from '../services/messaging.ts'
import { startFlow, onTagAdded } from '../services/automation.ts'
import { buildOutMessage } from './inbox.ts'
import { normalizePhone } from '../lib/util.ts'
import { processChannelInbound, type Channel } from '../services/channels.ts'

// Public REST API for client developers, CRMs, Zapier/Make and website forms.
export const apiV1 = Router()
apiV1.use(requireApiKey)

apiV1.get('/me', h((req, res) => {
  res.json({ workspace: { id: req.ws!.id, name: req.ws!.name }, numbers: all('SELECT id, label, display_phone, is_default FROM wa_numbers WHERE workspace_id = ?', req.ws!.id) })
}))

apiV1.post('/messages', h(async (req, res) => {
  const b = parse(z.object({
    to: z.string().min(8), name: z.string().max(80).optional(), number_id: z.number().optional(),
    type: z.enum(['text', 'template', 'image', 'video', 'document', 'buttons', 'cta_url']),
    text: z.string().max(4096).optional(), template: z.string().optional(), language: z.string().optional(), variables: z.array(z.string()).optional(),
    header_media: z.string().url().optional(), link: z.string().url().optional(), caption: z.string().max(1024).optional(), filename: z.string().optional(),
    buttons: z.array(z.string().max(20)).max(3).optional(), url: z.string().url().optional(), display_text: z.string().max(20).optional(),
  }), req.body)
  const { contact } = upsertContact(req.ws!.id, b.to, { name: b.name, source: 'api' })
  let payload: Parameters<typeof buildOutMessage>[2]
  if (b.type === 'template') {
    const t = get<{ id: number }>("SELECT id FROM templates WHERE workspace_id = ? AND name = ? AND (? IS NULL OR language = ?) AND status = 'APPROVED'", req.ws!.id, b.template, b.language ?? null, b.language ?? null)
    if (!t) throw bad(`Approved template "${b.template}" not found`)
    payload = { type: 'template', template_id: t.id, vars: { body: b.variables ?? [], header_media: b.header_media } }
  } else if (b.type === 'text') payload = { type: 'text', text: b.text ?? '' }
  else if (b.type === 'buttons') payload = { type: 'buttons', text: b.text ?? '', buttons: b.buttons ?? [] }
  else if (b.type === 'cta_url') payload = { type: 'cta_url', text: b.text ?? '', url: b.url ?? '', display_text: b.display_text ?? 'Open' }
  else payload = { type: b.type, link: b.link ?? '', caption: b.caption, filename: b.filename }
  const num = getNumber(req.ws!.id, b.number_id)
  const message = await buildOutMessage(req.ws!.id, contact, payload)
  const row = await sendToContact({ workspaceId: req.ws!.id, contactId: contact.id, numberId: num.id, message, sentBy: 'api' })
  res.status(row.status === 'failed' ? 422 : 200).json({ id: row.id, status: row.status, error: row.error, wa_message_id: row.wa_message_id, contact_id: contact.id })
}))

apiV1.get('/messages/:id', h((req, res) => {
  const m = get('SELECT id, direction, type, body, status, error, wa_message_id, created_at FROM messages WHERE id = ? AND workspace_id = ?', id(req.params.id), req.ws!.id)
  if (!m) throw notFound('Message')
  res.json(m)
}))

apiV1.get('/contacts', h((req, res) => {
  const { limit, offset, page } = paginate(req.query as Record<string, unknown>)
  res.json({ page, data: all('SELECT id, wa_id AS phone, name, email, tags, attributes, stage, opted_out, created_at FROM contacts WHERE workspace_id = ? ORDER BY id DESC LIMIT ? OFFSET ?', req.ws!.id, limit, offset) })
}))
apiV1.get('/contacts/:phone', h((req, res) => {
  const c = get('SELECT id, wa_id AS phone, name, email, tags, attributes, stage, opted_out, created_at FROM contacts WHERE workspace_id = ? AND wa_id = ?', req.ws!.id, normalizePhone(String(req.params.phone)))
  if (!c) throw notFound('Contact')
  res.json(c)
}))
apiV1.post('/contacts', h(async (req, res) => {
  const b = parse(z.object({ phone: z.string().min(8), name: z.string().max(120).optional(), email: z.string().email().optional(), tags: z.array(z.string()).optional(),
    attributes: z.record(z.string(), z.unknown()).optional(), stage: z.string().optional() }), req.body)
  const before = get<{ tags: string[] }>('SELECT tags FROM contacts WHERE workspace_id = ? AND wa_id = ?', req.ws!.id, normalizePhone(b.phone))
  const { contact, created } = upsertContact(req.ws!.id, b.phone, { ...b, source: 'api' })
  for (const t of (b.tags ?? []).filter((t) => !(before?.tags ?? []).includes(t))) await onTagAdded(req.ws!.id, contact.id, t)
  res.status(created ? 201 : 200).json({ id: contact.id, created })
}))

apiV1.get('/templates', h((req, res) => {
  res.json(all("SELECT id, name, language, category, status, components FROM templates WHERE workspace_id = ? ORDER BY name", req.ws!.id))
}))

apiV1.post('/flows/:id/trigger', h(async (req, res) => {
  const b = parse(z.object({ to: z.string().min(8), name: z.string().optional(), variables: z.record(z.string(), z.unknown()).optional() }), req.body)
  const flow = get<{ id: number }>('SELECT id FROM flows WHERE id = ? AND workspace_id = ?', id(req.params.id), req.ws!.id)
  if (!flow) throw notFound('Flow')
  const { contact } = upsertContact(req.ws!.id, b.to, { name: b.name, attributes: b.variables, source: 'api' })
  const conv = get<{ id: number }>('SELECT id FROM conversations WHERE contact_id = ? ORDER BY last_message_at DESC LIMIT 1', (contact as Contact).id)
  await startFlow(flow.id, contact.id, conv?.id ?? null)
  res.json({ ok: true, contact_id: contact.id })
}))

// ---- Custom channel: connect any website, app or CRM chat to the Team Inbox ----
// Messages you POST here run through the same bots, flows, AI and agents as WhatsApp. Bot replies come back in
// the response; later agent replies arrive via the `message.sent` webhook (channel "api") or by polling below.
apiV1.post('/inbound', h(async (req, res) => {
  const b = parse(z.object({
    user_id: z.string().trim().min(1).max(120), text: z.string().max(4096).default(''), button_id: z.string().max(256).optional(),
    name: z.string().max(120).optional(), email: z.string().email().optional(), phone: z.string().max(20).optional(), channel: z.string().trim().max(60).default('API'),
  }), req.body)
  if (!b.text && !b.button_id) throw bad('text is required')
  let ch = get<Channel>("SELECT * FROM channels WHERE workspace_id = ? AND type = 'api' AND name = ?", req.ws!.id, b.channel)
  if (!ch) ch = get<Channel>('SELECT * FROM channels WHERE id = ?', insert('channels', { workspace_id: req.ws!.id, type: 'api', name: b.channel, config: {}, created_at: now() }))!
  if (!ch.is_active) throw bad(`The "${ch.name}" channel is turned off`)
  const r = await processChannelInbound(ch, { externalId: b.user_id, text: b.text, buttonId: b.button_id, name: b.name, email: b.email, phone: b.phone })
  const replies = all("SELECT id, type, body, payload, sent_by, created_at FROM messages WHERE conversation_id = ? AND direction = 'out' AND id > ? ORDER BY id", r!.conversation_id, r!.message_id)
  res.json({ ...r, replies })
}))

apiV1.get('/conversations/:id/messages', h((req, res) => {
  const conv = get<{ id: number }>('SELECT id FROM conversations WHERE id = ? AND workspace_id = ?', id(req.params.id), req.ws!.id)
  if (!conv) throw notFound('Conversation')
  const after = Number(req.query.after) || 0
  res.json(all('SELECT id, direction, type, body, payload, status, sent_by, created_at FROM messages WHERE conversation_id = ? AND id > ? ORDER BY id LIMIT 200', conv.id, after))
}))
