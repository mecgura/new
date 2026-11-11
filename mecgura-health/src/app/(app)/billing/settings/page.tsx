import type { Metadata } from "next";
import { BillingSettingsForm } from "@/components/billing/billing-settings-form";
import { requireTenantPagePermission } from "@/lib/auth/context";

export const metadata: Metadata = { title: "Billing settings" };
export const dynamic = "force-dynamic";

export default async function BillingSettingsPage() {
  await requireTenantPagePermission("billing.view");
  return <BillingSettingsForm />;
}
