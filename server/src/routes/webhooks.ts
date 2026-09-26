import { Router } from 'express'
import { config } from '../config.ts'
import { hmacHex, safeEqual } from '../lib/security.ts'
import { processWebhook } from '../services/inbound.ts'
import { razorpayClientWebhook } from './commerce.ts'

export const webhookRoutes = Router()

// Meta verification handshake.
webhookRoutes.get('/whatsapp', (req, res) => {
  if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === config.meta.verifyToken) return res.status(200).send(String(req.query['hub.challenge']))
  res.sendStatus(403)
})

webhookRoutes.post('/whatsapp', (req, res) => {
  if (config.meta.appSecret) {
    const sig = String(req.headers['x-hub-signature-256'] || '')
    if (!req.rawBody || !safeEqual(`sha256=${hmacHex(config.meta.appSecret, req.rawBody)}`, sig)) return res.sendStatus(401)
  }
  res.sendStatus(200) // acknowledge fast; Meta retries slow endpoints
  processWebhook(req.body).catch((e) => console.error('webhook processing failed', e))
})

webhookRoutes.post('/razorpay/:workspaceId', razorpayClientWebhook)
