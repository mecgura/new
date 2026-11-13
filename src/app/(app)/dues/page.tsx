import type { Metadata } from "next";
import { getInboxContext } from "@/lib/inbox-context";
import { DuesApp } from "@/components/dues/dues-app";
import { NoWorkspace } from "@/components/whatsapp/states";

export const metadata: Metadata = { title: "Payment reminders" };

export default async function DuesPage() {
  const ctx = await getInboxContext();
  if (!ctx.active) return <NoWorkspace />;
  return <DuesApp orgId={ctx.orgId} canManage={ctx.perms["campaigns:manage"]} />;
}
