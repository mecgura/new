import "server-only";
import { db } from "@/lib/db";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import type { RequestContext } from "@/lib/auth/context";
import { AppError } from "@/lib/errors";
import { guard, requireReason } from "./platform-core";
import { CATEGORIES, SEVERITIES, securityEvent } from "./sec-events";
import { pageParams } from "./shared";

const DAY = 86_400_000;
export async function securityOverview(ctx: RequestContext, now = new Date()) {
  guard(ctx); const d1 = new Date(now.getTime() - DAY), d7 = new Date(now.getTime() - 7 * DAY);
  const [sev24, sev7, failed24, locked, openInc, recent, topIps, seal, lastVerify, keys, support, whFail, saTotal, saMfa, adminTotal, adminMfa] = await Promise.all([
    db.securityEvent.groupBy({ by: ["severity"], where: { createdAt: { gte: d1 } }, _count: { _all: true } }),
    db.securityEvent.groupBy({ by: ["severity"], where: { createdAt: { gte: d7 } }, _count: { _all: true } }),
    db.securityEvent.count({ where: { type: "LOGIN_FAILED", createdAt: { gte: d1 } } }),
    db.user.count({ where: { lockedUntil: { gt: now }, deletedAt: null } }),
    db.securityIncident.count({ where: { status: { in: ["OPEN", "INVESTIGATING", "CONTAINED"] } } }),
    db.securityEvent.findMany({ where: { severity: { in: ["MEDIUM", "HIGH", "CRITICAL"] } }, orderBy: { createdAt: "desc" }, take: 10 }),
    db.securityEvent.groupBy({ by: ["ip"], where: { type: "LOGIN_FAILED", createdAt: { gte: d1 }, ip: { not: null } }, _count: { _all: true }, orderBy: { _count: { ip: "desc" } }, take: 5 }),
    db.auditSeal.findFirst({ where: { NOT: { chainHash: { startsWith: "PURGE:" } } }, orderBy: { toAt: "desc" }, select: { toAt: true, count: true } }),
    db.auditLog.findFirst({ where: { action: AUDIT_ACTIONS.SECURITY_AUDIT_VERIFIED }, orderBy: { createdAt: "desc" }, select: { createdAt: true, metadata: true } }),
    db.apiKey.findMany({ where: { revokedAt: null }, select: { expiresAt: true, lastUsedAt: true } }),
    db.supportAccess.count({ where: { endedAt: null, expiresAt: { gt: now } } }),
    db.subscriptionWebhookEvent.count({ where: { status: "FAILED", receivedAt: { gte: d7 } } }),
    db.user.count({ where: { deletedAt: null, status: "ACTIVE", role: { key: "SUPER_ADMIN" } } }),
    db.userMfa.count({ where: { enabledAt: { not: null }, user: { role: { key: "SUPER_ADMIN" }, deletedAt: null, status: "ACTIVE" } } }),
    db.user.count({ where: { deletedAt: null, status: "ACTIVE", role: { key: "CLINIC_ADMIN" } } }),
    db.userMfa.count({ where: { enabledAt: { not: null }, user: { role: { key: "CLINIC_ADMIN" }, deletedAt: null, status: "ACTIVE" } } }),
  ]);
  const tally = (g: { severity: string; _count: { _all: number } }[]) => Object.fromEntries(SEVERITIES.map((s) => [s, g.find((x) => x.severity === s)?._count._all ?? 0])) as Record<string, number>;
  let verified: { at: Date; ok: boolean } | null = null; if (lastVerify) { try { verified = { at: lastVerify.createdAt, ok: (JSON.parse(lastVerify.metadata ?? "{}") as { ok?: boolean }).ok === true }; } catch { verified = { at: lastVerify.createdAt, ok: false }; } }
  return {
    last24h: tally(sev24), last7d: tally(sev7), failedLogins24h: failed24, lockedAccounts: locked, openIncidents: openInc, activeSupportSessions: support, failedWebhooks7d: whFail,
    topFailingIps: topIps.map((t) => ({ ip: t.ip!, failures: t._count._all })), recent: recent.map((e) => ({ id: e.id, at: e.createdAt, severity: e.severity, category: e.category, type: e.type, summary: e.summary, ip: e.ip, tenantId: e.tenantId })),
    audit: { lastSealedTo: seal?.toAt ?? null, lastVerification: verified, unsealedNote: seal ? null : "No seal has been created yet." },
    apiKeys: { active: keys.length, expiringIn30d: keys.filter((k) => k.expiresAt && k.expiresAt.getTime() - now.getTime() < 30 * DAY).length, unusedFor90d: keys.filter((k) => !k.lastUsedAt).length },
    mfaAdoption: { superAdmins: { total: saTotal, withMfa: saMfa }, clinicAdmins: { total: adminTotal, withMfa: adminMfa } },
  };
}
export async function listSecurityEvents(ctx: RequestContext, f: { severity?: string; category?: string; type?: string; tenantId?: string; from?: string; page?: number }) {
  guard(ctx); const { skip, take, page } = pageParams(f.page, 30);
  const where = { ...(f.severity && (SEVERITIES as readonly string[]).includes(f.severity) ? { severity: f.severity } : {}), ...(f.category && (CATEGORIES as readonly string[]).includes(f.category) ? { category: f.category } : {}), ...(f.type ? { type: f.type } : {}), ...(f.tenantId ? { tenantId: f.tenantId } : {}), ...(f.from && !Number.isNaN(Date.parse(f.from)) ? { createdAt: { gte: new Date(f.from) } } : {}) };
  const [total, rows] = await Promise.all([db.securityEvent.count({ where }), db.securityEvent.findMany({ where, orderBy: { createdAt: "desc" }, skip, take })]);
  return { total, page, pageSize: take, rows, severities: SEVERITIES, categories: CATEGORIES };
}

/** Everyone holding powerful access, for the periodic access review. */
export async function accessReview(ctx: RequestContext) {
  guard(ctx); const now = Date.now();
  const users = await db.user.findMany({ where: { deletedAt: null, status: "ACTIVE", role: { key: { in: ["SUPER_ADMIN", "CLINIC_ADMIN"] } } }, select: { id: true, name: true, email: true, lastLoginAt: true, tenant: { select: { id: true, name: true } }, role: { select: { key: true } }, mfa: { select: { enabledAt: true } } }, orderBy: [{ tenantId: "asc" }, { name: "asc" }], take: 500 });
  const grants = await db.userPermissionGrant.groupBy({ by: ["userId"], _count: { _all: true } });
  const g = new Map(grants.map((x) => [x.userId, x._count._all]));
  const extra = await db.user.findMany({ where: { id: { in: [...g.keys()] }, deletedAt: null, status: "ACTIVE" }, select: { id: true, name: true, email: true, lastLoginAt: true, tenant: { select: { name: true } }, role: { select: { key: true } } }, take: 300 });
  return {
    privileged: users.map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role.key, clinic: u.tenant?.name ?? "Platform", mfa: !!u.mfa?.enabledAt, lastLoginAt: u.lastLoginAt, inactive90d: !u.lastLoginAt || now - u.lastLoginAt.getTime() > 90 * DAY })),
    withExtraGrants: extra.map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role.key, clinic: u.tenant?.name ?? "Platform", grants: g.get(u.id) ?? 0, lastLoginAt: u.lastLoginAt })),
  };
}

/* -------------------------------------------------------------------- incidents -------------------------------------------------------------------- */
export const INCIDENT_STATUSES = ["OPEN", "INVESTIGATING", "CONTAINED", "RESOLVED", "CLOSED"] as const;
const MOVES: Record<string, string[]> = { OPEN: ["INVESTIGATING", "CONTAINED", "RESOLVED"], INVESTIGATING: ["CONTAINED", "RESOLVED", "OPEN"], CONTAINED: ["INVESTIGATING", "RESOLVED"], RESOLVED: ["CLOSED", "INVESTIGATING"], CLOSED: [] };
const short = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
export async function createIncident(ctx: RequestContext, i: { title?: string; description?: string; severity?: string; category?: string; tenantId?: string; affectedResource?: string; evidence?: string }) {
  guard(ctx); const title = short(i.title, 140), description = short(i.description, 2000);
  if (title.length < 5 || description.length < 10) throw new AppError("VALIDATION_ERROR", { message: "Give the incident a title and a description.", fieldErrors: { title: title.length < 5 ? "At least 5 characters." : "", description: description.length < 10 ? "At least 10 characters." : "" } });
  const severity = (SEVERITIES as readonly string[]).includes(i.severity ?? "") ? i.severity! : "MEDIUM"; const category = (CATEGORIES as readonly string[]).includes(i.category ?? "") ? i.category! : "ACCESS";
  if (i.tenantId && !(await db.tenant.findFirst({ where: { id: i.tenantId }, select: { id: true } }))) throw new AppError("NOT_FOUND", { message: "That clinic doesn't exist." });
  const inc = await db.$transaction(async (tx) => { const year = new Date().getUTCFullYear(); const c = await tx.platformCounter.upsert({ where: { key: `SEC:${year}` }, create: { key: `SEC:${year}`, value: 1 }, update: { value: { increment: 1 } } });
    return tx.securityIncident.create({ data: { incidentNumber: `SEC-${year}-${String(c.value).padStart(4, "0")}`, tenantId: i.tenantId || null, severity, category, title, description, detectedById: ctx.user.id, affectedResource: short(i.affectedResource, 200) || null, evidence: short(i.evidence, 2000) || null, events: { create: { type: "CREATED", note: "Incident opened", actorId: ctx.user.id } } } }); });
  await recordAudit({ action: AUDIT_ACTIONS.SECURITY_INCIDENT_CHANGED, tenantId: inc.tenantId, actorId: ctx.user.id, entityType: "security_incident", entityId: inc.id, metadata: { number: inc.incidentNumber, severity, created: true } });
  return inc;
}
export async function updateIncident(ctx: RequestContext, id: string, i: { status?: string; note?: string; assignedToId?: string | null; actionsTaken?: string; resolution?: string; evidence?: string }) {
  guard(ctx); const inc = await db.securityIncident.findUnique({ where: { id } }); if (!inc) throw new AppError("NOT_FOUND");
  const data: Record<string, unknown> = {}; const events: { type: string; note: string }[] = [];
  if (i.status && i.status !== inc.status) {
    if (!(MOVES[inc.status] ?? []).includes(i.status)) throw new AppError("CONFLICT", { message: `An incident that is ${inc.status.toLowerCase()} can't become ${i.status.toLowerCase()}.` });
    if (["RESOLVED", "CLOSED"].includes(i.status) && short(i.resolution ?? inc.resolution, 2000).length < 10) throw new AppError("VALIDATION_ERROR", { fieldErrors: { resolution: "Describe how it was resolved." } });
    data.status = i.status; if (i.status === "RESOLVED") data.resolvedAt = new Date(); events.push({ type: "STATUS", note: `${inc.status} → ${i.status}` });
  }
  if (i.assignedToId !== undefined) { if (i.assignedToId && !(await db.user.findFirst({ where: { id: i.assignedToId, role: { key: "SUPER_ADMIN" }, deletedAt: null }, select: { id: true } }))) throw new AppError("VALIDATION_ERROR", { message: "Assign to a Super Admin." }); data.assignedToId = i.assignedToId; events.push({ type: "ASSIGNED", note: i.assignedToId ? "Assigned" : "Unassigned" }); }
  if (i.actionsTaken) { data.actionsTaken = short(i.actionsTaken, 2000); events.push({ type: "ACTION", note: short(i.actionsTaken, 300) }); }
  if (i.resolution) { data.resolution = short(i.resolution, 2000); events.push({ type: "RESOLUTION", note: short(i.resolution, 300) }); }
  if (i.evidence) { data.evidence = short(i.evidence, 2000); events.push({ type: "EVIDENCE", note: "Evidence updated" }); }
  if (i.note) events.push({ type: "NOTE", note: short(i.note, 1000) });
  if (!events.length) throw new AppError("VALIDATION_ERROR", { message: "Nothing to update." });
  const upd = await db.securityIncident.update({ where: { id }, data: { ...data, events: { create: events.map((e) => ({ ...e, actorId: ctx.user.id })) } } });
  await recordAudit({ action: AUDIT_ACTIONS.SECURITY_INCIDENT_CHANGED, tenantId: inc.tenantId, actorId: ctx.user.id, entityType: "security_incident", entityId: id, metadata: { number: inc.incidentNumber, status: upd.status } });
  return upd;
}
export async function listIncidents(ctx: RequestContext, f: { status?: string; page?: number } = {}) {
  guard(ctx); const { skip, take, page } = pageParams(f.page, 20); const where = f.status && (INCIDENT_STATUSES as readonly string[]).includes(f.status) ? { status: f.status } : {};
  const [total, rows] = await Promise.all([db.securityIncident.count({ where }), db.securityIncident.findMany({ where, orderBy: { detectedAt: "desc" }, skip, take })]); return { total, page, pageSize: take, rows };
}
export async function getIncident(ctx: RequestContext, id: string) { guard(ctx); const i = await db.securityIncident.findUnique({ where: { id }, include: { events: { orderBy: { createdAt: "asc" } } } }); if (!i) throw new AppError("NOT_FOUND"); return i; }
export { securityEvent, requireReason };
