import express from 'express'
import path from 'node:path'
import fs from 'node:fs'
import { config } from './config.ts'
import { migrate } from './db.ts'
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
import { startWorker } from './services/worker.ts'

if (config.isProd && config.appSecret.startsWith('dev-only')) {
  console.error('APP_SECRET must be set in production'); process.exit(1)
}

migrate()
seed()

const app = express()
app.set('trust proxy', 1)
app.disable('x-powered-by')
app.use((_req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'X-Frame-Options': 'SAMEORIGIN' })
  next()
})
// Keep the raw body for webhook signature checks (Meta, Razorpay).
app.use(express.json({ limit: '6mb', verify: (req, _res, buf) => { (req as express.Request).rawBody = buf } }))

app.get('/health', (_req, res) => { res.json({ ok: true, service: config.brand.product }) })
app.use('/webhooks', webhookRoutes)
app.use('/uploads', express.static(path.join(config.dataDir, 'uploads'), { maxAge: '7d' }))
app.use('/api/public', publicRoutes)
app.use('/api/auth', authRoutes)
app.use('/api/admin', requireUser, adminRoutes)
app.use('/api/v1', apiV1)
app.use('/api', requireUser, requireWorkspace, workspaceRoutes, numberRoutes, inboxRoutes, contactRoutes, templateRoutes,
  campaignRoutes, automationRoutes, commerceRoutes, teamRoutes, billingRoutes, analyticsRoutes)
app.use('/api', (_req, res) => { res.status(404).json({ error: 'Not found' }) })

// Serve the built dashboard + landing page.
const dist = path.resolve('dist')
if (fs.existsSync(dist)) {
  app.use(express.static(dist, { index: false, maxAge: '1h' }))
  app.get(/^(?!\/(api|webhooks|uploads)\/).*/, (_req, res) => { res.sendFile(path.join(dist, 'index.html')) })
}

app.use(errorHandler)

app.listen(config.port, () => {
  console.log(`${config.brand.product} running on :${config.port}`)
  startWorker()
})
