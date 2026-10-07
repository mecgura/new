import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ACTIVE_ORG_COOKIE, getSessionUser, resolveActiveMembership, type Membership, type SessionUser } from "@/lib/session";
import type { ShellOrg, ShellUser } from "@/components/app/app-shell";

/** Server-side context for protected pages. Redirects to /login when the session is missing or revoked. */
export async function getAppContext(): Promise<{
  user: SessionUser;
  active: Membership | null;
  shellUser: ShellUser;
  shellOrgs: ShellOrg[];
}> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const active = resolveActiveMembership(user, (await cookies()).get(ACTIVE_ORG_COOKIE)?.value);
  return {
    user,
    active,
    shellUser: { name: user.name, email: user.email, isSuperAdmin: user.platformRole === "SUPER_ADMIN" },
    shellOrgs: user.memberships
      .filter((m) => m.organizationStatus === "active")
      .map((m) => ({ id: m.organizationId, name: m.organizationName, role: m.role })),
  };
}
