import "server-only";
import dns from "node:dns/promises";
import { db } from "@/lib/db";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import type { RequestContext } from "@/lib/auth/context";
import { getEnv } from "@/lib/env";
import { TENANT_STATUSES } from "@/lib/domain/constants";
import { AppError } from "@/lib/errors";
import { FEATURES, applyFeatureGates, isFeatureKey } from "@/lib/platform/features";
import { isClaimableHost, newDomainToken, txtMatches, txtRecordName, txtRecordValue } from "@/lib/platform/domain";
import { REASON_CATEGORIES, planTransition, setupChecklist, type SetupFacts } from "@/lib/platform/lifecycle";
import { limitsSchema, parseJson, retentionSchema, type Limits, type Retention } from "@/lib/platform/limits";
import { disabledFeaturesOf } from "@/lib/platform/runtime";
import { brandContrastIssues } from "@/theme/contrast";
import { resolveBrandColors } from "@/theme/tokens";
import { brandingSchema, hostname } from "@/lib/validation/clinic";
import { TENANT_ASSIGNABLE_ROLES } from "@/lib/permissions";
import { channelEnabled, toSettings } from "@/lib/communications/settings";
import { configuredProvider } from "@/lib/communications/providers/registry";
import { CHANNELS } from "@/lib/communications/catalog";
import { cleanNotes, clamp, findClinic, guard, requireReason, stepUp } from "./platform-core";
import { containsCI, pageParams } from "./shared";

/** Super Admin clinic management: list, lifecycle, branding, domains, features, configuration, usage, health. Always through `guard` (SUPER_ADMIN + platform.manage). */
const SUBSCRIPTION_FOR: Record<string, string> = { ACTIVE: "ACTIVE", TRIAL: "TRIAL" };

/* ---------------------------------------------------------------- list ---------------------------------------------------------------- */
export interface ClinicListFilter { q?: string; status?: string; type?: string; page?: number; sort?: string; includeArchived?: boolean }
export async function listClinicsAdmin(ctx: RequestContext, f: ClinicListFilter) {
  guard(ctx);
  const { skip, take, page } = pageParams(f.page, 20);
  const statusOk = f.status && f.status in TENANT_STATUSES ? f.status : undefined;
  const where = {
    deletedAt: null,
    ...(statusOk ? { status: statusOk } : f.includeArchived ? {} : { status: { not: "ARCHIVED" } }),
    ...(f.type ? { clinicType: f.type } : {}),
    ...(f.q ? { OR: [{ id: f.q }, { name: containsCI(f.q) }, { slug: containsCI(f.q) }, { customDomain: containsCI(f.q) }, { subdomain: containsCI(f.q) }, { contactEmail: containsCI(f.q) }] } : {}),
  };
  const orderBy = f.sort === "name" ? { name: "asc" as const } : f.sort === "status" ? { status: "asc" as const } : { createdAt: "desc" as const };
  const [total, rows] = await Promise.all([db.tenant.count({ where }), db.tenant.findMany({ where, orderBy, skip, take })]);
  const ids = rows.map((r) => r.id);
  const [roles, userGroups, patientGroups, activity, admins] = ids.length ? await Promise.all([
    db.role.findMany({ where: { tenantId: null }, select: { id: true, key: true } }),
    db.user.groupBy({ by: ["tenantId", "roleId"], where: { tenantId: { in: ids }, deletedAt: null }, _count: { _all: true } }),
    db.patient.groupBy({ by: ["tenantId"], where: { tenantId: { in: ids }, deletedAt: null }, _count: { _all: true } }),
    db.user.groupBy({ by: ["tenantId"], where: { tenantId: { in: ids }, deletedAt: null }, _max: { lastLoginAt: true } }),
    db.user.findMany({ where: { tenantId: { in: ids }, deletedAt: null, role: { key: "CLINIC_ADMIN" } }, orderBy: { createdAt: "asc" }, select: { tenantId: true, name: true, status: true } }),
  ]) : [[], [], [], [], []] as never[];
  const key = new Map((roles as { id: string; key: string }[]).map((r) => [r.id, r.key]));
  return {
    total, page, pageSize: take,
    rows: rows.map((t) => {
      const ug = (userGroups as { tenantId: string; roleId: string; _count: { _all: number } }[]).filter((u) => u.tenantId === t.id);
      const n = (pred: (k: string) => boolean) => ug.filter((u) => pred(key.get(u.roleId) ?? "")).reduce((a, u) => a + u._count._all, 0);
      const doctorsN = n((k) => k === "DOCTOR"); const staffN = n((k) => k !== "DOCTOR" && k !== "PATIENT" && k !== "SUPER_ADMIN");
      const adminName = (admins as { tenantId: string; name: string; status: string }[]).find((a) => a.tenantId === t.id && a.status === "ACTIVE")?.name ?? (admins as { tenantId: string; name: string }[]).find((a) => a.tenantId === t.id)?.name ?? null;
      return {
        id: t.id, name: t.name, slug: t.slug, clinicType: t.clinicType, status: t.status, isDemo: t.isDemo, createdAt: t.createdAt,
        userCount: doctorsN + staffN, owner: adminName,
        domain: t.customDomainVerifiedAt && t.customDomain ? t.customDomain : t.subdomain, doctors: doctorsN, staff: staffN,
        patients: (patientGroups as { tenantId: string; _count: { _all: number } }[]).find((p) => p.tenantId === t.id)?._count._all ?? 0,
        lastActivity: (activity as { tenantId: string; _max: { lastLoginAt: Date | null } }[]).find((a) => a.tenantId === t.id)?._max.lastLoginAt ?? null,
        admin: adminName,
      };
    }),
  };
}

/* ------------------------------------------------------------ setup + health ------------------------------------------------------------ */
export async function setupFactsOf(tenantId: string): Promise<SetupFacts> {
  const t = await findClinic(tenantId);
  const [brand, admins, doctors, schedules, comm, portal] = await Promise.all([
    db.tenantBranding.findUnique({ where: { tenantId } }),
    db.user.count({ where: { tenantId, deletedAt: null, status: "ACTIVE", role: { key: "CLINIC_ADMIN" } } }),
    db.user.count({ where: { tenantId, deletedAt: null, status: { not: "DISABLED" }, role: { key: "DOCTOR" } } }),
    db.doctorSchedule.count({ where: { tenantId } }),
    db.communicationSettings.findUnique({ where: { tenantId } }),
    db.portalSettings.findFirst({ where: { tenantId }, select: { enabled: true } }),
  ]);
  const off = await disabledFeaturesOf(tenantId); const cs = toSettings(comm);
  const usable = CHANNELS.some((c) => channelEnabled(cs, c) && !!configuredProvider(c) && !off.includes(c.toLowerCase()));
  return {
    name: t.name, clinicType: t.clinicType, contactEmail: t.contactEmail, contactPhone: t.contactPhone, timezone: t.timezone, activeAdmins: admins,
    hasLogo: !!brand?.logoUrl, hasBrandColors: !!(brand?.primaryColor && brand?.secondaryColor && brand?.accentColor), subdomain: t.subdomain, customDomain: t.customDomain,
    customDomainVerified: !!t.customDomainVerifiedAt && t.customDomainStatus === "VERIFIED", doctors, schedules, anyChannelUsable: usable, portalEnabled: portal ? portal.enabled : false, websiteEnabled: t.websiteEnabled,
  };
}
export async function clinicSetup(ctx: RequestContext, id: string) { guard(ctx); return setupChecklist(await setupFactsOf(id)); }

export async function clinicUsage(ctx: RequestContext, id: string) {
  guard(ctx); await findClinic(id);
  const since30 = new Date(Date.now() - 30 * 86_400_000);
  const [users, doctors, patients, appts30, apptsAll, consultations, labOrders, invoices, dispensings, msgs30, assets] = await Promise.all([
    db.user.count({ where: { tenantId: id, deletedAt: null, role: { key: { notIn: ["PATIENT", "SUPER_ADMIN"] } } } }),
    db.user.count({ where: { tenantId: id, deletedAt: null, role: { key: "DOCTOR" } } }),
    db.patient.count({ where: { tenantId: id, deletedAt: null } }),
    db.appointment.count({ where: { tenantId: id, startsAt: { gte: since30 } } }), db.appointment.count({ where: { tenantId: id } }),
    db.consultation.count({ where: { tenantId: id } }), db.investigationOrder.count({ where: { tenantId: id } }), db.invoice.count({ where: { tenantId: id } }), db.dispensing.count({ where: { tenantId: id } }),
    db.communicationMessage.count({ where: { tenantId: id, createdAt: { gte: since30 } } }),
    db.tenantAsset.aggregate({ where: { tenantId: id }, _sum: { size: true }, _count: { _all: true } }),
  ]);
  const cfg = await db.tenantConfig.findUnique({ where: { tenantId: id } });
  const limits = parseJson<Limits>(limitsSchema, cfg?.limits, {});
  return {
    counts: { users, doctors, patients, appointmentsLast30Days: appts30, appointmentsTotal: apptsAll, consultations, labOrders, invoices, dispensings, messagesLast30Days: msgs30 },
    storage: { brandingAssetBytes: assets._sum.size ?? 0, brandingAssets: assets._count._all, note: "Storage figures cover files stored in the database by the platform; private file contents are never read." },
    limits, limitsEnforced: false,
  };
}

export async function clinicHealth(ctx: RequestContext, id: string) {
  guard(ctx); const t = await findClinic(id);
  const now = Date.now(); const d7 = new Date(now - 7 * 86_400_000); const d30 = new Date(now - 30 * 86_400_000);
  const [last, active30, appts7, failed7, queued, setup, off, cfg] = await Promise.all([
    db.user.aggregate({ where: { tenantId: id, deletedAt: null }, _max: { lastLoginAt: true } }),
    db.user.count({ where: { tenantId: id, deletedAt: null, lastLoginAt: { gte: d30 } } }),
    db.appointment.count({ where: { tenantId: id, startsAt: { gte: d7 } } }),
    db.communicationMessage.count({ where: { tenantId: id, status: "FAILED", createdAt: { gte: d7 } } }),
    db.communicationMessage.count({ where: { tenantId: id, status: { in: ["QUEUED", "RETRYING"] } } }),
    setupFactsOf(id).then(setupChecklist), disabledFeaturesOf(id), db.tenantConfig.findUnique({ where: { tenantId: id } }),
  ]);
  const warnings: string[] = [];
  if (!["ACTIVE", "TRIAL"].includes(t.status)) warnings.push(`The clinic is ${t.status.toLowerCase()}, so nobody can use it.`);
  if (setup.items.find((i) => i.key === "admin" && !i.done)) warnings.push("There is no active Clinic Admin.");
  if (t.customDomain && t.customDomainStatus !== "VERIFIED") warnings.push(`Custom domain is ${t.customDomainStatus.toLowerCase()}.`);
  if (failed7 > 0) warnings.push(`${failed7} message(s) failed in the last 7 days.`);
  if (cfg?.maintenanceMode) warnings.push("Maintenance mode is on for this clinic.");
  if (setup.requiredMissing.length) warnings.push(`${setup.requiredMissing.length} required setup item(s) are missing.`);
  return {
    lastLoginAt: last._max.lastLoginAt, activeUsers30d: active30, appointmentsLast7Days: appts7, communication: { failedLast7Days: failed7, queued }, setup: { done: setup.done, total: setup.total, missing: setup.items.filter((i) => !i.done).map((i) => i.label) },
    disabledFeatures: off, enabledFeatures: FEATURES.filter((f) => !off.includes(f.key)).map((f) => f.key), warnings,
    note: "Aggregated figures only. Patient records are not shown here.",
  };
}

export async function whiteLabelCheck(ctx: RequestContext, id: string) {
  guard(ctx); const t = await findClinic(id);
  const [brand, comm, portal, off] = await Promise.all([db.tenantBranding.findUnique({ where: { tenantId: id } }), db.communicationSettings.findUnique({ where: { tenantId: id }, select: { senderName: true } }), db.portalSettings.findFirst({ where: { tenantId: id }, select: { enabled: true } }), disabledFeaturesOf(id)]);
  const colors = !!(brand?.primaryColor && brand?.secondaryColor && brand?.accentColor);
  const contrast = colors ? Object.keys(brandContrastIssues({ primary: brand!.primaryColor!, secondary: brand!.secondaryColor!, accent: brand!.accentColor! })).length === 0 : false;
  const domainOk = !!t.subdomain || (!!t.customDomain && t.customDomainStatus === "VERIFIED");
  const items = [
    { key: "logo", label: "Logo", ok: !!brand?.logoUrl, detail: brand?.logoUrl ? "Uploaded" : "No logo uploaded (the clinic name is shown instead)" },
    { key: "favicon", label: "Favicon", ok: !!brand?.faviconUrl, detail: brand?.faviconUrl ? "Uploaded" : "No favicon uploaded" },
    { key: "colors", label: "Colours", ok: colors && contrast, detail: !colors ? "Default platform colours" : contrast ? "Custom colours with readable contrast" : "Custom colours below the readable-contrast minimum" },
    { key: "website", label: "Public website", ok: t.websiteEnabled, detail: t.websiteEnabled ? "Enabled" : "Not enabled" },
    { key: "portal", label: "Patient portal", ok: (portal?.enabled ?? false) && !off.includes("patientPortal"), detail: off.includes("patientPortal") ? "Switched off by the platform" : portal?.enabled ? "Enabled" : "Not enabled" },
    { key: "domain", label: "Domain", ok: domainOk, detail: t.customDomain ? `Custom domain ${t.customDomainStatus.toLowerCase()}` : t.subdomain ? "Platform subdomain" : "No domain" },
    { key: "email", label: "Email branding", ok: !!comm?.senderName, detail: comm?.senderName ? `Sender name “${comm.senderName}”` : "No sender name set (the clinic name is used)" },
    { key: "notifications", label: "Notification branding", ok: colors, detail: colors ? "Uses the clinic name and colours" : "Uses platform default colours" },
  ];
  return { items, ok: items.filter((i) => i.ok).length, total: items.length, brand: resolveBrandColors(brand) };
}

/* -------------------------------------------------------------- lifecycle -------------------------------------------------------------- */
export interface LifecycleInput { action: string; category?: string; notes?: string; password?: string }
export async function changeLifecycle(ctx: RequestContext, id: string, input: LifecycleInput) {
  guard(ctx);
  const t = await findClinic(id);
  const plan = planTransition(input.action, t.status);
  if (!plan.ok) throw new AppError("CONFLICT", { message: plan.message });
  const { def, to } = plan;
  const category = (REASON_CATEGORIES as readonly string[]).includes(input.category ?? "") ? input.category! : "ADMINISTRATIVE";
  const notes = def.reasonRequired ? requireReason(input.notes, 5) : cleanNotes(input.notes);
  if (def.sensitive) await stepUp(ctx, input.password, `clinic.${input.action}`);
  if (input.action === "activate" && t.status === "PENDING") {
    const c = setupChecklist(await setupFactsOf(id));
    if (c.requiredMissing.length) throw new AppError("CONFLICT", { message: `Finish setup first: ${c.requiredMissing.map((m) => m.label).join(", ")}.`, fieldErrors: { checklist: c.requiredMissing.map((m) => m.label).join(", ") } });
  }
  await db.$transaction([
    db.tenant.update({ where: { id }, data: { status: to } }),
    db.subscription.updateMany({ where: { tenantId: id }, data: { status: SUBSCRIPTION_FOR[to] ?? "CANCELLED" } }),
    db.tenantStatusEvent.create({ data: { tenantId: id, fromStatus: t.status, toStatus: to, category: input.action === "activate" && t.status === "PENDING" ? "ONBOARDING" : category, notes: notes || null, actorId: ctx.user.id } }),
  ]);
  await recordAudit({ action: AUDIT_ACTIONS.CLINIC_STATUS_CHANGED, tenantId: id, actorId: ctx.user.id, entityType: "tenant", entityId: id, metadata: { action: input.action, from: t.status, to, category, reasonProvided: !!notes } });
  return { from: t.status, status: to };
}
export async function statusHistory(ctx: RequestContext, id: string, take = 20) {
  guard(ctx); await findClinic(id);
  const rows = await db.tenantStatusEvent.findMany({ where: { tenantId: id }, orderBy: { createdAt: "desc" }, take: clamp(take, 20, 1, 100) });
  const names = new Map((await db.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.actorId))] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  return rows.map((r) => ({ id: r.id, from: r.fromStatus, to: r.toStatus, category: r.category, notes: r.notes, by: names.get(r.actorId) ?? "Super Admin", at: r.createdAt }));
}

/* ---------------------------------------------------------------- branding ---------------------------------------------------------------- */
export async function updateClinicBranding(ctx: RequestContext, id: string, raw: unknown) {
  guard(ctx); await findClinic(id);
  const p = brandingSchema.safeParse(raw);
  if (!p.success) throw new AppError("VALIDATION_ERROR", { message: p.error.issues[0]?.message ?? "Check the colours.", fieldErrors: Object.fromEntries(p.error.issues.map((i) => [String(i.path[0]), i.message])) });
  const before = await db.tenantBranding.findUnique({ where: { tenantId: id } });
  await db.tenantBranding.upsert({ where: { tenantId: id }, update: { primaryColor: p.data.primaryColor, secondaryColor: p.data.secondaryColor, accentColor: p.data.accentColor }, create: { tenantId: id, primaryColor: p.data.primaryColor, secondaryColor: p.data.secondaryColor, accentColor: p.data.accentColor } });
  await recordAudit({ action: AUDIT_ACTIONS.PLATFORM_BRANDING_CHANGED, tenantId: id, actorId: ctx.user.id, entityType: "tenant_branding", entityId: id, metadata: { before: { primary: before?.primaryColor ?? null, secondary: before?.secondaryColor ?? null, accent: before?.accentColor ?? null }, after: { primary: p.data.primaryColor, secondary: p.data.secondaryColor, accent: p.data.accentColor } } });
  return { saved: true };
}

/* ---------------------------------------------------------------- domains ---------------------------------------------------------------- */
type TxtResolver = (name: string) => Promise<string[][]>;
let resolver: TxtResolver = async (name) => {
  const timeout = new Promise<never>((_, rej) => setTimeout(() => rej(Object.assign(new Error("timeout"), { code: "ETIMEOUT" })), 5000));
  return Promise.race([dns.resolveTxt(name), timeout]);
};
export const setTxtResolver = (r: TxtResolver | null) => { resolver = r ?? (async (name) => dns.resolveTxt(name)); };

export async function clinicDomain(ctx: RequestContext, id: string) {
  guard(ctx); const t = await findClinic(id); const root = getEnv().TENANT_ROOT_DOMAIN;
  return {
    subdomain: t.subdomain, subdomainHost: t.subdomain && root ? `${t.subdomain}.${root}` : null, rootDomainConfigured: !!root,
    custom: t.customDomain ? { domain: t.customDomain, status: t.customDomainStatus, verifiedAt: t.customDomainVerifiedAt, checkedAt: t.customDomainCheckedAt, failure: t.customDomainFailure, txtName: txtRecordName(t.customDomain), txtValue: t.customDomainToken ? txtRecordValue(t.customDomainToken) : null, resolving: !!t.customDomainVerifiedAt && t.customDomainStatus === "VERIFIED" } : null,
  };
}
export async function setCustomDomain(ctx: RequestContext, id: string, raw: unknown) {
  guard(ctx); const t = await findClinic(id);
  if (raw === null || raw === "") {
    await db.tenant.update({ where: { id }, data: { customDomain: null, customDomainVerifiedAt: null, customDomainStatus: "PENDING", customDomainToken: null, customDomainFailure: null, customDomainCheckedAt: null } });
    await recordAudit({ action: AUDIT_ACTIONS.DOMAIN_UPDATED, tenantId: id, actorId: ctx.user.id, entityType: "tenant", entityId: id, metadata: { customDomainRemoved: true } });
    return { removed: true };
  }
  const p = hostname.safeParse(raw);
  if (!p.success) throw new AppError("VALIDATION_ERROR", { message: p.error.issues[0].message, fieldErrors: { customDomain: p.error.issues[0].message } });
  const host = p.data;
  if (!isClaimableHost(host, getEnv().TENANT_ROOT_DOMAIN)) throw new AppError("VALIDATION_ERROR", { message: "This host belongs to the platform and can't be used as a clinic domain.", fieldErrors: { customDomain: "This host can't be used." } });
  const clash = await db.tenant.findFirst({ where: { id: { not: id }, customDomain: host }, select: { id: true } });
  if (clash) throw new AppError("CONFLICT", { message: "This domain is already used by another clinic.", fieldErrors: { customDomain: "This domain is already used by another clinic." } });
  if (t.customDomain === host) return { unchanged: true };
  await db.tenant.update({ where: { id }, data: { customDomain: host, customDomainVerifiedAt: null, customDomainStatus: "PENDING", customDomainToken: newDomainToken(), customDomainFailure: null, customDomainCheckedAt: null } });
  await recordAudit({ action: AUDIT_ACTIONS.DOMAIN_UPDATED, tenantId: id, actorId: ctx.user.id, entityType: "tenant", entityId: id, metadata: { customDomainChanged: true } });
  return { domain: host, status: "PENDING" };
}
/** Real verification: the clinic must publish the TXT record shown to the Super Admin. Nothing is marked verified unless DNS actually returned it. */
export async function verifyCustomDomain(ctx: RequestContext, id: string) {
  guard(ctx); const t = await findClinic(id);
  if (!t.customDomain || !t.customDomainToken) throw new AppError("VALIDATION_ERROR", { message: "Set a custom domain first." });
  await db.tenant.update({ where: { id }, data: { customDomainStatus: "VERIFYING" } });
  let status = "FAILED"; let failure: string | null = null;
  try {
    const records = await resolver(txtRecordName(t.customDomain));
    if (txtMatches(records, t.customDomainToken)) status = "VERIFIED"; else failure = "The TXT record was found but its value doesn't match.";
  } catch (e) {
    const code = (e as { code?: string }).code;
    failure = code === "ENODATA" || code === "ENOTFOUND" ? "No TXT record found yet. DNS changes can take time to spread." : "DNS lookup was not possible from the server right now. Try again later.";
  }
  await db.tenant.update({ where: { id }, data: { customDomainStatus: status, customDomainVerifiedAt: status === "VERIFIED" ? new Date() : null, customDomainCheckedAt: new Date(), customDomainFailure: failure } });
  await recordAudit({ action: AUDIT_ACTIONS.PLATFORM_DOMAIN_CHECKED, tenantId: id, actorId: ctx.user.id, entityType: "tenant", entityId: id, metadata: { result: status } });
  return { status, failure };
}
export async function disableCustomDomain(ctx: RequestContext, id: string, password?: string) {
  guard(ctx); const t = await findClinic(id); if (!t.customDomain) throw new AppError("VALIDATION_ERROR", { message: "No custom domain is set." });
  await stepUp(ctx, password, "domain.disable");
  await db.tenant.update({ where: { id }, data: { customDomainStatus: "DISABLED", customDomainVerifiedAt: null } }); // verifiedAt cleared => the host stops resolving immediately
  await recordAudit({ action: AUDIT_ACTIONS.DOMAIN_UPDATED, tenantId: id, actorId: ctx.user.id, entityType: "tenant", entityId: id, metadata: { customDomainDisabled: true } });
  return { status: "DISABLED" };
}
/** Domains across all clinics (server-side paged). */
export async function listDomains(ctx: RequestContext, f: { q?: string; status?: string; page?: number }) {
  guard(ctx); const { skip, take, page } = pageParams(f.page, 25);
  const where = { deletedAt: null, OR: [{ customDomain: { not: null } }, { subdomain: { not: null } }], ...(f.status ? { customDomainStatus: f.status, customDomain: { not: null } } : {}), ...(f.q ? { AND: [{ OR: [{ name: containsCI(f.q) }, { customDomain: containsCI(f.q) }, { subdomain: containsCI(f.q) }] }] } : {}) };
  const [total, rows] = await Promise.all([db.tenant.count({ where }), db.tenant.findMany({ where, orderBy: { createdAt: "desc" }, skip, take, select: { id: true, name: true, status: true, subdomain: true, customDomain: true, customDomainStatus: true, customDomainVerifiedAt: true, customDomainCheckedAt: true } })]);
  return { total, page, pageSize: take, rows };
}

/* ---------------------------------------------------------------- features ---------------------------------------------------------------- */
export async function clinicFeatures(ctx: RequestContext, id: string) {
  guard(ctx); await findClinic(id); const off = await db.tenantFeature.findMany({ where: { tenantId: id, enabled: false }, select: { key: true } }); const offSet = new Set(off.map((o) => o.key));
  return FEATURES.map((f) => ({ key: f.key, label: f.label, group: f.group, description: f.description, critical: !!f.critical, enabled: !offSet.has(f.key) }));
}
export async function setClinicFeature(ctx: RequestContext, id: string, input: { key: string; enabled: boolean; notes?: string; password?: string }) {
  guard(ctx); await findClinic(id);
  if (!isFeatureKey(input.key)) throw new AppError("VALIDATION_ERROR", { message: "Unknown feature." });
  if (typeof input.enabled !== "boolean") throw new AppError("VALIDATION_ERROR", { message: "Choose on or off." });
  const notes = !input.enabled ? requireReason(input.notes, 5) : cleanNotes(input.notes);
  if (!input.enabled) await stepUp(ctx, input.password, `feature.${input.key}`);
  const cur = await db.tenantFeature.findUnique({ where: { tenantId_key: { tenantId: id, key: input.key } } });
  if ((cur?.enabled ?? true) === input.enabled) return { unchanged: true, enabled: input.enabled };
  await db.tenantFeature.upsert({ where: { tenantId_key: { tenantId: id, key: input.key } }, update: { enabled: input.enabled, updatedById: ctx.user.id }, create: { tenantId: id, key: input.key, enabled: input.enabled, updatedById: ctx.user.id } });
  await recordAudit({ action: AUDIT_ACTIONS.PLATFORM_FEATURE_CHANGED, tenantId: id, actorId: ctx.user.id, entityType: "tenant_feature", entityId: input.key, metadata: { key: input.key, from: cur?.enabled ?? true, to: input.enabled, reasonProvided: !!notes } });
  return { enabled: input.enabled };
}
/** Matrix: clinic x feature (paged by clinic). */
export async function featureMatrix(ctx: RequestContext, f: { q?: string; page?: number }) {
  guard(ctx); const { skip, take, page } = pageParams(f.page, 25);
  const where = { deletedAt: null, status: { not: "ARCHIVED" }, ...(f.q ? { OR: [{ name: containsCI(f.q) }, { slug: containsCI(f.q) }] } : {}) };
  const [total, rows] = await Promise.all([db.tenant.count({ where }), db.tenant.findMany({ where, orderBy: { name: "asc" }, skip, take, select: { id: true, name: true, status: true } })]);
  const off = rows.length ? await db.tenantFeature.findMany({ where: { tenantId: { in: rows.map((r) => r.id) }, enabled: false }, select: { tenantId: true, key: true } }) : [];
  return { total, page, pageSize: take, features: FEATURES.map((x) => ({ key: x.key, label: x.label })), rows: rows.map((r) => ({ ...r, off: off.filter((o) => o.tenantId === r.id).map((o) => o.key) })) };
}
export { applyFeatureGates };

/* ----------------------------------------------------------- limits / retention / maintenance ----------------------------------------------------------- */
export async function clinicConfig(ctx: RequestContext, id: string) {
  guard(ctx); await findClinic(id); const c = await db.tenantConfig.findUnique({ where: { tenantId: id } });
  return { limits: parseJson<Limits>(limitsSchema, c?.limits, {}), retention: parseJson<Retention>(retentionSchema, c?.retention, {}), maintenanceMode: c?.maintenanceMode ?? false, maintenanceMessage: c?.maintenanceMessage ?? "", note: "Limits and retention are recorded configuration only: nothing is enforced and nothing is deleted automatically." };
}
export async function updateClinicConfig(ctx: RequestContext, id: string, raw: Record<string, unknown>) {
  guard(ctx); await findClinic(id);
  const data: Record<string, unknown> = {}; const changed: string[] = [];
  if (raw.limits !== undefined) { const p = limitsSchema.safeParse(raw.limits); if (!p.success) throw new AppError("VALIDATION_ERROR", { message: "One of the limits is out of range." }); data.limits = JSON.stringify(p.data); changed.push("limits"); }
  if (raw.retention !== undefined) { const p = retentionSchema.safeParse(raw.retention); if (!p.success) throw new AppError("VALIDATION_ERROR", { message: "One of the retention values is out of range." }); data.retention = JSON.stringify(p.data); changed.push("retention"); }
  if (raw.maintenanceMode !== undefined) {
    if (typeof raw.maintenanceMode !== "boolean") throw new AppError("VALIDATION_ERROR", { message: "Choose on or off." });
    await stepUp(ctx, raw.password, "clinic.maintenance"); data.maintenanceMode = raw.maintenanceMode; data.maintenanceMessage = cleanNotes(raw.maintenanceMessage, 300) || null; changed.push("maintenance");
  }
  if (!changed.length) return { unchanged: true };
  await db.tenantConfig.upsert({ where: { tenantId: id }, update: { ...data, updatedById: ctx.user.id }, create: { tenantId: id, ...data, updatedById: ctx.user.id } });
  await recordAudit({ action: raw.maintenanceMode !== undefined ? AUDIT_ACTIONS.PLATFORM_MAINTENANCE_CHANGED : AUDIT_ACTIONS.PLATFORM_CLINIC_CONFIG_CHANGED, tenantId: id, actorId: ctx.user.id, entityType: "tenant_config", entityId: id, metadata: { fields: changed, ...(raw.maintenanceMode !== undefined ? { maintenanceMode: raw.maintenanceMode } : {}) } });
  return { saved: true };
}

/* ------------------------------------------------------------------ clinic admin handoff ------------------------------------------------------------------ */
export async function changeClinicAdmin(ctx: RequestContext, id: string, input: { userId: string; demotePreviousTo?: string; password?: string; notes?: string }) {
  guard(ctx); await findClinic(id); requireReason(input.notes, 5);
  const target = await db.user.findFirst({ where: { id: input.userId, tenantId: id, deletedAt: null }, include: { role: { select: { key: true } } } });
  if (!target || target.role.key === "PATIENT" || target.role.key === "SUPER_ADMIN") throw new AppError("NOT_FOUND", { message: "Choose a staff member of this clinic." });
  if (target.status !== "ACTIVE") throw new AppError("VALIDATION_ERROR", { message: "The new admin must have an active account.", fieldErrors: { userId: "The new admin must have an active account." } });
  if (target.role.key === "CLINIC_ADMIN") throw new AppError("CONFLICT", { message: "That person is already a Clinic Admin." });
  if (target.role.key === "DOCTOR") throw new AppError("VALIDATION_ERROR", { message: "Doctors keep their doctor role. Choose another staff member (or invite a new admin).", fieldErrors: { userId: "Choose a non-doctor staff member." } });
  const demote = input.demotePreviousTo && (TENANT_ASSIGNABLE_ROLES as readonly string[]).includes(input.demotePreviousTo) && input.demotePreviousTo !== "CLINIC_ADMIN" ? input.demotePreviousTo : null;
  if (input.demotePreviousTo && !demote) throw new AppError("VALIDATION_ERROR", { message: "Choose a valid role for the previous admin." });
  await stepUp(ctx, input.password, "clinic.admin_change");
  const prev = await db.user.findMany({ where: { tenantId: id, deletedAt: null, role: { key: "CLINIC_ADMIN" } }, select: { id: true } });
  const [adminRole, demoteRole] = await Promise.all([db.role.findFirstOrThrow({ where: { key: "CLINIC_ADMIN", tenantId: null } }), demote ? db.role.findFirstOrThrow({ where: { key: demote, tenantId: null } }) : null]);
  await db.$transaction([
    db.user.update({ where: { id: target.id }, data: { roleId: adminRole.id } }),
    db.userPermissionGrant.deleteMany({ where: { tenantId: id, userId: target.id } }),
    ...(demoteRole && prev.length ? [db.user.updateMany({ where: { id: { in: prev.map((p) => p.id) } }, data: { roleId: demoteRole.id } })] : []),
  ]);
  await recordAudit({ action: AUDIT_ACTIONS.PLATFORM_ADMIN_CHANGED, tenantId: id, actorId: ctx.user.id, entityType: "user", entityId: target.id, metadata: { newAdmin: target.id, previousAdmins: prev.map((p) => p.id), previousDemotedTo: demote, fromRole: target.role.key } });
  return { adminUserId: target.id, previousAdmins: prev.map((p) => p.id) };
}

/** Manual confirmation (DNS verified outside the app). Re-authenticated and audited; the real check above is preferred. */
export async function confirmDomainManually(ctx: RequestContext, id: string, input: { password?: string; notes?: string }) {
  guard(ctx); const t = await findClinic(id); if (!t.customDomain) throw new AppError("VALIDATION_ERROR", { message: "Set a custom domain first." });
  requireReason(input.notes, 5); await stepUp(ctx, input.password, "domain.confirm");
  await db.tenant.update({ where: { id }, data: { customDomainVerifiedAt: new Date(), customDomainStatus: "VERIFIED", customDomainFailure: null, customDomainCheckedAt: new Date() } });
  await recordAudit({ action: AUDIT_ACTIONS.DOMAIN_VERIFIED, tenantId: id, actorId: ctx.user.id, entityType: "tenant", entityId: id, metadata: { verified: true, manual: true } });
  return { status: "VERIFIED" };
}
