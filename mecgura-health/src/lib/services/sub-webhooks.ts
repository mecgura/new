import "server-only";
import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { providerByKey } from "@/lib/subscriptions/providers/registry";
import { ProviderError, type ParsedWebhook } from "@/lib/subscriptions/providers/types";
import { applyPayment, recordFailedPayment, syncProviderRefund } from "./sub-billing";
import { methodOf } from "./sub-pay";
import { uniqueViolation } from "./shared";

export const MAX_WEBHOOK_BYTES = 256 * 1024;
const STALE_CLAIM_MS = 5 * 60_000;
export interface WebhookResult { status: number; body: { ok: boolean; result?: string; reason?: string } }

/**
 * Payment-provider webhook. In order: size cap → provider known and secret configured → SIGNATURE verified over the raw body → event claimed once by
 * (provider, eventId) → the payment is re-checked with the provider's API (a webhook alone never activates a subscription) → applied idempotently.
 * Replays and duplicates are answered 200 and change nothing; a transient failure answers 500 so the provider retries the same event.
 */
export async function handleSubscriptionWebhook(providerKey: string, rawBody: string, headers: Headers): Promise<WebhookResult> {
  const provider = providerByKey(providerKey); if (!provider || provider.key === "manual") return { status: 404, body: { ok: false, reason: "unknown_provider" } };
  if (rawBody.length > MAX_WEBHOOK_BYTES) return { status: 413, body: { ok: false, reason: "too_large" } };
  if (!provider.webhookReady()) return { status: 503, body: { ok: false, reason: "not_configured" } };
  const v = provider.verifyWebhook(rawBody, headers); if (!v.ok) { logger.warn("subscription webhook rejected", { provider: providerKey, reason: v.reason }); return { status: 401, body: { ok: false, reason: "invalid_signature" } }; }
  const ev = provider.parseWebhook(rawBody, headers); if (!ev) return { status: 400, body: { ok: false, reason: "unreadable" } };

  const hash = createHash("sha256").update(rawBody).digest("hex"); let row;
  try { row = await db.subscriptionWebhookEvent.create({ data: { provider: providerKey, eventId: ev.eventId, eventType: ev.rawType.slice(0, 80), payloadHash: hash } }); }
  catch (e) {
    if (!uniqueViolation(e)) throw e;
    const old = await db.subscriptionWebhookEvent.findUnique({ where: { provider_eventId: { provider: providerKey, eventId: ev.eventId } } });
    if (!old || old.status === "PROCESSED" || old.status === "IGNORED") return { status: 200, body: { ok: true, result: "duplicate" } };
    // FAILED (provider retry) or a crashed claim: take it over exactly once
    const stale = old.status === "FAILED" || Date.now() - old.receivedAt.getTime() > STALE_CLAIM_MS;
    if (!stale) return { status: 200, body: { ok: true, result: "in_progress" } };
    const got = await db.subscriptionWebhookEvent.updateMany({ where: { id: old.id, status: old.status, receivedAt: old.receivedAt }, data: { status: "RECEIVED", receivedAt: new Date(), error: null } });
    if (got.count === 0) return { status: 200, body: { ok: true, result: "in_progress" } };
    row = old;
  }
  try {
    const outcome = await process(provider.key, ev);
    await db.subscriptionWebhookEvent.update({ where: { id: row.id }, data: { status: outcome === "ignored" ? "IGNORED" : "PROCESSED", processedAt: new Date(), error: null } });
    await recordAudit({ action: AUDIT_ACTIONS.SUBSCRIPTION_WEBHOOK_PROCESSED, tenantId: null, entityType: "webhook_event", entityId: row.id, metadata: { provider: providerKey, type: ev.rawType, outcome } });
    return { status: 200, body: { ok: true, result: outcome } };
  } catch (e) {
    const transient = e instanceof ProviderError && e.code === "UNAVAILABLE";
    await db.subscriptionWebhookEvent.update({ where: { id: row.id }, data: { status: "FAILED", error: (e instanceof Error ? e.message : "error").slice(0, 200) } });
    logger.error("subscription webhook failed", { provider: providerKey, type: ev.rawType, error: e });
    return { status: transient ? 503 : 500, body: { ok: false, reason: "processing_failed" } };
  }
}

async function invoiceFor(ev: ParsedWebhook) {
  if (ev.invoiceRef) { const i = await db.saasInvoice.findUnique({ where: { id: ev.invoiceRef } }); if (i) return i; }
  if (ev.providerOrderId) { const p = await db.saasPayment.findFirst({ where: { providerOrderId: ev.providerOrderId } }); if (p) return db.saasInvoice.findUnique({ where: { id: p.invoiceId } }); }
  return null;
}
async function process(providerKey: string, ev: ParsedWebhook): Promise<"applied" | "duplicate" | "ignored" | "recorded"> {
  const provider = providerByKey(providerKey)!;
  if (ev.kind === "payment.success") {
    if (!ev.providerPaymentId) return "ignored";
    const inv = await invoiceFor(ev); if (!inv) return "ignored"; // not ours / unknown reference
    const proof = await provider.verifyPayment(ev.providerPaymentId); // ask the provider — the webhook body alone is not trusted for money
    if (proof.status !== "SUCCEEDED") return "ignored";
    const o = await applyPayment({ invoiceId: inv.id, provider: providerKey, providerPaymentId: ev.providerPaymentId, providerOrderId: proof.providerOrderId ?? ev.providerOrderId, amountMinor: proof.amountMinor, currency: proof.currency, method: methodOf(proof.method), reference: proof.reference, actor: { id: null, source: "WEBHOOK" }, idempotencyKey: `pay:${providerKey}:${ev.providerPaymentId}` });
    return o.duplicate ? "duplicate" : "applied";
  }
  if (ev.kind === "payment.failed") {
    const inv = await invoiceFor(ev); if (!inv) return "ignored";
    const r = await recordFailedPayment({ invoiceId: inv.id, provider: providerKey, providerPaymentId: ev.providerPaymentId, providerOrderId: ev.providerOrderId, amountMinor: ev.amountMinor ?? inv.totalMinor - inv.paidMinor, reason: ev.failureReason ?? "The payment was declined", idempotencyKey: `payfail:${providerKey}:${ev.providerPaymentId ?? ev.eventId}`, method: ev.method });
    return r.recorded ? "recorded" : "duplicate";
  }
  if (ev.kind === "refund.processed" && ev.providerPaymentId && ev.refundId && ev.amountMinor) return (await syncProviderRefund({ provider: providerKey, providerPaymentId: ev.providerPaymentId, providerRefundId: ev.refundId, amountMinor: ev.amountMinor })) ? "applied" : "duplicate";
  return "ignored";
}
