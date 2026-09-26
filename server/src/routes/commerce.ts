import { Router, type Request, type Response } from 'express'
import { z } from 'zod'
import { all, get, insert, run, update, now } from '../db.ts'
import { h, parse, bad, id, notFound } from '../lib/http.ts'
import { perm } from '../lib/auth.ts'
import { encrypt, decrypt, randomToken } from '../lib/security.ts'
import { requireFeature } from '../services/plans.ts'
import { createPaymentLink, verifyWebhook } from '../services/razorpay.ts'
import { sendToContact, notify, type Contact } from '../services/messaging.ts'
import { emitEvent } from '../services/hooks.ts'
import { config } from '../config.ts'

export const commerceRoutes = Router()
const P = perm('commerce.manage')

// ---- Catalogue ----
const productSchema = z.object({ name: z.string().trim().min(1).max(120), description: z.string().max(1000).optional(), price: z.number().min(0),
  currency: z.string().length(3).default('INR'), image_url: z.string().url().or(z.literal('')).optional(), retailer_id: z.string().max(100).optional(),
  category: z.string().max(60).optional(), stock: z.number().int().nullable().optional(), is_active: z.boolean().default(true) })
commerceRoutes.get('/products', h((req, res) => { res.json(all('SELECT * FROM products WHERE workspace_id = ? ORDER BY id DESC', req.ws!.id)) }))
commerceRoutes.post('/products', P, h((req, res) => {
  requireFeature(req.ws!.id, 'catalog')
  const b = parse(productSchema, req.body)
  res.json(get('SELECT * FROM products WHERE id = ?', insert('products', { workspace_id: req.ws!.id, ...b, created_at: now() })))
}))
commerceRoutes.put('/products/:id', P, h((req, res) => {
  update('products', id(req.params.id), parse(productSchema.partial(), req.body), req.ws!.id)
  res.json(get('SELECT * FROM products WHERE id = ?', id(req.params.id)))
}))
commerceRoutes.delete('/products/:id', P, h((req, res) => { run('DELETE FROM products WHERE id = ? AND workspace_id = ?', id(req.params.id), req.ws!.id); res.json({ ok: true }) }))

// ---- Orders ----
commerceRoutes.get('/orders', P, h((req, res) => {
  res.json(all('SELECT o.*, c.name AS contact_name, c.wa_id FROM orders o LEFT JOIN contacts c ON c.id = o.contact_id WHERE o.workspace_id = ? ORDER BY o.id DESC LIMIT 300', req.ws!.id))
}))
commerceRoutes.post('/orders', P, h((req, res) => {
  const b = parse(z.object({ contact_id: z.number(), items: z.array(z.object({ name: z.string(), qty: z.number().int().min(1), price: z.number().min(0) })).min(1), notes: z.string().max(1000).optional() }), req.body)
  if (!get('SELECT id FROM contacts WHERE id = ? AND workspace_id = ?', b.contact_id, req.ws!.id)) throw notFound('Contact')
  const total = b.items.reduce((s, i) => s + i.qty * i.price, 0)
  const oid = insert('orders', { workspace_id: req.ws!.id, contact_id: b.contact_id, items: b.items, total: Math.round(total), notes: b.notes ?? null, source: 'manual', created_at: now() })
  const order = get('SELECT * FROM orders WHERE id = ?', oid)
  emitEvent(req.ws!.id, 'order.created', order)
  res.json(order)
}))
commerceRoutes.patch('/orders/:id', P, h((req, res) => {
  const b = parse(z.object({ status: z.enum(['pending', 'confirmed', 'shipped', 'delivered', 'cancelled']).optional(), payment_status: z.enum(['unpaid', 'paid', 'refunded']).optional(), notes: z.string().max(1000).optional() }), req.body)
  update('orders', id(req.params.id), b, req.ws!.id)
  res.json(get('SELECT * FROM orders WHERE id = ?', id(req.params.id)))
}))
commerceRoutes.post('/orders/:id/payment-link', P, h(async (req, res) => {
  const o = get<{ id: number; contact_id: number; total: number }>('SELECT * FROM orders WHERE id = ? AND workspace_id = ?', id(req.params.id), req.ws!.id)
  if (!o) throw notFound('Order')
  const contact = get<Contact>('SELECT * FROM contacts WHERE id = ?', o.contact_id)!
  const pay = await createPaymentForContact(req.ws!.id, contact, o.total, `Order #${o.id}`, o.id)
  await sendToContact({ workspaceId: req.ws!.id, contactId: contact.id, sentBy: 'agent', userId: req.user!.id,
    message: { type: 'cta_url', text: `💳 Payment for Order #${o.id}\nAmount: ₹${o.total.toLocaleString('en-IN')}`, display_text: 'Pay now', url: pay.short_url! } })
  res.json(pay)
}))

// ---- Payments (Razorpay payment links on the client's own Razorpay account) ----
function razorpayKeys(workspaceId: number) {
  const i = get<{ config: { key_id?: string; key_secret?: string; webhook_secret?: string } }>("SELECT config FROM integrations WHERE workspace_id = ? AND provider = 'razorpay' AND enabled = 1", workspaceId)
  if (!i?.config.key_id) throw bad('Connect your Razorpay account in Integrations first')
  return { keyId: i.config.key_id, keySecret: decrypt(i.config.key_secret), webhookSecret: decrypt(i.config.webhook_secret) }
}

export async function createPaymentForContact(workspaceId: number, contact: Contact, amount: number, description: string, orderId?: number) {
  requireFeature(workspaceId, 'payments')
  const keys = razorpayKeys(workspaceId)
  const pid = insert('payments', { workspace_id: workspaceId, contact_id: contact.id, order_id: orderId ?? null, amount: Math.round(amount), description, created_at: now() })
  try {
    const link = await createPaymentLink(keys, { amount, description, name: contact.name ?? undefined, phone: contact.wa_id, email: contact.email ?? undefined, reference: `mec_${workspaceId}_${pid}` })
    update('payments', pid, { provider_ref: link.id, short_url: link.short_url, status: 'created' })
    if (orderId) update('orders', orderId, { payment_id: pid })
  } catch (e) { run('DELETE FROM payments WHERE id = ?', pid); throw bad(`Razorpay: ${(e as Error).message}`) }
  return get<{ id: number; short_url: string | null }>('SELECT * FROM payments WHERE id = ?', pid)!
}

commerceRoutes.get('/payments', P, h((req, res) => {
  res.json(all('SELECT p.*, c.name AS contact_name, c.wa_id FROM payments p LEFT JOIN contacts c ON c.id = p.contact_id WHERE p.workspace_id = ? ORDER BY p.id DESC LIMIT 300', req.ws!.id))
}))
commerceRoutes.post('/payments', P, h(async (req, res) => {
  const b = parse(z.object({ contact_id: z.number(), amount: z.number().positive(), description: z.string().min(2).max(200), send: z.boolean().default(true) }), req.body)
  const contact = get<Contact>('SELECT * FROM contacts WHERE id = ? AND workspace_id = ?', b.contact_id, req.ws!.id)
  if (!contact) throw notFound('Contact')
  const pay = await createPaymentForContact(req.ws!.id, contact, b.amount, b.description)
  if (b.send) await sendToContact({ workspaceId: req.ws!.id, contactId: contact.id, sentBy: 'agent', userId: req.user!.id,
    message: { type: 'cta_url', text: `💳 ${b.description}\nAmount: ₹${b.amount.toLocaleString('en-IN')}`, display_text: 'Pay now', url: pay.short_url! } })
  res.json(pay)
}))

// Razorpay → MECGURA webhook for a client's payment links.
export const razorpayClientWebhook = h(async (req: Request, res: Response) => {
  const wsId = id(req.params.workspaceId)
  const keys = razorpayKeys(wsId)
  if (!keys.webhookSecret || !req.rawBody || !verifyWebhook(keys.webhookSecret, req.rawBody, String(req.headers['x-razorpay-signature']))) return res.status(400).json({ error: 'bad signature' })
  const ev = req.body as { event: string; payload?: { payment_link?: { entity?: { id: string } } } }
  if (ev.event === 'payment_link.paid') {
    const linkId = ev.payload?.payment_link?.entity?.id
    const p = get<{ id: number; order_id: number | null; contact_id: number; amount: number; description: string; status: string }>('SELECT * FROM payments WHERE workspace_id = ? AND provider_ref = ?', wsId, linkId)
    if (p && p.status !== 'paid') {
      update('payments', p.id, { status: 'paid', paid_at: now() })
      if (p.order_id) update('orders', p.order_id, { payment_status: 'paid', status: 'confirmed' })
      notify(wsId, { title: `Payment received: ₹${p.amount.toLocaleString('en-IN')}`, body: p.description, link: '/app/commerce?tab=payments', type: 'payment' })
      emitEvent(wsId, 'payment.paid', get('SELECT * FROM payments WHERE id = ?', p.id))
      await sendToContact({ workspaceId: wsId, contactId: p.contact_id, sentBy: 'system', message: { type: 'text', text: `✅ Payment of ₹${p.amount.toLocaleString('en-IN')} received for "${p.description}". Thank you!` } }).catch(() => undefined)
    }
  }
  res.json({ ok: true })
})

// ---- Integrations ----
const SECRET_FIELDS = ['key_secret', 'webhook_secret', 'api_key']
commerceRoutes.get('/integrations', perm('settings.manage'), h((req, res) => {
  const rows = all<{ provider: string; config: Record<string, string>; enabled: number }>('SELECT provider, config, enabled FROM integrations WHERE workspace_id = ?', req.ws!.id)
  res.json(rows.map((r) => ({ ...r, config: Object.fromEntries(Object.entries(r.config).map(([k, v]) => [k, SECRET_FIELDS.includes(k) ? (v ? '••••••••' : '') : v])),
    webhook_url: r.provider === 'razorpay' ? `${config.appUrl}/webhooks/razorpay/${req.ws!.id}` : undefined })))
}))
commerceRoutes.put('/integrations/:provider', perm('settings.manage'), h((req, res) => {
  const provider = String(req.params.provider)
  if (!['razorpay', 'anthropic', 'google_sheets', 'shopify', 'woocommerce'].includes(provider)) throw bad('Unknown integration')
  const b = parse(z.object({ enabled: z.boolean().default(true), config: z.record(z.string(), z.string().max(500)) }), req.body)
  const cur = get<{ config: Record<string, string> }>('SELECT config FROM integrations WHERE workspace_id = ? AND provider = ?', req.ws!.id, provider)
  const merged: Record<string, string> = { ...(cur?.config ?? {}) }
  for (const [k, v] of Object.entries(b.config)) {
    if (v === '••••••••') continue
    merged[k] = SECRET_FIELDS.includes(k) && v ? encrypt(v) : v
  }
  if (provider === 'razorpay' && !merged.webhook_secret) merged.webhook_secret = encrypt(randomToken(18))
  run(`INSERT INTO integrations (workspace_id, provider, config, enabled, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(workspace_id, provider) DO UPDATE SET config = excluded.config, enabled = excluded.enabled`, req.ws!.id, provider, JSON.stringify(merged), b.enabled ? 1 : 0, now())
  res.json({ ok: true, webhook_secret: provider === 'razorpay' ? decrypt(merged.webhook_secret) : undefined })
}))
commerceRoutes.delete('/integrations/:provider', perm('settings.manage'), h((req, res) => {
  run('DELETE FROM integrations WHERE workspace_id = ? AND provider = ?', req.ws!.id, String(req.params.provider)); res.json({ ok: true })
}))
