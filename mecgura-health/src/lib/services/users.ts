import { assertCanCreate, noteUsage, seatKey } from "./entitlements";
import "server-only";
import { notifyStaffSecurity } from "@/lib/notifications/events";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import type { TenantRequestContext } from "@/lib/auth/context";
import { TENANT_ACCESS_STATUSES, USER_STATUSES } from "@/lib/domain/constants";
import { AppError } from "@/lib/errors";
import { assertPermission, GRANTABLE_PERMISSIONS, TENANT_ASSIGNABLE_ROLES, type RoleKey } from "@/lib/permissions";
import { rateLimit } from "@/lib/security/rate-limit";
import { tenantDb } from "@/lib/tenant/db";
import type { UserCreateInput, UserUpdateInput } from "@/lib/validation/clinic";
import { containsCI, getRoleId, hashToken, newInviteToken, pageParams, uniqueViolation } from "./shared";

/**
 * Team (user) management for ONE clinic. Every read/write goes through tenantDb(ctx), so a user id from
 * another clinic simply does not exist here (404) — regardless of what the client sends.
 */

const listSelect = {
  id: true, name: true, email: true, phone: true, status: true, avatarUrl: true, lastLoginAt: true, createdAt: true,
  role: { select: { key: true } },
  doctorProfile: { select: { specialization: true } },
  staffProfile: { select: { designation: true } },
} as const;

export async function listUsers(ctx: TenantRequestContext, f: { q?: string; role?: string; status?: string; page?: number }) {
  assertPermission(ctx.permissions, "users.view");
  const { skip, take, page } = pageParams(f.page);
  const where = {
    // portal patients are not staff: they never appear in (or can be managed from) the team screens
    role: { key: f.role && f.role !== "PATIENT" ? f.role : { not: "PATIENT" } },
    ...(f.status && f.status in USER_STATUSES ? { status: f.status } : {}),
    ...(f.q ? { OR: [{ name: containsCI(f.q) }, { email: containsCI(f.q) }, { phone: containsCI(f.q) }] } : {}),
  };
  const tdb = tenantDb(ctx);
  const [total, rows] = await Promise.all([
    tdb.user.count({ where }),
    tdb.user.findMany({ where, orderBy: [{ createdAt: "desc" }], skip, take, select: listSelect }),
  ]);
  return { total, page, pageSize: take, rows };
}

export async function getUser(ctx: TenantRequestContext, id: string) {
  assertPermission(ctx.permissions, "users.view");
  const user = await tenantDb(ctx).user.findFirst({
    where: { id, role: { key: { not: "PATIENT" } } },
    select: { ...listSelect, doctorProfile: true, staffProfile: true, permissionGrants: { select: { permission: true } } },
  });
  if (!user) throw new AppError("NOT_FOUND"); // also what a user of ANOTHER clinic gets: resource hiding
  return user;
}

function cleanGrants(role: string, grants: string[] | undefined): string[] {
  if (!grants?.length) return [];
  if (role === "DOCTOR" || role === "CLINIC_ADMIN") return []; // role already covers them / admins are not extended
  return Array.from(new Set(grants.filter((g) => (GRANTABLE_PERMISSIONS as readonly string[]).includes(g))));
}

function profileData(input: UserCreateInput | UserUpdateInput) {
  return {
    doctor: { qualification: input.qualification, specialization: input.specialization, registrationNumber: input.registrationNumber, experienceYears: input.experienceYears, gender: input.gender, bio: input.bio, consultationFee: input.consultationFee },
    staff: { employeeRef: input.employeeRef, designation: input.designation },
  };
}

async function assertNoDuplicate(email: string | undefined, phone: string | undefined, selfId?: string) {
  const dupe = await db.user.findFirst({
    where: { id: selfId ? { not: selfId } : undefined, OR: [...(email ? [{ email }] : []), ...(phone ? [{ phone }] : [])] },
    select: { email: true, phone: true },
  });
  if (dupe) {
    throw new AppError("CONFLICT", { fieldErrors: dupe.email === email ? { email: "This email is already registered." } : { phone: "This phone number is already registered." } });
  }
}

export async function createUser(ctx: TenantRequestContext, input: UserCreateInput) {
  assertPermission(ctx.permissions, "users.create");
  if (!(TENANT_ASSIGNABLE_ROLES as readonly string[]).includes(input.role)) throw new AppError("FORBIDDEN");
  await assertNoDuplicate(input.email, input.phone);
  await assertCanCreate(ctx.tenantId, seatKey(input.role)); // plan limit (checked before any transaction)
  const tdb = tenantDb(ctx);
  const invite = newInviteToken();
  const grants = cleanGrants(input.role, input.grants);
  const p = profileData(input);
  try {
    const user = await tdb.user.create({
      data: {
        name: input.name, email: input.email, phone: input.phone, roleId: await getRoleId(input.role), status: "INVITED",
        // nested writes are NOT auto-scoped: tenantId is set explicitly
        ...(input.role === "DOCTOR" ? { doctorProfile: { create: { tenantId: ctx.tenantId, ...p.doctor } } } : { staffProfile: { create: { tenantId: ctx.tenantId, ...p.staff } } }),
        ...(grants.length ? { permissionGrants: { create: grants.map((permission) => ({ tenantId: ctx.tenantId, permission })) } } : {}),
        invitations: { create: { tenantId: ctx.tenantId, tokenHash: invite.tokenHash, expiresAt: invite.expiresAt, createdById: ctx.user.id } },
      } as never,
      select: { id: true },
    });
    await recordAudit({ action: AUDIT_ACTIONS.USER_CREATED, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "user", entityId: user.id, metadata: { role: input.role, viaSuperAdmin: ctx.viewingAs } });
    await recordAudit({ action: AUDIT_ACTIONS.USER_INVITED, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "user", entityId: user.id });
    await noteUsage(ctx.tenantId, seatKey(input.role));
    return { id: user.id, inviteToken: invite.token, inviteExpiresAt: invite.expiresAt };
  } catch (e) {
    if (uniqueViolation(e)) throw new AppError("CONFLICT", { message: "Email or phone is already registered." });
    throw e;
  }
}

async function activeAdminCountExcluding(ctx: TenantRequestContext, userId: string) {
  return tenantDb(ctx).user.count({ where: { id: { not: userId }, status: "ACTIVE", role: { key: "CLINIC_ADMIN" } } });
}

export async function updateUser(ctx: TenantRequestContext, id: string, input: UserUpdateInput) {
  assertPermission(ctx.permissions, "users.edit");
  const tdb = tenantDb(ctx);
  const current = await tdb.user.findFirst({ where: { id, role: { key: { not: "PATIENT" } } }, select: { id: true, status: true, role: { select: { key: true } } } });
  if (!current) throw new AppError("NOT_FOUND");
  if (input.phone) await assertNoDuplicate(undefined, input.phone, id);

  const roleChanged = !!input.role && input.role !== current.role.key;
  if (roleChanged) {
    if (id === ctx.user.id) throw new AppError("FORBIDDEN", { message: "You can't change your own role." });
    if (current.role.key === "CLINIC_ADMIN" && current.status === "ACTIVE" && (await activeAdminCountExcluding(ctx, id)) === 0) {
      throw new AppError("CONFLICT", { message: "A clinic needs at least one active Clinic Admin." });
    }
  }
  const newRole = (input.role ?? current.role.key) as RoleKey;
  if (roleChanged && ["ACTIVE", "INVITED"].includes(current.status) && seatKey(newRole) !== seatKey(current.role.key)) await assertCanCreate(ctx.tenantId, seatKey(newRole));
  const p = profileData(input);

  await tdb.user.update({ where: { id }, data: { ...(input.name ? { name: input.name } : {}), ...(input.phone !== undefined ? { phone: input.phone } : {}), ...(roleChanged ? { roleId: await getRoleId(newRole) } : {}) } });
  if (newRole === "DOCTOR") {
    await tdb.doctorProfile.upsert({ where: { userId: id }, update: p.doctor, create: { tenantId: ctx.tenantId, userId: id, ...p.doctor } as never });
  } else {
    await tdb.staffProfile.upsert({ where: { userId: id }, update: p.staff, create: { tenantId: ctx.tenantId, userId: id, ...p.staff } as never });
  }
  if (input.grants) {
    const grants = cleanGrants(newRole, input.grants);
    await tdb.userPermissionGrant.deleteMany({ where: { userId: id } });
    if (grants.length) await tdb.userPermissionGrant.createMany({ data: grants.map((permission) => ({ userId: id, permission })) as never });
  } else if (roleChanged && (newRole === "DOCTOR" || newRole === "CLINIC_ADMIN")) {
    await tdb.userPermissionGrant.deleteMany({ where: { userId: id } });
  }
  await recordAudit({
    action: roleChanged ? AUDIT_ACTIONS.USER_ROLE_CHANGED : AUDIT_ACTIONS.USER_UPDATED,
    tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "user", entityId: id,
    metadata: roleChanged ? { from: current.role.key, to: newRole } : undefined,
  });
  if (roleChanged) await notifyStaffSecurity(ctx.tenantId, "role_changed", id, { who: input.name ?? "A team member", role: newRole });
  return { id };
}

export async function setUserStatus(ctx: TenantRequestContext, id: string, status: "ACTIVE" | "SUSPENDED" | "DISABLED") {
  assertPermission(ctx.permissions, "users.disable");
  if (id === ctx.user.id) throw new AppError("FORBIDDEN", { message: "You can't change your own account status." });
  const tdb = tenantDb(ctx);
  const u = await tdb.user.findFirst({ where: { id, role: { key: { not: "PATIENT" } } }, select: { status: true, passwordHash: true, role: { select: { key: true } } } });
  if (!u) throw new AppError("NOT_FOUND");
  if (status !== "ACTIVE" && u.role.key === "CLINIC_ADMIN" && u.status === "ACTIVE" && (await activeAdminCountExcluding(ctx, id)) === 0) {
    throw new AppError("CONFLICT", { message: "A clinic needs at least one active Clinic Admin." });
  }
  if (status === "ACTIVE" && !["ACTIVE", "INVITED"].includes(u.status)) await assertCanCreate(ctx.tenantId, seatKey(u.role.key)); // re-activating takes a seat again
  // A user who never set a password goes back to INVITED, not ACTIVE.
  const next = status === "ACTIVE" && !u.passwordHash ? "INVITED" : status;
  await tdb.user.update({ where: { id }, data: { status: next, ...(status === "ACTIVE" ? { failedLoginCount: 0, lockedUntil: null } : {}) } });
  await recordAudit({ action: AUDIT_ACTIONS.USER_STATUS_CHANGED, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "user", entityId: id, metadata: { from: u.status, to: next } });
  return { status: next };
}

/** Issue a fresh invitation (revokes earlier ones). The token is returned ONCE and never stored. */
export async function reinviteUser(ctx: TenantRequestContext, id: string) {
  assertPermission(ctx.permissions, "users.create");
  const tdb = tenantDb(ctx);
  const u = await tdb.user.findFirst({ where: { id, role: { key: { not: "PATIENT" } } }, select: { status: true, passwordHash: true } });
  if (!u) throw new AppError("NOT_FOUND");
  if (u.passwordHash) throw new AppError("CONFLICT", { message: "This user has already set up their account." });
  const invite = newInviteToken();
  await tdb.invitation.updateMany({ where: { userId: id, acceptedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
  await tdb.invitation.create({ data: { userId: id, tokenHash: invite.tokenHash, expiresAt: invite.expiresAt, createdById: ctx.user.id } as never });
  await recordAudit({ action: AUDIT_ACTIONS.USER_INVITED, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "user", entityId: id, metadata: { reissued: true } });
  return { inviteToken: invite.token, inviteExpiresAt: invite.expiresAt };
}

/** Public: set a password using an invitation token. Generic failure message — never says why. */
export async function acceptInvitation(token: string, password: string) {
  const limited = await rateLimit(`invite:${hashToken(token).slice(0, 16)}`, { limit: 10, windowMs: 15 * 60_000 });
  if (!limited.allowed) throw new AppError("RATE_LIMITED");
  const invalid = new AppError("VALIDATION_ERROR", { message: "This invitation link is invalid or has expired. Ask your admin for a new one." });
  const inv = await db.invitation.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { include: { tenant: true, role: { select: { key: true } } } } },
  });
  if (!inv || inv.acceptedAt || inv.revokedAt || inv.expiresAt < new Date()) throw invalid;
  const { user } = inv;
  if (user.deletedAt || user.status !== "INVITED" || user.passwordHash) throw invalid;
  if (user.tenant && (user.tenant.deletedAt || !TENANT_ACCESS_STATUSES.includes(user.tenant.status))) throw invalid;
  const passwordHash = await bcrypt.hash(password, 12);
  await db.$transaction([
    db.user.update({ where: { id: user.id }, data: { passwordHash, status: "ACTIVE", failedLoginCount: 0, lockedUntil: null } }),
    db.invitation.update({ where: { id: inv.id }, data: { acceptedAt: new Date() } }),
  ]);
  await recordAudit({ action: AUDIT_ACTIONS.INVITATION_ACCEPTED, tenantId: user.tenantId, actorId: user.id, entityType: "user", entityId: user.id });
  return { email: user.email };
}
