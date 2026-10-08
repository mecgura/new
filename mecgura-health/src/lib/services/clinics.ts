import "server-only";
import { db } from "@/lib/db";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import type { RequestContext } from "@/lib/auth/context";
import { AppError } from "@/lib/errors";
import { assertPermission } from "@/lib/permissions";
import type { ClinicCreateInput, ClinicProfileInput } from "@/lib/validation/clinic";
import { RESERVED_LABELS, TENANT_STATUSES, type TenantStatus } from "@/lib/domain/constants";
import { getPlatformSetting } from "@/lib/platform/runtime";
import { newDomainToken } from "@/lib/platform/domain";
import { changedKeys, containsCI, getRoleId, newInviteToken, pageParams, uniqueViolation } from "./shared";

/** Platform-level clinic management. EVERY function requires `platform.manage` (SUPER_ADMIN only). */
const guard = (ctx: RequestContext) => assertPermission(ctx.permissions, "platform.manage");

export async function listClinics(ctx: RequestContext, f: { q?: string; status?: string; type?: string; page?: number }) {
  guard(ctx);
  const { skip, take, page } = pageParams(f.page);
  const where = {
    deletedAt: null,
    ...(f.status && f.status in TENANT_STATUSES ? { status: f.status } : {}),
    ...(f.type ? { clinicType: f.type } : {}),
    ...(f.q ? { OR: [{ name: containsCI(f.q) }, { slug: containsCI(f.q) }, { customDomain: containsCI(f.q) }, { subdomain: containsCI(f.q) }] } : {}),
  };
  const [total, rows] = await Promise.all([
    db.tenant.count({ where }),
    db.tenant.findMany({ where, orderBy: { createdAt: "desc" }, skip, take, include: { _count: { select: { users: { where: { deletedAt: null } } } } } }),
  ]);
  const owners = rows.length
    ? await db.user.findMany({
        where: { tenantId: { in: rows.map((r) => r.id) }, deletedAt: null, role: { key: { in: ["CLINIC_ADMIN", "DOCTOR"] } } },
        orderBy: { createdAt: "asc" },
        select: { tenantId: true, name: true, role: { select: { key: true } } },
      })
    : [];
  const ownerOf = new Map<string, string>();
  for (const o of owners) if (o.tenantId && !ownerOf.has(o.tenantId)) ownerOf.set(o.tenantId, o.name);
  return { total, page, pageSize: take, rows: rows.map((r) => ({ ...r, userCount: r._count.users, owner: ownerOf.get(r.id) ?? null })) };
}

export async function getClinic(ctx: RequestContext, id: string) {
  guard(ctx);
  const t = await db.tenant.findFirst({
    where: { id, deletedAt: null },
    include: {
      branding: true,
      subscription: { include: { plan: true } },
      users: { where: { deletedAt: null }, orderBy: { createdAt: "asc" }, take: 50, select: { id: true, name: true, status: true, lastLoginAt: true, role: { select: { key: true } } } },
    },
  });
  if (!t) throw new AppError("NOT_FOUND");
  return t;
}

export async function platformStats(ctx: RequestContext) {
  guard(ctx);
  const [byStatus, users] = await Promise.all([
    db.tenant.groupBy({ by: ["status"], where: { deletedAt: null }, _count: true }),
    db.user.count({ where: { deletedAt: null, tenantId: { not: null } } }),
  ]);
  const counts = Object.fromEntries(byStatus.map((s) => [s.status, s._count])) as Record<string, number>;
  return { counts, totalClinics: byStatus.reduce((n, s) => n + s._count, 0), users };
}

async function defaultPlanId() {
  const plan = await db.plan.upsert({ where: { key: "foundation" }, update: {}, create: { key: "foundation", name: "Foundation", modules: JSON.stringify(["dashboard", "settings", "team"]) } });
  return plan.id;
}

export async function createClinic(ctx: RequestContext, input: ClinicCreateInput) {
  guard(ctx);
  const { profile, slug, branding, admin } = input;
  const [slugTaken, emailTaken, phoneTaken] = await Promise.all([
    db.tenant.findFirst({ where: { OR: [{ slug }, { subdomain: slug }] }, select: { id: true } }),
    db.user.findFirst({ where: { email: admin.email }, select: { id: true } }),
    admin.phone ? db.user.findFirst({ where: { phone: admin.phone }, select: { id: true } }) : null,
  ]);
  const fieldErrors: Record<string, string> = {};
  if (slugTaken) fieldErrors.slug = "This clinic address is already taken.";
  if (emailTaken) fieldErrors["admin.email"] = "This email is already registered.";
  if (phoneTaken) fieldErrors["admin.phone"] = "This phone number is already registered.";
  if (Object.keys(fieldErrors).length) throw new AppError("CONFLICT", { message: "Some details are already in use.", fieldErrors });

  const [roleId, planId] = [await getRoleId(admin.role), await defaultPlanId()];
  const invite = newInviteToken();
  try {
    const { tenant, user } = await db.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          ...profile, slug, subdomain: slug, status: input.status,
          branding: { create: { primaryColor: branding.primaryColor, secondaryColor: branding.secondaryColor, accentColor: branding.accentColor } },
          subscription: { create: { planId, status: input.status === "ACTIVE" ? "ACTIVE" : "TRIAL" } },
        },
      });
      const user = await tx.user.create({
        data: {
          name: admin.name, email: admin.email, phone: admin.phone, tenantId: tenant.id, roleId, status: "INVITED",
          ...(admin.role === "DOCTOR" ? { doctorProfile: { create: { tenantId: tenant.id } } } : { staffProfile: { create: { tenantId: tenant.id } } }),
          invitations: { create: { tenantId: tenant.id, tokenHash: invite.tokenHash, expiresAt: invite.expiresAt, createdById: ctx.user.id } },
        },
      });
      return { tenant, user };
    });
    // Platform feature defaults: features the platform keeps OFF for new clinics start switched off (clinic data is untouched either way).
    const defaults = await getPlatformSetting<{ featureDefaults?: Record<string, boolean> }>("defaults", {});
    const startOff = Object.entries(defaults.featureDefaults ?? {}).filter(([, v]) => v === false).map(([k]) => k);
    if (startOff.length) await db.tenantFeature.createMany({ data: startOff.map((key) => ({ tenantId: tenant.id, key, enabled: false, updatedById: ctx.user.id })) });
    await recordAudit({ action: AUDIT_ACTIONS.CLINIC_CREATED, tenantId: tenant.id, actorId: ctx.user.id, entityType: "tenant", entityId: tenant.id, metadata: { status: input.status, clinicType: profile.clinicType } });
    await recordAudit({ action: AUDIT_ACTIONS.USER_INVITED, tenantId: tenant.id, actorId: ctx.user.id, entityType: "user", entityId: user.id, metadata: { role: admin.role } });
    return { tenant, adminUserId: user.id, inviteToken: invite.token, inviteExpiresAt: invite.expiresAt };
  } catch (e) {
    if (uniqueViolation(e)) throw new AppError("CONFLICT", { message: "Some details are already in use." });
    throw e;
  }
}

export async function updateClinic(ctx: RequestContext, id: string, input: ClinicProfileInput) {
  guard(ctx);
  const before = await db.tenant.findFirst({ where: { id, deletedAt: null } });
  if (!before) throw new AppError("NOT_FOUND");
  const updated = await db.tenant.update({ where: { id }, data: input });
  await recordAudit({ action: AUDIT_ACTIONS.CLINIC_UPDATED, tenantId: id, actorId: ctx.user.id, entityType: "tenant", entityId: id, metadata: { fields: changedKeys(before, input) } });
  return updated;
}

export async function setClinicStatus(ctx: RequestContext, id: string, status: TenantStatus) {
  guard(ctx);
  const before = await db.tenant.findFirst({ where: { id, deletedAt: null }, select: { status: true } });
  if (!before) throw new AppError("NOT_FOUND");
  if (before.status === status) return { status };
  await db.$transaction([
    db.tenant.update({ where: { id }, data: { status } }),
    db.subscription.updateMany({ where: { tenantId: id, managed: false }, data: { status: status === "ACTIVE" ? "ACTIVE" : status === "TRIAL" ? "TRIAL" : "CANCELLED" } }),
  ]);
  await recordAudit({ action: AUDIT_ACTIONS.CLINIC_STATUS_CHANGED, tenantId: id, actorId: ctx.user.id, entityType: "tenant", entityId: id, metadata: { from: before.status, to: status } });
  return { status };
}

export async function updateDomain(ctx: RequestContext, id: string, input: { subdomain?: string; customDomain?: string; websiteEnabled?: boolean }) {
  guard(ctx);
  const before = await db.tenant.findFirst({ where: { id, deletedAt: null } });
  if (!before) throw new AppError("NOT_FOUND");
  const subdomain = input.subdomain ?? null;
  const customDomain = input.customDomain ?? null;
  if (subdomain && RESERVED_LABELS.includes(subdomain)) throw new AppError("VALIDATION_ERROR", { fieldErrors: { subdomain: "This name is reserved." } });
  const clash = await db.tenant.findFirst({
    where: { id: { not: id }, OR: [...(subdomain ? [{ subdomain }, { slug: subdomain }] : []), ...(customDomain ? [{ customDomain }] : [])] },
    select: { subdomain: true, customDomain: true },
  });
  if (clash) {
    throw new AppError("CONFLICT", { fieldErrors: clash.customDomain === customDomain && customDomain ? { customDomain: "This domain is already used by another clinic." } : { subdomain: "This subdomain is already taken." } });
  }
  const domainChanged = customDomain !== before.customDomain;
  const updated = await db.tenant.update({
    where: { id },
    data: { subdomain, customDomain, websiteEnabled: input.websiteEnabled ?? before.websiteEnabled, ...(domainChanged ? { customDomainVerifiedAt: null, customDomainStatus: "PENDING", customDomainToken: customDomain ? newDomainToken() : null, customDomainFailure: null, customDomainCheckedAt: null } : {}) },
  });
  await recordAudit({ action: AUDIT_ACTIONS.DOMAIN_UPDATED, tenantId: id, actorId: ctx.user.id, entityType: "tenant", entityId: id, metadata: { subdomainChanged: subdomain !== before.subdomain, customDomainChanged: domainChanged } });
  return updated;
}

/** Manual verification: the Super Admin confirms DNS + SSL are configured OUTSIDE this app. */
export async function markDomainVerified(ctx: RequestContext, id: string, verified: boolean) {
  guard(ctx);
  const t = await db.tenant.findFirst({ where: { id, deletedAt: null }, select: { customDomain: true } });
  if (!t) throw new AppError("NOT_FOUND");
  if (!t.customDomain) throw new AppError("VALIDATION_ERROR", { message: "Set a custom domain first." });
  await db.tenant.update({ where: { id }, data: { customDomainVerifiedAt: verified ? new Date() : null, customDomainStatus: verified ? "VERIFIED" : "PENDING", customDomainFailure: null } });
  await recordAudit({ action: AUDIT_ACTIONS.DOMAIN_VERIFIED, tenantId: id, actorId: ctx.user.id, entityType: "tenant", entityId: id, metadata: { verified } });
  return { verified };
}

/** Super Admin enters a clinic workspace. Audited; the cookie itself is set by the route. */
export async function assertCanEnterClinic(ctx: RequestContext, id: string) {
  guard(ctx);
  const t = await db.tenant.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
  if (!t) throw new AppError("NOT_FOUND");
  await recordAudit({ action: AUDIT_ACTIONS.TENANT_ENTERED, tenantId: id, actorId: ctx.user.id, entityType: "tenant", entityId: id });
}
