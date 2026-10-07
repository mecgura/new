import type { Metadata } from "next";
import { getInboxContext } from "@/lib/inbox-context";
import { FlowsApp } from "@/components/flows/flows-app";
import { NoWorkspace } from "@/components/whatsapp/states";

export const metadata: Metadata = { title: "WhatsApp Flows" };

export default async function FlowsPage() {
  const ctx = await getInboxContext();
  if (!ctx.active) return <NoWorkspace />;
  return <FlowsApp orgId={ctx.orgId} canManage={ctx.perms["flows:manage"]} />;
}
