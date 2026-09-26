import { Router } from 'express'
import { z } from 'zod'
import { all, get, insert, run, update, now } from '../db.ts'
import { h, parse, bad, id, notFound } from '../lib/http.ts'
import { perm } from '../lib/auth.ts'
import { encrypt } from '../lib/security.ts'
import { checkLimit } from '../services/plans.ts'
import * as wa from '../services/whatsapp.ts'
import { config } from '../config.ts'

export const numberRoutes = Router()
const cols = 'id, label, phone_number_id, waba_id, display_phone, verified_name, quality_rating, messaging_limit, status, is_default, is_demo, created_at'

numberRoutes.get('/numbers', h((req, res) => { res.json(all(`SELECT ${cols} FROM wa_numbers WHERE workspace_id = ? ORDER BY is_default DESC, id`, req.ws!.id)) }))

function saveNumber(workspaceId: number, d: { label?: string; phone_number_id: string; waba_id?: string; access_token: string; info?: Awaited<ReturnType<typeof wa.fetchNumberInfo>>; demo?: boolean }) {
  const other = get<{ workspace_id: number }>('SELECT workspace_id FROM wa_numbers WHERE phone_number_id = ?', d.phone_number_id)
  if (other && other.workspace_id !== workspaceId) throw bad('This WhatsApp number is already connected to another MECGURA workspace')
  if (other) {
    run('UPDATE wa_numbers SET access_token = ?, waba_id = COALESCE(?, waba_id), display_phone = COALESCE(?, display_phone), verified_name = COALESCE(?, verified_name), status = ? WHERE phone_number_id = ?',
      encrypt(d.access_token), d.waba_id ?? null, d.info?.display_phone_number ?? null, d.info?.verified_name ?? null, 'connected', d.phone_number_id)
    return get<{ id: number }>('SELECT id FROM wa_numbers WHERE phone_number_id = ?', d.phone_number_id)!.id
  }
  checkLimit(workspaceId, 'numbers')
  const isFirst = !get('SELECT id FROM wa_numbers WHERE workspace_id = ?', workspaceId)
  return insert('wa_numbers', {
    workspace_id: workspaceId, label: d.label || d.info?.verified_name || 'WhatsApp', phone_number_id: d.phone_number_id, waba_id: d.waba_id ?? null,
    access_token: d.demo ? '' : encrypt(d.access_token), display_phone: d.info?.display_phone_number ?? null, verified_name: d.info?.verified_name ?? null,
    quality_rating: d.info?.quality_rating ?? null, messaging_limit: d.info?.messaging_limit_tier ?? null, is_default: isFirst ? 1 : 0, is_demo: d.demo ? 1 : 0,
    status: 'connected', created_at: now(),
  })
}

// Manual connection with a permanent System User token from Meta Business Manager.
numberRoutes.post('/numbers', perm('numbers.manage'), h(async (req, res) => {
  const b = parse(z.object({ label: z.string().max(60).optional(), phone_number_id: z.string().trim().regex(/^\d+$/, 'Phone number ID must be numeric'),
    waba_id: z.string().trim().regex(/^\d+$/, 'WABA ID must be numeric'), access_token: z.string().trim().min(20) }), req.body)
  let info
  try { info = await wa.fetchNumberInfo(b.access_token, b.phone_number_id) } catch (e) { throw bad(`Meta rejected these credentials: ${(e as Error).message}`) }
  try { await wa.subscribeApp(b.access_token, b.waba_id) } catch { /* token may lack permission; webhook can be set in Meta app */ }
  const nid = saveNumber(req.ws!.id, { ...b, info })
  res.json(get(`SELECT ${cols} FROM wa_numbers WHERE id = ?`, nid))
}))

// Sandbox number: lets a new client explore the full product before Meta approval.
numberRoutes.post('/numbers/demo', perm('numbers.manage'), h((req, res) => {
  const pid = `demo${req.ws!.id}${Date.now().toString().slice(-6)}`
  const nid = saveNumber(req.ws!.id, { label: 'Sandbox (demo)', phone_number_id: pid, access_token: '', demo: true,
    info: { display_phone_number: '+91 00000 00000', verified_name: `${req.ws!.name} (Sandbox)`, quality_rating: 'GREEN' } })
  res.json(get(`SELECT ${cols} FROM wa_numbers WHERE id = ?`, nid))
}))

// Meta Embedded Signup: the frontend runs FB.login with the config id and posts back the code + ids.
numberRoutes.post('/numbers/embedded-signup', perm('numbers.manage'), h(async (req, res) => {
  if (!config.meta.appId || !config.meta.appSecret) throw bad('Embedded signup is not configured on this server')
  const b = parse(z.object({ code: z.string().min(5), phone_number_id: z.string().regex(/^\d+$/), waba_id: z.string().regex(/^\d+$/), pin: z.string().regex(/^\d{6}$/).optional() }), req.body)
  const token = await wa.exchangeCode(b.code)
  await wa.subscribeApp(token, b.waba_id)
  await wa.registerNumber(token, b.phone_number_id, b.pin ?? '000000').catch(() => undefined)
  const info = await wa.fetchNumberInfo(token, b.phone_number_id)
  const nid = saveNumber(req.ws!.id, { phone_number_id: b.phone_number_id, waba_id: b.waba_id, access_token: token, info })
  res.json(get(`SELECT ${cols} FROM wa_numbers WHERE id = ?`, nid))
}))

numberRoutes.patch('/numbers/:id', perm('numbers.manage'), h((req, res) => {
  const nid = id(req.params.id)
  const b = parse(z.object({ label: z.string().max(60).optional(), is_default: z.boolean().optional(), access_token: z.string().min(20).optional() }), req.body)
  if (!get('SELECT id FROM wa_numbers WHERE id = ? AND workspace_id = ?', nid, req.ws!.id)) throw notFound('Number')
  if (b.is_default) run('UPDATE wa_numbers SET is_default = 0 WHERE workspace_id = ?', req.ws!.id)
  update('wa_numbers', nid, { label: b.label, is_default: b.is_default, access_token: b.access_token ? encrypt(b.access_token) : undefined }, req.ws!.id)
  res.json(get(`SELECT ${cols} FROM wa_numbers WHERE id = ?`, nid))
}))

numberRoutes.post('/numbers/:id/refresh', perm('numbers.manage'), h(async (req, res) => {
  const n = get<wa.WaNumber>('SELECT * FROM wa_numbers WHERE id = ? AND workspace_id = ?', id(req.params.id), req.ws!.id)
  if (!n) throw notFound('Number')
  if (!n.is_demo) {
    try {
      const { decrypt } = await import('../lib/security.ts')
      const info = await wa.fetchNumberInfo(decrypt(n.access_token), n.phone_number_id)
      update('wa_numbers', n.id, { display_phone: info.display_phone_number, verified_name: info.verified_name, quality_rating: info.quality_rating, messaging_limit: info.messaging_limit_tier, status: 'connected' })
    } catch (e) { update('wa_numbers', n.id, { status: 'error' }); throw bad((e as Error).message) }
  }
  res.json(get(`SELECT ${cols} FROM wa_numbers WHERE id = ?`, n.id))
}))

numberRoutes.get('/numbers/:id/profile', h(async (req, res) => {
  const n = get<wa.WaNumber>('SELECT * FROM wa_numbers WHERE id = ? AND workspace_id = ?', id(req.params.id), req.ws!.id)
  if (!n) throw notFound('Number')
  res.json(await wa.businessProfile(n))
}))
numberRoutes.post('/numbers/:id/profile', perm('numbers.manage'), h(async (req, res) => {
  const n = get<wa.WaNumber>('SELECT * FROM wa_numbers WHERE id = ? AND workspace_id = ?', id(req.params.id), req.ws!.id)
  if (!n) throw notFound('Number')
  const b = parse(z.object({ about: z.string().max(139).optional(), description: z.string().max(512).optional(), email: z.string().max(128).optional(),
    address: z.string().max(256).optional(), websites: z.array(z.string().max(256)).max(2).optional(), vertical: z.string().optional() }), req.body)
  await wa.updateBusinessProfile(n, b)
  res.json({ ok: true })
}))

numberRoutes.delete('/numbers/:id', perm('numbers.manage'), h((req, res) => {
  run('DELETE FROM wa_numbers WHERE id = ? AND workspace_id = ?', id(req.params.id), req.ws!.id)
  res.json({ ok: true })
}))
