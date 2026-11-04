import type { Metadata } from "next";
import { getInboxContext } from "@/lib/inbox-context";
import { roleHasPermission } from "@/lib/authz";
import { NoWorkspace } from "@/components/whatsapp/states";
import { ServiceLocked } from "@/components/whatsapp/service-locked";
import { PagesList } from "@/components/landing/pages-list";
import { isServiceEnabled } from "@/services/whatsapp/guards";

export const metadata: Metadata = { title: "Landing pages" };

export default async function LandingPagesPage() {
  const ctx = await getInboxContext();
  if (!ctx.active) return <NoWorkspace />;
  if (!(await isServiceEnabled(ctx.orgId, "LANDING_PAGES"))) return <ServiceLocked name="Landing pages" />;
  return <PagesList orgId={ctx.orgId} canManage={roleHasPermission(ctx.me.role, "pages:manage")} />;
}
