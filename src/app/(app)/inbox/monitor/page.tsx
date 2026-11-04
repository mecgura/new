import type { Metadata } from "next";
import { Lock } from "lucide-react";
import { getInboxContext } from "@/lib/inbox-context";
import { Card, EmptyState } from "@/components/ds";
import { NoWorkspace } from "@/components/whatsapp/states";
import { InboxMonitor } from "@/components/inbox/inbox-monitor";

export const metadata: Metadata = { title: "Inbox monitor" };

export default async function InboxMonitorPage() {
  const ctx = await getInboxContext();
  if (!ctx.active) return <NoWorkspace />;
  if (!ctx.perms["inbox:view_all"]) return <Card><EmptyState icon={Lock} title="For owners and managers" description="The team monitor shows every agent's chats and reply times." /></Card>;
  return <InboxMonitor orgId={ctx.orgId} canEdit={ctx.perms["inbox:assign"]} />;
}
