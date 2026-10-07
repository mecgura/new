import { randomUUID } from "node:crypto";
import { hasFeature } from "@/services/billing/entitlements";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { decryptSecret } from "@/lib/crypto";
import { notify } from "@/lib/notifications";
import { runAfterResponse } from "@/lib/background";
import { assertPublicHttpsUrl, UnsafeUrlError } from "@/lib/safe-fetch";
import { MAX_ATTEMPTS, WEBHOOK_LIMITS, signPayload, type WebhookEvent } from "@/lib/webhook-events";

/** Event names that are sent but can't be subscribed to (used by the "Send test" button). */
export type DeliverableEvent = WebhookEvent | "webhook.test";

// ---------------------------------------------------------------------------
// Subscriber lookup (cached a few seconds so hot paths cost nothing when nobody listens)
// ---------------------------------------------------------------------------

const TTL_MS = 5_000;
const cache = new Map<string, { at: number; events: Set<string> }>();
export const invalidateWebhookCache = (organizationId?: string) => (organizationId ? cache.delete(organizationId) : cache.clear());

async function subscribed(organizationId: string): Promise<Set<string>> {
  const hit = cache.get(organizationId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.events;
  if (!(await hasFeature(organizationId, "webhooks"))) {
    const none = new Set<string>();
    cache.set(organizationId, { at: Date.now(), events: none });
    return none;
  }
  const rows = await db.webhookEndpoint.findMany({ where: { organizationId, status: "active" }, select: { events: true } });
  const events = new Set<string>();
  for (const r of rows) {
    try {
      for (const e of JSON.parse(r.events) as string[]) events.add(e);
    } catch {
      /* ignore a corrupt row */
    }
  }
  cache.set(organizationId, { at: Date.now(), events });
  return events;
}

export const hasSubscribers = async (organizationId: string, event: WebhookEvent) => (await subscribed(organizationId)).has(event);

// ---------------------------------------------------------------------------
// Emit: one delivery row per subscribed endpoint, sent after the response
// ---------------------------------------------------------------------------

/**
 * Queues `event` for every active endpoint of the workspace that subscribed to it. Never throws — a webhook
 * problem must not break the message, contact or campaign that caused the event.
 */
export async function emitWebhook(organizationId: string, event: WebhookEvent, data: Record<string, unknown>) {
  try {
    if (!(await hasSubscribers(organizationId, event))) return;
    const endpoints = await db.webhookEndpoint.findMany({ where: { organizationId, status: "active" } });
    const mine = endpoints.filter((e) => {
      try {
        return (JSON.parse(e.events) as string[]).includes(event);
      } catch {
        return false;
      }
    });
    if (!mine.length) return;
    const eventId = `evt_${randomUUID()}`;
    const payload = JSON.stringify({ id: eventId, type: event, created_at: new Date().toISOString(), organization_id: organizationId, data });
    const ids: string[] = [];
    for (const e of mine) {
      const d = await db.webhookDelivery.create({ data: { organizationId, endpointId: e.id, eventId, event, payload, status: "pending", nextAttemptAt: new Date() } });
      ids.push(d.id);
    }
    runAfterResponse(async () => {
      for (const id of ids) await attemptDelivery(id);
    });
  } catch (e) {
    console.error("[webhooks] emit failed:", e);
  }
}

// ---------------------------------------------------------------------------
// Delivery
// ---------------------------------------------------------------------------

const LOCK_MS = 30_000;

/** Short, safe-to-store reason. Never a response body, never a URL query. */
function failureText(e: unknown): string {
  if (e instanceof UnsafeUrlError) return `Blocked: ${e.message}`.slice(0, 200);
  if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) return "Timed out after 10 seconds.";
  return "Couldn't connect to the endpoint.";
}

/**
 * One attempt. The delivery is claimed first so overlapping workers never send it twice. Success clears the
 * stored payload; failure schedules the next attempt (or gives up after the last), and enough failed
 * deliveries in a row switch the endpoint off.
 */
export async function attemptDelivery(deliveryId: string, opts: { noRetry?: boolean } = {}) {
  const now = new Date();
  const claim = await db.webhookDelivery.updateMany({
    where: { id: deliveryId, status: "pending", OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] },
    data: { lockedUntil: new Date(now.getTime() + LOCK_MS) },
  });
  if (!claim.count) return null;
  const d = await db.webhookDelivery.findUniqueOrThrow({ where: { id: deliveryId }, include: { endpoint: true } });
  const attempts = d.attempts + 1;
  const giveUp = (error: string, extra: { responseStatus?: number | null; durationMs?: number } = {}) => finalFailure(d.id, d.endpointId, d.organizationId, attempts, error, extra);

  if (d.endpoint.status !== "active" && d.event !== "webhook.test") return giveUp("The endpoint is disabled.");
  if (!d.payload) return giveUp("No payload to send.");

  let responseStatus: number | null = null;
  let error = "";
  const started = Date.now();
  try {
    const url = await assertPublicHttpsUrl(d.endpoint.url); // checked again at send time, not just when saved
    const ts = Math.floor(Date.now() / 1000);
    const res = await fetch(url, {
      method: "POST",
      redirect: "manual", // a redirect could point at an internal address
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "MECGURA-Webhooks/1.0",
        "X-Mecgura-Event": d.event,
        "X-Mecgura-Delivery": d.id,
        "X-Mecgura-Event-Id": d.eventId,
        "X-Mecgura-Signature": signPayload(decryptSecret(d.endpoint.secretEnc), d.payload, ts),
      },
      body: d.payload,
      signal: AbortSignal.timeout(WEBHOOK_LIMITS.timeoutMs),
    });
    responseStatus = res.status;
    await res.body?.cancel().catch(() => undefined); // the response body is never read or stored
    if (res.status >= 200 && res.status < 300) {
      await db.webhookDelivery.update({ where: { id: d.id }, data: { status: "delivered", attempts, responseStatus, durationMs: Date.now() - started, deliveredAt: new Date(), nextAttemptAt: null, lockedUntil: null, payload: null, error: "" } });
      if (d.event !== "webhook.test") await db.webhookEndpoint.update({ where: { id: d.endpointId }, data: { consecutiveFailures: 0, lastSuccessAt: new Date() } });
      return db.webhookDelivery.findUnique({ where: { id: d.id } });
    }
    error = res.status >= 300 && res.status < 400 ? `The endpoint redirected (HTTP ${res.status}); redirects aren't followed.` : `The endpoint answered HTTP ${res.status}.`;
    if (res.status === 410) return giveUp("The endpoint answered 410 Gone.", { responseStatus, durationMs: Date.now() - started });
  } catch (e) {
    error = failureText(e);
  }
  const durationMs = Date.now() - started;
  if (opts.noRetry || attempts >= MAX_ATTEMPTS) return giveUp(error, { responseStatus, durationMs });
  await db.webhookDelivery.update({
    where: { id: d.id },
    data: { attempts, responseStatus, durationMs, error, lockedUntil: null, nextAttemptAt: new Date(Date.now() + WEBHOOK_LIMITS.retryDelaysMs[attempts - 1]) },
  });
  return db.webhookDelivery.findUnique({ where: { id: d.id } });
}

async function finalFailure(id: string, endpointId: string, organizationId: string, attempts: number, error: string, extra: { responseStatus?: number | null; durationMs?: number }) {
  const row = await db.webhookDelivery.update({ where: { id }, data: { status: "failed", attempts, error, responseStatus: extra.responseStatus ?? null, durationMs: extra.durationMs ?? null, nextAttemptAt: null, lockedUntil: null } });
  if (row.event === "webhook.test") return row; // a test never counts against the endpoint
  const ep = await db.webhookEndpoint.update({ where: { id: endpointId }, data: { consecutiveFailures: { increment: 1 }, lastFailureAt: new Date() } });
  if (ep.status === "active" && ep.consecutiveFailures >= WEBHOOK_LIMITS.disableAfterFailures) {
    await db.webhookEndpoint.update({ where: { id: endpointId }, data: { status: "disabled", disabledReason: `Switched off automatically after ${ep.consecutiveFailures} failed deliveries in a row.` } });
    invalidateWebhookCache(organizationId);
    await audit({ action: "webhook.disabled", organizationId, targetType: "webhook", targetId: endpointId, metadata: { automatic: true, failures: ep.consecutiveFailures } });
    const owners = await db.organizationMember.findMany({ where: { organizationId, role: { in: ["CLIENT_OWNER", "MANAGER"] } }, select: { userId: true } });
    for (const o of owners) await notify({ userId: o.userId, organizationId, type: "warning", title: "A webhook endpoint was switched off", body: "It failed too many deliveries in a row. Fix the endpoint, then enable it again.", link: "/webhooks" });
  }
  return row;
}

/** Scheduler tick: retries that are due, then housekeeping. */
export async function runDueWebhooks(budgetMs = 20_000) {
  const started = Date.now();
  let sent = 0;
  while (Date.now() - started < budgetMs) {
    const now = new Date();
    const due = await db.webhookDelivery.findMany({ where: { status: "pending", nextAttemptAt: { lte: now }, OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] }, orderBy: { nextAttemptAt: "asc" }, take: 25, select: { id: true } });
    if (!due.length) break;
    for (const d of due) {
      if (Date.now() - started >= budgetMs) break;
      if (await attemptDelivery(d.id)) sent++;
    }
  }
  return { attempted: sent, ...(await purgeWebhookData()) };
}

/** Data minimisation: failed deliveries keep their payload for a week (so they can be re-sent), then it is dropped; old rows go. */
export async function purgeWebhookData() {
  const week = new Date(Date.now() - WEBHOOK_LIMITS.failedPayloadRetentionDays * 86_400_000);
  const month = new Date(Date.now() - 30 * 86_400_000);
  const stripped = await db.webhookDelivery.updateMany({ where: { status: "failed", payload: { not: null }, createdAt: { lt: week } }, data: { payload: null } });
  const removed = await db.webhookDelivery.deleteMany({ where: { status: { in: ["delivered", "failed"] }, createdAt: { lt: month } } });
  return { payloadsDropped: stripped.count, rowsRemoved: removed.count };
}
