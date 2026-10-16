import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { Badge, ButtonLink, Card, CardBody, CardHeader, EmptyState, StatusBadge } from "@/components/ui";
import { CashierCard } from "@/components/billing/cashier-card";
import { METHOD_LABEL, PAYMENT_STATUS_LABEL, PAYMENT_STATUS_TONE, dayLabel } from "@/components/billing/billing-ui";
import { requireTenantPagePermission } from "@/lib/auth/context";
import { formatMoney } from "@/lib/billing/money";
import { billingDashboard } from "@/lib/services/billing-reports";

export const metadata: Metadata = { title: "Billing" };
export const dynamic = "force-dynamic";

export default async function BillingDashboardPage() {
  const ctx = await requireTenantPagePermission("billing.view");
  const d = await billingDashboard(ctx);
  const m = (x: number) => formatMoney(x, d.currency);
  const tiles: [string, string, string?][] = [["Today's billing", m(d.todaysRevenue)], ["Collected today", m(d.todaysCollections)], ["Pending amount", m(d.pendingMinor), "/billing/outstanding"], ["Refunded today", m(d.refundsToday), "/billing/refunds"], ["Invoices today", String(d.invoicesToday), "/billing/invoices"], ["Outstanding invoices", String(d.outstandingInvoices), "/billing/outstanding"], ["Partial payments", String(d.partialPayments), "/billing/invoices?status=PARTIALLY_PAID"], ["Overdue", String(d.overdueInvoices), "/billing/invoices?status=OVERDUE"]];
  return (
    <div className="space-y-section">
      <div className="flex flex-wrap gap-2">
        {d.can.newInvoice && <ButtonLink href="/billing/invoices/new"><Plus aria-hidden className="size-4" />New invoice</ButtonLink>}
        <ButtonLink href="/billing/invoices?outstanding=1" variant="outline">Collect payment</ButtonLink><ButtonLink href="/billing/outstanding" variant="outline">View outstanding</ButtonLink><ButtonLink href="/billing/payments?view=receipts" variant="outline">View receipts</ButtonLink><ButtonLink href="/billing/refunds" variant="outline">View refunds</ButtonLink>
      </div>
      <section aria-label="Billing summary" role="list" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map(([label, value, href]) => { const inner = <><p className="type-caption">{label}</p><p className="type-page-title tabular-nums break-words">{value}</p></>; return href ? <Link key={label} role="listitem" href={href} className="rounded-lg border border-line bg-surface p-3 no-underline hover:bg-surface-muted">{inner}</Link> : <div key={label} role="listitem" className="rounded-lg border border-line bg-surface p-3">{inner}</div>; })}
      </section>
      <div className="grid gap-3 sm:grid-cols-2"><Card><CardBody><p className="type-caption">Last 7 days collected</p><p className="type-card-title tabular-nums">{m(d.weekCollected)}</p></CardBody></Card><Card><CardBody><p className="type-caption">This month collected</p><p className="type-card-title tabular-nums">{m(d.monthCollected)}</p></CardBody></Card></div>
      <CashierCard />
      <Card>
        <CardHeader title="Recent transactions" description="Latest payments received." />
        {!d.recent.length ? <EmptyState title="No payments yet" description="Payments you record appear here." /> : (
          <ul className="divide-y divide-line">{d.recent.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 p-card">
              <div className="min-w-0"><p className="type-label">{r.patientName}</p><p className="type-caption"><Link href={`/billing/invoices/${r.invoiceId}`} className="tabular-nums">{r.invoiceNumber}</Link> · {METHOD_LABEL[r.method] ?? r.method} · {dayLabel(r.date)}</p></div>
              <div className="flex items-center gap-2"><span className="type-label tabular-nums">{m(r.amountMinor)}</span><StatusBadge tone={PAYMENT_STATUS_TONE[r.status]}>{PAYMENT_STATUS_LABEL[r.status]}</StatusBadge></div>
            </li>))}</ul>
        )}
      </Card>
      {d.pendingRefunds.length > 0 && <Card><CardHeader title="Refunds waiting" action={<Link href="/billing/refunds" className="type-label">Open →</Link>} /><ul className="divide-y divide-line">{d.pendingRefunds.map((r) => <li key={r.id} className="flex items-center justify-between gap-2 p-card"><span className="type-secondary tabular-nums">{r.refundNumber} · {r.invoiceNumber}</span><span className="flex items-center gap-2"><span className="type-label tabular-nums">{m(r.amountMinor)}</span><Badge tone="warning">{r.status.toLowerCase()}</Badge></span></li>)}</ul></Card>}
    </div>
  );
}
