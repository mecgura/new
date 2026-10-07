import type { Metadata } from "next";
import { Suspense } from "react";
import { getInboxContext } from "@/lib/inbox-context";
import { LoadingState } from "@/components/ds";
import { InboxApp } from "@/components/inbox/inbox-app";
import { NoWorkspace } from "@/components/whatsapp/states";

export const metadata: Metadata = { title: "Inbox" };

export default async function InboxPage() {
  const ctx = await getInboxContext();
  if (!ctx.active) return <NoWorkspace />;
  return (
    <Suspense fallback={<LoadingState />}>
      <InboxApp orgId={ctx.orgId} me={ctx.me} perms={ctx.perms} accounts={[...ctx.accounts]} activeAccountId={ctx.activeAccountId} />
    </Suspense>
  );
}
