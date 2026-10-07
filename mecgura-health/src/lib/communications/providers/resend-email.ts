import { callProvider } from "./http";
import { verifySvix } from "./verify";
import type { EmailProvider, ParsedWebhook, SendResult, StatusUpdate, WebhookRequest } from "./types";

/**
 * Email through Resend. Env: EMAIL_PROVIDER=resend, EMAIL_API_KEY, EMAIL_FROM (an address on a domain verified at the provider),
 * optional EMAIL_REPLY_TO (platform default), EMAIL_API_URL, EMAIL_WEBHOOK_SECRET (the `whsec_…` signing secret of the webhook).
 */
const base = () => (process.env.EMAIL_API_URL || "https://api.resend.com").replace(/\/$/, "");
const TYPE: Record<string, StatusUpdate["status"]> = { "email.sent": "SENT", "email.delivered": "DELIVERED", "email.bounced": "FAILED", "email.failed": "FAILED", "email.complained": "FAILED" };

export const resendEmail: EmailProvider = {
  name: "resend", channel: "EMAIL",
  isConfigured: () => process.env.EMAIL_PROVIDER === "resend" && !!process.env.EMAIL_API_KEY && !!process.env.EMAIL_FROM,
  webhookReady: () => !!process.env.EMAIL_WEBHOOK_SECRET,
  async sendEmail({ to, fromName, replyTo, subject, html, text }): Promise<SendResult> {
    const safeName = fromName.replace(/[<>"\r\n]/g, "").slice(0, 80) || "Clinic";
    const r = await callProvider(`${base()}/emails`, { method: "POST", headers: { authorization: `Bearer ${process.env.EMAIL_API_KEY}`, "content-type": "application/json" }, body: JSON.stringify({ from: `${safeName} <${process.env.EMAIL_FROM}>`, to: [to], subject, html, text, ...((replyTo || process.env.EMAIL_REPLY_TO) ? { reply_to: replyTo || process.env.EMAIL_REPLY_TO } : {}) }) });
    if (!r.ok) return r.result;
    const id = (r.json as { id?: string } | null)?.id;
    return id ? { ok: true, providerMessageId: id } : { ok: false, retryable: false, code: "NO_MESSAGE_ID", message: "The provider answered without a message id." };
  },
  async getMessageStatus(id) {
    const r = await callProvider(`${base()}/emails/${encodeURIComponent(id)}`, { method: "GET", headers: { authorization: `Bearer ${process.env.EMAIL_API_KEY}` } });
    if (!r.ok) return null; const ev = (r.json as { last_event?: string } | null)?.last_event; const status = ev ? TYPE[`email.${ev}`] : undefined;
    return status ? { providerMessageId: id, status, eventKey: `resend-poll:${id}:${ev}`, at: null } : null;
  },
  parseWebhook(req: WebhookRequest): ParsedWebhook {
    const v = verifySvix(req.rawBody, req.headers, process.env.EMAIL_WEBHOOK_SECRET); if (!v.ok) return { verified: false, reason: v.reason, updates: [] };
    let j: { type?: string; created_at?: string; data?: { email_id?: string } }; try { j = JSON.parse(req.rawBody); } catch { return { verified: true, reason: "bad_json", updates: [] }; }
    const status = j.type ? TYPE[j.type] : undefined; const id = j.data?.email_id;
    if (!status || !id) return { verified: true, updates: [] };
    return { verified: true, updates: [{ providerMessageId: id, status, eventKey: `resend:${req.headers.get("svix-id")}`, at: j.created_at ? new Date(j.created_at) : null, code: j.type === "email.bounced" ? "BOUNCED" : j.type === "email.complained" ? "COMPLAINED" : undefined }] };
  },
};
