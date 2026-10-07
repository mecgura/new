import type { Metadata } from "next";
import { ServiceMaster } from "@/components/billing/service-master";
import { requireTenantPagePermission } from "@/lib/auth/context";
import { loadBillingSettings } from "@/lib/services/billing-master";
import { tenantDb } from "@/lib/tenant/db";

export const metadata: Metadata = { title: "Billing services" };
export const dynamic = "force-dynamic";

export default async function ServicesPage() {
  const ctx = await requireTenantPagePermission("billing.view");
  const s = await loadBillingSettings(tenantDb(ctx), ctx.tenantId);
  return <ServiceMaster canConfigure={ctx.permissions.has("billing.configure")} currency={s.currency} />;
}
