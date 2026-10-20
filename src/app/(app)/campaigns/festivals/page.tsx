import type { Metadata } from "next";
import { getInboxContext } from "@/lib/inbox-context";
import { FestivalPlanner } from "@/components/campaigns/festival-planner";
import { NoWorkspace } from "@/components/whatsapp/states";

export const metadata: Metadata = { title: "Festival campaigns" };

export default async function FestivalCampaignsPage() {
  const ctx = await getInboxContext();
  if (!ctx.active) return <NoWorkspace />;
  return <FestivalPlanner orgId={ctx.orgId} canManage={ctx.perms["campaigns:manage"]} />;
}
