import type { Metadata } from "next";
import { Lock } from "lucide-react";
import { getInboxContext } from "@/lib/inbox-context";
import { WebhooksApp } from "@/components/webhooks/webhooks-app";
import { Card, EmptyState } from "@/components/ds";
import { NoWorkspace } from "@/components/whatsapp/states";

export const metadata: Metadata = { title: "Webhooks" };

export default async function WebhooksPage() {
  const ctx = await getInboxContext();
  if (!ctx.active) return <NoWorkspace />;
  if (!ctx.perms["webhooks:read"]) {
    return (
      <Card>
        <EmptyState icon={Lock} title="Visible to owners and managers" description="Ask your workspace owner if you need webhook access." />
      </Card>
    );
  }
  return <WebhooksApp orgId={ctx.orgId} canManage={ctx.perms["webhooks:manage"]} />;
}
