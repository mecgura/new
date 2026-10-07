import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notifications";
import { canAssignRole, type OrgRole } from "@/lib/authz";
import type { OrgAccess } from "@/lib/session";
import { hashPassword } from "@/lib/services/accounts";
import { assertWithinLimit } from "@/lib/services/usage";

export async function updateOrganization(access: OrgAccess, name: string, req?: Request) {
  const organization = await db.organization.update({ where: { id: access.organizationId }, data: { name } });
  await audit({ action: "organization.updated", actorUserId: access.user.id, organizationId: access.organizationId, targetType: "organization", targetId: access.organizationId, metadata: { fields: ["name"] }, req });
  return organization;
}

export function listMembers(organizationId: string) {
  return db.organizationMember.findMany({
    where: { organizationId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      role: true,
      createdAt: true,
      user: { select: { id: true, name: true, email: true, status: true, lastLoginAt: true } },
    },
  });
}

function actorRole(access: OrgAccess): OrgRole {
  return access.isPlatformAdmin ? "CLIENT_OWNER" : (access.role as OrgRole);
}

export async function addMember(
  access: OrgAccess,
  input: { email: string; name: string; role: OrgRole; password?: string },
  req?: Request
) {
  if (!canAssignRole(actorRole(access), input.role)) throw new ApiError("FORBIDDEN");
  const orgId = access.organizationId;
  await assertWithinLimit(orgId, "users");
  let user = await db.user.findUnique({ where: { email: input.email } });
  let created = false;
  if (user) {
    const already = await db.organizationMember.findUnique({ where: { organizationId_userId: { organizationId: orgId, userId: user.id } } });
    if (already) throw new ApiError("CONFLICT", "This person is already a member of the organization.");
  } else {
    if (!input.password) {
      throw new ApiError("VALIDATION_ERROR", "A temporary password is required for a new account.", { details: { password: ["Required for new accounts"] } });
    }
    user = await db.user.create({ data: { email: input.email, name: input.name, passwordHash: await hashPassword(input.password), role: "USER" } });
    created = true;
    await audit({ action: "user.created", actorUserId: access.user.id, organizationId: orgId, targetType: "user", targetId: user.id, metadata: { email: user.email }, req });
  }
  const member = await db.organizationMember.create({ data: { organizationId: orgId, userId: user.id, role: input.role } });
  await audit({ action: "member.added", actorUserId: access.user.id, organizationId: orgId, targetType: "member", targetId: member.id, metadata: { userId: user.id, role: input.role }, req });
  await notify({ userId: user.id, organizationId: orgId, type: "info", title: "You were added to a workspace", body: `Role: ${input.role}`, link: "/dashboard" });
  return { member, created };
}

/** Members are always looked up by (id, organizationId) so ids from another tenant resolve to 404. */
async function findMemberInOrg(organizationId: string, memberId: string) {
  const member = await db.organizationMember.findFirst({ where: { id: memberId, organizationId } });
  if (!member) throw new ApiError("NOT_FOUND", "Member not found.");
  return member;
}

async function assertNotLastOwner(organizationId: string, memberRole: string) {
  if (memberRole !== "CLIENT_OWNER") return;
  const owners = await db.organizationMember.count({ where: { organizationId, role: "CLIENT_OWNER" } });
  if (owners <= 1) throw new ApiError("CONFLICT", "An organization must keep at least one owner.");
}

export async function updateMemberRole(access: OrgAccess, memberId: string, role: OrgRole, req?: Request) {
  if (!canAssignRole(actorRole(access), role)) throw new ApiError("FORBIDDEN");
  const member = await findMemberInOrg(access.organizationId, memberId);
  if (member.role === role) return member;
  if (role !== "CLIENT_OWNER") await assertNotLastOwner(access.organizationId, member.role);
  const updated = await db.organizationMember.update({ where: { id: member.id }, data: { role } });
  await audit({ action: "member.role_changed", actorUserId: access.user.id, organizationId: access.organizationId, targetType: "member", targetId: member.id, metadata: { userId: member.userId, from: member.role, to: role }, req });
  await notify({ userId: member.userId, organizationId: access.organizationId, type: "info", title: "Your role was updated", body: `New role: ${role}`, link: "/dashboard" });
  return updated;
}

export async function removeMember(access: OrgAccess, memberId: string, req?: Request) {
  const member = await findMemberInOrg(access.organizationId, memberId);
  await assertNotLastOwner(access.organizationId, member.role);
  await db.organizationMember.delete({ where: { id: member.id } });
  await audit({ action: "member.removed", actorUserId: access.user.id, organizationId: access.organizationId, targetType: "member", targetId: member.id, metadata: { userId: member.userId, role: member.role }, req });
}

export async function listOrgAuditLogs(organizationId: string, opts: { page: number; pageSize: number; action?: string }) {
  const where = { organizationId, ...(opts.action ? { action: opts.action } : {}) };
  const [items, total] = await Promise.all([
    db.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (opts.page - 1) * opts.pageSize,
      take: opts.pageSize,
      select: { id: true, action: true, targetType: true, targetId: true, metadata: true, createdAt: true, actor: { select: { name: true, email: true } } },
    }),
    db.auditLog.count({ where }),
  ]);
  return { items, total };
}
