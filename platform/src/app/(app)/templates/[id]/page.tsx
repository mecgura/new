import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getInboxContext } from "@/lib/inbox-context";
import { idSchema } from "@/lib/validations";
import { findTemplate, listTemplateAccounts } from "@/services/templates/templates";
import { TemplateEditor } from "@/components/templates/template-editor";
import type { TemplateView } from "@/components/templates/types";
import { NoWorkspace } from "@/components/whatsapp/states";

export const metadata: Metadata = { title: "Template" };

export default async function TemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getInboxContext();
  if (!ctx.active) return <NoWorkspace />;
  const id = idSchema.safeParse((await params).id);
  if (!id.success) notFound();
  const [t, accounts] = await Promise.all([findTemplate(ctx.orgId, id.data), listTemplateAccounts(ctx.orgId)]);
  if (!t) notFound();
  const view = JSON.parse(JSON.stringify(t)) as TemplateView;
  return <TemplateEditor key={view.id} orgId={ctx.orgId} accounts={accounts} template={view} canManage={ctx.perms["templates:manage"]} />;
}
