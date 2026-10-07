import { randomBytes, randomUUID } from "node:crypto";
import { assertFeature } from "@/services/billing/entitlements";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { audit } from "@/lib/audit";
import { encryptSecret } from "@/lib/crypto";
import { assertPublicHttpsUrl, UnsafeUrlError } from "@/lib/safe-fetch";
import { WEBHOOK_LIMITS, type WebhookEvent } from "@/lib/webhook-events";
import type { OrgAccess } from "@/lib/session";
import { attemptDelivery, invalidateWebhookCache } from "@/services/webhooks/delivery";

type Row = Awaited<ReturnType<typeof load>>;

const newSecret = () => `whsec_${randomBytes(32).toString("base64url")}`;

function events(raw: string): WebhookEvent[] {
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? (v as WebhookEvent[]) : [];
  } catch {
    return [];
  }
}

/** Browser-safe projection: only the last four characters of the signing secret are ever returned. */
function toDto(e: Row) {
  return {
    id: e.id,
    url: e.url,
    description: e.description,
    events: events(e.events),
    status: e.status,
    disabledReason: e.disabledReason,
    secretHint: e.secretLast4 ? `whsec_••••${e.secretLast4}` : "",
    consecutiveFailures: e.consecutiveFailures,
    lastSuccessAt: e.lastSuccessAt,
    lastFailureAt: e.lastFailureAt,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  };
}
export type WebhookEndpointDto = ReturnType<typeof toDto>;

async function load(organizationId: string, id: string) {
  const e = await db.webhookEndpoint.findFirst({ where: { id, organizationId } });
  if (!e) throw new ApiError("NOT_FOUND", "Webhook endpoint not found.");
  return e;
}

async function checkUrl(raw: string): Promise<string> {
  try {
    return (await assertPublicHttpsUrl(raw)).toString();
  } catch (e) {
    throw new ApiError("VALIDATION_ERROR", e instanceof UnsafeUrlError ? e.message : "Invalid URL.", { details: { url: [e instanceof UnsafeUrlError ? e.message : "Invalid URL"] } });
  }
}

export async function listEndpoints(organizationId: string) {
  const rows = await db.webhookEndpoint.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" } });
  return rows.map(toDto);
}

export async function getEndpoint(organizationId: string, id: string) {
  return toDto(await load(organizationId, id));
}

/** The response is the only place the signing secret ever appears. */
export async function createEndpoint(access: OrgAccess, input: { url: string; description: string; events: WebhookEvent[] }, req?: Request) {
  const orgId = access.organizationId;
  await assertFeature(orgId, "webhooks");
  if ((await db.webhookEndpoint.count({ where: { organizationId: orgId } })) >= WEBHOOK_LIMITS.maxEndpoints) {
    throw new ApiError("CONFLICT", `A workspace can have up to ${WEBHOOK_LIMITS.maxEndpoints} webhook endpoints.`);
  }
  const url = await checkUrl(input.url);
  const secret = newSecret();
  const e = await db.webhookEndpoint.create({
    data: { organizationId: orgId, url, description: input.description, events: JSON.stringify([...new Set(input.events)]), secretEnc: encryptSecret(secret), secretLast4: secret.slice(-4), createdById: access.user.id },
  });
  invalidateWebhookCache(orgId);
  await audit({ action: "webhook.created", actorUserId: access.user.id, organizationId: orgId, targetType: "webhook", targetId: e.id, metadata: { host: new URL(url).host, events: input.events }, req });
  return { endpoint: toDto(e), secret };
}

export async function updateEndpoint(access: OrgAccess, id: string, input: { url?: string; description?: string; events?: WebhookEvent[]; status?: "active" | "disabled" }, req?: Request) {
  const e = await load(access.organizationId, id);
  const data: Record<string, unknown> = {};
  if (input.url !== undefined) data.url = await checkUrl(input.url);
  if (input.description !== undefined) data.description = input.description;
  if (input.events !== undefined) data.events = JSON.stringify([...new Set(input.events)]);
  if (input.status !== undefined) {
    data.status = input.status;
    if (input.status === "active") Object.assign(data, { disabledReason: "", consecutiveFailures: 0 });
    else data.disabledReason = "Switched off by a teammate.";
  }
  const u = await db.webhookEndpoint.update({ where: { id: e.id }, data });
  invalidateWebhookCache(access.organizationId);
  await audit({ action: input.status === "disabled" ? "webhook.disabled" : "webhook.updated", actorUserId: access.user.id, organizationId: access.organizationId, targetType: "webhook", targetId: id, metadata: { fields: Object.keys(input) }, req });
  return toDto(u);
}

export async function deleteEndpoint(access: OrgAccess, id: string, req?: Request) {
  const e = await load(access.organizationId, id);
  await db.webhookEndpoint.delete({ where: { id: e.id } });
  invalidateWebhookCache(access.organizationId);
  await audit({ action: "webhook.deleted", actorUserId: access.user.id, organizationId: access.organizationId, targetType: "webhook", targetId: id, metadata: { host: safeHost(e.url) }, req });
}

const safeHost = (u: string) => {
  try {
    return new URL(u).host;
  } catch {
    return "";
  }
};

export async function rotateSecret(access: OrgAccess, id: string, req?: Request) {
  const e = await load(access.organizationId, id);
  const secret = newSecret();
  const u = await db.webhookEndpoint.update({ where: { id: e.id }, data: { secretEnc: encryptSecret(secret), secretLast4: secret.slice(-4) } });
  await audit({ action: "webhook.secret_rotated", actorUserId: access.user.id, organizationId: access.organizationId, targetType: "webhook", targetId: id, req });
  return { endpoint: toDto(u), secret };
}

const deliveryDto = (d: { id: string; eventId: string; event: string; status: string; attempts: number; nextAttemptAt: Date | null; responseStatus: number | null; durationMs: number | null; error: string; createdAt: Date; deliveredAt: Date | null; payload: string | null }) => ({
  id: d.id,
  eventId: d.eventId,
  event: d.event,
  status: d.status,
  attempts: d.attempts,
  nextAttemptAt: d.nextAttemptAt,
  responseStatus: d.responseStatus,
  durationMs: d.durationMs,
  error: d.error,
  createdAt: d.createdAt,
  deliveredAt: d.deliveredAt,
  canRedeliver: d.status === "failed" && d.payload !== null,
});

export async function listDeliveries(organizationId: string, endpointId: string, f: { status?: string; page: number; pageSize: number }) {
  await load(organizationId, endpointId);
  const where = { organizationId, endpointId, ...(f.status ? { status: f.status } : {}) };
  const [rows, total] = await Promise.all([
    db.webhookDelivery.findMany({ where, orderBy: { createdAt: "desc" }, skip: (f.page - 1) * f.pageSize, take: f.pageSize }),
    db.webhookDelivery.count({ where }),
  ]);
  return { deliveries: rows.map(deliveryDto), total };
}

/** Sends a signed sample event right now, so the receiver can check its signature code. Doesn't count towards auto-disable. */
export async function sendTest(access: OrgAccess, id: string) {
  const e = await load(access.organizationId, id);
  const eventId = `evt_${randomUUID()}`;
  const payload = JSON.stringify({ id: eventId, type: "webhook.test", created_at: new Date().toISOString(), organization_id: access.organizationId, data: { message: "This is a test event from MECGURA." } });
  const d = await db.webhookDelivery.create({ data: { organizationId: access.organizationId, endpointId: e.id, eventId, event: "webhook.test", payload, status: "pending", nextAttemptAt: new Date() } });
  const done = (await attemptDelivery(d.id, { noRetry: true })) ?? d;
  return deliveryDto(done);
}

export async function redeliver(access: OrgAccess, endpointId: string, deliveryId: string) {
  const e = await load(access.organizationId, endpointId);
  if (e.status !== "active") throw new ApiError("CONFLICT", "Enable the endpoint before re-sending.");
  const d = await db.webhookDelivery.findFirst({ where: { id: deliveryId, endpointId: e.id, organizationId: access.organizationId } });
  if (!d) throw new ApiError("NOT_FOUND", "Delivery not found.");
  if (d.status !== "failed" || !d.payload) throw new ApiError("CONFLICT", "Only failed deliveries whose payload is still kept can be re-sent.");
  await db.webhookDelivery.update({ where: { id: d.id }, data: { status: "pending", attempts: 0, error: "", nextAttemptAt: new Date(), lockedUntil: null } });
  return deliveryDto((await attemptDelivery(d.id)) ?? d);
}
