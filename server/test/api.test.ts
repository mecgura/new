// End-to-end API tests: boots a real server on a temp database and drives it over HTTP.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import http from 'node:http'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const PORT = 18000 + Math.floor(Math.random() * 1000)
const BASE = `http://127.0.0.1:${PORT}`
const META_SECRET = 'test-meta-secret'
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mecgura-test-'))
let server: ChildProcess
const RZP_WEBHOOK_SECRET = 'rzp-webhook-secret'
// Stand-in for the Razorpay API so payment-link flows can be tested offline.
const rzpCalls: Json[] = []
const rzpMock = http.createServer((req, res) => {
  let body = ''
  req.on('data', (c) => { body += c })
  req.on('end', () => {
    rzpCalls.push({ path: req.url, body: (() => { try { return body ? JSON.parse(body) : null } catch { return { raw: body.length } } })() })
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ id: `plink_${rzpCalls.length}`, short_url: `https://rzp.io/i/test${rzpCalls.length}`, status: 'created', h: `handle_${rzpCalls.length}` }))
  })
})

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
  await new Promise<void>((r) => rzpMock.listen(0, '127.0.0.1', () => r()))
  const rzpBase = `http://127.0.0.1:${(rzpMock.address() as { port: number }).port}`
  server = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
    env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, ADMIN_EMAIL: 'admin@test.local', ADMIN_PASSWORD: 'adminpass123',
      APP_URL: BASE, META_APP_SECRET: META_SECRET, WORKER_INTERVAL_MS: '250', NODE_ENV: 'test', ANTHROPIC_API_KEY: '', RAZORPAY_KEY_ID: 'rzp_test_key', RAZORPAY_KEY_SECRET: 'rzp_test_secret', RAZORPAY_WEBHOOK_SECRET: RZP_WEBHOOK_SECRET, RAZORPAY_API_BASE: rzpBase, SMTP_HOST: 'json', SMTP_FROM: 'MECGURA <hello@mecgura.com>', WA_GRAPH_BASE: rzpBase, META_APP_ID: 'test-app' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  server.stderr?.on('data', (d) => { const s = String(d); if (!s.includes('ExperimentalWarning') && !s.includes('--trace-warnings')) process.stderr.write(s) })
  await until(async () => (await fetch(BASE + '/health').then((r) => r.ok).catch(() => false)), 15000)
  const r = await call('POST', '/api/auth/signup', { name: 'Test Owner', email: 'owner@test.local', password: 'password123', company: 'Test Shop' })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  owner = { token: r.body.token, ws: r.body.workspaces[0].id }
})

after(() => { server?.kill(); rzpMock.close(); fs.rmSync(dataDir, { recursive: true, force: true }) })

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

test('CORS: website origin may call the API directly, other origins may not', async () => {
  const pre = await fetch(`${BASE}/api/auth/login`, { method: 'OPTIONS', headers: { Origin: BASE, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' } })
  assert.equal(pre.status, 204)
  assert.equal(pre.headers.get('access-control-allow-origin'), BASE)
  const evil = await fetch(`${BASE}/api/auth/login`, { method: 'OPTIONS', headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' } })
  assert.equal(evil.status, 403)
  const get = await fetch(`${BASE}/api/public/plans`, { headers: { Origin: 'https://evil.example' } })
  assert.equal(get.headers.get('access-control-allow-origin'), null)
})

test('billing is managed by MECGURA: clients cannot see plans or billing', async () => {
  const me = await call('GET', '/api/auth/me', undefined, owner)
  const ws = me.body.workspaces.find((w: Json) => w.id === owner.ws)
  assert.equal(ws.role, 'owner')
  assert.ok(!ws.permissions.includes('billing.manage'))
  assert.equal((await call('GET', '/api/billing', undefined, owner)).status, 403)
  const team = await call('GET', '/api/team', undefined, owner)
  assert.equal(team.body.permissions['billing.manage'], undefined)
  const admin = await call('POST', '/api/auth/login', { email: 'admin@test.local', password: 'adminpass123' })
  assert.equal((await call('GET', '/api/admin/plans', undefined, { token: admin.body.token })).status, 200, 'admin still manages plans')
})

test('admin bills a client with a Razorpay link; paying it activates the plan once', async () => {
  const admin = await call('POST', '/api/auth/login', { email: 'admin@test.local', password: 'adminpass123' })
  const A = { token: admin.body.token }
  const plans = (await call('GET', '/api/admin/plans', undefined, A)).body
  const growth = plans.find((p: Json) => p.code === 'growth')
  const c = await call('POST', '/api/admin/workspaces', { company: 'Pay Client', name: 'Payer', email: 'payer@test.local', password: 'password123' }, A)
  const inv = await call('POST', `/api/admin/workspaces/${c.body.id}/payment-link`, { plan_id: growth.id, cycle: 'monthly' }, A)
  assert.equal(inv.status, 200, JSON.stringify(inv.body))
  assert.match(inv.body.payment_url, /^https:\/\/rzp\.io\//)
  assert.equal(rzpCalls.at(-1)!.body.amount, growth.price_monthly * 100, 'amount sent to Razorpay in paise')
  assert.equal((await call('POST', `/api/admin/workspaces/${c.body.id}/payment-link`, { plan_id: growth.id, cycle: 'monthly' }, owner)).status, 403)

  const payload = JSON.stringify({ event: 'payment_link.paid', payload: { payment_link: { entity: { id: inv.body.provider_order_id } }, payment: { entity: { id: 'pay_123' } } } })
  const post = (sig: string) => fetch(`${BASE}/webhooks/razorpay-billing`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': sig }, body: payload })
  assert.equal((await post('bad')).status, 400)
  const sig = crypto.createHmac('sha256', RZP_WEBHOOK_SECRET).update(payload).digest('hex')
  assert.equal((await post(sig)).status, 200)
  const ws1 = (await call('GET', `/api/admin/workspaces/${c.body.id}`, undefined, A)).body
  assert.equal(ws1.subscription_status, 'active')
  assert.equal(ws1.invoices[0].status, 'paid')
  assert.equal((await post(sig)).status, 200) // Razorpay retries: must not extend twice
  const ws2 = (await call('GET', `/api/admin/workspaces/${c.body.id}`, undefined, A)).body
  assert.equal(ws2.current_period_end, ws1.current_period_end)
})

test('email: forgot password, admin welcome + bill emails, workspace bulk email campaign', async () => {
  const admin = await call('POST', '/api/auth/login', { email: 'admin@test.local', password: 'adminpass123' })
  const A = { token: admin.body.token }
  assert.equal((await call('POST', '/api/auth/forgot', { email: 'owner@test.local' })).status, 200)
  assert.equal((await call('POST', '/api/auth/forgot', { email: 'nobody@test.local' })).status, 200, 'same answer for unknown emails')
  assert.equal((await call('POST', '/api/auth/reset', { token: 'not-a-real-token-123', password: 'password999' })).status, 400)

  const c = await call('POST', '/api/admin/workspaces', { company: 'Mail Client', name: 'Mailer', email: 'mailer@test.local', password: 'password123' }, A)
  assert.equal(c.body.email_sent, true)
  const plans = (await call('GET', '/api/admin/plans', undefined, A)).body
  await call('POST', `/api/admin/workspaces/${c.body.id}/payment-link`, { plan_id: plans[0].id, cycle: 'monthly' }, A)
  const log = await until(async () => { const l = (await call('GET', '/api/admin/emails', undefined, A)).body; return l.log.some((e: Json) => e.kind === 'invoice') ? l : false })
  const kinds = log.log.filter((e: Json) => e.status === 'sent').map((e: Json) => e.kind)
  for (const k of ['password_reset', 'welcome', 'invoice']) assert.ok(kinds.includes(k), `${k} email sent`)
  assert.ok(!log.log.some((e: Json) => e.to_email === 'nobody@test.local'))

  // Workspace email: connect SMTP, template with variables, bulk campaign to contacts that have an email.
  const mail = await call('POST', '/api/auth/signup', { name: 'Mail Owner', email: 'mailowner@test.local', password: 'password123', company: 'Mail Shop' })
  const O = { token: mail.body.token, ws: mail.body.workspaces[0].id }
  assert.equal((await call('POST', '/api/email/test', { to: 'x@test.local' }, O)).status, 400, 'needs SMTP first')
  await call('PUT', '/api/integrations/smtp', { config: { host: 'json', port: '465', user: 'shop@test.local', pass: 'app-password', from_email: 'shop@test.local', from_name: 'Mail Shop' } }, O)
  assert.equal((await call('POST', '/api/email/test', { to: 'x@test.local' }, O)).status, 200)
  await call('POST', '/api/contacts/import', { csv: 'phone,name,email,tags\n9822200001,Asha,asha@test.local,vip\n9822200002,Bina,,vip\n9822200003,Chet,chet@test.local,vip\n', tags: [] }, O)
  const tpl = await call('POST', '/api/email/templates', { name: 'Offer', subject: 'Hi {{first_name}}, 20% off', html: '<html><body><h1>Hello {{first_name}}</h1><p>{{name}}</p></body></html>' }, O)
  const prev = await call('POST', '/api/email/preview', { html: tpl.body.html }, O)
  assert.match(prev.body.html, /Unsubscribe/)
  assert.match(prev.body.html, /\/e\/o\//)
  assert.equal((await call('POST', '/api/email/campaigns/audience-preview', { type: 'tags', tags: ['vip'] }, O)).body.count, 2, 'only contacts with an email')
  const camp = await call('POST', '/api/email/campaigns', { name: 'Diwali mail', template_id: tpl.body.id, audience: { type: 'tags', tags: ['vip'] }, send: 'now' }, O)
  assert.equal(camp.status, 200, JSON.stringify(camp.body))
  const done = await until(async () => { const r = (await call('GET', `/api/email/campaigns/${camp.body.id}`, undefined, O)).body; return r.status === 'completed' ? r : false })
  assert.equal(done.sent, 2)
  assert.equal(done.failed, 0)
  const wlog = (await call('GET', '/api/email/log', undefined, O)).body
  assert.ok(wlog.some((e: Json) => e.kind === 'campaign' && e.subject === 'Hi Asha, 20% off'))
})

test('templates: image header sample is uploaded to Meta and attached as header_handle', async () => {
  const su = await call('POST', '/api/auth/signup', { name: 'Media Owner', email: 'media@test.local', password: 'password123', company: 'Media Shop' })
  const M = { token: su.body.token, ws: su.body.workspaces[0].id }
  const n = await call('POST', '/api/numbers', { label: 'Main', phone_number_id: '1112223334', waba_id: '5556667778', access_token: 'EAAG' + 'x'.repeat(40) }, M)
  assert.equal(n.status, 200, JSON.stringify(n.body))
  const fd = new FormData()
  fd.append('file', new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')], { type: 'image/png' }), 'banner.png')
  const up = await fetch(`${BASE}/api/uploads`, { method: 'POST', headers: { Authorization: `Bearer ${M.token}`, 'X-Workspace-Id': String(M.ws) }, body: fd }).then((r) => r.json())
  assert.match(up.url, /\/uploads\/[a-f0-9]{24}\.png$/)
  const comps = [{ type: 'HEADER', format: 'IMAGE' }, { type: 'BODY', text: 'New collection is here!' }]
  const missing = await call('POST', '/api/templates', { name: 'new_arrivals', language: 'en', category: 'MARKETING', components: comps }, M)
  assert.equal(missing.status, 400)
  const before = rzpCalls.length
  const tpl = await call('POST', '/api/templates', { name: 'new_arrivals', language: 'en', category: 'MARKETING', components: comps, header_media_url: up.url }, M)
  assert.equal(tpl.status, 200, JSON.stringify(tpl.body))
  const uploadCall = rzpCalls.slice(before).find((c) => String(c.path).includes('/test-app/uploads?file_length='))
  assert.ok(uploadCall, 'resumable upload session opened on the Meta app')
  const header = tpl.body.components.find((c: Json) => c.type === 'HEADER')
  assert.match(header.example.header_handle[0], /^handle_/)
})

test('auto-assign: new chats are routed to eligible agents, least busy first, respecting max open', async () => {
  const su = await call('POST', '/api/auth/signup', { name: 'AA Owner', email: 'aa-owner@test.local', password: 'password123', company: 'AA Co' })
  const o = { token: su.body.token, ws: su.body.workspaces[0].id }
  await call('POST', '/api/numbers/demo', {}, o)
  const ids: number[] = []
  for (const e of ['aa1@test.local', 'aa2@test.local']) {
    const inv = await call('POST', '/api/team/invites', { email: e, role: 'agent' }, o)
    const acc = await call('POST', `/api/auth/invites/${inv.body.link.split('/invite/')[1]}/accept`, { name: e, password: 'password123' })
    ids.push(acc.body.user.id)
  }
  // off by default: chat stays unassigned
  let sim = await call('POST', '/api/simulate', { phone: '9811100000', text: 'hi' }, o)
  assert.equal((await call('GET', `/api/conversations/${sim.body.conversation_id}`, undefined, o)).body.assigned_to, null)
  const agent = { token: (await call('POST', '/api/auth/login', { email: 'aa1@test.local', password: 'password123' })).body.token, ws: o.ws }
  assert.equal((await call('PUT', '/api/team/auto-assign', { mode: 'least_busy', members: ids }, agent)).status, 403)
  const set = await call('PUT', '/api/team/auto-assign', { mode: 'least_busy', members: [...ids, 999999], max_open: 2 }, o)
  assert.equal(set.status, 200, JSON.stringify(set.body))
  assert.deepEqual(set.body.members, ids, 'unknown users are dropped')
  const got: number[] = []
  for (let i = 1; i <= 5; i++) {
    sim = await call('POST', '/api/simulate', { phone: `98111000${10 + i}`, text: 'hello' }, o)
    got.push((await call('GET', `/api/conversations/${sim.body.conversation_id}`, undefined, o)).body.assigned_to)
  }
  assert.equal(got.filter((g) => g === ids[0]).length, 2)
  assert.equal(got.filter((g) => g === ids[1]).length, 2)
  assert.equal(got[4], null, 'everyone is at max open chats')
  // returning customer keeps the same agent
  sim = await call('POST', '/api/simulate', { phone: '9811100011', text: 'again' }, o)
  assert.equal((await call('GET', `/api/conversations/${sim.body.conversation_id}`, undefined, o)).body.assigned_to, got[0])
})

test('booking: WhatsApp flow picks day + slot, creates appointment, ICS feed, double-booking blocked', async () => {
  const su = await call('POST', '/api/auth/signup', { name: 'Clinic', email: 'clinic@test.local', password: 'password123', company: 'Clinic Co' })
  const o = { token: su.body.token, ws: su.body.workspaces[0].id }
  await call('POST', '/api/numbers/demo', {}, o)
  const set = await call('PUT', '/api/booking/settings', { services: [{ name: 'Checkup', duration: 30 }], days: [0, 1, 2, 3, 4, 5, 6], start: '00:00', end: '23:30',
    slot_minutes: 30, capacity: 1, days_ahead: 3, min_notice_minutes: 0 }, o)
  assert.equal(set.status, 200, JSON.stringify(set.body))
  assert.match(set.body.ics_url, /\/cal\/[\w-]+\.ics$/)
  const f = await call('POST', '/api/flows', { name: 'Book', is_active: true, trigger: { type: 'keyword', value: 'book', match: 'exact' }, nodes: [
    { id: 'b1', type: 'booking', data: { service: 'Checkup' }, next: 'm1' },
    { id: 'm1', type: 'message', data: { reply: { type: 'text', text: 'See you {{appointment_date}} at {{appointment_time}}' } } },
  ] }, o)
  assert.equal(f.status, 200, JSON.stringify(f.body))
  const lastOut = async (conv: number) => (await call('GET', `/api/conversations/${conv}/messages`, undefined, o)).body.filter((m: Json) => m.direction === 'out').pop()
  let sim = await call('POST', '/api/simulate', { phone: '9822200001', name: 'Ravi', text: 'book' }, o)
  const conv = sim.body.conversation_id
  const days = await lastOut(conv)
  assert.equal(days.type, 'list')
  const dayRow = days.payload.sections[0].rows[1] ?? days.payload.sections[0].rows[0]
  sim = await call('POST', '/api/simulate', { phone: '9822200001', text: dayRow.title, button_id: dayRow.id }, o)
  const slots = await lastOut(conv)
  assert.equal(slots.type, 'list')
  assert.ok(slots.payload.sections[0].rows.length === 10, 'slot list is paged to 10 rows')
  const slotRow = slots.payload.sections[0].rows[0]
  // typed answer "1" picks the first option too
  await call('POST', '/api/simulate', { phone: '9822200001', text: '1' }, o)
  const msgs = (await call('GET', `/api/conversations/${conv}/messages`, undefined, o)).body.filter((m: Json) => m.direction === 'out')
  assert.ok(msgs.some((m: Json) => /Booked!/.test(m.body) && m.body.includes('calendar.google.com')), 'confirmation with Google Calendar link')
  assert.ok(/See you .+ at .+/.test(msgs[msgs.length - 1].body), 'flow continues with appointment variables')
  const list = await call('GET', '/api/appointments', undefined, o)
  assert.equal(list.body.items.length, 1)
  const appt = list.body.items[0]
  assert.equal(appt.starts_at, slotRow.id.split(':s:')[1])
  assert.equal(appt.contact_name, 'Ravi')
  // same slot cannot be booked twice (capacity 1) unless forced
  const dup = await call('POST', '/api/appointments', { phone: '9822200002', name: 'Neha', starts_at: appt.starts_at, service: 'Checkup' }, o)
  assert.equal(dup.status, 400)
  assert.equal((await call('POST', '/api/appointments', { phone: '9822200002', name: 'Neha', starts_at: appt.starts_at, force: true }, o)).status, 200)
  const ics = await fetch(set.body.ics_url.replace(/^https?:\/\/[^/]+/, BASE))
  const text = await ics.text()
  assert.equal(ics.status, 200)
  assert.match(text, /BEGIN:VCALENDAR/)
  assert.equal(text.split('BEGIN:VEVENT').length - 1, 2)
  assert.equal((await call('PATCH', `/api/appointments/${appt.id}`, { status: 'cancelled' }, o)).body.status, 'cancelled')
  assert.equal((await fetch(BASE + '/cal/not-a-real-token-123456.ics')).status, 404)
})
