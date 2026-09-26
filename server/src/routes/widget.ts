import { Router, type Request, type Response, type NextFunction } from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { all, get, run } from '../db.ts'
import { h, parse, bad, HttpError } from '../lib/http.ts'
import { randomToken } from '../lib/security.ts'
import { processChannelInbound, contactKey, visitorToken, checkVisitor, markChannelDelivered, type Channel } from '../services/channels.ts'
import { WEB_DEFAULTS } from './channels.ts'

/** Public endpoints used by the website chat widget (embedded on any client site, so CORS is open). */
export const widgetRoutes = Router()

const here = path.dirname(fileURLToPath(import.meta.url))
let script: string | null = null
widgetRoutes.get('/widget.js', (_req, res) => {
  script ??= fs.readFileSync(path.join(here, '../widget/widget.js'), 'utf8')
  res.set({ 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=600', 'Access-Control-Allow-Origin': '*' }).send(script)
})

widgetRoutes.use('/widget', (req, res, next) => {
  res.set({ 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Max-Age': '86400' })
  if (req.method === 'OPTIONS') return res.sendStatus(204)
  next()
})

// Tiny fixed-window limiter per IP + widget key (no external store needed on a single VPS).
const hits = new Map<string, { n: number; reset: number }>()
function limit(max: number) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const k = `${req.ip}|${req.params.key}|${req.method}`
    const t = Date.now()
    const e = hits.get(k)
    if (!e || e.reset < t) hits.set(k, { n: 1, reset: t + 60000 })
    else if (++e.n > max) return next(new HttpError(429, 'Too many messages, please slow down'))
    if (hits.size > 50000) for (const [key, v] of hits) if (v.reset < t) hits.delete(key)
    next()
  }
}

function channel(key: string) {
  const ch = get<Channel>("SELECT * FROM channels WHERE public_key = ? AND type = 'web'", key)
  if (!ch || !ch.is_active) throw new HttpError(404, 'Chat is not available')
  return ch
}

function online(workspaceId: number) {
  return !!get("SELECT id FROM memberships WHERE workspace_id = ? AND is_online = 1 AND role IN ('owner','admin','manager','agent') LIMIT 1", workspaceId)
}

type Row = { id: number; direction: string; type: string; body: string; payload: Record<string, unknown>; created_at: string; sent_by: string | null; agent: string | null }
function shape(m: Row) {
  const p = m.payload ?? {}
  const buttons = m.type === 'buttons' ? (p.buttons as { id: string; title: string }[] | undefined)
    : m.type === 'list' ? (p.sections as { rows: { id: string; title: string }[] }[] | undefined)?.flatMap((s) => s.rows) : undefined
  return {
    id: m.id, from: m.direction === 'in' ? 'visitor' : m.sent_by === 'agent' ? 'agent' : 'bot', text: m.body, created_at: m.created_at,
    agent: m.direction === 'out' && m.sent_by === 'agent' ? (m.agent ?? '').split(' ')[0] || null : null,
    buttons: m.direction === 'out' ? buttons?.map((b) => ({ id: b.id, title: b.title })) : undefined,
    media: ['image', 'video', 'document', 'audio'].includes(m.type) ? { type: m.type, url: p.link as string } : undefined,
    link: m.type === 'cta_url' ? { url: p.url as string, text: p.display_text as string } : undefined,
  }
}

function history(ch: Channel, vid: string, after: number) {
  const conv = get<{ id: number }>('SELECT v.id FROM conversations v JOIN contacts c ON c.id = v.contact_id WHERE v.channel_id = ? AND c.wa_id = ?', ch.id, contactKey(ch, vid))
  if (!conv) return []
  markChannelDelivered(conv.id)
  return all<Row>(`SELECT m.id, m.direction, m.type, m.body, m.payload, m.created_at, m.sent_by, u.name AS agent FROM messages m LEFT JOIN users u ON u.id = m.user_id
    WHERE m.conversation_id = ? AND m.id > ? AND m.status != 'failed' ORDER BY m.id LIMIT 200`, conv.id, after).map(shape)
}

widgetRoutes.get('/widget/:key/config', limit(120), h((req, res) => {
  const ch = channel(String(req.params.key))
  const c = { ...WEB_DEFAULTS, ...ch.config } as typeof WEB_DEFAULTS
  const ws = get<{ name: string }>('SELECT name FROM workspaces WHERE id = ?', ch.workspace_id)!
  res.json({ title: c.title, subtitle: c.subtitle, greeting: c.greeting, color: c.color, position: c.position, ask_details: c.ask_details, launcher_text: c.launcher_text,
    business: ws.name, online: online(ch.workspace_id), whatsapp: c.whatsapp ? `https://wa.me/${c.whatsapp.replace(/\D/g, '')}` : null })
}))

widgetRoutes.post('/widget/:key/session', limit(20), h((req, res) => {
  const ch = channel(String(req.params.key))
  const b = parse(z.object({ visitor_id: z.string().optional(), token: z.string().optional() }), req.body ?? {})
  if (b.visitor_id && b.token && checkVisitor(ch, b.visitor_id, b.token)) return res.json({ visitor_id: b.visitor_id, token: b.token })
  const vid = randomToken(12)
  res.json({ visitor_id: vid, token: visitorToken(ch, vid) })
}))

const auth = z.object({ vid: z.string().min(8).max(64), token: z.string().min(10).max(80) })

widgetRoutes.get('/widget/:key/messages', limit(90), h((req, res) => {
  const ch = channel(String(req.params.key))
  const q = parse(auth.extend({ after: z.coerce.number().int().min(0).default(0) }), req.query)
  if (!checkVisitor(ch, q.vid, q.token)) throw new HttpError(401, 'Session expired')
  res.json({ messages: history(ch, q.vid, q.after), online: online(ch.workspace_id) })
}))

widgetRoutes.post('/widget/:key/messages', limit(30), h(async (req, res) => {
  const ch = channel(String(req.params.key))
  const b = parse(auth.extend({
    text: z.string().trim().max(2000).default(''), button_id: z.string().max(256).optional(), after: z.number().int().min(0).default(0),
    name: z.string().trim().max(80).optional(), email: z.string().trim().email().max(120).optional().or(z.literal('')), phone: z.string().trim().max(20).optional(), page: z.string().max(500).optional(),
  }), req.body)
  if (!checkVisitor(ch, b.vid, b.token)) throw new HttpError(401, 'Session expired')
  if (!b.text && !b.button_id) throw bad('Type a message')
  await processChannelInbound(ch, {
    externalId: b.vid, text: b.text, buttonId: b.button_id, name: b.name || undefined, email: b.email || undefined,
    phone: b.phone || undefined, type: b.button_id ? 'interactive' : 'text',
  })
  if (b.page) {
    const c = get<{ id: number; attributes: Record<string, unknown> }>('SELECT id, attributes FROM contacts WHERE workspace_id = ? AND wa_id = ?', ch.workspace_id, contactKey(ch, b.vid))
    if (c && c.attributes.last_page !== b.page) run('UPDATE contacts SET attributes = ? WHERE id = ?', { ...c.attributes, last_page: b.page }, c.id)
  }
  res.json({ messages: history(ch, b.vid, b.after), online: online(ch.workspace_id) })
}))
