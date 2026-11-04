import type { Metadata } from "next";
import { getInboxContext } from "@/lib/inbox-context";
import { roleHasPermission } from "@/lib/authz";
import { NoWorkspace } from "@/components/whatsapp/states";
import { ServiceLocked } from "@/components/whatsapp/service-locked";
import { ReviewsApp } from "@/components/reviews/reviews-app";
import { isServiceEnabled } from "@/services/whatsapp/guards";

export const metadata: Metadata = { title: "Reviews" };

export default async function ReviewsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const ctx = await getInboxContext();
  if (!ctx.active) return <NoWorkspace />;
  if (!(await isServiceEnabled(ctx.orgId, "REVIEWS"))) return <ServiceLocked name="Reviews & reputation" />;
  const { tab } = await searchParams;
  return <ReviewsApp orgId={ctx.orgId} canSend={roleHasPermission(ctx.me.role, "reviews:send")} canManage={roleHasPermission(ctx.me.role, "reviews:manage")} initialTab={["overview", "requests", "feedback", "settings"].includes(tab ?? "") ? tab! : "overview"} />;
}
