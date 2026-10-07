import type { Metadata } from "next";
import { Lock } from "lucide-react";
import { getInboxContext } from "@/lib/inbox-context";
import { AnalyticsApp } from "@/components/analytics/analytics-app";
import { Card, EmptyState } from "@/components/ds";
import { NoWorkspace } from "@/components/whatsapp/states";
import { hasFeature } from "@/services/billing/entitlements";

export const metadata: Metadata = { title: "Analytics" };

export default async function AnalyticsPage() {
  const ctx = await getInboxContext();
  if (!ctx.active) return <NoWorkspace />;
  if (!ctx.perms["analytics:read"]) {
    return (
      <Card>
        <EmptyState icon={Lock} title="Visible to owners and managers" description="Ask your workspace owner for analytics." />
      </Card>
    );
  }
  if (!(await hasFeature(ctx.orgId, "analytics"))) {
    return (
      <Card>
        <EmptyState icon={Lock} title="Analytics isn't in your plan" description="Upgrade your plan in Billing to see analytics." />
      </Card>
    );
  }
  return <AnalyticsApp orgId={ctx.orgId} numbers={ctx.accounts.map((a) => ({ id: a.id, displayName: a.displayName, phoneNumber: a.phoneNumber }))} />;
}
