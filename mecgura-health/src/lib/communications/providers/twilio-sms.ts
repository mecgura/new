import { callProvider } from "./http";
import { verifyTwilio } from "./verify";
import type { ParsedWebhook, SendResult, SmsProvider, StatusUpdate, WebhookRequest } from "./types";

/**
 * SMS through Twilio. Env: SMS_PROVIDER=twilio, SMS_ACCOUNT_SID, SMS_API_KEY (the auth token), SMS_SENDER_ID (a Twilio number / alphanumeric
 * sender / "MG…" messaging-service sid), optional SMS_API_URL. Status callbacks go to APP_URL/api/webhooks/sms. Indian operators additionally
 * need a registered sender + DLT template: that registration is the clinic's/operator's responsibility and is not simulated here.
 */
const base = () => (process.env.SMS_API_URL || "https://api.twilio.com").replace(/\/$/, "");
const auth = () => `Basic ${Buffer.from(`${process.env.SMS_ACCOUNT_SID}:${process.env.SMS_API_KEY}`).toString("base64")}`;
const STATUS: Record<string, StatusUpdate["status"]> = { sent: "SENT", delivered: "DELIVERED", undelivered: "FAILED", failed: "FAILED", read: "READ" };

export const twilioSms: SmsProvider = {
  name: "twilio", channel: "SMS",
  isConfigured: () => process.env.SMS_PROVIDER === "twilio" && !!process.env.SMS_ACCOUNT_SID && !!process.env.SMS_API_KEY && !!process.env.SMS_SENDER_ID,
  webhookReady: () => !!process.env.SMS_API_KEY,
  async sendSMS({ to, text, senderId }): Promise<SendResult> {
    const from = senderId || process.env.SMS_SENDER_ID || "";
    const form = new URLSearchParams({ To: to, Body: text, ...(from.startsWith("MG") ? { MessagingServiceSid: from } : { From: from }) });
    const cb = process.env.APP_URL ? `${process.env.APP_URL.replace(/\/$/, "")}/api/webhooks/sms` : ""; if (cb.startsWith("https://")) form.set("StatusCallback", cb);
    const r = await callProvider(`${base()}/2010-04-01/Accounts/${process.env.SMS_ACCOUNT_SID}/Messages.json`, { method: "POST", headers: { authorization: auth(), "content-type": "application/x-www-form-urlencoded" }, body: form.toString() });
    if (!r.ok) return r.result;
    const sid = (r.json as { sid?: string } | null)?.sid;
    return sid ? { ok: true, providerMessageId: sid } : { ok: false, retryable: false, code: "NO_MESSAGE_ID", message: "The provider answered without a message id." };
  },
  async getMessageStatus(id) {
    const r = await callProvider(`${base()}/2010-04-01/Accounts/${process.env.SMS_ACCOUNT_SID}/Messages/${encodeURIComponent(id)}.json`, { method: "GET", headers: { authorization: auth() } });
    if (!r.ok) return null; const j = r.json as { status?: string; error_code?: number | null } | null; const status = j?.status ? STATUS[j.status] : undefined;
    return status ? { providerMessageId: id, status, eventKey: `twilio-poll:${id}:${j?.status}`, at: null, code: j?.error_code ? `TWILIO_${j.error_code}` : undefined } : null;
  },
  parseWebhook(req: WebhookRequest): ParsedWebhook {
    const params: Record<string, string> = {}; for (const [k, v] of new URLSearchParams(req.rawBody)) params[k] = v;
    if (!verifyTwilio(req.url, params, req.headers.get("x-twilio-signature"), process.env.SMS_API_KEY)) return { verified: false, reason: "bad_signature", updates: [] };
    const status = STATUS[params.MessageStatus ?? ""]; if (!params.MessageSid || !status) return { verified: true, updates: [] };
    return { verified: true, updates: [{ providerMessageId: params.MessageSid, status, eventKey: `twilio:${params.MessageSid}:${params.MessageStatus}`, at: null, code: params.ErrorCode ? `TWILIO_${params.ErrorCode}` : undefined }] };
  },
};
