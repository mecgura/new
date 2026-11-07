import type { Metadata } from "next";
import { getInboxContext } from "@/lib/inbox-context";
import { roleHasPermission } from "@/lib/authz";
import { db } from "@/lib/db";
import { NoWorkspace } from "@/components/whatsapp/states";
import { ServiceLocked } from "@/components/whatsapp/service-locked";
import { SponsoredApp } from "@/components/sponsored/sponsored-app";
import { isServiceEnabled } from "@/services/whatsapp/guards";

export const metadata: Metadata = { title: "Sponsored spot" };

export default async function SponsoredPage() {
  const ctx = await getInboxContext();
  if (!ctx.active) return <NoWorkspace />;
  if (!(await isServiceEnabled(ctx.orgId, "SPONSORED_ADS"))) return <ServiceLocked name="Sponsored placement" />;
  const org = await db.organization.findUnique({ where: { id: ctx.orgId }, select: { name: true } });
  return <SponsoredApp orgId={ctx.orgId} orgName={org?.name ?? "Your business"} canManage={roleHasPermission(ctx.me.role, "sponsored:manage")} />;
}
