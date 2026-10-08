import type { Metadata } from "next";
import { CommunicationCenter } from "@/components/communications/communication-center";
import { requireTenantPagePermission } from "@/lib/auth/context";

export const metadata: Metadata = { title: "Communications" };
export const dynamic = "force-dynamic";
export default async function Page() {
  const ctx = await requireTenantPagePermission("communications.view");
  return <CommunicationCenter canTemplates={ctx.permissions.has("communications.templates")} canConfigure={ctx.permissions.has("communications.configure")} />;
}
