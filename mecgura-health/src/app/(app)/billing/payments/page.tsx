import type { Metadata } from "next";
import Link from "next/link";
import { ButtonLink, Card, EmptyState, Field, Pagination, Select, StatusBadge } from "@/components/ui";
import { METHOD_LABEL, PAYMENT_STATUS_LABEL, PAYMENT_STATUS_TONE, dayLabel } from "@/components/billing/billing-ui";
import { requireTenantPagePermission } from "@/lib/auth/context";
import { formatMoney } from "@/lib/billing/money";
import { listPayments, type PaymentRow } from "@/lib/services/billing-payments";
import { loadBillingSettings } from "@/lib/services/billing-master";
import { tenantDb } from "@/lib/tenant/db";

export const metadata: Metadata = { title: "Payments" };
export const dynamic = "force-dynamic";
type SP = { view?: string; q?: string; from?: string; to?: string; method?: string; status?: string; staffId?: string; page?: string };

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireTenantPagePermission("billing.view");
  const sp = await searchParams; const receipts = sp.view === "receipts";
  const data = await listPayments(ctx, { ...sp, status: receipts ? "SUCCESS" : sp.status, page: Math.max(1, Number(sp.page) || 1) });
  const tdb = tenantDb(ctx);
  const [staff, settings] = await Promise.all([tdb.user.findMany({ where: { role: { key: { in: ["RECEPTIONIST", "ACCOUNTANT", "CLINIC_ADMIN"] } }, status: "ACTIVE", deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }), loadBillingSettings(tdb, ctx.tenantId)]);
  void settings;
  const qs = (over: Record<string, string | undefined>) => `/billing/payments?${new URLSearchParams(Object.entries({ ...sp, ...over }).filter(([, v]) => v) as [string, string][])}`;
  return (
    <div className="space-y-section">
      <p className="type-secondary">{receipts ? "A receipt is issued for every payment received." : "All payments, including cancelled ones. Only received payments count in collections."}</p>
      <form method="get" action="/billing/payments" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Filter payments">
        {receipts && <input type="hidden" name="view" value="receipts" />}
        <Field label="Search" hint="Patient, ID, mobile, payment/receipt/invoice no. or reference"><input name="q" defaultValue={sp.q ?? ""} maxLength={60} className="type-body min-h-control w-full rounded-md border border-line-strong bg-surface px-3" /></Field>
        <Field label="Method"><Select name="method" defaultValue={sp.method ?? ""} placeholder="Any method" options={Object.entries(METHOD_LABEL).map(([value, label]) => ({ value, label }))} /></Field>
        {!receipts && <Field label="Status"><Select name="status" defaultValue={sp.status ?? ""} placeholder="Any status" options={Object.entries(PAYMENT_STATUS_LABEL).map(([value, label]) => ({ value, label }))} /></Field>}
        <Field label="Received by"><Select name="staffId" defaultValue={sp.staffId ?? ""} placeholder="Anyone" options={staff.map((d: { id: string; name: string }) => ({ value: d.id, label: d.name }))} /></Field>
        <Field label="From"><input type="date" name="from" defaultValue={sp.from ?? ""} className="type-body min-h-control w-full rounded-md border border-line-strong bg-surface px-3" /></Field>
        <Field label="To"><input type="date" name="to" defaultValue={sp.to ?? ""} className="type-body min-h-control w-full rounded-md border border-line-strong bg-surface px-3" /></Field>
        <div className="flex items-end gap-2"><button type="submit" className="type-button min-h-control rounded-md border border-line-strong px-4 hover:bg-surface-muted">Apply filters</button><Link href={receipts ? "/billing/payments?view=receipts" : "/billing/payments"} className="type-label min-h-control content-center px-2">Clear</Link></div>
      </form>
      {!data.rows.length ? <Card><EmptyState title={receipts ? "No receipts found." : "No payments found."} description={sp.q ? "Nothing matches your search." : "No transactions for the selected period."} /></Card> : (
        <>
          <Card className="hidden overflow-hidden md:block"><table className="w-full text-left"><caption className="sr-only">{receipts ? "Receipts" : "Payments"}</caption>
            <thead><tr className="type-caption border-b border-line bg-surface-muted"><th className="p-3">{receipts ? "Receipt" : "Payment"}</th><th className="p-3">Patient</th><th className="p-3">Invoice</th><th className="p-3">Date</th><th className="p-3">Method</th><th className="p-3 text-right">Amount</th><th className="p-3">Status</th><th className="p-3 text-right">Open</th></tr></thead>
            <tbody>{data.rows.map((r) => <Row key={r.id} r={r} receipts={receipts} />)}</tbody></table></Card>
          <ul className="space-y-3 md:hidden" aria-label="Payments">{data.rows.map((r) => <li key={r.id} className="space-y-1 rounded-lg border border-line bg-surface p-3"><div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="type-label tabular-nums">{receipts ? r.receiptNumber : r.paymentNumber}</p><p className="type-secondary">{r.patient?.name}</p></div><StatusBadge tone={PAYMENT_STATUS_TONE[r.status]}>{PAYMENT_STATUS_LABEL[r.status]}</StatusBadge></div><p className="type-caption">{dayLabel(r.paymentDate)} · {METHOD_LABEL[r.method]} · <Link href={`/billing/invoices/${r.invoiceId}`}>{r.invoiceNumber}</Link></p><div className="flex items-center justify-between"><span className="type-label tabular-nums">{formatMoney(r.amountMinor)}</span>{["SUCCESS", "PARTIALLY_REFUNDED", "REFUNDED"].includes(r.status) && <ButtonLink href={`/billing/payments/${r.id}/receipt`} size="sm" variant="outline">Receipt</ButtonLink>}</div></li>)}</ul>
        </>
      )}
      <Pagination page={data.page} pageCount={Math.max(1, Math.ceil(data.total / data.pageSize))} hrefFor={(p) => qs({ page: String(p) })} />
    </div>
  );
}
function Row({ r, receipts }: { r: PaymentRow; receipts: boolean }) {
  return (<tr className="border-b border-line last:border-0"><td className="p-3 tabular-nums font-semibold">{receipts ? r.receiptNumber : r.paymentNumber}</td><td className="p-3"><p className="type-label">{r.patient?.name}</p><p className="type-caption tabular-nums">{r.patient?.code}</p></td><td className="p-3 tabular-nums"><Link href={`/billing/invoices/${r.invoiceId}`}>{r.invoiceNumber}</Link></td><td className="p-3 type-secondary">{dayLabel(r.paymentDate)}</td><td className="p-3 type-secondary">{METHOD_LABEL[r.method]}{r.transactionReference ? <span className="type-caption block">{r.transactionReference}</span> : null}</td><td className="p-3 text-right tabular-nums">{formatMoney(r.amountMinor)}</td><td className="p-3"><StatusBadge tone={PAYMENT_STATUS_TONE[r.status]}>{PAYMENT_STATUS_LABEL[r.status]}</StatusBadge></td><td className="p-3 text-right">{["SUCCESS", "PARTIALLY_REFUNDED", "REFUNDED"].includes(r.status) ? <ButtonLink href={`/billing/payments/${r.id}/receipt`} size="sm" variant="outline" aria-label={`Receipt ${r.receiptNumber}`}>Receipt</ButtonLink> : "—"}</td></tr>);
}
