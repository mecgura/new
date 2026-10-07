import type { Metadata } from "next";
import { getInboxContext } from "@/lib/inbox-context";
import { TemplatesApp } from "@/components/templates/templates-app";
import { NoWorkspace } from "@/components/whatsapp/states";

export const metadata: Metadata = { title: "Templates" };

export default async function TemplatesPage() {
  const ctx = await getInboxContext();
  if (!ctx.active) return <NoWorkspace />;
  return <TemplatesApp orgId={ctx.orgId} canManage={ctx.perms["templates:manage"]} />;
}
