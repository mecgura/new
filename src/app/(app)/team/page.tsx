import type { Metadata } from "next";
import { Check, Minus } from "lucide-react";
import { getInboxContext } from "@/lib/inbox-context";
import { ORG_PERMISSIONS, ORG_ROLES, ORG_ROLE_LABELS, PERMISSION_LABELS, roleHasPermission, type OrgPermission } from "@/lib/authz";
import { listMembers } from "@/lib/services/organizations";
import { listTeam } from "@/services/inbox/team";
import { Card, CardHeader, PageHeader, Table, TBody, TD, TH, THead, TR } from "@/components/ds";
import { TeamManager, type TeamMember as ManagedMember } from "@/components/app/settings/team-manager";
import { PresenceBoard } from "@/components/team/presence-board";
import { NoWorkspace } from "@/components/whatsapp/states";

export const metadata: Metadata = { title: "Team" };

export default async function TeamPage() {
  const ctx = await getInboxContext();
  if (!ctx.active) return <NoWorkspace />;
  const canReadMembers = roleHasPermission(ctx.active.role, "members:read");
  const [presence, rows] = await Promise.all([listTeam(ctx.orgId), canReadMembers ? listMembers(ctx.orgId) : Promise.resolve([])]);
  const members: ManagedMember[] = rows.map((m) => ({
    id: m.id,
    role: m.role as ManagedMember["role"],
    userId: m.user.id,
    name: m.user.name,
    email: m.user.email,
    status: m.user.status,
    lastLoginAt: m.user.lastLoginAt?.toISOString() ?? null,
  }));
  const permissions = (Object.keys(PERMISSION_LABELS) as OrgPermission[]).filter((p) => p in ORG_PERMISSIONS);

  return (
    <>
      <PageHeader title="Team" description="Members, roles, availability and what each role can do." />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        <div className="min-w-0 space-y-4 xl:col-span-3">
          {canReadMembers ? (
            <TeamManager organizationId={ctx.orgId} members={members} currentUserId={ctx.me.id} canManage={ctx.perms["members:manage"]} />
          ) : null}
          <Card>
            <CardHeader title="Roles & permissions" description="Owners manage the workspace; managers run the team; agents handle their own chats." />
            <Table caption="Role permissions" className="min-w-[520px]">
              <THead>
                <tr>
                  <TH>Permission</TH>
                  {ORG_ROLES.map((r) => <TH key={r} className="text-center">{ORG_ROLE_LABELS[r]}</TH>)}
                </tr>
              </THead>
              <TBody>
                {permissions.map((p) => (
                  <TR key={p}>
                    <TD>{PERMISSION_LABELS[p]}</TD>
                    {ORG_ROLES.map((r) => (
                      <TD key={r} className="text-center">
                        {roleHasPermission(r, p) ? (
                          <><Check className="mx-auto size-4 text-app-success" aria-hidden="true" /><span className="sr-only">Allowed</span></>
                        ) : (
                          <><Minus className="mx-auto size-4 text-app-subtle" aria-hidden="true" /><span className="sr-only">Not allowed</span></>
                        )}
                      </TD>
                    ))}
                  </TR>
                ))}
              </TBody>
            </Table>
          </Card>
        </div>
        <div className="min-w-0 xl:col-span-2">
          <PresenceBoard orgId={ctx.orgId} meId={ctx.me.id} initial={presence} />
        </div>
      </div>
    </>
  );
}
