import type { Metadata } from "next";
import { db } from "@/lib/db";
import { getInboxContext } from "@/lib/inbox-context";
import { roleHasPermission } from "@/lib/authz";
import { NoWorkspace } from "@/components/whatsapp/states";
import { ServiceLocked } from "@/components/whatsapp/service-locked";
import { Builder } from "@/components/landing/builder";
import { isServiceEnabled } from "@/services/whatsapp/guards";

export const metadata: Metadata = { title: "Page builder" };

export default async function PageBuilderPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getInboxContext();
  if (!ctx.active) return <NoWorkspace />;
  if (!(await isServiceEnabled(ctx.orgId, "LANDING_PAGES"))) return <ServiceLocked name="Landing pages" />;
  const org = await db.organization.findUniqueOrThrow({ where: { id: ctx.orgId }, select: { name: true } });
  return <Builder orgId={ctx.orgId} pageId={(await params).id} business={org.name} canManage={roleHasPermission(ctx.me.role, "pages:manage")} />;
}
