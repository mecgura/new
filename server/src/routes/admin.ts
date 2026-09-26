import { Router } from 'express'
import { z } from 'zod'
import { all, get, insert, run, update, now, tx } from '../db.ts'
import { h, parse, bad, id, notFound } from '../lib/http.ts'
import { superAdmin } from '../lib/auth.ts'
import { hashPassword } from '../lib/security.ts'
import { activatePlan, usageSummary } from '../services/plans.ts'
import { createWorkspace } from './auth.ts'

// MECGURA super-admin console: manage every client workspace, plan and lead.
export const adminRoutes = Router()
adminRoutes.use(superAdmin)

adminRoutes.get('/overview', h((_req, res) => {
  const n = (sql: string, ...p: unknown[]) => Number(get<{ c: number }>(sql, ...p)?.c ?? 0)
  const month = new Date().toISOString().slice(0, 7)
  res.json({
    workspaces: n('SELECT COUNT(*) c FROM workspaces'), active: n("SELECT COUNT(*) c FROM workspaces WHERE subscription_status = 'active'"),
    trialing: n("SELECT COUNT(*) c FROM workspaces WHERE subscription_status = 'trialing'"), suspended: n("SELECT COUNT(*) c FROM workspaces WHERE status = 'suspended'"),
    users: n('SELECT COUNT(*) c FROM users'), numbers: n('SELECT COUNT(*) c FROM wa_numbers WHERE is_demo = 0'),
    messages_month: n("SELECT COALESCE(SUM(value),0) c FROM usage WHERE metric = 'messages' AND period = ?", month),
    mrr: n(`SELECT COALESCE(SUM(p.price_monthly),0) c FROM workspaces w JOIN plans p ON p.id = w.plan_id WHERE w.subscription_status = 'active'`),
    revenue_month: n("SELECT COALESCE(SUM(amount),0) c FROM invoices WHERE status = 'paid' AND created_at >= ?", month + '-01'),
    new_leads: n("SELECT COUNT(*) c FROM site_leads WHERE status = 'new'"),
  })
}))

adminRoutes.get('/workspaces', h((req, res) => {
  const q = String(req.query.q || '')
  res.json(all(`SELECT w.id, w.name, w.status, w.subscription_status, w.trial_ends_at, w.current_period_end, w.created_at, p.name AS plan, p.id AS plan_id,
    (SELECT u.email FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = w.id AND m.role = 'owner' LIMIT 1) AS owner_email,
    (SELECT COUNT(*) FROM contacts c WHERE c.workspace_id = w.id) AS contacts,
    (SELECT COUNT(*) FROM wa_numbers n WHERE n.workspace_id = w.id AND n.is_demo = 0) AS numbers,
    (SELECT COALESCE(SUM(value),0) FROM usage u WHERE u.workspace_id = w.id AND u.metric = 'messages' AND u.period = ?) AS messages_month
    FROM workspaces w LEFT JOIN plans p ON p.id = w.plan_id ${q ? 'WHERE w.name LIKE ?' : ''} ORDER BY w.id DESC LIMIT 500`,
  new Date().toISOString().slice(0, 7), ...(q ? [`%${q}%`] : [])))
}))

adminRoutes.get('/workspaces/:id', h((req, res) => {
  const w = get('SELECT * FROM workspaces WHERE id = ?', id(req.params.id))
  if (!w) throw notFound('Workspace')
  res.json({ ...w, ...usageSummary(id(req.params.id)),
    members: all('SELECT u.id, u.name, u.email, m.role, u.last_login_at FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ?', id(req.params.id)),
    invoices: all('SELECT * FROM invoices WHERE workspace_id = ? ORDER BY id DESC', id(req.params.id)) })
}))

// Create a client workspace on behalf of a customer (agency onboarding).
adminRoutes.post('/workspaces', h((req, res) => {
  const b = parse(z.object({ company: z.string().trim().min(2).max(80), name: z.string().trim().min(2).max(80), email: z.string().trim().toLowerCase().email(),
    password: z.string().min(8), plan_id: z.number().optional(), cycle: z.enum(['monthly', 'yearly']).optional() }), req.body)
  const wsId = tx(() => {
    let user = get<{ id: number }>('SELECT id FROM users WHERE email = ?', b.email)
    if (!user) user = { id: insert('users', { email: b.email, name: b.name, password_hash: hashPassword(b.password), created_at: now() }) }
    const w = createWorkspace(b.company, user.id)
    if (b.plan_id) activatePlan(w, b.plan_id, b.cycle ?? 'monthly')
    return w
  })
  res.json({ id: wsId })
}))

adminRoutes.patch('/workspaces/:id', h((req, res) => {
  const wid = id(req.params.id)
  const b = parse(z.object({ status: z.enum(['active', 'suspended']).optional(), plan_id: z.number().optional(), cycle: z.enum(['monthly', 'yearly']).optional(),
    subscription_status: z.enum(['trialing', 'active', 'past_due', 'cancelled']).optional(), current_period_end: z.string().optional(), trial_days: z.number().int().min(1).max(90).optional() }), req.body)
  if (b.plan_id && b.cycle) activatePlan(wid, b.plan_id, b.cycle)
  else if (b.plan_id) update('workspaces', wid, { plan_id: b.plan_id })
  if (b.trial_days) { const end = new Date(Date.now() + b.trial_days * 86400000).toISOString(); update('workspaces', wid, { subscription_status: 'trialing', trial_ends_at: end, current_period_end: end }) }
  update('workspaces', wid, { status: b.status, subscription_status: b.subscription_status, current_period_end: b.current_period_end })
  run('INSERT INTO audit_logs (workspace_id, user_id, action, meta, created_at) VALUES (?, ?, ?, ?, ?)', wid, req.user!.id, 'admin.workspace.updated', JSON.stringify(b), now())
  res.json(get('SELECT * FROM workspaces WHERE id = ?', wid))
}))

// Record an offline payment (UPI / bank transfer) and activate the plan.
adminRoutes.post('/workspaces/:id/invoices', h((req, res) => {
  const wid = id(req.params.id)
  const b = parse(z.object({ plan_id: z.number(), cycle: z.enum(['monthly', 'yearly']), amount: z.number().int().min(0), reference: z.string().max(100).optional() }), req.body)
  activatePlan(wid, b.plan_id, b.cycle)
  const ws = get<{ current_period_end: string }>('SELECT current_period_end FROM workspaces WHERE id = ?', wid)!
  insert('invoices', { workspace_id: wid, plan_id: b.plan_id, amount: b.amount, cycle: b.cycle, status: 'paid', provider_payment_id: b.reference ?? 'offline', period_end: ws.current_period_end, created_at: now() })
  res.json({ ok: true })
}))

adminRoutes.get('/plans', h((_req, res) => { res.json(all('SELECT * FROM plans ORDER BY sort')) }))
const planSchema = z.object({ code: z.string().regex(/^[a-z0-9_-]+$/), name: z.string().min(2), tagline: z.string().max(200).optional(), price_monthly: z.number().int().min(0),
  price_yearly: z.number().int().min(0), limits: z.record(z.string(), z.number().int()), features: z.array(z.string()), is_public: z.boolean().default(true), sort: z.number().int().default(9) })
adminRoutes.post('/plans', h((req, res) => {
  const b = parse(planSchema, req.body)
  if (get('SELECT id FROM plans WHERE code = ?', b.code)) throw bad('Plan code already exists')
  res.json(get('SELECT * FROM plans WHERE id = ?', insert('plans', b)))
}))
adminRoutes.put('/plans/:id', h((req, res) => {
  update('plans', id(req.params.id), parse(planSchema.partial(), req.body))
  res.json(get('SELECT * FROM plans WHERE id = ?', id(req.params.id)))
}))

adminRoutes.get('/leads', h((_req, res) => { res.json(all('SELECT * FROM site_leads ORDER BY id DESC LIMIT 500')) }))
adminRoutes.patch('/leads/:id', h((req, res) => {
  const b = parse(z.object({ status: z.enum(['new', 'contacted', 'converted', 'closed']) }), req.body)
  update('site_leads', id(req.params.id), b); res.json({ ok: true })
}))
