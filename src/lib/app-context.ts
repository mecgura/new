import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { ACTIVE_ORG_COOKIE, getSessionUser, resolveActiveMembership, type Membership, type SessionUser } from "@/lib/session";
import type { ShellOrg, ShellUser } from "@/components/app/app-shell";

/** Server-side context for protected pages. Redirects to /login when the session is missing or revoked. */
export async function getAppContext(): Promise<{
  user: SessionUser;
  active: Membership | null;
  shellUser: ShellUser;
  shellOrgs: ShellOrg[];
  /** True when a Super Admin is inside a client workspace (support access). */
  supportMode: boolean;
}> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const requested = (await cookies()).get(ACTIVE_ORG_COOKIE)?.value;
  let active = resolveActiveMembership(user, requested);
  let supportMode = false;
  let supportOrg: ShellOrg | null = null;
  // Super Admin support access: the platform operator may step into any workspace
  // (validated against the DB, never trusted from the cookie alone).
  if (user.platformRole === "SUPER_ADMIN" && requested && active?.organizationId !== requested) {
    const org = await db.organization.findUnique({ where: { id: requested }, select: { id: true, name: true, slug: true, status: true } });
    if (org) {
      active = { organizationId: org.id, organizationName: org.name, organizationSlug: org.slug, organizationStatus: org.status, role: "CLIENT_OWNER" };
      supportMode = true;
      supportOrg = { id: org.id, name: org.name, role: "CLIENT_OWNER" };
    }
  }
  return {
    supportMode,
    user,
    active,
    shellUser: { name: user.name, email: user.email, isSuperAdmin: user.platformRole === "SUPER_ADMIN" },
    shellOrgs: [
      ...user.memberships.filter((m) => m.organizationStatus === "active").map((m) => ({ id: m.organizationId, name: m.organizationName, role: m.role })),
      ...(supportOrg ? [supportOrg] : []),
    ],
  };
}
