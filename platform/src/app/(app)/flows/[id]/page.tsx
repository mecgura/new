import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getInboxContext } from "@/lib/inbox-context";
import { idSchema } from "@/lib/validations";
import { db } from "@/lib/db";
import { getFlow } from "@/services/flows/flows";
import { FlowBuilder, type FlowView } from "@/components/flows/flow-builder";
import { NoWorkspace } from "@/components/whatsapp/states";

export const metadata: Metadata = { title: "Flow builder" };

export default async function FlowPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getInboxContext();
  if (!ctx.active) return <NoWorkspace />;
  const id = idSchema.safeParse((await params).id);
  if (!id.success || !(await db.flow.count({ where: { id: id.data, organizationId: ctx.orgId } }))) notFound();
  const view = JSON.parse(JSON.stringify(await getFlow(ctx.orgId, id.data))) as FlowView;
  return <FlowBuilder key={view.id} orgId={ctx.orgId} flow={view} canManage={ctx.perms["flows:manage"]} />;
}
