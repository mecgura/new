import path from 'node:path'
import crypto from 'node:crypto'

const env = process.env

export const config = {
  port: Number(env.PORT || 8080),
  appUrl: (env.APP_URL || 'https://whatsapp.mecgura.tech').replace(/\/$/, ''),
  dataDir: path.resolve(env.DATA_DIR || './data'),
  // Used for JWT signing and encrypting stored access tokens. MUST be set in production.
  appSecret: env.APP_SECRET || 'dev-only-change-me-' + crypto.createHash('sha256').update(process.cwd()).digest('hex').slice(0, 16),
  isProd: env.NODE_ENV === 'production',
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
  razorpay: { keyId: env.RAZORPAY_KEY_ID || '', keySecret: env.RAZORPAY_KEY_SECRET || '' },
  brand: {
    name: 'MECGURA',
    product: 'MECGURA WhatsApp',
    email: 'hello@mecgura.com',
    phone: '+91 78377 22567',
    website: 'https://mecgura.tech',
  },
}
