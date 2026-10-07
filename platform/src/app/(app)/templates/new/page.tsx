import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getInboxContext } from "@/lib/inbox-context";
import { listTemplateAccounts } from "@/services/templates/templates";
import { TemplateEditor } from "@/components/templates/template-editor";
import { NoWorkspace } from "@/components/whatsapp/states";

export const metadata: Metadata = { title: "New template" };

export default async function NewTemplatePage() {
  const ctx = await getInboxContext();
  if (!ctx.active) return <NoWorkspace />;
  if (!ctx.perms["templates:manage"]) redirect("/templates");
  const accounts = await listTemplateAccounts(ctx.orgId);
  if (!accounts.length) redirect("/templates");
  return <TemplateEditor orgId={ctx.orgId} accounts={accounts} canManage />;
}
