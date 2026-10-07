import { callProvider } from "./http";
import { verifyMeta } from "./verify";
import type { ParsedWebhook, SendResult, StatusUpdate, WebhookRequest, WhatsAppProvider } from "./types";

/**
 * WhatsApp Business Cloud API (Meta). Env: WHATSAPP_PROVIDER=meta, WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID,
 * optional WHATSAPP_API_URL (default Graph API), WHATSAPP_APP_SECRET (webhook signature), WHATSAPP_VERIFY_TOKEN (webhook handshake).
 */
const base = () => (process.env.WHATSAPP_API_URL || "https://graph.facebook.com/v21.0").replace(/\/$/, "");
const digits = (to: string) => to.replace(/\D/g, "");
const STATUS: Record<string, StatusUpdate["status"]> = { sent: "SENT", delivered: "DELIVERED", read: "READ", failed: "FAILED" };

async function post(body: unknown): Promise<SendResult> {
  const r = await callProvider(`${base()}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, { method: "POST", headers: { authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`, "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) return r.result;
  const id = (r.json as { messages?: { id?: string }[] } | null)?.messages?.[0]?.id;
  return id ? { ok: true, providerMessageId: id } : { ok: false, retryable: false, code: "NO_MESSAGE_ID", message: "The provider answered without a message id." };
}

export const metaWhatsApp: WhatsAppProvider = {
  name: "meta", channel: "WHATSAPP",
  isConfigured: () => process.env.WHATSAPP_PROVIDER === "meta" && !!process.env.WHATSAPP_ACCESS_TOKEN && !!process.env.WHATSAPP_PHONE_NUMBER_ID,
  webhookReady: () => !!process.env.WHATSAPP_APP_SECRET,
  sendTemplate: ({ to, templateName, language, params }) => post({ messaging_product: "whatsapp", to: digits(to), type: "template", template: { name: templateName, language: { code: language }, ...(params.length ? { components: [{ type: "body", parameters: params.map((text) => ({ type: "text", text })) }] } : {}) } }),
  sendMessage: ({ to, text }) => post({ messaging_product: "whatsapp", to: digits(to), type: "text", text: { body: text, preview_url: false } }),
  /** The Cloud API has no "status by id" call — status only arrives by webhook. */
  getMessageStatus: async () => null,
  parseWebhook(req: WebhookRequest): ParsedWebhook {
    if (!verifyMeta(req.rawBody, req.headers.get("x-hub-signature-256"), process.env.WHATSAPP_APP_SECRET)) return { verified: false, reason: "bad_signature", updates: [] };
    let json: { entry?: { changes?: { value?: { statuses?: { id?: string; status?: string; timestamp?: string; errors?: { code?: number }[] }[] } }[] }[] };
    try { json = JSON.parse(req.rawBody); } catch { return { verified: true, reason: "bad_json", updates: [] }; }
    const updates: StatusUpdate[] = [];
    for (const e of json.entry ?? []) for (const c of e.changes ?? []) for (const s of c.value?.statuses ?? []) {
      const status = s.status ? STATUS[s.status] : undefined; if (!s.id || !status) continue;
      updates.push({ providerMessageId: s.id, status, eventKey: `meta:${s.id}:${s.status}:${s.timestamp ?? ""}`, at: s.timestamp ? new Date(Number(s.timestamp) * 1000) : null, code: s.errors?.[0]?.code ? `META_${s.errors[0].code}` : undefined });
    }
    return { verified: true, updates };
  },
};
