import type { Metadata } from "next";
import { Suspense } from "react";
import { getInboxContext } from "@/lib/inbox-context";
import { LoadingState } from "@/components/ds";
import { InboxApp } from "@/components/inbox/inbox-app";
import { NoWorkspace } from "@/components/whatsapp/states";
import { hasFeature } from "@/services/billing/entitlements";
import { isServiceEnabled } from "@/services/whatsapp/guards";
import { db } from "@/lib/db";

export const metadata: Metadata = { title: "Inbox" };

export default async function InboxPage() {
  const ctx = await getInboxContext();
  if (!ctx.active) return <NoWorkspace />;
  const [phone, ai, waNumbers] = await Promise.all([
    hasFeature(ctx.orgId, "calling"),
    isServiceEnabled(ctx.orgId, "AI_CALLING"),
    db.whatsAppAccount.findMany({ where: { organizationId: ctx.orgId, callingEnabled: true, status: "connected" }, select: { id: true } }),
  ]);
  return (
    <Suspense fallback={<LoadingState />}>
      <InboxApp orgId={ctx.orgId} me={ctx.me} perms={ctx.perms} accounts={[...ctx.accounts]} activeAccountId={ctx.activeAccountId} calling={{ phone, ai, waAccountIds: waNumbers.map((a) => a.id) }} />
    </Suspense>
  );
}
