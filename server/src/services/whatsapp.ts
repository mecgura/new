import crypto from 'node:crypto'
import { config } from '../config.ts'
import { decrypt } from '../lib/security.ts'

// Outbound message shapes supported across inbox, bots, flows, campaigns and the public API.
export type OutMessage =
  | { type: 'text'; text: string; preview_url?: boolean }
  | { type: 'image' | 'video' | 'document' | 'audio'; link: string; caption?: string; filename?: string }
  | { type: 'template'; name: string; language: string; components?: unknown[]; preview?: string }
  | { type: 'buttons'; text: string; buttons: { id: string; title: string }[]; header?: string; footer?: string }
  | { type: 'list'; text: string; button: string; sections: { title: string; rows: { id: string; title: string; description?: string }[] }[]; header?: string; footer?: string }
  | { type: 'cta_url'; text: string; display_text: string; url: string; header?: string; footer?: string }
  | { type: 'product'; catalog_id: string; product_retailer_id: string; text?: string }
  | { type: 'location'; latitude: number; longitude: number; name?: string; address?: string }

export type WaNumber = {
  id: number; workspace_id: number; phone_number_id: string; waba_id: string | null; access_token: string | null
  display_phone: string | null; verified_name: string | null; is_demo: number; label: string | null
}

export class WhatsAppError extends Error {
  code?: number
  constructor(message: string, code?: number) { super(message); this.code = code }
}

const graph = (path: string) => `https://graph.facebook.com/${config.meta.graphVersion}/${path.replace(/^\//, '')}`

async function call<T = Record<string, unknown>>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(graph(path), {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.body && !(init.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
  })
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) {
    const e = (json.error ?? {}) as { message?: string; code?: number; error_user_msg?: string; error_data?: { details?: string } }
    throw new WhatsAppError(e.error_user_msg || e.error_data?.details || e.message || `WhatsApp API error ${res.status}`, e.code)
  }
  return json as T
}

export function toGraphPayload(to: string, m: OutMessage): Record<string, unknown> {
  const base = { messaging_product: 'whatsapp', recipient_type: 'individual', to }
  const hdr = (h?: string) => (h ? { header: { type: 'text', text: h.slice(0, 60) } } : {})
  const ftr = (f?: string) => (f ? { footer: { text: f.slice(0, 60) } } : {})
  switch (m.type) {
    case 'text': return { ...base, type: 'text', text: { body: m.text, preview_url: m.preview_url ?? true } }
    case 'image': case 'video': case 'audio': case 'document':
      return { ...base, type: m.type, [m.type]: { link: m.link, ...(m.caption && m.type !== 'audio' ? { caption: m.caption } : {}), ...(m.filename && m.type === 'document' ? { filename: m.filename } : {}) } }
    case 'template': return { ...base, type: 'template', template: { name: m.name, language: { code: m.language }, components: m.components ?? [] } }
    case 'buttons': return { ...base, type: 'interactive', interactive: { type: 'button', ...hdr(m.header), body: { text: m.text }, ...ftr(m.footer),
      action: { buttons: m.buttons.slice(0, 3).map((b) => ({ type: 'reply', reply: { id: b.id.slice(0, 256), title: b.title.slice(0, 20) } })) } } }
    case 'list': return { ...base, type: 'interactive', interactive: { type: 'list', ...hdr(m.header), body: { text: m.text }, ...ftr(m.footer),
      action: { button: m.button.slice(0, 20), sections: m.sections.map((s) => ({ title: s.title.slice(0, 24), rows: s.rows.slice(0, 10).map((r) => ({ id: r.id, title: r.title.slice(0, 24), ...(r.description ? { description: r.description.slice(0, 72) } : {}) })) })) } } }
    case 'cta_url': return { ...base, type: 'interactive', interactive: { type: 'cta_url', ...hdr(m.header), body: { text: m.text }, ...ftr(m.footer),
      action: { name: 'cta_url', parameters: { display_text: m.display_text.slice(0, 20), url: m.url } } } }
    case 'product': return { ...base, type: 'interactive', interactive: { type: 'product', ...(m.text ? { body: { text: m.text } } : {}),
      action: { catalog_id: m.catalog_id, product_retailer_id: m.product_retailer_id } } }
    case 'location': return { ...base, type: 'location', location: { latitude: m.latitude, longitude: m.longitude, name: m.name, address: m.address } }
  }
}

/** Human-readable preview stored in the inbox for any outbound message. */
export function previewOf(m: OutMessage): string {
  switch (m.type) {
    case 'text': return m.text
    case 'template': return m.preview || `Template: ${m.name}`
    case 'buttons': case 'list': case 'cta_url': return m.text
    case 'product': return m.text || 'Product'
    case 'location': return `📍 ${m.name || 'Location'}`
    default: return m.caption || `[${m.type}]`
  }
}

export async function sendMessage(num: WaNumber, to: string, m: OutMessage): Promise<{ wamid: string }> {
  if (num.is_demo) return { wamid: `wamid.demo.${crypto.randomBytes(10).toString('hex')}` }
  const res = await call<{ messages?: { id: string }[] }>(decrypt(num.access_token), `${num.phone_number_id}/messages`, {
    method: 'POST', body: JSON.stringify(toGraphPayload(to, m)),
  })
  const wamid = res.messages?.[0]?.id
  if (!wamid) throw new WhatsAppError('WhatsApp did not return a message id')
  return { wamid }
}

export async function markRead(num: WaNumber, wamid: string) {
  if (num.is_demo) return
  await call(decrypt(num.access_token), `${num.phone_number_id}/messages`, {
    method: 'POST', body: JSON.stringify({ messaging_product: 'whatsapp', status: 'read', message_id: wamid }),
  }).catch(() => undefined)
}

export async function fetchNumberInfo(token: string, phoneNumberId: string) {
  return call<{ display_phone_number?: string; verified_name?: string; quality_rating?: string; messaging_limit_tier?: string }>(
    token, `${phoneNumberId}?fields=display_phone_number,verified_name,quality_rating,messaging_limit_tier`)
}

export async function listTemplates(num: WaNumber) {
  if (num.is_demo || !num.waba_id) return []
  const out: Record<string, unknown>[] = []
  let path: string | null = `${num.waba_id}/message_templates?limit=100&fields=id,name,language,status,category,components,rejected_reason`
  while (path) {
    const res: { data: Record<string, unknown>[]; paging?: { next?: string } } = await call(decrypt(num.access_token), path)
    out.push(...res.data)
    path = res.paging?.next ? res.paging.next.replace(/^https:\/\/graph\.facebook\.com\/v[\d.]+\//, '') : null
  }
  return out
}

export async function createTemplate(num: WaNumber, t: { name: string; language: string; category: string; components: unknown[] }) {
  if (num.is_demo) return { id: `demo_${Date.now()}`, status: 'APPROVED' }
  if (!num.waba_id) throw new WhatsAppError('This number has no WhatsApp Business Account ID saved')
  return call<{ id: string; status: string }>(decrypt(num.access_token), `${num.waba_id}/message_templates`, { method: 'POST', body: JSON.stringify(t) })
}

export async function deleteTemplate(num: WaNumber, name: string) {
  if (num.is_demo || !num.waba_id) return
  await call(decrypt(num.access_token), `${num.waba_id}/message_templates?name=${encodeURIComponent(name)}`, { method: 'DELETE' })
}

export async function downloadMedia(num: WaNumber, mediaId: string): Promise<{ buffer: Buffer; mime: string }> {
  const token = decrypt(num.access_token)
  const meta = await call<{ url: string; mime_type: string }>(token, mediaId)
  const res = await fetch(meta.url, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) throw new WhatsAppError('Could not download media')
  return { buffer: Buffer.from(await res.arrayBuffer()), mime: meta.mime_type }
}

// ---- Embedded Signup (Meta "Tech Provider" onboarding) ----
export async function exchangeCode(code: string) {
  const url = graph(`oauth/access_token?client_id=${config.meta.appId}&client_secret=${config.meta.appSecret}&code=${encodeURIComponent(code)}`)
  const res = await fetch(url)
  const json = (await res.json()) as { access_token?: string; error?: { message: string } }
  if (!json.access_token) throw new WhatsAppError(json.error?.message || 'Could not complete WhatsApp signup')
  return json.access_token
}
export async function subscribeApp(token: string, wabaId: string) {
  await call(token, `${wabaId}/subscribed_apps`, { method: 'POST' })
}
export async function registerNumber(token: string, phoneNumberId: string, pin: string) {
  await call(token, `${phoneNumberId}/register`, { method: 'POST', body: JSON.stringify({ messaging_product: 'whatsapp', pin }) })
}
export async function businessProfile(num: WaNumber) {
  if (num.is_demo) return { about: 'Demo number', description: '', email: '', websites: [], address: '', vertical: '' }
  const r = await call<{ data: Record<string, unknown>[] }>(decrypt(num.access_token),
    `${num.phone_number_id}/whatsapp_business_profile?fields=about,address,description,email,profile_picture_url,websites,vertical`)
  return r.data?.[0] ?? {}
}
export async function updateBusinessProfile(num: WaNumber, data: Record<string, unknown>) {
  if (num.is_demo) return
  await call(decrypt(num.access_token), `${num.phone_number_id}/whatsapp_business_profile`, {
    method: 'POST', body: JSON.stringify({ messaging_product: 'whatsapp', ...data }),
  })
}
