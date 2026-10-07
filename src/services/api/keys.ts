import { db } from "@/lib/db";
import { assertFeature } from "@/services/billing/entitlements";
import { ApiError } from "@/lib/api";
import { audit } from "@/lib/audit";
import { API_KEY_LIMITS, generateApiKey, keyStatus, type ApiScope } from "@/lib/api-keys";
import type { OrgAccess } from "@/lib/session";

type Row = Awaited<ReturnType<typeof load>>;

function scopes(raw: string): ApiScope[] {
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? (v as ApiScope[]) : [];
  } catch {
    return [];
  }
}

/** Browser-safe projection: the prefix and last-used info — never the hash or the secret. */
function toDto(k: Row) {
  return {
    id: k.id,
    name: k.name,
    prefix: k.prefix,
    permissions: scopes(k.permissions),
    status: keyStatus(k),
    lastUsedAt: k.lastUsedAt,
    lastUsedIp: k.lastUsedIp,
    expiresAt: k.expiresAt,
    revokedAt: k.revokedAt,
    rotatedFromId: k.rotatedFromId,
    createdBy: k.createdBy ? (k.createdBy.name ?? k.createdBy.email) : null,
    createdAt: k.createdAt,
  };
}
export type ApiKeyDto = ReturnType<typeof toDto>;

const include = { createdBy: { select: { name: true, email: true } } } as const;
async function load(organizationId: string, id: string) {
  const k = await db.apiKey.findFirst({ where: { id, organizationId }, include });
  if (!k) throw new ApiError("NOT_FOUND", "API key not found.");
  return k;
}

export async function listKeys(organizationId: string) {
  const rows = await db.apiKey.findMany({ where: { organizationId }, include, orderBy: { createdAt: "desc" }, take: 100 });
  return rows.map(toDto);
}

async function assertSlot(organizationId: string) {
  const active = await db.apiKey.count({ where: { organizationId, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } });
  if (active >= API_KEY_LIMITS.maxActiveKeys) throw new ApiError("CONFLICT", `A workspace can have up to ${API_KEY_LIMITS.maxActiveKeys} active API keys. Revoke one first.`);
}

/** Returns the new key's secret — this is the only time it exists in readable form. */
export async function createKey(access: OrgAccess, input: { name: string; permissions: ApiScope[]; expiresInDays?: number | null }, req?: Request) {
  await assertFeature(access.organizationId, "api");
  await assertSlot(access.organizationId);
  const g = generateApiKey();
  const k = await db.apiKey.create({
    data: {
      organizationId: access.organizationId,
      name: input.name,
      prefix: g.prefix,
      keyHash: g.hash,
      permissions: JSON.stringify([...new Set(input.permissions)]),
      createdById: access.user.id,
      ...(input.expiresInDays ? { expiresAt: new Date(Date.now() + input.expiresInDays * 86_400_000) } : {}),
    },
    include,
  });
  await audit({ action: "api_key.created", actorUserId: access.user.id, organizationId: access.organizationId, targetType: "api_key", targetId: k.id, metadata: { name: k.name, permissions: input.permissions, prefix: k.prefix }, req });
  return { key: toDto(k), secret: g.key };
}

export async function updateKey(access: OrgAccess, id: string, input: { name?: string; permissions?: ApiScope[] }, req?: Request) {
  const k = await load(access.organizationId, id);
  if (k.revokedAt) throw new ApiError("CONFLICT", "A revoked key can't be edited.");
  const u = await db.apiKey.update({
    where: { id: k.id },
    data: { ...(input.name ? { name: input.name } : {}), ...(input.permissions ? { permissions: JSON.stringify([...new Set(input.permissions)]) } : {}) },
    include,
  });
  await audit({ action: "api_key.updated", actorUserId: access.user.id, organizationId: access.organizationId, targetType: "api_key", targetId: id, metadata: { fields: Object.keys(input) }, req });
  return toDto(u);
}

export async function revokeKey(access: OrgAccess, id: string, req?: Request) {
  const k = await load(access.organizationId, id);
  if (k.revokedAt) throw new ApiError("CONFLICT", "This key is already revoked.");
  const u = await db.apiKey.update({ where: { id: k.id }, data: { revokedAt: new Date() }, include });
  await audit({ action: "api_key.revoked", actorUserId: access.user.id, organizationId: access.organizationId, targetType: "api_key", targetId: id, metadata: { name: k.name, prefix: k.prefix }, req });
  return toDto(u);
}

/**
 * New secret, same name and permissions. The old key stops working now (grace 0) or after the grace period,
 * so a deployment can switch over without downtime.
 */
export async function rotateKey(access: OrgAccess, id: string, graceHours: number, req?: Request) {
  const old = await load(access.organizationId, id);
  if (old.revokedAt || (old.expiresAt && old.expiresAt <= new Date())) throw new ApiError("CONFLICT", "Only an active key can be rotated.");
  const g = generateApiKey();
  const [fresh] = await db.$transaction([
    db.apiKey.create({
      data: { organizationId: access.organizationId, name: old.name, prefix: g.prefix, keyHash: g.hash, permissions: old.permissions, createdById: access.user.id, rotatedFromId: old.id },
      include,
    }),
    db.apiKey.update({ where: { id: old.id }, data: graceHours > 0 ? { expiresAt: new Date(Date.now() + graceHours * 3_600_000) } : { revokedAt: new Date() } }),
  ]);
  await audit({ action: "api_key.rotated", actorUserId: access.user.id, organizationId: access.organizationId, targetType: "api_key", targetId: id, metadata: { newKeyId: fresh.id, graceHours, prefix: old.prefix }, req });
  return { key: toDto(fresh), secret: g.key, previous: toDto(await load(access.organizationId, old.id)) };
}

// ---------------------------------------------------------------------------
// Usage and request logs (metadata only)
// ---------------------------------------------------------------------------

const TZ = "Asia/Kolkata";
const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });

export async function usageSummary(organizationId: string, days: number) {
  const since = new Date(Date.now() - (days + 1) * 86_400_000);
  const [logs, keys] = await Promise.all([
    db.apiRequestLog.findMany({ where: { organizationId, createdAt: { gte: since } }, select: { createdAt: true, status: true, durationMs: true, apiKeyId: true }, take: 100_000 }),
    db.apiKey.findMany({ where: { organizationId }, select: { id: true, name: true, prefix: true } }),
  ]);
  const byDay = new Map<string, { total: number; errors: number; limited: number }>();
  for (let i = days - 1; i >= 0; i--) byDay.set(dayFmt.format(new Date(Date.now() - i * 86_400_000)), { total: 0, errors: 0, limited: 0 });
  const byKey = new Map<string, { total: number; errors: number }>();
  let totalMs = 0;
  let total = 0;
  for (const l of logs) {
    const d = byDay.get(dayFmt.format(l.createdAt));
    if (!d) continue;
    d.total++;
    if (l.status >= 400) d.errors++;
    if (l.status === 429) d.limited++;
    total++;
    totalMs += l.durationMs;
    const k = byKey.get(l.apiKeyId ?? "") ?? { total: 0, errors: 0 };
    k.total++;
    if (l.status >= 400) k.errors++;
    byKey.set(l.apiKeyId ?? "", k);
  }
  const errors = [...byDay.values()].reduce((n, d) => n + d.errors, 0);
  return {
    days: [...byDay.entries()].map(([date, v]) => ({ date, ...v })),
    totals: { requests: total, errors, rateLimited: [...byDay.values()].reduce((n, d) => n + d.limited, 0), avgMs: total ? Math.round(totalMs / total) : 0 },
    keys: keys.map((k) => ({ id: k.id, name: k.name, prefix: k.prefix, ...(byKey.get(k.id) ?? { total: 0, errors: 0 }) })).sort((a, b) => b.total - a.total),
    limits: { perMinute: API_KEY_LIMITS.perMinute, logRetentionDays: API_KEY_LIMITS.logRetentionDays },
  };
}

export async function listLogs(organizationId: string, f: { keyId?: string; status?: string; method?: string; q?: string; page: number; pageSize: number }) {
  const where = {
    organizationId,
    ...(f.keyId ? { apiKeyId: f.keyId } : {}),
    ...(f.status === "2xx" ? { status: { gte: 200, lt: 300 } } : f.status === "4xx" ? { status: { gte: 400, lt: 500 } } : f.status === "5xx" ? { status: { gte: 500 } } : f.status === "429" ? { status: 429 } : {}),
    ...(f.method ? { method: f.method } : {}),
    ...(f.q ? { path: { contains: f.q } } : {}),
  };
  const [rows, total] = await Promise.all([
    db.apiRequestLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (f.page - 1) * f.pageSize, take: f.pageSize, include: { apiKey: { select: { name: true, prefix: true } } } }),
    db.apiRequestLog.count({ where }),
  ]);
  return {
    logs: rows.map((l) => ({ id: l.id, method: l.method, path: l.path, status: l.status, durationMs: l.durationMs, ip: l.ip, userAgent: l.userAgent, errorCode: l.errorCode, key: l.apiKey ? { name: l.apiKey.name, prefix: l.apiKey.prefix } : null, createdAt: l.createdAt })),
    total,
  };
}

/** Housekeeping, run by the scheduler. */
export async function purgeOldApiLogs() {
  const r = await db.apiRequestLog.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - API_KEY_LIMITS.logRetentionDays * 86_400_000) } } });
  return r.count;
}
