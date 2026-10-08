import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import type { RequestContext } from "@/lib/auth/context";
import { TIMEZONES } from "@/lib/domain/constants";
import { AppError } from "@/lib/errors";
import { FEATURE_KEYS } from "@/lib/platform/features";
import { CATEGORIES_LIST, categoryOf, prefixesOfCategory, severityOf } from "@/lib/platform/audit-class";
import { DEFAULT_MAINTENANCE, SUPPORT_ACCESS_MS, SUPER_ADMIN_SESSION_MS, getPlatformSetting, invalidatePlatformSetting, type Maintenance } from "@/lib/platform/runtime";
import { ALL_PERMISSIONS, GRANTABLE_PERMISSIONS, NON_GRANTABLE_PERMISSIONS, PERMISSIONS, ROLES, ROLE_PERMISSIONS, TENANT_ASSIGNABLE_ROLES, type Permission, type RoleKey } from "@/lib/permissions";
import { cleanNotes, clamp, findClinic, guard, requireReason, stepUp } from "./platform-core";
import { containsCI, pageParams } from "./shared";

/* ---------------------------------------------------------------- audit center ---------------------------------------------------------------- */
export interface AuditFilter { actorId?: string; tenantId?: string; action?: string; category?: string; severity?: string; from?: string; to?: string; entityType?: string; entityId?: string; page?: number }
const SEV_ACTIONS: Record<string, string[]> = {
  high: ["clinic.status_changed", "platform.support_started", "platform.admin_changed", "platform.user_role_changed", "platform.feature_changed", "auth.login_failed", "user.disabled", "platform.settings_changed", "platform.maintenance_changed", "platform.user_status_changed", "platform.reauth_failed"],
  notice: ["clinic.created", "clinic.updated", "domain.updated", "domain.verified", "tenant.entered", "tenant.exited", "user.invited", "platform.branding_changed", "platform.announcement_saved", "platform.clinic_config_changed", "platform.domain_checked", "platform.access_reset", "platform.support_ended"],
};
const dateOk = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
export async function auditCenter(ctx: RequestContext, f: AuditFilter) {
  guard(ctx); const { skip, take, page } = pageParams(f.page, 30);
  const and: Record<string, unknown>[] = [];
  if (f.actorId) and.push({ actorId: f.actorId }); if (f.tenantId) and.push({ tenantId: f.tenantId }); if (f.entityType) and.push({ entityType: f.entityType }); if (f.entityId) and.push({ entityId: f.entityId });
  if (f.action) and.push({ action: { startsWith: f.action } });
  if (f.category && CATEGORIES_LIST.includes(f.category)) { const pre = prefixesOfCategory(f.category); if (pre.length) and.push({ OR: pre.map((p) => ({ action: { startsWith: p } })) }); }
  if (f.severity === "high") and.push({ action: { in: SEV_ACTIONS.high } }); else if (f.severity === "notice") and.push({ action: { in: SEV_ACTIONS.notice } }); else if (f.severity === "info") and.push({ action: { notIn: [...SEV_ACTIONS.high, ...SEV_ACTIONS.notice] } });
  if (dateOk(f.from)) and.push({ createdAt: { gte: new Date(`${f.from}T00:00:00Z`) } }); if (dateOk(f.to)) and.push({ createdAt: { lt: new Date(Date.parse(`${f.to}T00:00:00Z`) + 86_400_000) } });
  const where = and.length ? { AND: and } : {};
  const [total, rows] = await Promise.all([db.auditLog.count({ where }), db.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip, take })]);
  const people = new Map((await db.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.actorId).filter((x): x is string => !!x))] } }, select: { id: true, name: true, role: { select: { key: true } } } })).map((u) => [u.id, u]));
  const clinics = new Map((await db.tenant.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.tenantId).filter((x): x is string => !!x))] } }, select: { id: true, name: true } })).map((t) => [t.id, t.name]));
  return { total, page, pageSize: take, categories: CATEGORIES_LIST, rows: rows.map((r) => shapeAudit(r, people, clinics)) };
}
function shapeAudit(r: { id: string; action: string; tenantId: string | null; actorId: string | null; entityType: string | null; entityId: string | null; metadata: string | null; ip: string | null; userAgent: string | null; createdAt: Date }, people: Map<string, { name: string; role: { key: string } }>, clinics: Map<string, string>) {
  let meta: Record<string, unknown> | null = null; try { meta = r.metadata ? JSON.parse(r.metadata) : null; } catch { meta = null; }
  const a = r.actorId ? people.get(r.actorId) : undefined;
  return { id: r.id, at: r.createdAt, action: r.action, category: categoryOf(r.action), severity: severityOf(r.action), actor: a?.name ?? (r.actorId ? "Unknown user" : "System"), actorRole: a?.role.key ?? null, actorId: r.actorId, clinic: r.tenantId ? clinics.get(r.tenantId) ?? "—" : "Platform", clinicId: r.tenantId, entityType: r.entityType, entityId: r.entityId, ip: r.ip, device: r.userAgent ? r.userAgent.slice(0, 160) : null, before: (meta?.before as unknown) ?? null, after: (meta?.after as unknown) ?? null, metadata: meta };
}
export async function auditEntry(ctx: RequestContext, id: string) {
  guard(ctx); const r = await db.auditLog.findUnique({ where: { id } }); if (!r) throw new AppError("NOT_FOUND");
  const [people, clinics] = await Promise.all([db.user.findMany({ where: { id: r.actorId ?? "" }, select: { id: true, name: true, role: { select: { key: true } } } }), db.tenant.findMany({ where: { id: r.tenantId ?? "" }, select: { id: true, name: true } })]);
  return shapeAudit(r, new Map(people.map((u) => [u.id, u])), new Map(clinics.map((t) => [t.id, t.name])));
}

/* ------------------------------------------------------------------ settings ------------------------------------------------------------------ */
export interface PlatformDefaults { timezone: string; locale: string; currency: string; dateFormat: string; reminderOffsets: number[]; featureDefaults: Record<string, boolean> }
export const DEFAULT_DEFAULTS: PlatformDefaults = { timezone: "Asia/Kolkata", locale: "en-IN", currency: "INR", dateFormat: "DD/MM/YYYY", reminderOffsets: [1440], featureDefaults: {} };
const defaultsSchema = z.object({
  timezone: z.enum(TIMEZONES), locale: z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/), currency: z.string().regex(/^[A-Z]{3}$/), dateFormat: z.enum(["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"]),
  reminderOffsets: z.array(z.number().int().min(15).max(10080)).min(1).max(4), featureDefaults: z.partialRecord(z.enum(FEATURE_KEYS as [string, ...string[]]), z.boolean()),
}).partial().strict();
export const getDefaults = () => getPlatformSetting<PlatformDefaults>("defaults", DEFAULT_DEFAULTS);
export const SECURITY_POSTURE = [
  { label: "Staff session length", value: "8 hours (absolute)" }, { label: "Platform admin session length", value: `${SUPER_ADMIN_SESSION_MS / 3_600_000} hours (absolute)` }, { label: "Failed sign-ins before lockout", value: "5 attempts → 15 minute lock" },
  { label: "Sensitive Super Admin actions", value: "Re-enter your password; 5 wrong tries pause confirmations for 15 minutes" }, { label: "Support access to a clinic", value: `Reason required, ${SUPPORT_ACCESS_MS / 60_000} minutes, audited, visible banner` },
  { label: "State-changing requests", value: "Same-origin (CSRF) check" }, { label: "Multi-factor authentication", value: "Not available yet" }, { label: "Platform API keys / clinic API access", value: "Not implemented — none exist to manage" },
];
export async function platformSettings(ctx: RequestContext) {
  guard(ctx);
  const [defaults, maintenance, hb] = await Promise.all([getDefaults(), getPlatformSetting<Maintenance>("maintenance", DEFAULT_MAINTENANCE), db.platformSetting.findUnique({ where: { key: "defaults" }, select: { updatedAt: true } })]);
  return { defaults, maintenance, defaultsUpdatedAt: hb?.updatedAt ?? null, security: SECURITY_POSTURE, hierarchy: "Platform default → clinic setting → user preference. A clinic or user value always wins where one exists." };
}
export async function updateDefaults(ctx: RequestContext, raw: unknown) {
  guard(ctx); const p = defaultsSchema.safeParse(raw);
  if (!p.success) throw new AppError("VALIDATION_ERROR", { message: "One of the defaults is not valid.", fieldErrors: Object.fromEntries(p.error.issues.map((i) => [String(i.path[0]), i.message])) });
  const before = await getDefaults(); const next = { ...before, ...p.data, featureDefaults: p.data.featureDefaults ? { ...before.featureDefaults, ...p.data.featureDefaults } : before.featureDefaults };
  await db.platformSetting.upsert({ where: { key: "defaults" }, update: { value: JSON.stringify(next), updatedById: ctx.user.id }, create: { key: "defaults", value: JSON.stringify(next), updatedById: ctx.user.id } });
  invalidatePlatformSetting("defaults");
  await recordAudit({ action: AUDIT_ACTIONS.PLATFORM_SETTINGS_CHANGED, tenantId: null, actorId: ctx.user.id, entityType: "platform_settings", entityId: "defaults", metadata: { fields: Object.keys(p.data), before: Object.fromEntries(Object.keys(p.data).map((k) => [k, (before as unknown as Record<string, unknown>)[k]])), after: p.data } });
  return { saved: true, defaults: next };
}
export async function setGlobalMaintenance(ctx: RequestContext, input: { enabled: boolean; message?: string; password?: string }) {
  guard(ctx); if (typeof input.enabled !== "boolean") throw new AppError("VALIDATION_ERROR", { message: "Choose on or off." });
  await stepUp(ctx, input.password, "platform.maintenance");
  const value: Maintenance = { enabled: input.enabled, message: cleanNotes(input.message, 300) || DEFAULT_MAINTENANCE.message };
  await db.platformSetting.upsert({ where: { key: "maintenance" }, update: { value: JSON.stringify(value), updatedById: ctx.user.id }, create: { key: "maintenance", value: JSON.stringify(value), updatedById: ctx.user.id } });
  invalidatePlatformSetting("maintenance");
  await recordAudit({ action: AUDIT_ACTIONS.PLATFORM_MAINTENANCE_CHANGED, tenantId: null, actorId: ctx.user.id, entityType: "platform_settings", entityId: "maintenance", metadata: { enabled: input.enabled } });
  return value;
}

/* ---------------------------------------------------------------- announcements ---------------------------------------------------------------- */
const annSchema = z.object({ id: z.string().optional(), title: z.string().trim().min(3).max(120), body: z.string().trim().min(3).max(600), audience: z.enum(["ALL", "ADMINS", "SELECTED"]), tenantIds: z.array(z.string().max(40)).max(200).default([]), startsAt: z.string().optional(), endsAt: z.string().nullable().optional(), active: z.boolean().default(true) });
export async function saveAnnouncement(ctx: RequestContext, raw: unknown) {
  guard(ctx); const p = annSchema.safeParse(raw);
  if (!p.success) throw new AppError("VALIDATION_ERROR", { message: p.error.issues[0]?.message ?? "Check the announcement.", fieldErrors: Object.fromEntries(p.error.issues.map((i) => [String(i.path[0]), i.message])) });
  const a = p.data; let tenantIds: string[] = [];
  if (a.audience === "SELECTED") { tenantIds = (await db.tenant.findMany({ where: { id: { in: a.tenantIds }, deletedAt: null }, select: { id: true } })).map((t) => t.id); if (!tenantIds.length) throw new AppError("VALIDATION_ERROR", { message: "Choose at least one clinic.", fieldErrors: { tenantIds: "Choose at least one clinic." } }); }
  const startsAt = a.startsAt && !Number.isNaN(Date.parse(a.startsAt)) ? new Date(a.startsAt) : new Date(); const endsAt = a.endsAt && !Number.isNaN(Date.parse(a.endsAt)) ? new Date(a.endsAt) : null;
  if (endsAt && endsAt <= startsAt) throw new AppError("VALIDATION_ERROR", { message: "The end time must be after the start.", fieldErrors: { endsAt: "The end time must be after the start." } });
  const data = { title: a.title, body: a.body, audience: a.audience, audienceTenants: JSON.stringify(tenantIds), startsAt, endsAt, active: a.active };
  let id = a.id;
  if (id) { const r = await db.platformAnnouncement.updateMany({ where: { id }, data }); if (!r.count) throw new AppError("NOT_FOUND"); } else id = (await db.platformAnnouncement.create({ data: { ...data, createdById: ctx.user.id }, select: { id: true } })).id;
  await recordAudit({ action: AUDIT_ACTIONS.PLATFORM_ANNOUNCEMENT_SAVED, tenantId: null, actorId: ctx.user.id, entityType: "announcement", entityId: id, metadata: { audience: a.audience, active: a.active, clinics: tenantIds.length } });
  return { id };
}
export async function listAnnouncements(ctx: RequestContext) { guard(ctx); return (await db.platformAnnouncement.findMany({ orderBy: { createdAt: "desc" }, take: 50 })).map((a) => ({ ...a, audienceTenants: JSON.parse(a.audienceTenants || "[]") as string[] })); }
/** Announcements a signed-in user should see right now. Audience is decided from the SERVER-side context only. */
export async function announcementsFor(ctx: RequestContext) {
  if (!ctx.tenant || ctx.user.role === "SUPER_ADMIN" || ctx.user.role === "PATIENT") return [];
  const now = new Date(); const rows = await db.platformAnnouncement.findMany({ where: { active: true, startsAt: { lte: now }, OR: [{ endsAt: null }, { endsAt: { gt: now } }] }, orderBy: { startsAt: "desc" }, take: 5 });
  return rows.filter((a) => a.audience === "ALL" || (a.audience === "ADMINS" && ctx.user.role === "CLINIC_ADMIN") || (a.audience === "SELECTED" && (JSON.parse(a.audienceTenants || "[]") as string[]).includes(ctx.tenant!.id))).map((a) => ({ id: a.id, title: a.title, body: a.body }));
}

/* ---------------------------------------------------------------- support access ---------------------------------------------------------------- */
export async function startSupportAccess(ctx: RequestContext, tenantId: string, input: { reason?: string; password?: string }) {
  guard(ctx); const t = await findClinic(tenantId); const reason = requireReason(input.reason, 10); await stepUp(ctx, input.password, "support.start");
  await db.supportAccess.updateMany({ where: { actorId: ctx.user.id, endedAt: null }, data: { endedAt: new Date() } }); // one open visit per Super Admin
  const row = await db.supportAccess.create({ data: { tenantId, actorId: ctx.user.id, reason, expiresAt: new Date(Date.now() + SUPPORT_ACCESS_MS) } });
  await recordAudit({ action: AUDIT_ACTIONS.PLATFORM_SUPPORT_STARTED, tenantId, actorId: ctx.user.id, entityType: "support_access", entityId: row.id, metadata: { expiresAt: row.expiresAt.toISOString(), clinicStatus: t.status } });
  await recordAudit({ action: AUDIT_ACTIONS.TENANT_ENTERED, tenantId, actorId: ctx.user.id, entityType: "tenant", entityId: tenantId });
  return { id: row.id, expiresAt: row.expiresAt };
}
export async function endSupportAccess(ctx: RequestContext) {
  guard(ctx); const open = await db.supportAccess.findMany({ where: { actorId: ctx.user.id, endedAt: null } });
  for (const o of open) { await db.supportAccess.update({ where: { id: o.id }, data: { endedAt: new Date() } }); await recordAudit({ action: AUDIT_ACTIONS.PLATFORM_SUPPORT_ENDED, tenantId: o.tenantId, actorId: ctx.user.id, entityType: "support_access", entityId: o.id, metadata: { minutes: Math.round((Date.now() - o.startedAt.getTime()) / 60000) } }); await recordAudit({ action: AUDIT_ACTIONS.TENANT_EXITED, tenantId: o.tenantId, actorId: ctx.user.id, entityType: "tenant", entityId: o.tenantId }); }
  return { ended: open.length };
}
export async function listSupportAccess(ctx: RequestContext, tenantId?: string) {
  guard(ctx); const rows = await db.supportAccess.findMany({ where: tenantId ? { tenantId } : {}, orderBy: { startedAt: "desc" }, take: 25 });
  const people = new Map((await db.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.actorId))] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const clinics = new Map((await db.tenant.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.tenantId))] } }, select: { id: true, name: true } })).map((t) => [t.id, t.name]));
  return rows.map((r) => ({ id: r.id, clinicId: r.tenantId, clinic: clinics.get(r.tenantId) ?? "—", by: people.get(r.actorId) ?? "—", reason: r.reason, startedAt: r.startedAt, expiresAt: r.expiresAt, endedAt: r.endedAt, open: !r.endedAt && r.expiresAt > new Date() }));
}

/* ------------------------------------------------------------ roles & permissions (read-only) ------------------------------------------------------------ */
export function rolesOverview(ctx: RequestContext) {
  guard(ctx);
  const modules = [...new Set(ALL_PERMISSIONS.map((p) => PERMISSIONS[p].module))].sort();
  const label = (r: string) => r.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
  return {
    roles: ROLES.map((r) => ({ key: r as RoleKey, label: label(r), assignable: (TENANT_ASSIGNABLE_ROLES as readonly string[]).includes(r), permissionCount: ROLE_PERMISSIONS[r].length, byModule: Object.fromEntries(modules.map((m) => [m, ROLE_PERMISSIONS[r].filter((p) => PERMISSIONS[p].module === m).length])) })),
    modules, permissions: ALL_PERMISSIONS.map((p: Permission) => ({ key: p, module: PERMISSIONS[p].module, description: PERMISSIONS[p].description, grantable: (GRANTABLE_PERMISSIONS as readonly string[]).includes(p), roles: ROLES.filter((r) => ROLE_PERMISSIONS[r].includes(p)) })),
    nonGrantable: NON_GRANTABLE_PERMISSIONS.length,
    protections: ["SUPER_ADMIN and PATIENT can never be assigned to a clinic user.", "A clinic admin can only extend a user with grantable permissions; sensitive ones (users, audit, settings, billing configuration…) are role-only.", "Roles are defined in code, so they cannot be edited at run time; this prevents a role identifier from being renamed or weakened by accident."],
  };
}

/* --------------------------------------------------------------------- search --------------------------------------------------------------------- */
/** Clinics, people (account details only), domains. There is deliberately NO patient search here. */
export async function adminSearch(ctx: RequestContext, q: string) {
  guard(ctx); const term = cleanNotes(q, 80); if (term.length < 2) return { clinics: [], users: [], domains: [] };
  const [clinics, users, domains] = await Promise.all([
    db.tenant.findMany({ where: { deletedAt: null, OR: [{ id: term }, { name: containsCI(term) }, { slug: containsCI(term) }] }, take: 5, select: { id: true, name: true, status: true } }),
    db.user.findMany({ where: { deletedAt: null, role: { key: { notIn: ["PATIENT"] } }, OR: [{ name: containsCI(term) }, { email: containsCI(term) }] }, take: 5, select: { id: true, name: true, email: true, tenantId: true, role: { select: { key: true } } } }),
    db.tenant.findMany({ where: { deletedAt: null, OR: [{ customDomain: containsCI(term) }, { subdomain: containsCI(term) }] }, take: 5, select: { id: true, name: true, subdomain: true, customDomain: true, customDomainStatus: true } }),
  ]);
  return { clinics, users: users.map((u) => ({ id: u.id, name: u.name, email: u.email, clinicId: u.tenantId, role: u.role.key })), domains };
}
export { clamp };
