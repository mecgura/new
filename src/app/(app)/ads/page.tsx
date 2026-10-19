import type { Metadata } from "next";
import { getInboxContext } from "@/lib/inbox-context";
import { AdsApp } from "@/components/ads/ads-app";
import { NoWorkspace } from "@/components/whatsapp/states";
import { ServiceLocked } from "@/components/whatsapp/service-locked";
import { isServiceEnabled } from "@/services/whatsapp/guards";

export const metadata: Metadata = { title: "Ads Manager" };

export default async function AdsPage() {
  const ctx = await getInboxContext();
  if (!ctx.active) return <NoWorkspace />;
  if (!(await isServiceEnabled(ctx.orgId, "ADS_MANAGER"))) return <ServiceLocked name="Ads Manager" />;
  return <AdsApp orgId={ctx.orgId} canManage={ctx.perms["ads:manage"]} canConnect={ctx.perms["ads:connect"]} />;
}
