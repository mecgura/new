import { Router } from 'express'
import { z } from 'zod'
import { all, get, insert, run, update, now } from '../db.ts'
import { h, parse, bad, id, notFound } from '../lib/http.ts'
import { perm } from '../lib/auth.ts'
import { encrypt, randomToken } from '../lib/security.ts'
import { config } from '../config.ts'
import { inspectPage, subscribePage, publicChannel, type Channel } from '../services/channels.ts'
import { WhatsAppError } from '../services/whatsapp.ts'

export const channelRoutes = Router()
const P = perm('numbers.manage')

const webConfig = z.object({
  title: z.string().trim().max(40).optional(), subtitle: z.string().trim().max(80).optional(), greeting: z.string().trim().max(300).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(), position: z.enum(['right', 'left']).optional(),
  whatsapp: z.string().trim().max(20).optional(), ask_details: z.boolean().optional(), launcher_text: z.string().trim().max(30).optional(),
})
export const WEB_DEFAULTS = { title: 'Chat with us', subtitle: 'We usually reply in a few minutes', greeting: 'Hi 👋 How can we help you today?', color: '#10b981', position: 'right', whatsapp: '', ask_details: true, launcher_text: '' }

function out(c: Channel) {
  const base = publicChannel(c)
  if (c.type === 'web') {
    const src = `${config.apiUrl}/widget.js`
    return { ...base, config: { ...WEB_DEFAULTS, ...c.config }, embed: `<script src="${src}" data-key="${c.public_key}" async></script>` }
  }
  return base
}

channelRoutes.get('/channels', P, h((req, res) => {
  const rows = all<Channel>('SELECT * FROM channels WHERE workspace_id = ? ORDER BY id', req.ws!.id).map(out)
  const stats = all<{ channel_id: number; open: number; total: number }>(`SELECT channel_id, SUM(CASE WHEN status != 'resolved' THEN 1 ELSE 0 END) AS open, COUNT(*) AS total
    FROM conversations WHERE workspace_id = ? AND channel_id IS NOT NULL GROUP BY channel_id`, req.ws!.id)
  res.json({
    channels: rows.map((r) => ({ ...r, stats: stats.find((s) => s.channel_id === r.id) ?? { open: 0, total: 0 } })),
    meta_webhook: { url: `${config.apiUrl}/webhooks/meta`, verify_token: config.meta.verifyToken, app_configured: !!config.meta.appSecret },
    api: { inbound_url: `${config.apiUrl}/api/v1/inbound` },
  })
}))

channelRoutes.post('/channels', P, h(async (req, res) => {
  const b = parse(z.object({
    type: z.enum(['web', 'messenger', 'instagram', 'api']), name: z.string().trim().max(60).optional(),
    config: webConfig.optional(), page_id: z.string().trim().regex(/^\d{5,30}$/, 'Page ID is a number').optional(), page_token: z.string().trim().min(20).optional(),
  }), req.body)
  if (b.type === 'web' || b.type === 'api') {
    const cid = insert('channels', {
      workspace_id: req.ws!.id, type: b.type, name: b.name || (b.type === 'web' ? 'Website chat' : 'API'), public_key: b.type === 'web' ? `wk_${randomToken(16)}` : null,
      config: b.type === 'web' ? { ...WEB_DEFAULTS, ...b.config } : {}, created_at: now(),
    })
    return res.json(out(get<Channel>('SELECT * FROM channels WHERE id = ?', cid)!))
  }
  if (!b.page_id || !b.page_token) throw bad('Enter the Facebook Page ID and Page access token')
  let page: Awaited<ReturnType<typeof inspectPage>>
  try { page = await inspectPage(b.page_id, b.page_token) } catch (e) { throw bad(`Meta rejected the token: ${e instanceof WhatsAppError ? e.message : 'could not reach Meta'}`) }
  let externalId = page.id
  let name = b.name || page.name
  if (b.type === 'instagram') {
    if (!page.instagram_business_account?.id) throw bad('No Instagram professional account is linked to this Facebook Page. Link it in Meta Business Suite → Settings → Instagram accounts.')
    externalId = page.instagram_business_account.id
    name = b.name || (page.instagram_business_account.username ? `@${page.instagram_business_account.username}` : `${page.name} Instagram`)
  }
  const taken = get<{ workspace_id: number }>('SELECT workspace_id FROM channels WHERE type = ? AND external_id = ?', b.type, externalId)
  if (taken && taken.workspace_id !== req.ws!.id) throw bad('This account is already connected to another workspace')
  if (taken) run('DELETE FROM channels WHERE type = ? AND external_id = ? AND workspace_id = ?', b.type, externalId, req.ws!.id)
  const subscribed = await subscribePage(page.id, b.page_token)
  const cid = insert('channels', { workspace_id: req.ws!.id, type: b.type, name, external_id: externalId, access_token: encrypt(b.page_token), config: { page_id: page.id, page_name: page.name, subscribed }, created_at: now() })
  res.json(out(get<Channel>('SELECT * FROM channels WHERE id = ?', cid)!))
}))

channelRoutes.patch('/channels/:id', P, h((req, res) => {
  const c = get<Channel>('SELECT * FROM channels WHERE id = ? AND workspace_id = ?', id(req.params.id), req.ws!.id)
  if (!c) throw notFound('Channel')
  const b = parse(z.object({ name: z.string().trim().min(1).max(60).optional(), is_active: z.boolean().optional(), config: webConfig.optional() }), req.body)
  update('channels', c.id, { name: b.name, is_active: b.is_active === undefined ? undefined : b.is_active ? 1 : 0, config: b.config ? { ...c.config, ...b.config } : undefined })
  res.json(out(get<Channel>('SELECT * FROM channels WHERE id = ?', c.id)!))
}))

channelRoutes.post('/channels/:id/rotate-key', P, h((req, res) => {
  const c = get<Channel>("SELECT * FROM channels WHERE id = ? AND workspace_id = ? AND type = 'web'", id(req.params.id), req.ws!.id)
  if (!c) throw notFound('Channel')
  update('channels', c.id, { public_key: `wk_${randomToken(16)}` })
  res.json(out(get<Channel>('SELECT * FROM channels WHERE id = ?', c.id)!))
}))

channelRoutes.delete('/channels/:id', P, h((req, res) => {
  const c = get<Channel>('SELECT * FROM channels WHERE id = ? AND workspace_id = ?', id(req.params.id), req.ws!.id)
  if (!c) throw notFound('Channel')
  // Chats stay in the inbox as history; the channel just stops receiving and sending.
  run('DELETE FROM channels WHERE id = ?', c.id)
  res.json({ ok: true })
}))
