import { Router } from 'express'
import { z } from 'zod'
import { all, get, insert, run, now } from '../db.ts'
import { h, parse, bad } from '../lib/http.ts'
import { perm } from '../lib/auth.ts'
import { config } from '../config.ts'
import { listPlans, usageSummary, activatePlan, type Plan } from '../services/plans.ts'
import { createOrder, verifyPaymentSignature } from '../services/razorpay.ts'

export const billingRoutes = Router()
const B = perm('billing.manage')

billingRoutes.get('/billing', h((req, res) => {
  const ws = get('SELECT subscription_status, trial_ends_at, current_period_end, status FROM workspaces WHERE id = ?', req.ws!.id)
  res.json({ ...ws, ...usageSummary(req.ws!.id), plans: listPlans(true), invoices: all('SELECT i.*, p.name AS plan_name FROM invoices i LEFT JOIN plans p ON p.id = i.plan_id WHERE i.workspace_id = ? ORDER BY i.id DESC', req.ws!.id),
    online_payments: !!(config.razorpay.keyId && config.razorpay.keySecret), razorpay_key_id: config.razorpay.keyId || null })
}))

// Creates a Razorpay order for a plan (GST-inclusive pricing handled on invoice side).
billingRoutes.post('/billing/checkout', B, h(async (req, res) => {
  const b = parse(z.object({ plan_id: z.number(), cycle: z.enum(['monthly', 'yearly']) }), req.body)
  const plan = get<Plan>('SELECT * FROM plans WHERE id = ?', b.plan_id)
  if (!plan) throw bad('Plan not found')
  const amount = b.cycle === 'yearly' ? plan.price_yearly : plan.price_monthly
  if (!amount) throw bad(`Please contact MECGURA at ${config.brand.email} or ${config.brand.phone} for ${plan.name} pricing`)
  if (!config.razorpay.keyId) throw bad(`Online payment is not enabled yet. Contact ${config.brand.email} / ${config.brand.phone} to activate your plan.`)
  const inv = insert('invoices', { workspace_id: req.ws!.id, plan_id: plan.id, amount, cycle: b.cycle, status: 'created', created_at: now() })
  const order = await createOrder({ keyId: config.razorpay.keyId, keySecret: config.razorpay.keySecret }, amount, `inv_${inv}`, { workspace_id: String(req.ws!.id), invoice_id: String(inv) })
  run('UPDATE invoices SET provider_order_id = ? WHERE id = ?', order.id, inv)
  const user = get<{ name: string; email: string; phone: string | null }>('SELECT name, email, phone FROM users WHERE id = ?', req.user!.id)!
  res.json({ order_id: order.id, amount: order.amount, currency: order.currency, key_id: config.razorpay.keyId, invoice_id: inv,
    name: config.brand.product, description: `${plan.name} plan (${b.cycle})`, prefill: { name: user.name, email: user.email, contact: user.phone ?? '' } })
}))

billingRoutes.post('/billing/verify', B, h((req, res) => {
  const b = parse(z.object({ razorpay_order_id: z.string(), razorpay_payment_id: z.string(), razorpay_signature: z.string() }), req.body)
  const inv = get<{ id: number; plan_id: number; cycle: 'monthly' | 'yearly'; status: string }>('SELECT * FROM invoices WHERE provider_order_id = ? AND workspace_id = ?', b.razorpay_order_id, req.ws!.id)
  if (!inv) throw bad('Invoice not found')
  if (!verifyPaymentSignature(config.razorpay.keySecret, b.razorpay_order_id, b.razorpay_payment_id, b.razorpay_signature)) throw bad('Payment verification failed')
  if (inv.status !== 'paid') {
    activatePlan(req.ws!.id, inv.plan_id, inv.cycle)
    const ws = get<{ current_period_end: string }>('SELECT current_period_end FROM workspaces WHERE id = ?', req.ws!.id)!
    run("UPDATE invoices SET status = 'paid', provider_payment_id = ?, period_end = ? WHERE id = ?", b.razorpay_payment_id, ws.current_period_end, inv.id)
  }
  res.json({ ok: true })
}))
