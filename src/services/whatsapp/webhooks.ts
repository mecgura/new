import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { decryptSecret, safeEqual, sha256 } from "@/lib/crypto";
import { getMetaConfig } from "@/providers/meta/config";
import { normalizeEvents, verifySignature, type MetaWebhookPayload, type NormalizedEvent } from "@/providers/meta/webhook";
import { toE164 } from "@/providers/meta/api";
import { incrementUsage } from "@/lib/services/usage";
import { applyStatusUpdate, fromMetaMessage, receiveInbound } from "@/services/inbox/messaging";
import { applyTemplateWebhook } from "@/services/templates/templates";

/**
 * GET verification handshake. Accepts MECGURA's platform verify token or the
 * per-connection token issued to developer-mode connections. Returns the
 * challenge to echo, or null (→ 403).
 */
export async function verifyWebhookSubscription(mode: string | null, token: string | null, challenge: string | null): Promise<string | null> {
  if (mode !== "subscribe" || !token || !challenge || challenge.length > 200 || !/^[\w-]+$/.test(challenge)) return null;
  const platform = getMetaConfig().webhookVerifyToken;
  if (platform && safeEqual(token, platform)) return challenge;
  const cfg = await db.webhookConfiguration.findFirst({ where: { verifyTokenHash: sha256(token), status: { not: "disabled" } } });
  if (!cfg) return null;
  await db.webhookConfiguration.update({
    where: { id: cfg.id },
    data: { lastVerifiedAt: new Date(), status: cfg.status === "pending" ? "verified" : cfg.status },
  });
  await audit({ action: "whatsapp.webhook_verified", organizationId: cfg.organizationId, targetType: "webhook", targetId: cfg.id });
  return challenge;
}

export type IngestResult = { ok: true; received: number; duplicates: number } | { ok: false; status: 400 | 401 | 413; error: string };

export const MAX_WEBHOOK_BYTES = 1024 * 1024;

/**
 * POST ingestion: signature first, then idempotent storage + foundation-level
 * processing (counters, quality). Full inbox handling is a later phase.
 */
export async function ingestWebhook(raw: Buffer, signatureHeader: string | null): Promise<IngestResult> {
  if (raw.length > MAX_WEBHOOK_BYTES) return { ok: false, status: 413, error: "Payload too large" };
  let payload: MetaWebhookPayload;
  try {
    payload = JSON.parse(raw.toString("utf8")) as MetaWebhookPayload;
  } catch {
    return { ok: false, status: 400, error: "Invalid JSON" };
  }
  if (payload.object !== "whatsapp_business_account" || !Array.isArray(payload.entry)) {
    return { ok: false, status: 400, error: "Unsupported webhook object" };
  }

  // Candidate secrets: MECGURA's app + app secrets of developer-mode connections for these WABAs.
  // The payload is only used to pick candidates; nothing is trusted until a signature matches.
  const wabaIds = [...new Set(payload.entry.map((e) => String(e.id ?? "")).filter(Boolean))];
  const wabas = await db.whatsAppBusinessAccount.findMany({
    where: { wabaId: { in: wabaIds }, isDemo: false },
    include: { connections: { where: { status: "active", encryptedAppSecret: { not: "" } }, select: { encryptedAppSecret: true } } },
  });
  const secrets = [getMetaConfig().appSecret];
  for (const w of wabas) for (const c of w.connections) {
    try {
      secrets.push(decryptSecret(c.encryptedAppSecret));
    } catch {
      /* unreadable secret → skip */
    }
  }
  if (!verifySignature(raw, signatureHeader, secrets)) return { ok: false, status: 401, error: "Invalid signature" };

  const orgByWaba = new Map(wabas.map((w) => [w.wabaId, { orgId: w.organizationId, wabaRecordId: w.id }]));
  const events = normalizeEvents(payload);
  let duplicates = 0;
  for (const [i, ev] of events.entries()) {
    const owner = orgByWaba.get(ev.wabaId);
    const dedupeKey =
      ev.kind === "message" ? `meta:msg:${ev.id}` : ev.kind === "status" ? `meta:status:${ev.id}:${ev.status}` : `meta:${ev.kind}:${sha256(raw.toString("utf8"))}:${i}`;
    let stored;
    try {
      stored = await db.webhookEvent.create({
        data: {
          organizationId: owner?.orgId ?? null,
          wabaId: ev.wabaId,
          field: FIELD_OF[ev.kind] ?? (ev.kind === "other" ? ev.field : ev.kind),
          eventType: ev.kind === "status" ? `status.${ev.status}` : ev.kind,
          dedupeKey,
          payload: JSON.stringify(ev),
          status: owner ? "received" : "ignored",
          error: owner ? "" : "Unknown WABA",
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        duplicates++;
        continue;
      }
      throw e;
    }
    if (!owner) continue;
    try {
      const status = await processEvent(owner.orgId, owner.wabaRecordId, ev);
      await db.webhookEvent.update({ where: { id: stored.id }, data: { status, processedAt: new Date() } });
    } catch (e) {
      await db.webhookEvent.update({ where: { id: stored.id }, data: { status: "failed", error: String(e).slice(0, 500) } });
    }
  }
  if (wabas.length) {
    await db.webhookConfiguration.updateMany({ where: { wabaRecordId: { in: wabas.map((w) => w.id) }, status: { not: "disabled" } }, data: { lastEventAt: new Date() } });
  }
  return { ok: true, received: events.length, duplicates };
}

const FIELD_OF: Partial<Record<NormalizedEvent["kind"], string>> = {
  message: "messages",
  status: "messages",
  quality: "phone_number_quality_update",
  template_status: "message_template_status_update",
  template_quality: "message_template_quality_update",
  template_category: "template_category_update",
  account: "account_update",
};

async function processEvent(organizationId: string, wabaRecordId: string, ev: NormalizedEvent): Promise<"processed" | "ignored"> {
  switch (ev.kind) {
    case "message": {
      const r = await db.phoneNumber.updateMany({ where: { organizationId, phoneNumberId: ev.phoneNumberId }, data: { messagesReceived: { increment: 1 } } });
      const account = await db.whatsAppAccount.findFirst({ where: { organizationId, phoneNumberId: ev.phoneNumberId, status: "connected" }, select: { id: true } });
      if (!r.count || !account) return "ignored";
      await receiveInbound(organizationId, account.id, { ...fromMetaMessage(ev.raw, ev.from, ev.profileName), isDemo: false });
      return "processed";
    }
    case "status": {
      const at = ev.timestamp ? new Date(Number(ev.timestamp) * 1000) : new Date();
      const known = await applyStatusUpdate(organizationId, ev.id, ev.status, ev.error, at);
      if (ev.status !== "sent") return known ? "processed" : "ignored";
      const r = await db.phoneNumber.updateMany({ where: { organizationId, phoneNumberId: ev.phoneNumberId }, data: { messagesSent: { increment: 1 } } });
      if (!r.count) return "ignored";
      await incrementUsage(organizationId, "messages_sent");
      return "processed";
    }
    case "quality": {
      const e164 = toE164(ev.displayPhoneNumber);
      // FLAGGED → quality dropped to RED territory, UNFLAGGED → recovered; DOWNGRADE/UPGRADE change the tier.
      const rating = ev.event === "FLAGGED" ? { qualityRating: "RED" } : ev.event === "UNFLAGGED" ? { qualityRating: "GREEN" } : {};
      const r = await db.phoneNumber.updateMany({
        where: { organizationId, wabaRecordId, e164 },
        data: { lastQualityEvent: ev.event, ...rating, ...(ev.currentLimit ? { messagingLimitTier: ev.currentLimit } : {}) },
      });
      if (r.count) await audit({ action: "whatsapp.quality_changed", organizationId, targetType: "phone_number", targetId: e164, metadata: { event: ev.event, limit: ev.currentLimit } });
      return r.count ? "processed" : "ignored";
    }
    case "template_status":
      return (await applyTemplateWebhook(organizationId, wabaRecordId, { type: "status", metaTemplateId: ev.metaTemplateId, name: ev.name, language: ev.language, event: ev.event, reason: ev.reason })) ? "processed" : "ignored";
    case "template_quality":
      return (await applyTemplateWebhook(organizationId, wabaRecordId, { type: "quality", metaTemplateId: ev.metaTemplateId, score: ev.score })) ? "processed" : "ignored";
    case "template_category":
      return (await applyTemplateWebhook(organizationId, wabaRecordId, { type: "category", metaTemplateId: ev.metaTemplateId, category: ev.category })) ? "processed" : "ignored";
    case "account": {
      await db.whatsAppBusinessAccount.update({ where: { id: wabaRecordId }, data: { lastAccountEvent: ev.event, accountStatus: ev.detail || ev.event, lastAccountEventAt: new Date() } });
      await audit({ action: "whatsapp.account_event", organizationId, targetType: "waba", targetId: wabaRecordId, metadata: { event: ev.event, detail: ev.detail } });
      return "processed";
    }
    default:
      return "ignored";
  }
}
