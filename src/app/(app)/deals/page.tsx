import type { Metadata } from "next";
import { db } from "@/lib/db";
import { getInboxContext } from "@/lib/inbox-context";
import { roleHasPermission } from "@/lib/authz";
import { NoWorkspace } from "@/components/whatsapp/states";
import { DealsApp } from "@/components/crm/deals-app";

export const metadata: Metadata = { title: "Deals" };

export default async function DealsPage() {
  const ctx = await getInboxContext();
  if (!ctx.active) return <NoWorkspace />;
  const members = await db.organizationMember.findMany({ where: { organizationId: ctx.orgId }, select: { userId: true, user: { select: { name: true, email: true } } }, orderBy: { createdAt: "asc" } });
  return (
    <DealsApp
      orgId={ctx.orgId}
      meId={ctx.me.id}
      canWrite={roleHasPermission(ctx.me.role, "deals:write")}
      canManage={roleHasPermission(ctx.me.role, "deals:manage")}
      members={members.map((m) => ({ id: m.userId, name: m.user.name || m.user.email }))}
    />
  );
}
