import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getInboxContext } from "@/lib/inbox-context";
import { idSchema } from "@/lib/validations";
import { db } from "@/lib/db";
import { getAutomationForOrg } from "@/services/automations/automations";
import { AutomationBuilder, type AutomationView } from "@/components/automations/builder";
import { LoadingState } from "@/components/ds";
import { NoWorkspace } from "@/components/whatsapp/states";

export const metadata: Metadata = { title: "Automation builder" };

export default async function AutomationPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getInboxContext();
  if (!ctx.active) return <NoWorkspace />;
  const id = idSchema.safeParse((await params).id);
  if (!id.success) notFound();
  if (!(await db.automation.count({ where: { id: id.data, organizationId: ctx.orgId } }))) notFound();
  const detail = await getAutomationForOrg(ctx.orgId, id.data);
  const view = JSON.parse(JSON.stringify(detail)) as AutomationView;
  return (
    <Suspense fallback={<LoadingState />}>
      <AutomationBuilder key={view.id} orgId={ctx.orgId} automation={view} accounts={[...ctx.accounts]} canManage={ctx.perms["automations:manage"]} />
    </Suspense>
  );
}
