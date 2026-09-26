import { Router } from 'express'
import path from 'node:path'
import fs from 'node:fs'
import crypto from 'node:crypto'
import multer from 'multer'
import { z } from 'zod'
import { all, get, insert, run, update, now } from '../db.ts'
import { h, parse, bad, id, notFound, forbidden } from '../lib/http.ts'
import { perm } from '../lib/auth.ts'
import { can } from '../lib/permissions.ts'
import { publish } from '../lib/events.ts'
import { config } from '../config.ts'
import { sendToContact, upsertContact, getNumber, contactContext, notify, type Contact } from '../services/messaging.ts'
import { buildTemplateMessage, type TemplateVars } from '../services/campaigns.ts'
import { simulateInbound } from '../services/inbound.ts'
import { aiSuggest } from '../services/ai.ts'
import { emitEvent } from '../services/hooks.ts'
import { downloadMedia, type OutMessage, type WaNumber } from '../services/whatsapp.ts'

export const inboxRoutes = Router()

const uploadDir = path.join(config.dataDir, 'uploads')
fs.mkdirSync(uploadDir, { recursive: true })
const upload = multer({
  storage: multer.diskStorage({ destination: uploadDir, filename: (_r, f, cb) => cb(null, `${crypto.randomBytes(12).toString('hex')}${path.extname(f.originalname).toLowerCase().slice(0, 8)}`) }),
  limits: { fileSize: 16 * 1024 * 1024 },
})

function scopeFor(req: Parameters<Parameters<typeof h>[0]>[0]) {
  const settings = get<{ settings: { agents_see_all?: boolean } }>('SELECT settings FROM workspaces WHERE id = ?', req.ws!.id)!.settings
  return can(req.ws!.role, 'inbox.all') || settings.agents_see_all ? null : req.user!.id
}

function loadConv(req: Parameters<Parameters<typeof h>[0]>[0], convId: number) {
  const c = get<{ id: number; contact_id: number; number_id: number; assigned_to: number | null; status: string }>('SELECT * FROM conversations WHERE id = ? AND workspace_id = ?', convId, req.ws!.id)
  if (!c) throw notFound('Conversation')
  const own = scopeFor(req)
  if (own && c.assigned_to && c.assigned_to !== own) throw forbidden('This chat is assigned to another agent')
  return c
}

inboxRoutes.get('/conversations', perm('inbox.view'), h((req, res) => {
  const q = req.query as Record<string, string>
  const where = ['c.workspace_id = ?']; const p: unknown[] = [req.ws!.id]
  if (q.status && q.status !== 'all') { where.push('c.status = ?'); p.push(q.status) }
  if (q.number_id) { where.push('c.number_id = ?'); p.push(Number(q.number_id)) }
  if (q.assigned === 'me') { where.push('c.assigned_to = ?'); p.push(req.user!.id) }
  else if (q.assigned === 'unassigned') where.push('c.assigned_to IS NULL')
  else if (q.assigned && /^\d+$/.test(q.assigned)) { where.push('c.assigned_to = ?'); p.push(Number(q.assigned)) }
  if (q.unread === '1') where.push('c.unread_count > 0')
  if (q.tag) { where.push('EXISTS (SELECT 1 FROM json_each(ct.tags) WHERE value = ?)'); p.push(q.tag) }
  if (q.q) { where.push('(ct.name LIKE ? OR ct.wa_id LIKE ? OR c.last_preview LIKE ?)'); p.push(`%${q.q}%`, `%${q.q}%`, `%${q.q}%`) }
  const own = scopeFor(req)
  if (own) { where.push('(c.assigned_to = ? OR c.assigned_to IS NULL)'); p.push(own) }
  res.json(all(`SELECT c.*, ct.name AS contact_name, ct.wa_id, ct.tags, ct.stage, u.name AS agent_name, n.label AS number_label
    FROM conversations c JOIN contacts ct ON ct.id = c.contact_id LEFT JOIN users u ON u.id = c.assigned_to LEFT JOIN wa_numbers n ON n.id = c.number_id
    WHERE ${where.join(' AND ')} ORDER BY c.last_message_at DESC LIMIT 200`, ...p))
}))

inboxRoutes.get('/conversations/:id', perm('inbox.view'), h((req, res) => {
  const c = loadConv(req, id(req.params.id))
  const contact = get('SELECT * FROM contacts WHERE id = ?', c.contact_id)
  const notes = all('SELECT n.*, u.name AS user_name FROM notes n LEFT JOIN users u ON u.id = n.user_id WHERE n.contact_id = ? ORDER BY n.id DESC', c.contact_id)
  const orders = all('SELECT * FROM orders WHERE contact_id = ? ORDER BY id DESC LIMIT 5', c.contact_id)
  res.json({ ...get(`SELECT c.*, u.name AS agent_name, n.label AS number_label, n.display_phone FROM conversations c LEFT JOIN users u ON u.id = c.assigned_to
    LEFT JOIN wa_numbers n ON n.id = c.number_id WHERE c.id = ?`, c.id), contact, notes, orders })
}))

inboxRoutes.get('/conversations/:id/messages', perm('inbox.view'), h((req, res) => {
  const c = loadConv(req, id(req.params.id))
  const before = Number(req.query.before) || 1e15
  const rows = all('SELECT m.*, u.name AS agent_name FROM messages m LEFT JOIN users u ON u.id = m.user_id WHERE m.conversation_id = ? AND m.id < ? ORDER BY m.id DESC LIMIT 60', c.id, before)
  res.json(rows.reverse())
}))

const sendSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string().trim().min(1).max(4096) }),
  z.object({ type: z.enum(['image', 'video', 'document', 'audio']), link: z.string().url(), caption: z.string().max(1024).optional(), filename: z.string().max(200).optional() }),
  z.object({ type: z.literal('template'), template_id: z.number(), vars: z.record(z.string(), z.unknown()).optional() }),
  z.object({ type: z.literal('buttons'), text: z.string().min(1).max(1024), buttons: z.array(z.string().min(1).max(20)).min(1).max(3) }),
  z.object({ type: z.literal('cta_url'), text: z.string().min(1).max(1024), display_text: z.string().min(1).max(20), url: z.string().url() }),
  z.object({ type: z.literal('product'), product_id: z.number() }),
  z.object({ type: z.literal('payment'), amount: z.number().positive(), description: z.string().min(2).max(200) }),
])

export async function buildOutMessage(workspaceId: number, contact: Contact, b: z.infer<typeof sendSchema>): Promise<OutMessage> {
  switch (b.type) {
    case 'text': return { type: 'text', text: b.text }
    case 'template': {
      const t = get<Parameters<typeof buildTemplateMessage>[0]>('SELECT * FROM templates WHERE id = ? AND workspace_id = ?', b.template_id, workspaceId)
      if (!t) throw bad('Template not found')
      if (t.status !== 'APPROVED') throw bad('Only approved templates can be sent')
      return buildTemplateMessage(t, (b.vars ?? {}) as TemplateVars, contactContext(contact))
    }
    case 'buttons': return { type: 'buttons', text: b.text, buttons: b.buttons.map((t, i) => ({ id: `agent:${i}`, title: t })) }
    case 'cta_url': return b
    case 'product': {
      const p = get<{ name: string; price: number; currency: string; description: string | null; image_url: string | null; retailer_id: string | null }>('SELECT * FROM products WHERE id = ? AND workspace_id = ?', b.product_id, workspaceId)
      if (!p) throw bad('Product not found')
      const catalog = get<{ settings: { catalog_id?: string } }>('SELECT settings FROM workspaces WHERE id = ?', workspaceId)!.settings.catalog_id
      if (catalog && p.retailer_id) return { type: 'product', catalog_id: catalog, product_retailer_id: p.retailer_id, text: p.description || p.name }
      const caption = `*${p.name}*\n${p.currency === 'INR' ? '₹' : p.currency + ' '}${p.price.toLocaleString('en-IN')}${p.description ? `\n\n${p.description}` : ''}`
      return p.image_url ? { type: 'image', link: p.image_url, caption } : { type: 'text', text: caption }
    }
    case 'payment': {
      const { createPaymentForContact } = await import('./commerce.ts')
      const pay = await createPaymentForContact(workspaceId, contact, b.amount, b.description)
      return { type: 'cta_url', text: `💳 Payment request: ${b.description}\nAmount: ₹${b.amount.toLocaleString('en-IN')}`, display_text: 'Pay now', url: pay.short_url! }
    }
    default: return b
  }
}

inboxRoutes.post('/conversations/:id/messages', perm('inbox.reply'), h(async (req, res) => {
  const c = loadConv(req, id(req.params.id))
  const b = parse(sendSchema, req.body)
  const contact = get<Contact>('SELECT * FROM contacts WHERE id = ?', c.contact_id)!
  const message = await buildOutMessage(req.ws!.id, contact, b)
  const row = await sendToContact({ workspaceId: req.ws!.id, contactId: contact.id, numberId: c.number_id, message, sentBy: 'agent', userId: req.user!.id })
  if (!c.assigned_to) { update('conversations', c.id, { assigned_to: req.user!.id }); publish(req.ws!.id, 'conversation', { id: c.id }) }
  res.json(row)
}))

inboxRoutes.post('/conversations/:id/read', perm('inbox.view'), h((req, res) => {
  const c = loadConv(req, id(req.params.id))
  update('conversations', c.id, { unread_count: 0 })
  res.json({ ok: true })
}))

inboxRoutes.patch('/conversations/:id', perm('inbox.reply'), h((req, res) => {
  const c = loadConv(req, id(req.params.id))
  const b = parse(z.object({ status: z.enum(['open', 'pending', 'resolved']).optional(), assigned_to: z.number().nullable().optional(), bot_paused: z.boolean().optional() }), req.body)
  if (b.assigned_to !== undefined) {
    if (!can(req.ws!.role, 'inbox.assign') && b.assigned_to !== req.user!.id) throw forbidden('You can only assign chats to yourself')
    if (b.assigned_to && !get('SELECT id FROM memberships WHERE workspace_id = ? AND user_id = ?', req.ws!.id, b.assigned_to)) throw bad('User is not in this workspace')
  }
  update('conversations', c.id, b)
  if (b.assigned_to && b.assigned_to !== c.assigned_to) {
    notify(req.ws!.id, { title: 'Chat assigned to you', body: `by ${req.user!.name}`, link: `/app/inbox?c=${c.id}`, userId: b.assigned_to, type: 'assign' })
    emitEvent(req.ws!.id, 'conversation.assigned', { conversation_id: c.id, assigned_to: b.assigned_to })
  }
  if (b.status === 'resolved' && c.status !== 'resolved') emitEvent(req.ws!.id, 'conversation.resolved', { conversation_id: c.id })
  publish(req.ws!.id, 'conversation', { id: c.id })
  res.json(get('SELECT * FROM conversations WHERE id = ?', c.id))
}))

// Start a new chat with any number (template required outside the 24h window).
inboxRoutes.post('/conversations/start', perm('inbox.reply'), h(async (req, res) => {
  const b = parse(z.object({ phone: z.string().min(8), name: z.string().max(80).optional(), number_id: z.number().optional(),
    template_id: z.number(), vars: z.record(z.string(), z.unknown()).optional() }), req.body)
  const { contact } = upsertContact(req.ws!.id, b.phone, { name: b.name, source: 'manual' })
  const num = getNumber(req.ws!.id, b.number_id)
  const message = await buildOutMessage(req.ws!.id, contact, { type: 'template', template_id: b.template_id, vars: b.vars })
  const row = await sendToContact({ workspaceId: req.ws!.id, contactId: contact.id, numberId: num.id, message, sentBy: 'agent', userId: req.user!.id })
  res.json(row)
}))

inboxRoutes.post('/conversations/:id/ai-suggest', perm('inbox.reply'), h(async (req, res) => {
  const c = loadConv(req, id(req.params.id))
  res.json({ text: await aiSuggest(req.ws!.id, c.id) })
}))

inboxRoutes.post('/simulate', perm('inbox.reply'), h(async (req, res) => {
  const b = parse(z.object({ number_id: z.number().optional(), phone: z.string().min(8), name: z.string().max(80).optional(), text: z.string().min(1).max(1000), button_id: z.string().optional() }), req.body)
  const num = getNumber(req.ws!.id, b.number_id)
  const { normalizePhone } = await import('../lib/util.ts')
  await simulateInbound(num, normalizePhone(b.phone), b.text, b.name, b.button_id)
  const contact = get<{ id: number }>('SELECT id FROM contacts WHERE workspace_id = ? AND wa_id = ?', req.ws!.id, normalizePhone(b.phone))
  const conv = get<{ id: number }>('SELECT id FROM conversations WHERE contact_id = ? AND number_id = ?', contact?.id, num.id)
  res.json({ ok: true, conversation_id: conv?.id })
}))

inboxRoutes.get('/media/:messageId', perm('inbox.view'), h(async (req, res) => {
  const m = get<{ payload: { media_id?: string }; number_id: number }>('SELECT payload, number_id FROM messages WHERE id = ? AND workspace_id = ?', id(req.params.messageId), req.ws!.id)
  if (!m?.payload?.media_id) throw notFound('Media')
  const num = get<WaNumber>('SELECT * FROM wa_numbers WHERE id = ?', m.number_id)
  if (!num || num.is_demo) throw notFound('Media')
  const { buffer, mime } = await downloadMedia(num, m.payload.media_id)
  res.set({ 'Content-Type': mime, 'Cache-Control': 'private, max-age=86400' }).send(buffer)
}))

inboxRoutes.post('/uploads', perm('inbox.reply'), upload.single('file'), h((req, res) => {
  if (!req.file) throw bad('No file uploaded')
  res.json({ url: `${config.appUrl}/uploads/${req.file.filename}`, name: req.file.originalname, mime: req.file.mimetype, size: req.file.size })
}))

inboxRoutes.get('/quick-replies', h((req, res) => { res.json(all('SELECT * FROM quick_replies WHERE workspace_id = ? ORDER BY shortcut', req.ws!.id)) }))
inboxRoutes.post('/quick-replies', perm('inbox.reply'), h((req, res) => {
  const b = parse(z.object({ shortcut: z.string().trim().min(1).max(30).regex(/^[\w-]+$/, 'Use letters, numbers and dashes'), body: z.string().min(1).max(2000) }), req.body)
  res.json(get('SELECT * FROM quick_replies WHERE id = ?', insert('quick_replies', { workspace_id: req.ws!.id, ...b, created_at: now() })))
}))
inboxRoutes.delete('/quick-replies/:id', perm('inbox.reply'), h((req, res) => {
  run('DELETE FROM quick_replies WHERE id = ? AND workspace_id = ?', id(req.params.id), req.ws!.id); res.json({ ok: true })
}))
