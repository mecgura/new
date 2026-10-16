import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { Badge, ButtonLink, Card, CardHeader, EmptyState } from "@/components/ui";
import { LEDGER_LABEL, dayLabel, daysText, stamp } from "@/components/pharmacy/pharmacy-labels";
import { requireTenantPagePermission } from "@/lib/auth/context";
import { formatMoney } from "@/lib/billing/money";
import { pharmacyDashboard } from "@/lib/services/pharmacy-reports";
import { tenantDb } from "@/lib/tenant/db";

export const metadata: Metadata = { title: "Pharmacy" };
export const dynamic = "force-dynamic";

export default async function PharmacyDashboardPage() {
  const ctx = await requireTenantPagePermission("pharmacy.view");
  const d = await pharmacyDashboard(ctx); const c = d.counts;
  const currency = ((await tenantDb(ctx).billingSettings.findFirst({ where: { tenantId: ctx.tenantId }, select: { currency: true } })) as { currency: string } | null)?.currency ?? "INR"; const m = (x: number) => formatMoney(x, currency);
  const has = ctx.permissions.has.bind(ctx.permissions);
  const tiles: [string, string, string, string?][] = [["Total medicines", String(c.totalMedicines), "/pharmacy/medicines"], ["Low stock", String(c.lowStock), "/pharmacy/medicines?status=low"], ["Out of stock", String(c.outOfStock), "/pharmacy/medicines?status=out"], ["Near expiry", String(c.nearExpiry), "/pharmacy/expiry?state=near"], ["Expired", String(c.expired), "/pharmacy/expiry?state=expired"], ["Today's dispensing", String(c.todayDispensing), "/pharmacy/dispensing?view=history"], ["Today's pharmacy sales", m(c.todaySalesMinor), "/pharmacy/dispensing?view=history"]];
  return (
    <div className="space-y-section">
      <div className="flex flex-wrap gap-2">
        {has("pharmacy.purchase") && <ButtonLink href="/pharmacy/purchases/new"><Plus aria-hidden className="size-4" />Purchase</ButtonLink>}
        {has("pharmacy.dispense") && <ButtonLink href="/pharmacy/dispensing" variant="outline">Dispense</ButtonLink>}
        {has("pharmacy.adjust") && <ButtonLink href="/pharmacy/adjustments" variant="outline">Stock adjustment</ButtonLink>}
        {has("pharmacy.medicines") && <ButtonLink href="/pharmacy/medicines?new=1" variant="outline">Add medicine</ButtonLink>}
      </div>
      <section aria-label="Pharmacy summary" role="list" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map(([label, value, href]) => <Link key={label} role="listitem" href={href} className="rounded-lg border border-line bg-surface p-3 no-underline hover:bg-surface-muted"><p className="type-caption">{label}</p><p className="type-page-title tabular-nums break-words !text-ink">{value}</p></Link>)}
      </section>
      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="p-card"><p className="type-caption">This month — dispensings</p><p className="type-card-title tabular-nums">{c.monthDispensing}</p></Card>
        <Card className="p-card"><p className="type-caption">This month — pharmacy sales</p><p className="type-card-title tabular-nums">{m(c.monthSalesMinor)}</p></Card>
        <Card className="p-card"><p className="type-caption">Stock value (at purchase cost)</p><p className="type-card-title tabular-nums">{m(d.stockValueMinor)}</p><p className="type-caption">{d.valuationMethod}</p></Card>
      </div>
      <div className="grid gap-section lg:grid-cols-2">
        <Card><CardHeader title="Low stock" description="Medicines at or below their reorder level. Nothing is ordered automatically." action={<Link href="/pharmacy/medicines?status=low" className="type-label">View all →</Link>} />
          {!d.lowStock.length ? <EmptyState title="No low-stock medicines." /> : <ul className="divide-y divide-line">{d.lowStock.map((x) => <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 p-card"><div className="min-w-0"><p className="type-label"><Link href={`/pharmacy/medicines/${x.id}`}>{x.name}</Link></p><p className="type-caption">{x.code} · {x.available} available · reorder at {x.reorderLevel}</p></div>{has("pharmacy.purchase") && <ButtonLink size="sm" variant="outline" href={`/pharmacy/purchases/new?medicineId=${x.id}`}>Create purchase</ButtonLink>}</li>)}</ul>}
        </Card>
        <Card><CardHeader title="Expiry" description={`Expired batches and batches expiring within ${d.nearExpiryDays} days that still hold stock.`} action={<Link href="/pharmacy/expiry" className="type-label">View all →</Link>} />
          {!d.expiring.length ? <EmptyState title="No expired or near-expiry batches." /> : <ul className="divide-y divide-line">{d.expiring.map((x) => <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 p-card"><div className="min-w-0"><p className="type-label"><Link href={`/pharmacy/stock/${x.id}`}>{x.name}</Link></p><p className="type-caption">Batch {x.batchNumber} · expiry {dayLabel(x.expiryDate)} · {x.quantity} units</p></div><Badge tone={x.state === "EXPIRED" ? "danger" : "warning"}>{daysText(x.daysRemaining)}</Badge></li>)}</ul>}
        </Card>
      </div>
      <Card><CardHeader title="Recent activity" description="Latest stock movements." action={<Link href="/pharmacy/ledger" className="type-label">Stock ledger →</Link>} />
        {!d.recent.length ? <EmptyState title="No stock movements yet." description="Receive a purchase or add opening stock to begin." /> : <ul className="divide-y divide-line">{d.recent.map((r) => <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 p-card"><div className="min-w-0"><p className="type-label">{r.medicineName}</p><p className="type-caption">Batch {r.batchNumber} · {LEDGER_LABEL[r.type] ?? r.type} · {r.user ?? "—"} · {stamp(r.createdAt)}</p></div><span className={`type-label tabular-nums ${r.quantity < 0 ? "!text-danger" : "!text-success"}`}>{r.quantity > 0 ? "+" : ""}{r.quantity}</span></li>)}</ul>}
      </Card>
    </div>
  );
}
