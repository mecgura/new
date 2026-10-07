import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getInboxContext } from "@/lib/inbox-context";
import { idSchema } from "@/lib/validations";
import { findCampaign } from "@/services/campaigns/campaigns";
import { CampaignWizard } from "@/components/campaigns/campaign-wizard";
import { CampaignReport } from "@/components/campaigns/campaign-report";
import type { CampaignView } from "@/components/campaigns/types";
import { NoWorkspace } from "@/components/whatsapp/states";

export const metadata: Metadata = { title: "Campaign" };

export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getInboxContext();
  if (!ctx.active) return <NoWorkspace />;
  const id = idSchema.safeParse((await params).id);
  if (!id.success) notFound();
  const found = await findCampaign(ctx.orgId, id.data);
  if (!found) notFound();
  const c = JSON.parse(JSON.stringify(found)) as CampaignView;
  // Drafts open the 7-step wizard (managers only); everything else shows the live report.
  if (c.status === "draft" && ctx.perms["campaigns:manage"]) return <CampaignWizard key={c.id} orgId={ctx.orgId} campaign={c} accounts={[...ctx.accounts]} />;
  return <CampaignReport key={`${c.id}-${c.status}`} orgId={ctx.orgId} campaign={c} canManage={ctx.perms["campaigns:manage"]} />;
}
