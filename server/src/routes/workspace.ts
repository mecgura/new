import { Router } from 'express'
import { z } from 'zod'
import { all, get, run, update, now } from '../db.ts'
import { h, parse } from '../lib/http.ts'
import { perm } from '../lib/auth.ts'
import { subscribe } from '../lib/events.ts'
import { usageSummary } from '../services/plans.ts'
import { config } from '../config.ts'

export const workspaceRoutes = Router()

workspaceRoutes.get('/workspace', h((req, res) => {
  const ws = get('SELECT id, name, slug, status, subscription_status, trial_ends_at, current_period_end, business, settings, timezone, created_at FROM workspaces WHERE id = ?', req.ws!.id)
  res.json({ ...ws, role: req.ws!.role, ...usageSummary(req.ws!.id), webhook_url: `${config.appUrl}/webhooks/whatsapp`, verify_token: config.meta.verifyToken })
}))

workspaceRoutes.patch('/workspace', perm('settings.manage'), h((req, res) => {
  const b = parse(z.object({
    name: z.string().trim().min(2).max(80).optional(), timezone: z.string().max(60).optional(),
    business: z.record(z.string(), z.unknown()).optional(), settings: z.record(z.string(), z.unknown()).optional(),
  }), req.body)
  const cur = get<{ settings: Record<string, unknown>; business: Record<string, unknown> }>('SELECT settings, business FROM workspaces WHERE id = ?', req.ws!.id)!
  update('workspaces', req.ws!.id, {
    name: b.name, timezone: b.timezone,
    business: b.business ? { ...cur.business, ...b.business } : undefined,
    settings: b.settings ? { ...cur.settings, ...b.settings } : undefined,
  })
  run('INSERT INTO audit_logs (workspace_id, user_id, action, meta, created_at) VALUES (?, ?, ?, ?, ?)', req.ws!.id, req.user!.id, 'settings.updated', JSON.stringify(Object.keys(b)), now())
  res.json(get('SELECT id, name, business, settings, timezone FROM workspaces WHERE id = ?', req.ws!.id))
}))

workspaceRoutes.get('/events', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' })
  res.flushHeaders()
  res.write('event: ready\ndata: {}\n\n')
  const off = subscribe(req.ws!.id, res)
  req.on('close', off)
})

workspaceRoutes.get('/notifications', h((req, res) => {
  res.json(all('SELECT * FROM notifications WHERE workspace_id = ? AND (user_id IS NULL OR user_id = ?) ORDER BY id DESC LIMIT 40', req.ws!.id, req.user!.id))
}))
workspaceRoutes.post('/notifications/read', h((req, res) => {
  run('UPDATE notifications SET read_at = ? WHERE workspace_id = ? AND (user_id IS NULL OR user_id = ?) AND read_at IS NULL', now(), req.ws!.id, req.user!.id)
  res.json({ ok: true })
}))

workspaceRoutes.get('/audit', perm('settings.manage'), h((req, res) => {
  res.json(all('SELECT a.*, u.name AS user_name FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id WHERE a.workspace_id = ? ORDER BY a.id DESC LIMIT 100', req.ws!.id))
}))

workspaceRoutes.get('/dashboard', h((req, res) => {
  const w = req.ws!.id
  const since = new Date(Date.now() - 13 * 86400000); since.setHours(0, 0, 0, 0)
  const n = (sql: string, ...p: unknown[]) => Number(get<{ c: number }>(sql, ...p)?.c ?? 0)
  const daily = all<{ d: string; dir: string; c: number }>(
    'SELECT substr(created_at,1,10) d, direction dir, COUNT(*) c FROM messages WHERE workspace_id = ? AND created_at >= ? GROUP BY d, dir', w, since.toISOString())
  const days = [...Array(14)].map((_, i) => { const d = new Date(since.getTime() + i * 86400000).toISOString().slice(0, 10); return {
    date: d, inbound: daily.find((x) => x.d === d && x.dir === 'in')?.c ?? 0, outbound: daily.find((x) => x.d === d && x.dir === 'out')?.c ?? 0 } })
  res.json({
    open_chats: n("SELECT COUNT(*) c FROM conversations WHERE workspace_id = ? AND status = 'open'", w),
    unassigned: n("SELECT COUNT(*) c FROM conversations WHERE workspace_id = ? AND status = 'open' AND assigned_to IS NULL", w),
    contacts: n('SELECT COUNT(*) c FROM contacts WHERE workspace_id = ?', w),
    new_contacts_7d: n('SELECT COUNT(*) c FROM contacts WHERE workspace_id = ? AND created_at >= ?', w, new Date(Date.now() - 7 * 86400000).toISOString()),
    messages_today: n('SELECT COUNT(*) c FROM messages WHERE workspace_id = ? AND created_at >= ?', w, new Date().toISOString().slice(0, 10)),
    active_flows: n('SELECT COUNT(*) c FROM flows WHERE workspace_id = ? AND is_active = 1', w),
    revenue_30d: n("SELECT COALESCE(SUM(amount),0) c FROM payments WHERE workspace_id = ? AND status = 'paid' AND paid_at >= ?", w, new Date(Date.now() - 30 * 86400000).toISOString()),
    numbers: n('SELECT COUNT(*) c FROM wa_numbers WHERE workspace_id = ?', w),
    templates: n("SELECT COUNT(*) c FROM templates WHERE workspace_id = ? AND status = 'APPROVED'", w),
    days,
    recent_campaigns: all('SELECT id, name, status, total, sent, delivered, read, failed, replied, created_at FROM campaigns WHERE workspace_id = ? ORDER BY id DESC LIMIT 5', w),
    stages: all('SELECT stage, COUNT(*) c FROM contacts WHERE workspace_id = ? GROUP BY stage', w),
  })
}))
