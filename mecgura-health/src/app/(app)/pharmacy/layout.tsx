import { PharmacyNav } from "@/components/pharmacy/pharmacy-nav";
import { PharmacyProvider } from "@/components/pharmacy/pharmacy-ui";
import { requireTenantPagePermission } from "@/lib/auth/context";
import { tenantDb } from "@/lib/tenant/db";

export default async function PharmacyLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireTenantPagePermission("pharmacy.view");
  const has = (p: Parameters<typeof ctx.permissions.has>[0]) => ctx.permissions.has(p);
  const currency = ((await tenantDb(ctx).billingSettings.findFirst({ where: { tenantId: ctx.tenantId }, select: { currency: true } })) as { currency: string } | null)?.currency ?? "INR";
  const perms = { view: true, dispense: has("pharmacy.dispense"), receive: has("pharmacy.receive") || has("pharmacy.purchase"), purchase: has("pharmacy.purchase"), medicines: has("pharmacy.medicines"), suppliers: has("pharmacy.suppliers"), adjust: has("pharmacy.adjust"), returnRequest: has("pharmacy.return_request"), returnApprove: has("pharmacy.return_approve"), reports: has("pharmacy.reports"), configure: has("pharmacy.configure") };
  return (
    <PharmacyProvider value={{ currency, perms }}>
      <div className="space-y-section">
        <h1 className="type-page-title">Pharmacy</h1>
        <PharmacyNav />
        {children}
      </div>
    </PharmacyProvider>
  );
}
