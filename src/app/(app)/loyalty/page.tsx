import type { Metadata } from "next";
import { getInboxContext } from "@/lib/inbox-context";
import { roleHasPermission } from "@/lib/authz";
import { NoWorkspace } from "@/components/whatsapp/states";
import { ServiceLocked } from "@/components/whatsapp/service-locked";
import { LoyaltyApp } from "@/components/loyalty/loyalty-app";
import { isServiceEnabled } from "@/services/whatsapp/guards";

export const metadata: Metadata = { title: "Loyalty & referrals" };

export default async function LoyaltyPage() {
  const ctx = await getInboxContext();
  if (!ctx.active) return <NoWorkspace />;
  if (!(await isServiceEnabled(ctx.orgId, "LOYALTY"))) return <ServiceLocked name="Referral & loyalty" />;
  return <LoyaltyApp orgId={ctx.orgId} canWrite={roleHasPermission(ctx.me.role, "loyalty:write")} canManage={roleHasPermission(ctx.me.role, "loyalty:manage")} />;
}
