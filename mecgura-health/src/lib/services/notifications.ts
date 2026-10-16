import "server-only";
import type { RequestContext } from "@/lib/auth/context";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { CATEGORY_LABEL, CATEGORIES, ENTITY_PERMISSION, FILTER_CATEGORIES, PRIORITY_RANK, TYPES, TYPE_KEYS, categoryOfType, def, safeActionUrl, type NCategory, type NType } from "@/lib/notifications/catalog";
import { loadRule } from "@/lib/notifications/engine";
import { addDays, dayRangeUtc, todayIn } from "@/lib/scheduling/time";
import { tenantTimezone } from "./clinic-shared";
import { rateLimit } from "@/lib/security/rate-limit";
import { parseOrThrow } from "@/lib/validation";
import { notificationQuerySchema, prefsSchema, ruleSchema, settingsSchema } from "@/lib/validation/notifications";
import { containsCI } from "./shared";

/** Who is asking. Always built on the server from the session — `userId` and `tenantId` NEVER come from the request. */
export interface Actor { userId: string; tenantId: string | null; patientId?: string; kind: "STAFF" | "PATIENT"; role: string; permissions: ReadonlySet<string> }
export const staffActor = (ctx: RequestContext): Actor => { if (ctx.user.role === "PATIENT") throw new AppError("FORBIDDEN"); return staffActorOf(ctx); };
const staffActorOf = (ctx: RequestContext): Actor => ({ userId: ctx.user.id, tenantId: ctx.user.tenantId, kind: "STAFF", role: ctx.user.role, permissions: ctx.permissions as ReadonlySet<string> });
export const patientActor = (ctx: { user: { id: string; tenantId: string | null }; tenantId: string; patientId: string }): Actor => ({ userId: ctx.user.id, tenantId: ctx.tenantId, patientId: ctx.patientId, kind: "PATIENT", role: "PATIENT", permissions: new Set() });

const PAGE = 20;
const iso = (d: Date | null | undefined) => d?.toISOString() ?? null;
const parse = <T,>(s: string | null | undefined, d: T): T => { try { return s ? (JSON.parse(s) as T) : d; } catch { return d; } };
/** A user's own, visible notifications: theirs, in their clinic, past any quiet-hours hold. */
const mine = (a: Actor, now = new Date()) => ({ userId: a.userId, tenantId: a.tenantId, visibleAt: { lte: now } });

export interface NotificationRow {
  id: string; type: string; category: NCategory; categoryLabel: string; priority: string; title: string; body: string | null; actionUrl: string | null; entityType: string | null; entityId: string | null;
  read: boolean; archived: boolean; expired: boolean; ackRequired: boolean; acknowledged: boolean; groupCount: number; createdAt: string;
}
function toRow(n: Record<string, any>, now: Date, staff = true): NotificationRow {
  const category = categoryOfType(n.type, n.category);
  return { id: n.id, type: n.type, category, categoryLabel: CATEGORY_LABEL[category], priority: n.priority, title: n.title, body: n.body ?? null, actionUrl: safeActionUrl(n.actionUrl), entityType: staff ? n.entityType ?? null : null, entityId: staff ? n.entityId ?? null : null, read: !!n.readAt, archived: !!n.archivedAt, expired: !!n.expiresAt && n.expiresAt <= now, ackRequired: !!n.ackRequired, acknowledged: !!n.acknowledgedAt, groupCount: n.groupCount ?? 1, createdAt: n.createdAt.toISOString() };
}

/* ------------------------------------------------------ count / list ------------------------------------------------------ */
export async function unreadCount(a: Actor): Promise<{ unread: number; urgent: number }> {
  const now = new Date(); const base = { ...mine(a, now), readAt: null, archivedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] };
  const [unread, urgent] = await Promise.all([db.notification.count({ where: base }), db.notification.count({ where: { ...base, priority: { in: ["URGENT", "CRITICAL"] } } })]);
  return { unread, urgent };
}

async function rangeFilter(a: Actor, q: { range?: string; from?: string; to?: string }) {
  if (!q.range) return undefined;
  const tz = a.tenantId ? await tenantTimezone(a.tenantId) : "Asia/Kolkata"; const today = todayIn(tz);
  const span = (from: string, to: string) => ({ gte: dayRangeUtc(from, tz).start, lt: dayRangeUtc(to, tz).end });
  if (q.range === "today") return span(today, today); if (q.range === "yesterday") return span(addDays(today, -1), addDays(today, -1));
  if (q.range === "7d") return span(addDays(today, -6), today); if (q.range === "30d") return span(addDays(today, -29), today);
  if (q.range === "custom" && q.from && q.to && q.from <= q.to) return span(q.from, q.to);
  return undefined;
}
export async function listNotifications(a: Actor, raw: Record<string, unknown> = {}) {
  const q = parseOrThrow(notificationQuerySchema, raw); const now = new Date(); const page = q.page ?? 1; const size = q.pageSize ?? PAGE;
  const and: Record<string, unknown>[] = [];
  const f = q.filter ?? "all";
  if (f === "archived") and.push({ archivedAt: { not: null } }); else if (f === "expired") and.push({ expiresAt: { lte: now } }); else { and.push({ archivedAt: null }, { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }); if (f === "unread") and.push({ readAt: null }); if (f === "ack") and.push({ ackRequired: true, acknowledgedAt: null }); }
  if (q.category) { const cat = q.category; const fc = FILTER_CATEGORIES.find((x) => x.key === cat.toLowerCase()); const up = cat.toUpperCase(); if (fc || (CATEGORIES as readonly string[]).includes(up)) and.push({ category: { in: fc ? fc.categories : [up] } }); else and.push({ id: "none" }); }
  if (q.priority) and.push({ priority: q.priority });
  const created = await rangeFilter(a, q); if (created) and.push({ createdAt: created });
  if (q.q) {
    const ors: Record<string, unknown>[] = [{ title: containsCI(q.q) }, { body: containsCI(q.q) }, { entityId: q.q }];
    // searching by patient only for staff who may see patients; the lookup is tenant-scoped
    if (a.kind === "STAFF" && a.tenantId && a.permissions.has("patients.view")) { const pts = await db.patient.findMany({ where: { tenantId: a.tenantId, deletedAt: null, OR: [{ name: containsCI(q.q) }, { code: containsCI(q.q) }] }, select: { id: true }, take: 50 }); if (pts.length) ors.push({ patientId: { in: pts.map((p) => p.id) } }); }
    and.push({ OR: ors });
  }
  const where = { ...mine(a, now), AND: and };
  const [total, rows, counts] = await Promise.all([
    db.notification.count({ where }),
    db.notification.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * size, take: size }),
    db.notification.groupBy({ by: ["category"], where: { ...mine(a, now), archivedAt: null, readAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }, _count: { _all: true } }),
  ]);
  const byCat: Record<string, number> = {}; for (const c of counts) { const k = categoryOfType("", c.category); byCat[k] = (byCat[k] ?? 0) + c._count._all; }
  return { rows: rows.map((r) => toRow(r, now, a.kind === "STAFF")), total, page, pageSize: size, unreadByCategory: byCat };
}

/* ------------------------------------------------------ detail + safe actions ------------------------------------------------------ */
const ENTITY_MODEL: Record<string, string> = { appointment: "appointment", patient: "patient", opd_visit: "opdVisit", lab_order: "investigationOrder", lab_report: "labReport", followup: "followUp", invoice: "invoice", payment: "payment", prescription: "prescription", purchase: "purchase", medicine: "medicine", user: "user" };
const COMM_ENTITY: Record<string, string> = { followup: "follow_up" };
/** The link is offered only if the viewer may open that kind of record AND the record really exists in their clinic. */
async function actionAllowed(a: Actor, n: { actionUrl: string | null; entityType: string | null; entityId: string | null; patientId: string | null }): Promise<string | null> {
  const url = safeActionUrl(n.actionUrl); if (!url) return null;
  if (a.kind === "PATIENT") return url.startsWith("/portal/") && n.patientId === a.patientId ? url : null; // portal pages enforce ownership again on open
  if (!a.tenantId) return url;
  const perm = n.entityType ? ENTITY_PERMISSION[n.entityType] : undefined; if (perm && !a.permissions.has(perm)) return null;
  const model = n.entityType ? ENTITY_MODEL[n.entityType] : undefined;
  if (model && n.entityId) { const delegate = (db as unknown as Record<string, { findFirst: (x: unknown) => Promise<unknown> }>)[model]; const row = await delegate.findFirst({ where: { id: n.entityId, tenantId: a.tenantId }, select: { id: true } }); if (!row) return null; }
  return url;
}
export async function getNotification(a: Actor, id: string, opts: { markRead?: boolean } = {}) {
  const now = new Date(); const n = await db.notification.findFirst({ where: { id, ...mine(a, now) } });
  if (!n) throw new AppError("NOT_FOUND", { message: "Notification not found." });
  if (opts.markRead && !n.readAt) { await db.notification.updateMany({ where: { id, userId: a.userId, readAt: null }, data: { readAt: now } }); n.readAt = now; }
  const row = toRow(n, now, a.kind === "STAFF"); const link = await actionAllowed(a, n);
  // delivery status of the related external messages, straight from the Phase 11 log
  let delivery: { channel: string; label: string; status: string; at: string }[] = [];
  if (n.entityType && n.entityId && n.tenantId) {
    const msgs = await db.communicationMessage.findMany({ where: { tenantId: n.tenantId, entityType: COMM_ENTITY[n.entityType] ?? n.entityType, entityId: n.entityId, status: { notIn: ["SKIPPED", "CANCELLED"] }, ...(a.kind === "PATIENT" ? { patientId: a.patientId } : {}) }, orderBy: { createdAt: "desc" }, take: 6, select: { channel: true, eventType: true, status: true, createdAt: true } });
    const allowed = a.kind === "PATIENT" || (a.permissions.has("communications.view") && ["CLINIC_ADMIN", "RECEPTIONIST", "DOCTOR", "ACCOUNTANT", "LAB_STAFF"].includes(a.role));
    if (allowed) delivery = msgs.map((m) => ({ channel: m.channel, label: m.eventType.toLowerCase().replace(/_/g, " "), status: a.kind === "PATIENT" ? (m.status === "FAILED" ? "NOT_DELIVERED" : m.status === "READ" ? "DELIVERED" : m.status) : m.status, at: m.createdAt.toISOString() }));
  }
  const d = def(n.type);
  return { ...row, actionUrl: link, entityType: a.kind === "PATIENT" ? null : n.entityType, readAt: iso(n.readAt), acknowledgedAt: iso(n.acknowledgedAt), description: a.kind === "STAFF" ? d?.description ?? null : null, delivery, inApp: n.readAt ? "READ" : "UNREAD" };
}

/* ------------------------------------------------------ state changes ------------------------------------------------------ */
export async function markRead(a: Actor, id: string) { const r = await db.notification.updateMany({ where: { id, userId: a.userId, tenantId: a.tenantId, readAt: null }, data: { readAt: new Date() } }); return { updated: r.count }; }
async function bulkLimit(a: Actor) { const l = await rateLimit(`notif:bulk:${a.userId}`, { limit: 30, windowMs: 60_000 }); if (!l.allowed) throw new AppError("RATE_LIMITED"); }
export async function markAllRead(a: Actor, category?: string) {
  await bulkLimit(a);
  const fc = category ? FILTER_CATEGORIES.find((x) => x.key === category) : undefined;
  const r = await db.notification.updateMany({ where: { ...mine(a), readAt: null, archivedAt: null, ...(fc ? { category: { in: fc.categories } } : {}), ackRequired: false }, data: { readAt: new Date() } }); // acknowledgement-required items stay unread until acknowledged
  if (r.count) await recordAudit({ action: AUDIT_ACTIONS.NOTIFICATION_BULK, tenantId: a.tenantId, actorId: a.userId, entityType: "notification", metadata: { action: "mark_all_read", count: r.count } });
  return { updated: r.count };
}
export async function archive(a: Actor, id: string, on = true) {
  const n = await db.notification.findFirst({ where: { id, userId: a.userId, tenantId: a.tenantId }, select: { id: true, ackRequired: true, acknowledgedAt: true } }); if (!n) throw new AppError("NOT_FOUND", { message: "Notification not found." });
  if (on && n.ackRequired && !n.acknowledgedAt) throw new AppError("CONFLICT", { message: "Acknowledge this notification before archiving it." });
  await db.notification.update({ where: { id }, data: { archivedAt: on ? new Date() : null, ...(on ? { readAt: new Date() } : {}) } }); return { archived: on };
}
export async function archiveAllRead(a: Actor) {
  await bulkLimit(a);
  const r = await db.notification.updateMany({ where: { ...mine(a), readAt: { not: null }, archivedAt: null, category: { not: "SECURITY" }, OR: [{ ackRequired: false }, { acknowledgedAt: { not: null } }] }, data: { archivedAt: new Date() } });
  if (r.count) await recordAudit({ action: AUDIT_ACTIONS.NOTIFICATION_BULK, tenantId: a.tenantId, actorId: a.userId, entityType: "notification", metadata: { action: "archive_read", count: r.count } });
  return { archived: r.count };
}
export async function acknowledge(a: Actor, id: string) {
  if (a.kind === "PATIENT") throw new AppError("FORBIDDEN");
  const r = await db.notification.updateMany({ where: { id, userId: a.userId, tenantId: a.tenantId, ackRequired: true, acknowledgedAt: null }, data: { acknowledgedAt: new Date(), acknowledgedById: a.userId, readAt: new Date() } });
  if (r.count !== 1) throw new AppError("CONFLICT", { message: "This notification doesn't need acknowledging, or you already did." });
  await recordAudit({ action: AUDIT_ACTIONS.NOTIFICATION_ACKNOWLEDGED, tenantId: a.tenantId, actorId: a.userId, entityType: "notification", entityId: id }); return { acknowledged: true };
}

/* ------------------------------------------------------ personal preferences ------------------------------------------------------ */
const LOCKED = new Set<NCategory>(["SECURITY"]);
export async function getPreferences(a: Actor) {
  if (a.kind === "PATIENT") throw new AppError("FORBIDDEN", { message: "Patients manage notification choices under Settings." });
  const [rows, us] = await Promise.all([db.notificationPreference.findMany({ where: { userId: a.userId } }), db.notificationUserSettings.findUnique({ where: { userId: a.userId } })]);
  const off = new Map(rows.map((r) => [r.category, r.inApp]));
  return { categories: CATEGORIES.filter((c) => c !== "GENERAL").map((c) => ({ key: c, label: CATEGORY_LABEL[c], inApp: LOCKED.has(c) ? true : off.get(c) ?? true, locked: LOCKED.has(c) })), channels: { inApp: true, email: false, whatsapp: false, sms: false, note: "Staff notifications are in-app. WhatsApp, SMS and email are used for patient messages (Phase 11); they are not sent to staff." },
    quiet: { enabled: !!us?.quietEnabled, startMin: us?.quietStartMin ?? 1320, endMin: us?.quietEndMin ?? 480 }, digestEnabled: !!us?.digestEnabled, quietNote: "Low and normal notifications wait until quiet hours end. High, urgent, critical and security notifications are never held." };
}
export async function savePreferences(a: Actor, raw: unknown) {
  if (a.kind === "PATIENT") throw new AppError("FORBIDDEN");
  const v = parseOrThrow(prefsSchema, raw);
  for (const [cat, on] of Object.entries(v.categories ?? {})) { if (LOCKED.has(cat as NCategory) && !on) throw new AppError("FORBIDDEN", { message: "Security notifications can't be switched off.", fieldErrors: { [cat]: "Security notifications can't be switched off." } }); await db.notificationPreference.upsert({ where: { userId_category: { userId: a.userId, category: cat } }, update: { inApp: on }, create: { userId: a.userId, tenantId: a.tenantId, category: cat, inApp: on } }); }
  if (v.quietEnabled !== undefined || v.quietStartMin !== undefined || v.quietEndMin !== undefined || v.digestEnabled !== undefined) { const data = { ...(v.quietEnabled !== undefined ? { quietEnabled: v.quietEnabled } : {}), ...(v.quietStartMin !== undefined ? { quietStartMin: v.quietStartMin } : {}), ...(v.quietEndMin !== undefined ? { quietEndMin: v.quietEndMin } : {}), ...(v.digestEnabled !== undefined ? { digestEnabled: v.digestEnabled } : {}) }; await db.notificationUserSettings.upsert({ where: { userId: a.userId }, update: data, create: { userId: a.userId, tenantId: a.tenantId, ...data } }); }
  await recordAudit({ action: AUDIT_ACTIONS.NOTIFICATION_PREFS_CHANGED, tenantId: a.tenantId, actorId: a.userId, entityType: "notification_preferences", entityId: a.userId, metadata: { categories: Object.keys(v.categories ?? {}), quiet: v.quietEnabled, digest: v.digestEnabled } });
  return getPreferences(a);
}

/* ------------------------------------------------------ clinic rules (admin) ------------------------------------------------------ */
function adminGuard(ctx: RequestContext) { if (ctx.user.role === "SUPER_ADMIN" || !ctx.user.tenantId || !ctx.permissions.has("notifications.configure")) throw new AppError("FORBIDDEN"); return ctx.user.tenantId; }
export async function getRules(ctx: RequestContext) {
  if (ctx.user.role === "SUPER_ADMIN" || !ctx.user.tenantId || !(ctx.permissions.has("notifications.configure"))) throw new AppError("FORBIDDEN");
  const tenantId = ctx.user.tenantId; const [rows, settings] = await Promise.all([db.notificationRule.findMany({ where: { tenantId } }), db.notificationSettings.findUnique({ where: { tenantId } })]);
  const by = new Map(rows.map((r) => [r.type, r]));
  return {
    rules: TYPE_KEYS.map((k) => { const d = TYPES[k] as ReturnType<typeof def> & object; const r = by.get(k); return { type: k, label: d.label, description: d.description, category: d.category, for: d.for, hasExternal: !!d.comm, default: { enabled: d.defaultOn, priority: d.priority, audience: [...d.audience], ackRequired: !!d.ack },
      enabled: r ? r.enabled : d.defaultOn, inApp: r ? r.inApp : true, roles: r ? parse<string[]>(r.roles, []) : [], priority: r?.priority ?? null, ackRequired: r?.ackRequired ?? null, escalateAfterMin: r?.escalateAfterMin ?? null, externalChannels: r?.externalChannels ? parse<string[]>(r.externalChannels, []) : null, customised: !!r }; }),
    settings: { retentionEnabled: !!settings?.retentionEnabled, archiveReadAfterDays: settings?.archiveReadAfterDays ?? 30, expireAfterDays: settings?.expireAfterDays ?? 180, lowStockCheck: settings?.lowStockCheck ?? true },
  };
}
export async function saveRule(ctx: RequestContext, raw: unknown) {
  const tenantId = adminGuard(ctx); const v = parseOrThrow(ruleSchema, raw); const d = TYPES[v.type as NType] as ReturnType<typeof def> & object;
  const lock = (d.category === "SECURITY" || d.priority === "CRITICAL");
  if (lock && (!v.enabled || !v.inApp)) throw new AppError("FORBIDDEN", { message: "Security and critical notifications can't be switched off.", fieldErrors: { enabled: "Security and critical notifications can't be switched off." } });
  if (v.priority && PRIORITY_RANK[v.priority] < PRIORITY_RANK[d.priority] && lock) throw new AppError("FORBIDDEN", { message: "The priority of security notifications can't be lowered." });
  if (v.externalChannels && !d.comm) throw new AppError("VALIDATION_ERROR", { message: "This notification has no WhatsApp / SMS / email delivery.", fieldErrors: { externalChannels: "Not available for this notification." } });
  const roles = (v.roles ?? []).filter((r) => !(r === "@self" && d.category !== "SECURITY"));
  const data = { enabled: v.enabled, inApp: v.inApp, roles: JSON.stringify(roles), priority: v.priority ?? null, ackRequired: v.ackRequired ?? null, escalateAfterMin: v.escalateAfterMin ?? null, externalChannels: v.externalChannels ? JSON.stringify(v.externalChannels) : null };
  const before = await loadRule(tenantId, v.type as NType);
  await db.notificationRule.upsert({ where: { tenantId_type: { tenantId, type: v.type } }, update: data, create: { tenantId, type: v.type, ...data } });
  await recordAudit({ action: AUDIT_ACTIONS.NOTIFICATION_RULE_CHANGED, tenantId, actorId: ctx.user.id, entityType: "notification_rule", entityId: v.type, metadata: { type: v.type, enabled: v.enabled, inApp: v.inApp, priority: v.priority ?? null, ack: v.ackRequired ?? null, escalate: v.escalateAfterMin ?? null, external: v.externalChannels ?? null, wasCustom: !!before } });
  return { saved: true };
}
export async function resetRule(ctx: RequestContext, type: string) { const tenantId = adminGuard(ctx); if (!(TYPE_KEYS as string[]).includes(type)) throw new AppError("NOT_FOUND"); await db.notificationRule.deleteMany({ where: { tenantId, type } }); await recordAudit({ action: AUDIT_ACTIONS.NOTIFICATION_RULE_CHANGED, tenantId, actorId: ctx.user.id, entityType: "notification_rule", entityId: type, metadata: { type, reset: true } }); return { reset: true }; }
export async function saveSettings(ctx: RequestContext, raw: unknown) {
  const tenantId = adminGuard(ctx); const v = parseOrThrow(settingsSchema, raw);
  await db.notificationSettings.upsert({ where: { tenantId }, update: v, create: { tenantId, ...v } });
  await recordAudit({ action: AUDIT_ACTIONS.NOTIFICATION_SETTINGS_CHANGED, tenantId, actorId: ctx.user.id, entityType: "notification_settings", entityId: tenantId, metadata: { retention: v.retentionEnabled, archiveDays: v.archiveReadAfterDays, expireDays: v.expireAfterDays } });
  return v;
}

/* ------------------------------------------------------ today's summary (real numbers) ------------------------------------------------------ */
export async function todaySummary(ctx: RequestContext) {
  const tenantId = ctx.user.tenantId; if (!tenantId || ctx.user.role === "SUPER_ADMIN") return null;
  const tz = await tenantTimezone(tenantId); const today = todayIn(tz); const { start, end } = dayRangeUtc(today, tz); const own = ctx.user.role === "DOCTOR";
  const [appts, followUps, reports] = await Promise.all([
    ctx.permissions.has("appointments.view") ? db.appointment.count({ where: { tenantId, startsAt: { gte: start, lt: end }, status: { notIn: ["CANCELLED", "NO_SHOW"] }, ...(own ? { doctorUserId: ctx.user.id } : {}) } }) : null,
    ctx.permissions.has("followups.view") ? db.followUp.count({ where: { tenantId, dueDate: today, status: { in: ["PENDING", "DUE", "IN_PROGRESS", "CONTACTED"] }, ...(own ? { doctorUserId: ctx.user.id } : {}) } }) : null,
    own && ctx.permissions.has("reports.view") ? db.labReport.count({ where: { tenantId, doctorUserId: ctx.user.id, currentVersion: { gt: 0 }, order: { is: { status: { not: "DOCTOR_REVIEWED" } } } } }) : null,
  ]);
  return { date: today, appointments: appts, followUpsDue: followUps, reportsToReview: reports };
}
