import type { Metadata } from "next";
import { getWhatsAppContext } from "@/lib/whatsapp-context";
import { ChannelsApp } from "@/components/channels/channels-app";
import { NoWorkspace } from "@/components/whatsapp/states";

export const metadata: Metadata = { title: "Channels" };

export default async function ChannelsPage() {
  const ctx = await getWhatsAppContext();
  if (!ctx.active) return <NoWorkspace />;
  return <ChannelsApp orgId={ctx.orgId} canManage={ctx.canManage} />;
}
