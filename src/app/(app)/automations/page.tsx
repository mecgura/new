import type { Metadata } from "next";
import { getInboxContext } from "@/lib/inbox-context";
import { AutomationsApp } from "@/components/automations/automations-app";
import { NoWorkspace } from "@/components/whatsapp/states";

export const metadata: Metadata = { title: "Automations" };

export default async function AutomationsPage() {
  const ctx = await getInboxContext();
  if (!ctx.active) return <NoWorkspace />;
  return <AutomationsApp orgId={ctx.orgId} canManage={ctx.perms["automations:manage"]} accounts={[...ctx.accounts]} activeAccountId={ctx.activeAccountId} />;
}
