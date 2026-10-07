import type { Metadata } from "next";
import { getInboxContext } from "@/lib/inbox-context";
import { CampaignsApp } from "@/components/campaigns/campaigns-app";
import { NoWorkspace } from "@/components/whatsapp/states";

export const metadata: Metadata = { title: "Campaigns" };

export default async function CampaignsPage() {
  const ctx = await getInboxContext();
  if (!ctx.active) return <NoWorkspace />;
  return <CampaignsApp orgId={ctx.orgId} canManage={ctx.perms["campaigns:manage"]} accounts={[...ctx.accounts]} activeAccountId={ctx.activeAccountId} />;
}
