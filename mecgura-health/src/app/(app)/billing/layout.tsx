import { BillingNav } from "@/components/billing/billing-nav";
import { requireTenantPagePermission } from "@/lib/auth/context";

export default async function BillingLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireTenantPagePermission("billing.view");
  return (
    <div className="space-y-section">
      <h1 className="type-page-title">Billing</h1>
      <BillingNav reports={ctx.permissions.has("billing.reports")} />
      {children}
    </div>
  );
}
