import nodemailer, { type Transporter } from 'nodemailer'
import { get, insert, now } from '../db.ts'
import { config } from '../config.ts'
import { decrypt } from '../lib/security.ts'
import { bad } from '../lib/http.ts'

type Smtp = { host: string; port: number; user: string; pass: string; from: string }
const cache = new Map<string, Transporter>()

function transport(s: Smtp) {
  const key = `${s.host}|${s.port}|${s.user}|${s.pass}`
  if (!cache.has(key)) {
    // SMTP_HOST=json captures mail without sending (tests / local dev).
    cache.set(key, s.host === 'json' ? nodemailer.createTransport({ jsonTransport: true })
      : nodemailer.createTransport({ host: s.host, port: s.port, secure: s.port === 465, auth: { user: s.user, pass: s.pass } }))
  }
  return cache.get(key)!
}

export const platformEmailReady = () => !!config.smtp.host && (config.smtp.host === 'json' || !!config.smtp.user)

export function workspaceSmtp(workspaceId: number): Smtp | null {
  const i = get<{ config: Record<string, string> }>("SELECT config FROM integrations WHERE workspace_id = ? AND provider = 'smtp' AND enabled = 1", workspaceId)
  if (!i?.config.host) return null
  const c = i.config
  return { host: c.host, port: Number(c.port || 465), user: c.user, pass: decrypt(c.pass), from: c.from_email ? `${c.from_name || ''} <${c.from_email}>`.trim() : c.user }
}

type Mail = { to: string; subject: string; html: string; text?: string; kind: string; workspaceId?: number | null; replyTo?: string; headers?: Record<string, string> }

/** Sends through MECGURA's mailbox (platform) or the client's own mailbox (workspace). Every attempt is logged. */
export async function sendMail(scope: 'platform' | 'workspace', m: Mail) {
  const smtp = scope === 'platform' ? (platformEmailReady() ? config.smtp : null) : workspaceSmtp(m.workspaceId!)
  if (!smtp) throw bad(scope === 'platform' ? 'MECGURA email (SMTP) is not configured on the server' : 'Connect your email account in Settings → Integrations → Email first')
  try {
    await transport(smtp).sendMail({ from: smtp.from, to: m.to, subject: m.subject, html: m.html, text: m.text ?? htmlToText(m.html), replyTo: m.replyTo, headers: m.headers })
    insert('email_log', { workspace_id: m.workspaceId ?? null, to_email: m.to, subject: m.subject, kind: m.kind, status: 'sent', created_at: now() })
  } catch (e) {
    insert('email_log', { workspace_id: m.workspaceId ?? null, to_email: m.to, subject: m.subject, kind: m.kind, status: 'failed', error: (e as Error).message.slice(0, 300), created_at: now() })
    throw bad(`Email failed: ${(e as Error).message}`)
  }
}

/** Fire-and-forget platform email: never breaks the request that triggered it. */
export function notifyByEmail(m: Mail) {
  if (!platformEmailReady()) return
  sendMail('platform', m).catch((e) => console.warn('email failed:', (e as Error).message))
}

export function htmlToText(html: string) {
  return html.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|h\d|tr|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\n{3,}/g, '\n\n').trim()
}

export const escapeHtml = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

/** {{var}} substitution for HTML — values are escaped so contact data can't inject markup. */
export function renderHtml(html: string, ctx: Record<string, unknown>) {
  return html.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key: string) => {
    const v = key.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), ctx)
    return key.endsWith('_url') ? String(v ?? '') : escapeHtml(v)
  })
}

// ---- MECGURA branded layout for platform emails ----
export function brandedEmail(o: { title: string; intro: string; rows?: [string, string][]; button?: { label: string; url: string }; outro?: string }) {
  const rows = (o.rows ?? []).map(([k, v]) => `<tr><td style="padding:8px 0;color:#8a9aa3;font-size:14px">${escapeHtml(k)}</td><td style="padding:8px 0;color:#0b1418;font-size:14px;font-weight:600;text-align:right">${escapeHtml(v)}</td></tr>`).join('')
  return `<!doctype html><html><body style="margin:0;background:#f3f6f5;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f6f5;padding:32px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden">
<tr><td style="background:#05080a;padding:22px 28px"><span style="color:#ffffff;font-size:20px;font-weight:800;letter-spacing:3px">MECGURA</span>
<span style="margin-left:8px;background:#10b98122;color:#34d399;font-size:11px;font-weight:700;padding:3px 8px;border-radius:6px">WHATSAPP</span></td></tr>
<tr><td style="padding:28px">
<h1 style="margin:0 0 12px;font-size:22px;color:#0b1418">${escapeHtml(o.title)}</h1>
<p style="margin:0 0 18px;font-size:15px;line-height:1.6;color:#33413f">${o.intro}</p>
${rows ? `<table role="presentation" width="100%" style="border-top:1px solid #e5ecea;border-bottom:1px solid #e5ecea;margin:6px 0 20px">${rows}</table>` : ''}
${o.button ? `<a href="${escapeHtml(o.button.url)}" style="display:inline-block;background:#10b981;color:#05080a;text-decoration:none;font-weight:700;padding:13px 24px;border-radius:10px;font-size:15px">${escapeHtml(o.button.label)}</a>` : ''}
${o.outro ? `<p style="margin:22px 0 0;font-size:13px;line-height:1.6;color:#6b7b83">${o.outro}</p>` : ''}
</td></tr>
<tr><td style="padding:18px 28px;background:#f8faf9;font-size:12px;color:#8a9aa3;line-height:1.6">© MECGURA — All Rights Reserved<br>
Email: ${config.brand.email} · Phone: ${config.brand.phone} · Website: mecgura.tech</td></tr>
</table></td></tr></table></body></html>`
}
