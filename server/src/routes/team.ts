import { Router } from 'express'
import { z } from 'zod'
import { all, get, insert, run, update, now } from '../db.ts'
import { h, parse, bad, id, forbidden } from '../lib/http.ts'
import { perm } from '../lib/auth.ts'
import { ROLES, PERMISSIONS, ROLE_PERMISSIONS } from '../lib/permissions.ts'
import { randomToken, sha256 } from '../lib/security.ts'
import { checkLimit, requireFeature } from '../services/plans.ts'
import { WEBHOOK_EVENTS } from '../services/hooks.ts'
import { config } from '../config.ts'

export const teamRoutes = Router()

teamRoutes.get('/team', h((req, res) => {
  const members = all(`SELECT m.id, m.role, m.is_online, m.created_at, u.id AS user_id, u.name, u.email, u.last_login_at,
    (SELECT COUNT(*) FROM conversations c WHERE c.assigned_to = u.id AND c.workspace_id = m.workspace_id AND c.status = 'open') AS open_chats
    FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ? ORDER BY m.id`, req.ws!.id)
  const invites = all("SELECT id, email, role, token, expires_at, created_at FROM invites WHERE workspace_id = ? AND accepted_at IS NULL ORDER BY id DESC", req.ws!.id)
    .map((i) => ({ ...i, link: `${config.appUrl}/invite/${(i as { token: string }).token}` }))
  res.json({ members, invites, roles: ROLES, permissions: PERMISSIONS, role_permissions: ROLE_PERMISSIONS })
}))

teamRoutes.post('/team/invites', perm('team.manage'), h((req, res) => {
  const b = parse(z.object({ email: z.string().trim().toLowerCase().email(), role: z.enum(ROLES) }), req.body)
  if (b.role === 'owner' && req.ws!.role !== 'owner') throw forbidden('Only the owner can invite another owner')
  if (get('SELECT m.id FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ? AND u.email = ?', req.ws!.id, b.email)) throw bad('This person is already in your team')
  checkLimit(req.ws!.id, 'users')
  run('DELETE FROM invites WHERE workspace_id = ? AND email = ? AND accepted_at IS NULL', req.ws!.id, b.email)
  const token = randomToken()
  insert('invites', { workspace_id: req.ws!.id, email: b.email, role: b.role, token, invited_by: req.user!.id, expires_at: new Date(Date.now() + 7 * 86400000).toISOString(), created_at: now() })
  res.json({ link: `${config.appUrl}/invite/${token}` })
}))
teamRoutes.delete('/team/invites/:id', perm('team.manage'), h((req, res) => { run('DELETE FROM invites WHERE id = ? AND workspace_id = ?', id(req.params.id), req.ws!.id); res.json({ ok: true }) }))

teamRoutes.patch('/team/members/:id', h((req, res) => {
  const m = get<{ id: number; user_id: number; role: string }>('SELECT * FROM memberships WHERE id = ? AND workspace_id = ?', id(req.params.id), req.ws!.id)
  if (!m) throw bad('Member not found')
  const b = parse(z.object({ role: z.enum(ROLES).optional(), is_online: z.boolean().optional() }), req.body)
  const self = m.user_id === req.user!.id
  if (b.role) {
    if (!['owner', 'admin'].includes(req.ws!.role)) throw forbidden()
    if ((m.role === 'owner' || b.role === 'owner') && req.ws!.role !== 'owner') throw forbidden('Only the owner can change owner roles')
    if (m.role === 'owner' && Number(get<{ c: number }>("SELECT COUNT(*) c FROM memberships WHERE workspace_id = ? AND role = 'owner'", req.ws!.id)!.c) <= 1) throw bad('A workspace needs at least one owner')
    run('UPDATE memberships SET role = ? WHERE id = ?', b.role, m.id)
  }
  if (b.is_online !== undefined) {
    if (!self && !['owner', 'admin', 'manager'].includes(req.ws!.role)) throw forbidden()
    run('UPDATE memberships SET is_online = ? WHERE id = ?', b.is_online ? 1 : 0, m.id)
  }
  res.json({ ok: true })
}))

teamRoutes.delete('/team/members/:id', perm('team.manage'), h((req, res) => {
  const m = get<{ id: number; user_id: number; role: string }>('SELECT * FROM memberships WHERE id = ? AND workspace_id = ?', id(req.params.id), req.ws!.id)
  if (!m) throw bad('Member not found')
  if (m.role === 'owner') throw bad('The owner cannot be removed. Transfer ownership first.')
  run('DELETE FROM memberships WHERE id = ?', m.id)
  run("UPDATE conversations SET assigned_to = NULL WHERE workspace_id = ? AND assigned_to = ?", req.ws!.id, m.user_id)
  res.json({ ok: true })
}))

// ---- Developers: API keys & webhooks ----
const D = perm('developers.manage')
teamRoutes.get('/developers', D, h((req, res) => {
  res.json({
    keys: all('SELECT id, name, prefix, scopes, last_used_at, revoked_at, created_at FROM api_keys WHERE workspace_id = ? ORDER BY id DESC', req.ws!.id),
    webhooks: all('SELECT * FROM webhooks WHERE workspace_id = ? ORDER BY id DESC', req.ws!.id),
    deliveries: all('SELECT d.id, d.webhook_id, d.event, d.status, d.status_code, d.attempts, d.created_at, d.response FROM webhook_deliveries d WHERE d.workspace_id = ? ORDER BY d.id DESC LIMIT 50', req.ws!.id),
    events: WEBHOOK_EVENTS, base_url: `${config.appUrl}/api/v1`,
  })
}))
teamRoutes.post('/developers/keys', D, h((req, res) => {
  requireFeature(req.ws!.id, 'api')
  const b = parse(z.object({ name: z.string().trim().min(1).max(60) }), req.body)
  const key = `mk_live_${randomToken(24)}`
  insert('api_keys', { workspace_id: req.ws!.id, name: b.name, prefix: key.slice(0, 14), key_hash: sha256(key), created_by: req.user!.id, created_at: now() })
  res.json({ key })
}))
teamRoutes.delete('/developers/keys/:id', D, h((req, res) => { run('UPDATE api_keys SET revoked_at = ? WHERE id = ? AND workspace_id = ?', now(), id(req.params.id), req.ws!.id); res.json({ ok: true }) }))
teamRoutes.post('/developers/webhooks', D, h((req, res) => {
  requireFeature(req.ws!.id, 'webhooks')
  const b = parse(z.object({ url: z.string().url().refine((u) => u.startsWith('https://') || !config.isProd, 'Webhook URL must use https'), events: z.array(z.string()).min(1) }), req.body)
  const wid = insert('webhooks', { workspace_id: req.ws!.id, url: b.url, events: b.events, secret: `whsec_${randomToken(20)}`, created_at: now() })
  res.json(get('SELECT * FROM webhooks WHERE id = ?', wid))
}))
teamRoutes.patch('/developers/webhooks/:id', D, h((req, res) => {
  const b = parse(z.object({ is_active: z.boolean().optional(), events: z.array(z.string()).optional(), url: z.string().url().optional() }), req.body)
  update('webhooks', id(req.params.id), { ...b, failure_count: b.is_active ? 0 : undefined }, req.ws!.id)
  res.json(get('SELECT * FROM webhooks WHERE id = ?', id(req.params.id)))
}))
teamRoutes.post('/developers/webhooks/:id/test', D, h((req, res) => {
  const w = get<{ id: number }>('SELECT id FROM webhooks WHERE id = ? AND workspace_id = ?', id(req.params.id), req.ws!.id)
  if (!w) throw bad('Webhook not found')
  insert('webhook_deliveries', { workspace_id: req.ws!.id, webhook_id: w.id, event: 'test.ping', status: 'pending', next_attempt_at: now(), created_at: now(),
    payload: JSON.stringify({ event: 'test.ping', workspace_id: req.ws!.id, created_at: now(), data: { message: 'Hello from MECGURA WhatsApp' } }) })
  res.json({ ok: true })
}))
teamRoutes.delete('/developers/webhooks/:id', D, h((req, res) => { run('DELETE FROM webhooks WHERE id = ? AND workspace_id = ?', id(req.params.id), req.ws!.id); res.json({ ok: true }) }))
