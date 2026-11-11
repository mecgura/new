import type { Metadata } from "next";
import { LabSettings } from "@/components/lab/lab-settings";
import { requireTenantPagePermission } from "@/lib/auth/context";

export const metadata: Metadata = { title: "Laboratory settings" };
export const dynamic = "force-dynamic";

export default async function LabSettingsPage() {
  const ctx = await requireTenantPagePermission("tests.view");
  return <LabSettings canConfigure={ctx.permissions.has("lab.configure")} />;
}
