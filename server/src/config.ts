import path from 'node:path'
import crypto from 'node:crypto'

const env = process.env

export const config = {
  port: Number(env.PORT || 8080),
  appUrl: (env.APP_URL || 'https://www.mecgura.tech').replace(/\/$/, ''),
  // Public URL of this API server for Meta / Razorpay webhooks (the site proxies /api here). Defaults to APP_URL.
  apiUrl: (env.API_URL || env.APP_URL || 'https://www.mecgura.tech').replace(/\/$/, ''),
  dataDir: path.resolve(env.DATA_DIR || './data'),
  // Used for JWT signing and encrypting stored access tokens. MUST be set in production.
  appSecret: env.APP_SECRET || 'dev-only-change-me-' + crypto.createHash('sha256').update(process.cwd()).digest('hex').slice(0, 16),
  isProd: env.NODE_ENV === 'production',
  // MECGURA sets plans and collects payment itself, so clients don't see plans or billing unless CLIENT_BILLING=visible.
  clientBilling: env.CLIENT_BILLING === 'visible',
  // Browser origins allowed to call the API directly. Defaults to APP_URL plus its www/apex twin.
  corsOrigins: (env.CORS_ORIGINS || '').split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean),
  admin: { email: env.ADMIN_EMAIL || 'hello@mecgura.com', password: env.ADMIN_PASSWORD || '' },
  seedDemo: env.SEED_DEMO === '1',
  meta: {
    graphVersion: env.WA_GRAPH_VERSION || 'v23.0',
    appId: env.META_APP_ID || '',
    appSecret: env.META_APP_SECRET || '',
    verifyToken: env.WA_VERIFY_TOKEN || 'mecgura-verify',
    embeddedConfigId: env.META_EMBEDDED_CONFIG_ID || '',
  },
  anthropic: { apiKey: env.ANTHROPIC_API_KEY || '', model: env.AI_MODEL || 'claude-opus-5' },
  // MECGURA's own mailbox for bills, receipts, invites and password resets (Gmail: smtp.gmail.com:465 + App Password).
  smtp: { host: env.SMTP_HOST || '', port: Number(env.SMTP_PORT || 465), user: env.SMTP_USER || '', pass: env.SMTP_PASS || '',
    from: env.SMTP_FROM || 'MECGURA <hello@mecgura.com>' },
  razorpay: { keyId: env.RAZORPAY_KEY_ID || '', keySecret: env.RAZORPAY_KEY_SECRET || '', webhookSecret: env.RAZORPAY_WEBHOOK_SECRET || '' },
  brand: {
    name: 'MECGURA',
    product: 'MECGURA WhatsApp',
    email: 'hello@mecgura.com',
    phone: '+91 78377 22567',
    website: 'https://mecgura.tech',
  },
}
