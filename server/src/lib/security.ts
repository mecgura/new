import crypto from 'node:crypto'
import { config } from '../config.ts'

const key = crypto.createHash('sha256').update(config.appSecret).digest()

export function hashPassword(pw: string) {
  const salt = crypto.randomBytes(16).toString('hex')
  const hash = crypto.scryptSync(pw, salt, 64).toString('hex')
  return `${salt}:${hash}`
}
export function verifyPassword(pw: string, stored: string) {
  const [salt, hash] = stored.split(':')
  if (!salt || !hash) return false
  const test = crypto.scryptSync(pw, salt, 64)
  return crypto.timingSafeEqual(test, Buffer.from(hash, 'hex'))
}

const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64url')

export function signJwt(payload: Record<string, unknown>, ttlSeconds = 60 * 60 * 24 * 14) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = b64url(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds }))
  const sig = crypto.createHmac('sha256', key).update(`${header}.${body}`).digest('base64url')
  return `${header}.${body}.${sig}`
}
export function verifyJwt<T = Record<string, unknown>>(token: string): T | null {
  const [h, b, s] = token.split('.')
  if (!h || !b || !s) return null
  const expected = crypto.createHmac('sha256', key).update(`${h}.${b}`).digest('base64url')
  if (expected.length !== s.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(s))) return null
  const payload = JSON.parse(Buffer.from(b, 'base64url').toString())
  if (payload.exp && payload.exp < Date.now() / 1000) return null
  return payload as T
}

// AES-256-GCM for secrets at rest (WhatsApp access tokens, integration keys).
export function encrypt(plain: string) {
  if (!plain) return ''
  const iv = crypto.randomBytes(12)
  const c = crypto.createCipheriv('aes-256-gcm', key, iv)
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()])
  return `enc:${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${enc.toString('base64')}`
}
export function decrypt(value: string | null | undefined) {
  if (!value) return ''
  if (!value.startsWith('enc:')) return value
  const [, iv, tag, data] = value.split(':')
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'))
  d.setAuthTag(Buffer.from(tag, 'base64'))
  return Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8')
}

export const randomToken = (bytes = 24) => crypto.randomBytes(bytes).toString('base64url')
export const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex')
export const hmacHex = (secret: string, body: string | Buffer) => crypto.createHmac('sha256', secret).update(body).digest('hex')
export function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a), bb = Buffer.from(b)
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb)
}
