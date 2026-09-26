import express from 'express'
import path from 'node:path'
import fs from 'node:fs'
import { config } from './config.ts'
import { migrate, db } from './db.ts'
import { seed } from './seed.ts'
import { errorHandler } from './lib/http.ts'
import { requireUser, requireWorkspace } from './lib/auth.ts'
import { authRoutes } from './routes/auth.ts'
import { publicRoutes } from './routes/public.ts'
import { workspaceRoutes } from './routes/workspace.ts'
import { numberRoutes } from './routes/numbers.ts'
import { inboxRoutes } from './routes/inbox.ts'
import { contactRoutes } from './routes/contacts.ts'
import { templateRoutes } from './routes/templates.ts'
import { campaignRoutes } from './routes/campaigns.ts'
import { automationRoutes } from './routes/automation.ts'
import { commerceRoutes } from './routes/commerce.ts'
import { teamRoutes } from './routes/team.ts'
import { billingRoutes } from './routes/billing.ts'
import { analyticsRoutes } from './routes/analytics.ts'
import { adminRoutes } from './routes/admin.ts'
import { apiV1 } from './routes/api_v1.ts'
import { webhookRoutes } from './routes/webhooks.ts'
import { emailRoutes, emailTracking } from './routes/email.ts'
import { startWorker } from './services/worker.ts'

if (config.isProd && config.appSecret.startsWith('dev-only')) {
  console.error('APP_SECRET must be set in production'); process.exit(1)
}

migrate()
seed()
if (config.isProd && !config.meta.appSecret) console.warn('WARNING: META_APP_SECRET is not set — incoming WhatsApp webhooks are not signature-verified.')

const app = express()
app.set('trust proxy', Number(process.env.TRUST_PROXY ?? 1))
app.disable('x-powered-by')
app.use((_req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'X-Frame-Options': 'SAMEORIGIN' })
  next()
})
// The dashboard on www.mecgura.tech calls this API on api.mecgura.tech directly.
const allowedOrigins = new Set(config.corsOrigins.length ? config.corsOrigins : (() => {
  const u = new URL(config.appUrl)
  const twin = u.hostname.startsWith('www.') ? u.hostname.slice(4) : `www.${u.hostname}`
  return [u.origin, `${u.protocol}//${twin}`]
})())
app.use(['/api', '/uploads'], (req, res, next) => {
  const origin = req.headers.origin
  if (origin && allowedOrigins.has(origin)) {
    res.set({ 'Access-Control-Allow-Origin': origin, Vary: 'Origin', 'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Workspace-Id, X-Api-Key',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS', 'Access-Control-Max-Age': '86400', 'Access-Control-Expose-Headers': 'Content-Disposition' })
  }
  if (req.method === 'OPTIONS') return res.sendStatus(origin && allowedOrigins.has(origin) ? 204 : 403)
  next()
})

// Keep the raw body for webhook signature checks (Meta, Razorpay).
app.use(express.json({ limit: '6mb', verify: (req, _res, buf) => { (req as express.Request).rawBody = buf } }))

app.get('/health', (_req, res) => {
  try { db.prepare('SELECT 1').get(); res.json({ ok: true, service: config.brand.product }) } catch { res.status(503).json({ ok: false }) }
})
app.use('/webhooks', webhookRoutes)
app.use('/e', emailTracking)
app.use('/uploads', express.static(path.join(config.dataDir, 'uploads'), { maxAge: '7d' }))
app.use('/api/public', publicRoutes)
app.use('/api/auth', authRoutes)
app.use('/api/admin', requireUser, adminRoutes)
app.use('/api/v1', apiV1)
app.use('/api', requireUser, requireWorkspace, workspaceRoutes, numberRoutes, inboxRoutes, contactRoutes, templateRoutes,
  campaignRoutes, automationRoutes, commerceRoutes, teamRoutes, billingRoutes, analyticsRoutes, emailRoutes)
app.use('/api', (_req, res) => { res.status(404).json({ error: 'Not found' }) })

// Serve the built dashboard + landing page.
const dist = path.resolve('dist')
if (fs.existsSync(dist)) {
  app.use(express.static(dist, { index: false, maxAge: '1h' }))
  app.get(/^(?!\/(api|webhooks|uploads|e)\/).*/, (_req, res) => { res.sendFile(path.join(dist, 'index.html')) })
}

app.use(errorHandler)

app.listen(config.port, () => {
  console.log(`${config.brand.product} running on :${config.port}`)
  startWorker()
})
