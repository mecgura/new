// End-to-end API tests: boots a real server on a temp database and drives it over HTTP.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const PORT = 18000 + Math.floor(Math.random() * 1000)
const BASE = `http://127.0.0.1:${PORT}`
const META_SECRET = 'test-meta-secret'
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mecgura-test-'))
let server: ChildProcess

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

async function call(method: string, p: string, body?: unknown, auth?: { token?: string; ws?: number; key?: string }) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (auth?.token) headers.Authorization = `Bearer ${auth.token}`
  if (auth?.key) headers.Authorization = `Bearer ${auth.key}`
  if (auth?.ws) headers['X-Workspace-Id'] = String(auth.ws)
  const res = await fetch(BASE + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await res.text()
  let json: Json = {}
  try { json = JSON.parse(text) } catch { json = { text } }
  return { status: res.status, body: json }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function until<T>(fn: () => Promise<T | undefined | false>, ms = 8000): Promise<T> {
  const end = Date.now() + ms
  while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(150) }
  throw new Error('condition not met in time')
}

let owner: { token: string; ws: number }

before(async () => {
  server = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
    env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, ADMIN_EMAIL: 'admin@test.local', ADMIN_PASSWORD: 'adminpass123',
      APP_URL: BASE, META_APP_SECRET: META_SECRET, WORKER_INTERVAL_MS: '250', NODE_ENV: 'test', ANTHROPIC_API_KEY: '', RAZORPAY_KEY_ID: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  server.stderr?.on('data', (d) => { const s = String(d); if (!s.includes('ExperimentalWarning') && !s.includes('--trace-warnings')) process.stderr.write(s) })
  await until(async () => (await fetch(BASE + '/health').then((r) => r.ok).catch(() => false)), 15000)
  const r = await call('POST', '/api/auth/signup', { name: 'Test Owner', email: 'owner@test.local', password: 'password123', company: 'Test Shop' })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  owner = { token: r.body.token, ws: r.body.workspaces[0].id }
})

after(() => { server?.kill(); fs.rmSync(dataDir, { recursive: true, force: true }) })

test('health and public endpoints', async () => {
  assert.equal((await call('GET', '/health')).body.ok, true)
  const plans = await call('GET', '/api/public/plans')
  assert.ok(plans.body.length >= 4)
  assert.equal((await call('POST', '/api/public/contact', { name: 'Lead', email: 'lead@test.local', message: 'hi' })).status, 200)
})

test('auth: wrong password, lockout after 10 failures, unauthenticated access', async () => {
  assert.equal((await call('POST', '/api/auth/login', { email: 'owner@test.local', password: 'nope' })).status, 401)
  for (let i = 0; i < 9; i++) await call('POST', '/api/auth/login', { email: 'lock@test.local', password: 'nope' })
  assert.equal((await call('POST', '/api/auth/login', { email: 'lock@test.local', password: 'nope' })).status, 401)
  assert.equal((await call('POST', '/api/auth/login', { email: 'lock@test.local', password: 'nope' })).status, 429)
  assert.equal((await call('GET', '/api/dashboard')).status, 401)
  assert.equal((await call('POST', '/api/auth/login', { email: 'owner@test.local', password: 'password123' })).status, 200)
})

test('inbox: sandbox number, inbound message, welcome bot, agent reply', async () => {
  const n = await call('POST', '/api/numbers/demo', {}, owner)
  assert.equal(n.status, 200)
  const sim = await call('POST', '/api/simulate', { phone: '9876500001', name: 'Asha', text: 'hello' }, owner)
  assert.equal(sim.status, 200)
  const conv = sim.body.conversation_id
  const msgs = await call('GET', `/api/conversations/${conv}/messages`, undefined, owner)
  assert.equal(msgs.body[0].direction, 'in')
  assert.equal(msgs.body[1].sent_by, 'bot', 'welcome message should be sent to a new contact')
  const reply = await call('POST', `/api/conversations/${conv}/messages`, { type: 'text', text: 'Hi Asha!' }, owner)
  assert.equal(reply.body.status, 'sent')
  const read = await until(async () => (await call('GET', `/api/conversations/${conv}/messages`, undefined, owner)).body.find((m: Json) => m.id === reply.body.id && m.status === 'read'))
  assert.ok(read)
  const detail = await call('GET', `/api/conversations/${conv}`, undefined, owner)
  assert.ok(detail.body.assigned_to, 'replying agent is auto-assigned')
})

test('chatbot keyword rule replies', async () => {
  const r = await call('POST', '/api/bot-rules', { name: 'Price', match_type: 'contains', keywords: ['price'], reply: { type: 'text', text: 'Plans start at 999' } }, owner)
  assert.equal(r.status, 200, JSON.stringify(r.body))
  const sim = await call('POST', '/api/simulate', { phone: '9876500002', text: 'what is the price' }, owner)
  const msgs = await call('GET', `/api/conversations/${sim.body.conversation_id}/messages`, undefined, owner)
  assert.ok(msgs.body.some((m: Json) => m.body === 'Plans start at 999'))
})

test('flow: buttons branch, question saves field, tag added, handoff pauses bot', async () => {
  const f = await call('POST', '/api/flows', { name: 'Lead', is_active: true, trigger: { type: 'keyword', value: 'start', match: 'exact' }, nodes: [
    { id: 'a', type: 'buttons', data: { text: 'Pick', options: ['Web', 'Ads'], save_as: 'interest' }, branches: { 0: 'b', 1: 'b', other: 'b' } },
    { id: 'b', type: 'question', data: { text: 'Your email?', save_as: 'email', validate: 'email' }, next: 'c' },
    { id: 'c', type: 'action', data: { action: 'add_tag', value: 'hot' }, next: 'd' },
    { id: 'd', type: 'handoff', data: { text: 'Thanks {{first_name}}' } },
  ] }, owner)
  assert.equal(f.status, 200, JSON.stringify(f.body))
  const phone = '9876500003'
  const s1 = await call('POST', '/api/simulate', { phone, name: 'Ravi Kumar', text: 'start' }, owner)
  await call('POST', '/api/simulate', { phone, text: 'Ads', button_id: 'flow:a:1' }, owner)
  await call('POST', '/api/simulate', { phone, text: 'not-an-email' }, owner)
  await call('POST', '/api/simulate', { phone, text: 'ravi@test.local' }, owner)
  const d = await call('GET', `/api/conversations/${s1.body.conversation_id}`, undefined, owner)
  assert.equal(d.body.contact.email, 'ravi@test.local')
  assert.equal(d.body.contact.attributes.interest, 'Ads')
  assert.ok(d.body.contact.tags.includes('hot'))
  assert.equal(d.body.bot_paused, 1)
  const msgs = await call('GET', `/api/conversations/${s1.body.conversation_id}/messages`, undefined, owner)
  assert.ok(msgs.body.some((m: Json) => m.body?.includes('does not look right')), 'invalid email is re-asked')
  assert.ok(msgs.body.some((m: Json) => m.body === 'Thanks Ravi'))
})

test('opt-out keyword unsubscribes and campaigns skip the contact', async () => {
  await call('POST', '/api/simulate', { phone: '9876500004', text: 'STOP' }, owner)
  const c = await call('GET', '/api/contacts?q=9876500004', undefined, owner)
  assert.equal(c.body.data[0].opted_out, 1)
})

let templateId = 0
test('templates and bulk campaign complete with delivery stats', async () => {
  const t = await call('POST', '/api/templates', { name: 'offer_test', language: 'en', category: 'MARKETING', components: [{ type: 'BODY', text: 'Hi {{1}}, sale is live!', example: { body_text: [['A']] } }] }, owner)
  assert.equal(t.status, 200, JSON.stringify(t.body))
  templateId = t.body.id
  const imp = await call('POST', '/api/contacts/import', { csv: 'phone,name,tags\n9811100001,Aman,diwali\n9811100002,Priya,diwali\nbad,Nope,diwali\n', tags: [] }, owner)
  assert.deepEqual([imp.body.created, imp.body.invalid], [2, 1])
  const prev = await call('POST', '/api/campaigns/audience-preview', { type: 'tags', tags: ['diwali'] }, owner)
  assert.equal(prev.body.count, 2)
  const camp = await call('POST', '/api/campaigns', { name: 'Diwali', template_id: templateId, template_vars: { body: ['{{first_name}}'] }, audience: { type: 'tags', tags: ['diwali'] }, send: 'now' }, owner)
  assert.equal(camp.status, 200, JSON.stringify(camp.body))
  const done = await until(async () => { const r = await call('GET', `/api/campaigns/${camp.body.id}`, undefined, owner); return r.body.status === 'completed' && r.body.read === 2 ? r.body : false })
  assert.equal(done.sent, 2)
  assert.equal(done.failed, 0)
})

test('public API: key auth, send template, upsert contact', async () => {
  assert.equal((await call('GET', '/api/v1/me', undefined, { key: 'mk_live_wrong' })).status, 401)
  const k = await call('POST', '/api/developers/keys', { name: 'test' }, owner)
  const key = k.body.key
  const send = await call('POST', '/api/v1/messages', { to: '919811100001', type: 'template', template: 'offer_test', variables: ['Aman'] }, { key })
  assert.equal(send.status, 200, JSON.stringify(send.body))
  assert.equal(send.body.status, 'sent')
  const up = await call('POST', '/api/v1/contacts', { phone: '9811100009', name: 'Api Lead', tags: ['website'] }, { key })
  assert.equal(up.status, 201)
  assert.equal((await call('GET', '/api/v1/contacts/919811100009', undefined, { key })).body.name, 'Api Lead')
})

test('Meta webhook: verify handshake, signature check, inbound + status', async () => {
  const verify = await fetch(`${BASE}/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=mecgura-verify&hub.challenge=42`)
  assert.equal(await verify.text(), '42')
  const nums = await call('GET', '/api/numbers', undefined, owner)
  const pid = nums.body[0].phone_number_id
  const payload = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: '1', changes: [{ field: 'messages', value: {
    metadata: { phone_number_id: pid }, contacts: [{ wa_id: '919700000001', profile: { name: 'Hook User' } }],
    messages: [{ id: 'wamid.T1', from: '919700000001', type: 'text', text: { body: 'price?' } }] } }] }] })
  const bad = await fetch(`${BASE}/webhooks/whatsapp`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': 'sha256=deadbeef' }, body: payload })
  assert.equal(bad.status, 401)
  const sig = 'sha256=' + crypto.createHmac('sha256', META_SECRET).update(payload).digest('hex')
  const post = () => fetch(`${BASE}/webhooks/whatsapp`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': sig }, body: payload })
  assert.equal((await post()).status, 200)
  assert.equal((await post()).status, 200) // Meta retries: must not duplicate
  const conv = await until(async () => (await call('GET', '/api/conversations?q=919700000001', undefined, owner)).body[0])
  const msgs = await until(async () => { const m = (await call('GET', `/api/conversations/${conv.id}/messages`, undefined, owner)).body; return m.length >= 2 ? m : false })
  assert.equal(msgs.filter((m: Json) => m.direction === 'in').length, 1, 'duplicate webhook delivery is ignored')
  assert.ok(msgs.some((m: Json) => m.body === 'Plans start at 999'))
})

test('roles: agent cannot manage campaigns or team', async () => {
  const inv = await call('POST', '/api/team/invites', { email: 'agent@test.local', role: 'agent' }, owner)
  const token = inv.body.link.split('/invite/')[1]
  const acc = await call('POST', `/api/auth/invites/${token}/accept`, { name: 'Agent One', password: 'password123' })
  assert.equal(acc.status, 200)
  const agent = { token: acc.body.token, ws: owner.ws }
  assert.equal((await call('GET', '/api/conversations', undefined, agent)).status, 200)
  assert.equal((await call('GET', '/api/campaigns', undefined, agent)).status, 403)
  assert.equal((await call('POST', '/api/team/invites', { email: 'x@test.local', role: 'admin' }, agent)).status, 403)
  const other = await call('POST', '/api/auth/signup', { name: 'Other', email: 'other@test.local', password: 'password123', company: 'Other Co' })
  assert.equal((await call('GET', '/api/contacts', undefined, { token: other.body.token, ws: owner.ws })).status, 403, 'no cross-tenant access')
})

test('plans: limits enforced and expired subscription blocks sending', async () => {
  const admin = await call('POST', '/api/auth/login', { email: 'admin@test.local', password: 'adminpass123' })
  const A = { token: admin.body.token }
  const plans = await call('GET', '/api/admin/plans', undefined, A)
  const starter = plans.body.find((p: Json) => p.code === 'starter')
  await call('PATCH', `/api/admin/workspaces/${owner.ws}`, { plan_id: starter.id }, A)
  const extra = await call('POST', '/api/numbers/demo', {}, owner)
  assert.equal(extra.status, 402, 'starter allows 1 number')
  assert.equal(extra.body.code, 'limit_reached')

  await call('PATCH', `/api/admin/workspaces/${owner.ws}`, { subscription_status: 'expired' }, A)
  const conv = (await call('GET', '/api/conversations?q=9876500001', undefined, owner)).body[0]
  const blocked = await call('POST', `/api/conversations/${conv.id}/messages`, { type: 'text', text: 'hi' }, owner)
  assert.equal(blocked.status, 402)
  assert.equal(blocked.body.code, 'subscription_inactive')
  const inbound = await call('POST', '/api/simulate', { phone: '9876500001', text: 'still there?' }, owner)
  assert.equal(inbound.status, 200, 'incoming messages are still accepted')

  await call('POST', `/api/admin/workspaces/${owner.ws}/invoices`, { plan_id: starter.id, cycle: 'monthly', amount: 999, reference: 'UPI123' }, A)
  const again = await call('POST', `/api/conversations/${conv.id}/messages`, { type: 'text', text: 'renewed' }, owner)
  assert.equal(again.body.status, 'sent')
})

test('admin: reset password, open client workspace, backup', async () => {
  const admin = await call('POST', '/api/auth/login', { email: 'admin@test.local', password: 'adminpass123' })
  const A = { token: admin.body.token }
  const detail = await call('GET', `/api/admin/workspaces/${owner.ws}`, undefined, A)
  const member = detail.body.members.find((m: Json) => m.email === 'owner@test.local')
  const reset = await call('POST', `/api/admin/users/${member.id}/reset-password`, {}, A)
  assert.equal((await call('POST', '/api/auth/login', { email: 'owner@test.local', password: reset.body.password })).status, 200)
  const me = await call('GET', '/api/auth/me', undefined, { token: A.token, ws: owner.ws })
  assert.ok(me.body.workspaces.some((w: Json) => w.id === owner.ws && w.via_admin))
  assert.equal((await call('GET', '/api/dashboard', undefined, { token: A.token, ws: owner.ws })).status, 200)
  const b = await call('POST', '/api/admin/backup', {}, A)
  assert.ok(fs.existsSync(b.body.file))
  assert.equal((await call('GET', '/api/admin/overview', undefined, owner)).status, 403, 'non-admins blocked')
})
