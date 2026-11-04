import type { Metadata } from "next";
import { Lock } from "lucide-react";
import { getInboxContext } from "@/lib/inbox-context";
import { Card, EmptyState } from "@/components/ds";
import { NoWorkspace } from "@/components/whatsapp/states";
import { IntegrationsApp } from "@/components/integrations/integrations-app";

export const metadata: Metadata = { title: "Integrations" };

export default async function IntegrationsPage() {
  const ctx = await getInboxContext();
  if (!ctx.active) return <NoWorkspace />;
  if (!ctx.perms["webhooks:read"]) {
    return (
      <Card>
        <EmptyState icon={Lock} title="Visible to owners and managers" description="Ask your workspace owner to connect your store or other apps." />
      </Card>
    );
  }
  return <IntegrationsApp orgId={ctx.orgId} canManage={ctx.perms["webhooks:manage"]} />;
}
