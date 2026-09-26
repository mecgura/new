import { Router } from 'express'
import { config } from '../config.ts'
import { hmacHex, safeEqual } from '../lib/security.ts'
import { processWebhook } from '../services/inbound.ts'
import { razorpayClientWebhook } from './commerce.ts'
import { get, run } from '../db.ts'
import { verifyWebhook } from '../services/razorpay.ts'
import { activatePlan } from '../services/plans.ts'
import { notify } from '../services/messaging.ts'
import { mailReceipt } from '../services/platformMail.ts'

export const webhookRoutes = Router()

// Meta verification handshake.
webhookRoutes.get(['/whatsapp', '/meta'], (req, res) => {
  if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === config.meta.verifyToken) return res.status(200).send(String(req.query['hub.challenge']))
  res.sendStatus(403)
})

webhookRoutes.post(['/whatsapp', '/meta'], (req, res) => {
  if (config.meta.appSecret) {
    const sig = String(req.headers['x-hub-signature-256'] || '')
    if (!req.rawBody || !safeEqual(`sha256=${hmacHex(config.meta.appSecret, req.rawBody)}`, sig)) return res.sendStatus(401)
  }
  res.sendStatus(200) // acknowledge fast; Meta retries slow endpoints
  processWebhook(req.body).catch((e) => console.error('webhook processing failed', e))
})

// Client paid MECGURA (payment link from Admin → Clients): activate the plan automatically.
webhookRoutes.post('/razorpay-billing', (req, res) => {
  const secret = config.razorpay.webhookSecret
  if (!secret || !req.rawBody || !verifyWebhook(secret, req.rawBody, String(req.headers['x-razorpay-signature'] || ''))) return res.status(400).json({ error: 'bad signature' })
  const ev = req.body as { event?: string; payload?: { payment_link?: { entity?: { id?: string } }; payment?: { entity?: { id?: string } } } }
  if (ev.event === 'payment_link.paid') {
    const linkId = ev.payload?.payment_link?.entity?.id
    const inv = get<{ id: number; workspace_id: number; plan_id: number; cycle: 'monthly' | 'yearly'; status: string; amount: number }>('SELECT * FROM invoices WHERE provider_order_id = ?', linkId)
    if (inv && inv.status !== 'paid') {
      activatePlan(inv.workspace_id, inv.plan_id, inv.cycle)
      const w = get<{ current_period_end: string }>('SELECT current_period_end FROM workspaces WHERE id = ?', inv.workspace_id)!
      run("UPDATE invoices SET status = 'paid', provider_payment_id = ?, period_end = ? WHERE id = ?", ev.payload?.payment?.entity?.id ?? 'razorpay', w.current_period_end, inv.id)
      const plan = get<{ name: string }>('SELECT name FROM plans WHERE id = ?', inv.plan_id)
      mailReceipt(inv.workspace_id, { id: inv.id, amount: inv.amount, plan: plan?.name ?? 'Plan', cycle: inv.cycle, validUntil: w.current_period_end, reference: ev.payload?.payment?.entity?.id })
      notify(inv.workspace_id, { title: 'Payment received — thank you!', body: `Your plan is active until ${new Date(w.current_period_end).toLocaleDateString('en-IN')}.`, type: 'billing' })
    }
  }
  res.json({ ok: true })
})

webhookRoutes.post('/razorpay/:workspaceId', razorpayClientWebhook)
