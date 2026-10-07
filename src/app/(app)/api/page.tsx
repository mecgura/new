import type { Metadata } from "next";
import { getInboxContext } from "@/lib/inbox-context";
import { ApiApp } from "@/components/api/api-app";
import { Card, EmptyState } from "@/components/ds";
import { NoWorkspace } from "@/components/whatsapp/states";
import { Lock } from "lucide-react";

export const metadata: Metadata = { title: "API" };

export default async function ApiPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const ctx = await getInboxContext();
  if (!ctx.active) return <NoWorkspace />;
  if (!ctx.perms["api:read"]) {
    return (
      <Card>
        <EmptyState icon={Lock} title="Visible to owners and managers" description="Ask your workspace owner if you need API access." />
      </Card>
    );
  }
  const { tab } = await searchParams;
  return <ApiApp orgId={ctx.orgId} canManage={ctx.perms["api:manage"]} initialTab={typeof tab === "string" ? tab : "keys"} />;
}
