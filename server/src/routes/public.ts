import { Router } from 'express'
import { z } from 'zod'
import { insert, now } from '../db.ts'
import { h, parse } from '../lib/http.ts'
import { listPlans } from '../services/plans.ts'
import { config } from '../config.ts'

export const publicRoutes = Router()

publicRoutes.get('/plans', h((_req, res) => { res.json(listPlans(true)) }))

publicRoutes.get('/config', (_req, res) => {
  res.json({
    brand: config.brand,
    embeddedSignup: config.meta.appId && config.meta.embeddedConfigId ? { appId: config.meta.appId, configId: config.meta.embeddedConfigId, graphVersion: config.meta.graphVersion } : null,
    webhookUrl: `${config.appUrl}/webhooks/whatsapp`,
    razorpayKeyId: config.razorpay.keyId || null,
  })
})

const seen = new Map<string, number>()
publicRoutes.post('/contact', h((req, res) => {
  const ip = String(req.ip)
  if ((seen.get(ip) ?? 0) > Date.now() - 20000) return res.status(429).json({ error: 'Please wait a moment before sending again.' })
  seen.set(ip, Date.now())
  const b = parse(z.object({ name: z.string().trim().min(2).max(80), email: z.string().trim().email().max(120), phone: z.string().trim().max(20).optional(),
    company: z.string().trim().max(80).optional(), message: z.string().trim().max(2000).optional() }), req.body)
  insert('site_leads', { ...b, created_at: now() })
  res.json({ ok: true })
}))
