import type { Metadata } from "next";
import { getWhatsAppContext } from "@/lib/whatsapp-context";
import { LeadAdsApp } from "@/components/leads/lead-ads-app";
import { NoWorkspace, ServiceDisabled } from "@/components/whatsapp/states";

export const metadata: Metadata = { title: "Lead Ads" };

export default async function LeadAdsPage() {
  const ctx = await getWhatsAppContext();
  if (!ctx.active) return <NoWorkspace />;
  if (!ctx.serviceEnabled) return <ServiceDisabled />;
  return <LeadAdsApp orgId={ctx.orgId} canManage={ctx.canManage} />;
}
