import type { Metadata } from "next";
import { getInboxContext } from "@/lib/inbox-context";
import { NoWorkspace } from "@/components/whatsapp/states";
import { CampaignPerformance } from "@/components/campaigns/campaign-performance";

export const metadata: Metadata = { title: "Campaign performance" };

export default async function CampaignPerformancePage() {
  const ctx = await getInboxContext();
  if (!ctx.active) return <NoWorkspace />;
  return <CampaignPerformance orgId={ctx.orgId} />;
}
