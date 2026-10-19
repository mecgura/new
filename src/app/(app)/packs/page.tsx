import type { Metadata } from "next";
import { getWhatsAppContext } from "@/lib/whatsapp-context";
import { PacksApp } from "@/components/packs/packs-app";
import { NoWorkspace } from "@/components/whatsapp/states";

export const metadata: Metadata = { title: "Industry packs" };

export default async function PacksPage() {
  const ctx = await getWhatsAppContext();
  if (!ctx.active) return <NoWorkspace />;
  return <PacksApp orgId={ctx.orgId} canManage={ctx.canManage} />;
}
