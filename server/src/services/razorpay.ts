import { hmacHex, safeEqual } from '../lib/security.ts'

export type RzpKeys = { keyId: string; keySecret: string }

async function rzp<T>(keys: RzpKeys, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`https://api.razorpay.com/v1/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Basic ${Buffer.from(`${keys.keyId}:${keys.keySecret}`).toString('base64')}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = (await res.json()) as T & { error?: { description?: string } }
  if (!res.ok) throw new Error(json.error?.description || `Razorpay error ${res.status}`)
  return json
}

export const createOrder = (keys: RzpKeys, amountRupees: number, receipt: string, notes: Record<string, string>) =>
  rzp<{ id: string; amount: number; currency: string }>(keys, 'orders', { amount: Math.round(amountRupees * 100), currency: 'INR', receipt, notes })

export const createPaymentLink = (keys: RzpKeys, p: { amount: number; description: string; name?: string; phone?: string; email?: string; reference: string; callbackUrl?: string }) =>
  rzp<{ id: string; short_url: string; status: string }>(keys, 'payment_links', {
    amount: Math.round(p.amount * 100), currency: 'INR', description: p.description.slice(0, 2048), reference_id: p.reference,
    customer: { name: p.name, contact: p.phone ? `+${p.phone}` : undefined, email: p.email || undefined },
    notify: { sms: false, email: false }, reminder_enable: true, ...(p.callbackUrl ? { callback_url: p.callbackUrl, callback_method: 'get' } : {}),
  })

export const verifyPaymentSignature = (secret: string, orderId: string, paymentId: string, signature: string) =>
  safeEqual(hmacHex(secret, `${orderId}|${paymentId}`), signature)

export const verifyWebhook = (secret: string, raw: Buffer, signature: string) => safeEqual(hmacHex(secret, raw), signature || '')
