import type { Metadata } from "next";
import { FollowUpSettings } from "@/components/followups/followup-settings";
import { requireTenantPagePermission } from "@/lib/auth/context";

export const metadata: Metadata = { title: "Follow-up settings" };
export const dynamic = "force-dynamic";

export default async function FollowUpSettingsPage() {
  await requireTenantPagePermission("followups.view");
  return <FollowUpSettings />;
}
