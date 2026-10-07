import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getAppContext } from "@/lib/app-context";
import { readActiveNumber } from "@/lib/active-number";
import { roleHasPermission, type OrgPermission } from "@/lib/authz";

const PERMS = [
  "inbox:view_all",
  "inbox:reply",
  "inbox:note",
  "inbox:assign",
  "inbox:claim",
  "inbox:transfer",
  "contacts:write",
  "contacts:delete",
  "contacts:import",
  "contacts:export",
  "members:manage",
  "whatsapp:manage",
  "templates:manage",
  "campaigns:manage",
  "quality:read",
  "automations:manage",
  "flows:manage",
  "ai:manage",
  "appointments:manage",
  "api:read",
  "api:manage",
  "webhooks:read",
  "webhooks:manage",
  "billing:read",
  "billing:manage",
  "analytics:read",
] as const satisfies readonly OrgPermission[];

export type InboxPerms = Record<(typeof PERMS)[number], boolean>;

/** Server context for inbox / contacts / team pages (tenant + role re-validated from the DB). */
export async function getInboxContext() {
  const { user, active } = await getAppContext();
  if (!active) {
    if (user.platformRole === "SUPER_ADMIN") redirect("/admin");
    return { active: null } as const;
  }
  const orgId = active.organizationId;
  const [accounts, me] = await Promise.all([
    db.whatsAppAccount.findMany({
      where: { organizationId: orgId, status: { in: ["connected", "demo"] } },
      orderBy: { createdAt: "asc" },
      select: { id: true, displayName: true, phoneNumber: true, status: true, isDemo: true },
    }),
    db.organizationMember.findFirst({ where: { organizationId: orgId, userId: user.id }, select: { agentStatus: true } }),
  ]);
  const activeAccountId = await readActiveNumber(orgId, accounts.map((a) => a.id));
  return {
    active,
    orgId,
    activeAccountId,
    me: { id: user.id, name: user.name ?? user.email, role: active.role, agentStatus: me?.agentStatus ?? "offline" },
    perms: Object.fromEntries(PERMS.map((p) => [p, roleHasPermission(active.role, p)])) as InboxPerms,
    accounts,
  } as const;
}
