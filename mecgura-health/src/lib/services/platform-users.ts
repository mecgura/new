import "server-only";
import { db } from "@/lib/db";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import type { RequestContext } from "@/lib/auth/context";
import { USER_STATUSES } from "@/lib/domain/constants";
import { AppError } from "@/lib/errors";
import { ROLES, TENANT_ASSIGNABLE_ROLES } from "@/lib/permissions";
import { cleanNotes, findClinic, guard, requireReason, stepUp } from "./platform-core";
import { containsCI, getRoleId, newInviteToken, pageParams, uniqueViolation } from "./shared";

/**
 * Cross-clinic account management for Super Admins. Account details only (no clinical data).
 * Protections: SUPER_ADMIN accounts and patient portal accounts can never be targeted here; the role set a user can be given
 * excludes SUPER_ADMIN, so no request can create or promote a platform admin; an active clinic can't lose its last active Clinic Admin.
 */
const PAGE = 25;
export async function searchUsers(ctx: RequestContext, f: { q?: string; role?: string; tenantId?: string; status?: string; page?: number }) {
  guard(ctx); const { skip, take, page } = pageParams(f.page, PAGE); const now = new Date();
  const roleFilter = f.role && (ROLES as readonly string[]).includes(f.role) && f.role !== "PATIENT" ? f.role : null;
  const where = {
    deletedAt: null, role: { key: roleFilter ?? { not: "PATIENT" } },
    ...(f.tenantId ? { tenantId: f.tenantId } : {}),
    ...(f.status === "LOCKED" ? { lockedUntil: { gt: now } } : f.status && f.status in USER_STATUSES ? { status: f.status } : {}),
    ...(f.q ? { OR: [{ name: containsCI(f.q) }, { email: containsCI(f.q) }, { phone: containsCI(f.q) }] } : {}),
  };
  const [total, rows] = await Promise.all([db.user.count({ where }), db.user.findMany({ where, orderBy: { createdAt: "desc" }, skip, take, select: { id: true, name: true, email: true, phone: true, status: true, lockedUntil: true, lastLoginAt: true, createdAt: true, tenantId: true, role: { select: { key: true } } } })]);
  const tenants = new Map((await db.tenant.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.tenantId).filter((x): x is string => !!x))] } }, select: { id: true, name: true } })).map((t) => [t.id, t.name]));
  return { total, page, pageSize: take, rows: rows.map((u) => ({ id: u.id, name: u.name, email: u.email, phone: u.phone, role: u.role.key, status: u.status, locked: !!u.lockedUntil && u.lockedUntil > now, lastLoginAt: u.lastLoginAt, createdAt: u.createdAt, clinicId: u.tenantId, clinic: u.tenantId ? tenants.get(u.tenantId) ?? "—" : "Platform" })) };
}

async function target(id: string) {
  const u = await db.user.findFirst({ where: { id, deletedAt: null }, include: { role: { select: { key: true } } } });
  if (!u) throw new AppError("NOT_FOUND", { message: "That user doesn't exist." });
  if (u.role.key === "SUPER_ADMIN") throw new AppError("FORBIDDEN", { message: "Platform administrator accounts can't be changed from here." });
  if (u.role.key === "PATIENT") throw new AppError("FORBIDDEN", { message: "Patient portal accounts are managed by the clinic." });
  if (!u.tenantId) throw new AppError("NOT_FOUND");
  return u as typeof u & { tenantId: string };
}
async function lastAdminGuard(userId: string, tenantId: string) {
  const [t, others] = await Promise.all([db.tenant.findFirst({ where: { id: tenantId }, select: { status: true } }), db.user.count({ where: { tenantId, id: { not: userId }, deletedAt: null, status: "ACTIVE", role: { key: "CLINIC_ADMIN" } } })]);
  if (t && ["ACTIVE", "TRIAL"].includes(t.status) && others === 0) throw new AppError("CONFLICT", { message: "This is the clinic's only active admin. Assign another admin first." });
}

export async function setUserStatus(ctx: RequestContext, id: string, input: { status: string; notes?: string; password?: string }) {
  guard(ctx); const u = await target(id);
  if (!["ACTIVE", "SUSPENDED", "DISABLED"].includes(input.status)) throw new AppError("VALIDATION_ERROR", { message: "Choose active, suspended or inactive." });
  if (u.status === "INVITED" && input.status === "ACTIVE") throw new AppError("CONFLICT", { message: "This person hasn't accepted their invitation yet." });
  if (u.status === input.status) return { unchanged: true, status: u.status };
  if (input.status !== "ACTIVE") { requireReason(input.notes, 5); await stepUp(ctx, input.password, `user.${input.status.toLowerCase()}`); if (u.role.key === "CLINIC_ADMIN") await lastAdminGuard(u.id, u.tenantId); }
  await db.user.update({ where: { id }, data: { status: input.status, ...(input.status === "ACTIVE" ? { lockedUntil: null, failedLoginCount: 0 } : {}) } });
  await recordAudit({ action: AUDIT_ACTIONS.PLATFORM_USER_STATUS_CHANGED, tenantId: u.tenantId, actorId: ctx.user.id, entityType: "user", entityId: id, metadata: { from: u.status, to: input.status } });
  return { status: input.status };
}

export async function changeUserRole(ctx: RequestContext, id: string, input: { role: string; password?: string; notes?: string }) {
  guard(ctx); const u = await target(id);
  if (!(TENANT_ASSIGNABLE_ROLES as readonly string[]).includes(input.role)) throw new AppError("VALIDATION_ERROR", { message: "That role can't be assigned.", fieldErrors: { role: "That role can't be assigned." } }); // SUPER_ADMIN / PATIENT are not assignable
  if (u.role.key === input.role) return { unchanged: true };
  requireReason(input.notes, 5); await stepUp(ctx, input.password, "user.role");
  if (u.role.key === "CLINIC_ADMIN") await lastAdminGuard(u.id, u.tenantId);
  const roleId = await getRoleId(input.role);
  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id }, data: { roleId } });
    await tx.userPermissionGrant.deleteMany({ where: { tenantId: u.tenantId, userId: id } }); // grants were chosen for the old role
    if (input.role === "DOCTOR") await tx.doctorProfile.upsert({ where: { userId: id }, update: {}, create: { tenantId: u.tenantId, userId: id } });
    else await tx.staffProfile.upsert({ where: { userId: id }, update: {}, create: { tenantId: u.tenantId, userId: id } });
  });
  await recordAudit({ action: AUDIT_ACTIONS.PLATFORM_USER_ROLE_CHANGED, tenantId: u.tenantId, actorId: ctx.user.id, entityType: "user", entityId: id, metadata: { from: u.role.key, to: input.role } });
  return { role: input.role };
}

/** Unlock the account; for users who haven't accepted yet, replace the old invitation with a fresh single-use one (token shown once). */
export async function resetAccess(ctx: RequestContext, id: string, input: { password?: string }) {
  guard(ctx); const u = await target(id); await stepUp(ctx, input.password, "user.reset_access");
  let invite: { token: string; expiresAt: Date } | null = null;
  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id }, data: { lockedUntil: null, failedLoginCount: 0 } });
    if (u.status === "INVITED") {
      await tx.invitation.updateMany({ where: { userId: id, acceptedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
      const t = newInviteToken(); invite = { token: t.token, expiresAt: t.expiresAt };
      await tx.invitation.create({ data: { tenantId: u.tenantId, userId: id, tokenHash: t.tokenHash, expiresAt: t.expiresAt, createdById: ctx.user.id } });
    }
  });
  await recordAudit({ action: AUDIT_ACTIONS.PLATFORM_ACCESS_RESET, tenantId: u.tenantId, actorId: ctx.user.id, entityType: "user", entityId: id, metadata: { reinvited: !!invite } });
  return { unlocked: true, inviteToken: (invite as { token: string } | null)?.token ?? null, inviteExpiresAt: (invite as { expiresAt: Date } | null)?.expiresAt ?? null };
}

export async function inviteClinicUser(ctx: RequestContext, tenantId: string, input: { name: string; email: string; phone?: string; role: string }) {
  guard(ctx); const t = await findClinic(tenantId);
  if (t.status === "ARCHIVED") throw new AppError("CONFLICT", { message: "Restore the clinic before adding people to it." });
  if (!(TENANT_ASSIGNABLE_ROLES as readonly string[]).includes(input.role)) throw new AppError("VALIDATION_ERROR", { message: "That role can't be assigned.", fieldErrors: { role: "That role can't be assigned." } });
  const name = cleanNotes(input.name, 120); const email = cleanNotes(input.email, 200).toLowerCase(); const phone = cleanNotes(input.phone, 20) || undefined;
  const fe: Record<string, string> = {};
  if (name.length < 2) fe.name = "Enter the person's name."; if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) fe.email = "Enter a valid email address."; if (phone && !/^\+?[0-9]{8,15}$/.test(phone)) fe.phone = "Enter a valid phone number.";
  if (Object.keys(fe).length) throw new AppError("VALIDATION_ERROR", { message: "Check the details.", fieldErrors: fe });
  const dupe = await db.user.findFirst({ where: { OR: [{ email }, ...(phone ? [{ phone }] : [])] }, select: { email: true } });
  if (dupe) throw new AppError("CONFLICT", { message: "This email or phone is already registered.", fieldErrors: dupe.email === email ? { email: "This email is already registered." } : { phone: "This phone number is already registered." } });
  const invite = newInviteToken();
  try {
    const user = await db.user.create({ data: { name, email, phone, tenantId, roleId: await getRoleId(input.role), status: "INVITED", ...(input.role === "DOCTOR" ? { doctorProfile: { create: { tenantId } } } : { staffProfile: { create: { tenantId } } }), invitations: { create: { tenantId, tokenHash: invite.tokenHash, expiresAt: invite.expiresAt, createdById: ctx.user.id } } }, select: { id: true } });
    await recordAudit({ action: AUDIT_ACTIONS.USER_INVITED, tenantId, actorId: ctx.user.id, entityType: "user", entityId: user.id, metadata: { role: input.role, viaSuperAdmin: true } });
    return { id: user.id, inviteToken: invite.token, inviteExpiresAt: invite.expiresAt };
  } catch (e) { if (uniqueViolation(e)) throw new AppError("CONFLICT", { message: "This email or phone is already registered." }); throw e; }
}

/** Users of one clinic (for the clinic's Users tab), paged. */
export async function clinicUsers(ctx: RequestContext, tenantId: string, f: { page?: number; q?: string }) { guard(ctx); await findClinic(tenantId); return searchUsers(ctx, { tenantId, page: f.page, q: f.q }); }
