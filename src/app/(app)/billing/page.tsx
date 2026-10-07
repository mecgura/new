import type { Metadata } from "next";
import { Lock } from "lucide-react";
import { getInboxContext } from "@/lib/inbox-context";
import { BillingApp } from "@/components/billing/billing-app";
import { Card, EmptyState } from "@/components/ds";
import { NoWorkspace } from "@/components/whatsapp/states";

export const metadata: Metadata = { title: "Billing" };

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const ctx = await getInboxContext();
  if (!ctx.active) return <NoWorkspace />;
  if (!ctx.perms["billing:read"]) {
    return (
      <Card>
        <EmptyState icon={Lock} title="Visible to owners and managers" description="Ask your workspace owner about plan and billing." />
      </Card>
    );
  }
  const { tab } = await searchParams;
  return <BillingApp orgId={ctx.orgId} canManage={ctx.perms["billing:manage"]} initialTab={typeof tab === "string" ? tab : "plan"} />;
}
