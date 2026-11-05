import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getInboxContext } from "@/lib/inbox-context";
import { EasySetup } from "@/components/automations/easy-setup";
import { NoWorkspace } from "@/components/whatsapp/states";

export const metadata: Metadata = { title: "Easy setup · Automations" };

export default async function EasySetupPage() {
  const ctx = await getInboxContext();
  if (!ctx.active) return <NoWorkspace />;
  if (!ctx.perms["automations:manage"]) redirect("/automations");
  return <EasySetup orgId={ctx.orgId} accounts={[...ctx.accounts]} activeAccountId={ctx.activeAccountId} />;
}
