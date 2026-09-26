import { Router } from 'express'
import { z } from 'zod'
import { all, get, insert, run, now, tx } from '../db.ts'
import { h, parse, bad, HttpError } from '../lib/http.ts'
import { hashPassword, verifyPassword, signJwt } from '../lib/security.ts'
import { requireUser } from '../lib/auth.ts'
import { ROLE_PERMISSIONS, type Role } from '../lib/permissions.ts'
import { slugify } from '../lib/util.ts'

export const authRoutes = Router()

export function createWorkspace(name: string, ownerId: number, business: Record<string, unknown> = {}) {
  const plan = get<{ id: number }>("SELECT id FROM plans WHERE code = 'growth'")
  let slug = slugify(name) || 'workspace'
  if (get('SELECT id FROM workspaces WHERE slug = ?', slug)) slug = `${slug}-${Date.now().toString(36)}`
  const trialEnd = new Date(Date.now() + 14 * 86400000).toISOString()
  const wsId = insert('workspaces', {
    name, slug, plan_id: plan?.id ?? null, status: 'active', subscription_status: 'trialing', trial_ends_at: trialEnd, current_period_end: trialEnd,
    business, created_at: now(),
    settings: {
      welcome: { enabled: true, text: 'Hi {{first_name}} 👋 Thanks for messaging ' + name + '! How can we help you today?' },
      away: { enabled: false, text: 'Thanks for your message! Our team is offline right now and will reply during business hours.' },
      hours: { enabled: false, days: [1, 2, 3, 4, 5, 6], start: '09:00', end: '19:00' },
      ai: { enabled: false, mode: 'suggest', persona: 'Warm, helpful and concise', knowledge: '', handoff_keywords: ['human', 'agent', 'call me'] },
      opt_out_keywords: ['stop', 'unsubscribe'],
      agents_see_all: false,
      pipeline: ['new', 'contacted', 'qualified', 'proposal', 'won', 'lost'],
    },
  })
  insert('memberships', { workspace_id: wsId, user_id: ownerId, role: 'owner', created_at: now() })
  return wsId
}

export function sessionPayload(userId: number) {
  const user = get<{ id: number; email: string; name: string; phone: string | null; is_super_admin: number }>('SELECT id, email, name, phone, is_super_admin FROM users WHERE id = ?', userId)!
  const workspaces = all<{ id: number; name: string; role: string; status: string; plan: string }>(
    `SELECT w.id, w.name, w.status, m.role, p.name AS plan FROM memberships m JOIN workspaces w ON w.id = m.workspace_id
     LEFT JOIN plans p ON p.id = w.plan_id WHERE m.user_id = ? ORDER BY w.id`, userId)
    .map((w) => ({ ...w, permissions: ROLE_PERMISSIONS[w.role as Role] ?? [] }))
  return { user, workspaces }
}

authRoutes.post('/signup', h((req, res) => {
  const b = parse(z.object({
    name: z.string().trim().min(2).max(80), email: z.string().trim().toLowerCase().email(), phone: z.string().trim().max(20).optional(),
    password: z.string().min(8, 'Password must be at least 8 characters').max(200), company: z.string().trim().min(2).max(80),
    industry: z.string().max(60).optional(), website: z.string().max(200).optional(),
  }), req.body)
  if (get('SELECT id FROM users WHERE email = ?', b.email)) throw bad('An account with this email already exists. Please sign in.')
  const userId = tx(() => {
    const uid = insert('users', { email: b.email, name: b.name, phone: b.phone ?? null, password_hash: hashPassword(b.password), created_at: now(), last_login_at: now() })
    createWorkspace(b.company, uid, { industry: b.industry ?? '', website: b.website ?? '', phone: b.phone ?? '', email: b.email })
    return uid
  })
  res.json({ token: signJwt({ uid: userId }), ...sessionPayload(userId) })
}))

authRoutes.post('/login', h((req, res) => {
  const b = parse(z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1) }), req.body)
  const user = get<{ id: number; password_hash: string }>('SELECT id, password_hash FROM users WHERE email = ?', b.email)
  if (!user || !verifyPassword(b.password, user.password_hash)) throw new HttpError(401, 'Incorrect email or password')
  run('UPDATE users SET last_login_at = ? WHERE id = ?', now(), user.id)
  res.json({ token: signJwt({ uid: user.id }), ...sessionPayload(user.id) })
}))

authRoutes.get('/me', requireUser, h((req, res) => { res.json(sessionPayload(req.user!.id)) }))

authRoutes.patch('/me', requireUser, h((req, res) => {
  const b = parse(z.object({ name: z.string().trim().min(2).max(80).optional(), phone: z.string().max(20).optional(),
    current_password: z.string().optional(), new_password: z.string().min(8).max(200).optional() }), req.body)
  if (b.new_password) {
    const u = get<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = ?', req.user!.id)!
    if (!b.current_password || !verifyPassword(b.current_password, u.password_hash)) throw bad('Current password is incorrect')
    run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(b.new_password), req.user!.id)
  }
  if (b.name) run('UPDATE users SET name = ? WHERE id = ?', b.name, req.user!.id)
  if (b.phone !== undefined) run('UPDATE users SET phone = ? WHERE id = ?', b.phone, req.user!.id)
  res.json(sessionPayload(req.user!.id))
}))

authRoutes.post('/workspaces', requireUser, h((req, res) => {
  const b = parse(z.object({ name: z.string().trim().min(2).max(80) }), req.body)
  const id = createWorkspace(b.name, req.user!.id)
  res.json({ id, ...sessionPayload(req.user!.id) })
}))

authRoutes.get('/invites/:token', h((req, res) => {
  const inv = get<{ email: string; role: string; ws: string; expires_at: string; accepted_at: string | null }>(
    'SELECT i.email, i.role, i.expires_at, i.accepted_at, w.name AS ws FROM invites i JOIN workspaces w ON w.id = i.workspace_id WHERE token = ?', req.params.token)
  if (!inv || inv.accepted_at || inv.expires_at < now()) throw bad('This invite link is invalid or has expired')
  res.json({ email: inv.email, role: inv.role, workspace: inv.ws, has_account: !!get('SELECT id FROM users WHERE email = ?', inv.email) })
}))

authRoutes.post('/invites/:token/accept', h((req, res) => {
  const inv = get<{ id: number; workspace_id: number; email: string; role: string; expires_at: string; accepted_at: string | null }>('SELECT * FROM invites WHERE token = ?', req.params.token)
  if (!inv || inv.accepted_at || inv.expires_at < now()) throw bad('This invite link is invalid or has expired')
  const b = parse(z.object({ name: z.string().trim().min(2).max(80).optional(), password: z.string().min(8).max(200) }), req.body)
  let user = get<{ id: number; password_hash: string }>('SELECT id, password_hash FROM users WHERE email = ?', inv.email)
  if (user) {
    if (!verifyPassword(b.password, user.password_hash)) throw new HttpError(401, 'Incorrect password for this account')
  } else {
    if (!b.name) throw bad('Please enter your name')
    const uid = insert('users', { email: inv.email, name: b.name, password_hash: hashPassword(b.password), created_at: now() })
    user = { id: uid, password_hash: '' }
  }
  run('INSERT OR IGNORE INTO memberships (workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?)', inv.workspace_id, user.id, inv.role, now())
  run('UPDATE invites SET accepted_at = ? WHERE id = ?', now(), inv.id)
  res.json({ token: signJwt({ uid: user.id }), ...sessionPayload(user.id) })
}))
