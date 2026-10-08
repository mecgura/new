import "server-only";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { rateLimit } from "@/lib/security/rate-limit";
import { isChannel, type Channel } from "./catalog";
import { providerFor } from "./providers/registry";
import { safeEqual } from "./providers/verify";
import type { WebhookRequest } from "./providers/types";
import { applyProviderStatus } from "./worker";

export const CHANNEL_OF_PATH: Record<string, Channel> = { whatsapp: "WHATSAPP", sms: "SMS", email: "EMAIL" };
const MAX_BODY = 1_000_000;

/**
 * Inbound provider callbacks. NOTHING changes unless (1) the channel's provider is selected, (2) its signing secret is configured and
 * (3) the signature on the RAW body verifies. Then every status is applied idempotently (replayed callbacks are no-ops) and monotonically.
 */
export async function handleWebhook(path: string, req: WebhookRequest, ip: string | null): Promise<{ status: number; body: Record<string, unknown> | string }> {
  const channel = CHANNEL_OF_PATH[path]; if (!channel || !isChannel(channel)) return { status: 404, body: { ok: false } };
  const lim = await rateLimit(`webhook:${channel}:${ip ?? "?"}`, { limit: 600, windowMs: 60_000 }); if (!lim.allowed) return { status: 429, body: { ok: false } };
  const provider = providerFor(channel);
  if (!provider || !provider.webhookReady()) return { status: 503, body: { ok: false, error: "webhooks_not_configured" } }; // never "trust by default"
  if (req.rawBody.length > MAX_BODY) return { status: 413, body: { ok: false } };
  const parsed = provider.parseWebhook(req);
  if (!parsed.verified) {
    await recordAudit({ action: AUDIT_ACTIONS.COMM_WEBHOOK_REJECTED, tenantId: null, entityType: "communication_webhook", metadata: { channel, reason: parsed.reason ?? "unverified" } });
    logger.warn("webhook rejected", { channel, reason: parsed.reason });
    return { status: 401, body: { ok: false } };
  }
  const tally = { applied: 0, duplicate: 0, ignored: 0, unknown: 0 };
  for (const u of parsed.updates.slice(0, 200)) {
    try { const o = await applyProviderStatus(provider.name, u); if (o === "applied") tally.applied++; else if (o === "duplicate") tally.duplicate++; else if (o === "unknown_message") tally.unknown++; else tally.ignored++; }
    catch (err) { logger.error("webhook update failed", { error: err }); return { status: 500, body: { ok: false } }; } // provider will retry
  }
  return { status: 200, body: { ok: true, ...tally } };
}

/** WhatsApp (Meta) subscription handshake: GET with hub.mode / hub.verify_token / hub.challenge. */
export function metaHandshake(q: URLSearchParams): { status: number; body: string } {
  const token = process.env.WHATSAPP_VERIFY_TOKEN;
  if (token && q.get("hub.mode") === "subscribe" && safeEqual(q.get("hub.verify_token") ?? "", token)) return { status: 200, body: q.get("hub.challenge") ?? "" };
  return { status: 403, body: "forbidden" };
}
