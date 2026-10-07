import { cache } from "react";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { audit } from "@/lib/audit";
import {
  isOrgRole,
  normalizePlatformRole,
  roleHasPermission,
  type OrgPermission,
  type OrgRole,
  type PlatformRole,
} from "@/lib/authz";

export const ACTIVE_ORG_COOKIE = "mecgura_org";

export type Membership = {
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  organizationStatus: string;
  role: OrgRole;
};

export type SessionUser = {
  id: string;
  email: string;
  name: string | null;
  platformRole: PlatformRole;
  memberships: Membership[];
};

/**
 * Resolves the signed-in user from the session cookie AND the database.
 * The JWT alone is never trusted for authorization: the account must still
 * exist, be active, and match the session version (revoked on password
 * change / "sign out everywhere"). Memberships always come from the DB.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const session = await auth();
  const id = (session?.user as { id?: string } | undefined)?.id;
  if (!id) return null;
  const sv = (session as { sv?: number } | null)?.sv ?? 0;

  const user = await db.user.findUnique({
    where: { id },
    include: { memberships: { include: { organization: true }, orderBy: { createdAt: "asc" } } },
  });
  if (!user || user.status !== "active" || user.sessionVersion !== sv) return null;

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    platformRole: normalizePlatformRole(user.role),
    memberships: user.memberships
      .filter((m) => isOrgRole(m.role))
      .map((m) => ({
        organizationId: m.organizationId,
        organizationName: m.organization.name,
        organizationSlug: m.organization.slug,
        organizationStatus: m.organization.status,
        role: m.role as OrgRole,
      })),
  };
});

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new ApiError("UNAUTHENTICATED");
  return user;
}

export async function requireSuperAdmin(req?: Request): Promise<SessionUser> {
  const user = await requireUser();
  if (user.platformRole !== "SUPER_ADMIN") {
    await audit({ action: "permission.denied", actorUserId: user.id, targetType: "admin", metadata: { area: "admin", path: req ? new URL(req.url).pathname : undefined }, req });
    throw new ApiError("FORBIDDEN");
  }
  return user;
}

export type OrgAccess = { user: SessionUser; organizationId: string; role: OrgRole | null; isPlatformAdmin: boolean };

/**
 * Tenant guard. The organization id comes from the URL/body, so it is
 * treated as untrusted: access is granted only if the DB says this user is a
 * member of that organization with a role holding `permission`.
 * SUPER_ADMIN (platform operator) may access any organization.
 * Unknown org and "not a member" both return 403 so tenant ids can't be probed.
 */
export async function requireOrgAccess(organizationId: string, permission: OrgPermission, req?: Request): Promise<OrgAccess> {
  const user = await requireUser();
  if (user.platformRole === "SUPER_ADMIN") {
    const exists = await db.organization.count({ where: { id: organizationId } });
    if (!exists) throw new ApiError("NOT_FOUND", "Organization not found.");
    return { user, organizationId, role: null, isPlatformAdmin: true };
  }

  const membership = user.memberships.find((m) => m.organizationId === organizationId);
  const allowed =
    membership && membership.organizationStatus === "active" && roleHasPermission(membership.role, permission);
  if (!allowed) {
    await audit({
      action: "permission.denied",
      actorUserId: user.id,
      // Only attribute the event to the org if the user actually belongs to it;
      // never write into another tenant's audit trail.
      organizationId: membership ? organizationId : null,
      targetType: "organization",
      targetId: organizationId,
      metadata: { permission, reason: !membership ? "not_a_member" : membership.organizationStatus !== "active" ? "organization_suspended" : "role" },
      req,
    });
    throw new ApiError("FORBIDDEN");
  }
  return { user, organizationId, role: membership.role, isPlatformAdmin: false };
}

/** Picks the active organization: requested (validated against memberships) → first active membership. */
export function resolveActiveMembership(user: SessionUser, requestedOrgId?: string | null): Membership | null {
  const active = user.memberships.filter((m) => m.organizationStatus === "active");
  return active.find((m) => m.organizationId === requestedOrgId) ?? active[0] ?? null;
}
