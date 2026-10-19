import type { Metadata } from "next";
import { getWhatsAppContext } from "@/lib/whatsapp-context";
import { ChannelsApp } from "@/components/channels/channels-app";
import { NoWorkspace } from "@/components/whatsapp/states";
import { ServiceLocked } from "@/components/whatsapp/service-locked";
import { isServiceEnabled } from "@/services/whatsapp/guards";

export const metadata: Metadata = { title: "Channels" };

export default async function ChannelsPage() {
  const ctx = await getWhatsAppContext();
  if (!ctx.active) return <NoWorkspace />;
  if (!(await isServiceEnabled(ctx.orgId, "OMNICHANNEL"))) return <ServiceLocked name="The omnichannel inbox" />;
  return <ChannelsApp orgId={ctx.orgId} canManage={ctx.canManage} />;
}
