import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { Badge, ButtonLink, Card, EmptyState, Field, Pagination, Select, StatusBadge } from "@/components/ui";
import { INVOICE_STATUS_LABEL, INVOICE_STATUS_TONE, METHOD_LABEL, dayLabel } from "@/components/billing/billing-ui";
import { requireTenantPagePermission } from "@/lib/auth/context";
import { formatMoney } from "@/lib/billing/money";
import { listInvoices, type InvoiceRow } from "@/lib/services/billing-invoices";
import { listServices } from "@/lib/services/billing-master";
import { tenantDb } from "@/lib/tenant/db";

export const metadata: Metadata = { title: "Invoices" };
export const dynamic = "force-dynamic";
type SP = { status?: string; q?: string; from?: string; to?: string; doctorId?: string; method?: string; serviceId?: string; staffId?: string; outstanding?: string; page?: string };
const STATUSES = ["DRAFT", "ISSUED", "PARTIALLY_PAID", "PAID", "OVERDUE", "CANCELLED", "REFUNDED", "PARTIALLY_REFUNDED"];

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireTenantPagePermission("billing.view");
  const sp = await searchParams;
  const data = await listInvoices(ctx, { ...sp, outstanding: sp.outstanding === "1", page: Math.max(1, Number(sp.page) || 1) });
  const tdb = tenantDb(ctx);
  const [doctors, staff, services] = await Promise.all([
    tdb.user.findMany({ where: { role: { key: "DOCTOR" }, status: "ACTIVE", deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    tdb.user.findMany({ where: { role: { key: { in: ["RECEPTIONIST", "ACCOUNTANT", "CLINIC_ADMIN"] } }, status: "ACTIVE", deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    listServices(ctx, {}).then((r) => r.services).catch(() => []),
  ]);
  const qs = (over: Record<string, string | undefined>) => `/billing/invoices?${new URLSearchParams(Object.entries({ ...sp, ...over }).filter(([, v]) => v) as [string, string][])}`;
  return (
    <div className="space-y-section">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="type-secondary">{sp.outstanding === "1" ? "Invoices with money still to collect." : "All invoices. Totals are calculated on the server."}</p>
        {ctx.permissions.has("billing.create") && <ButtonLink href="/billing/invoices/new"><Plus aria-hidden className="size-4" />New invoice</ButtonLink>}
      </div>
      <form method="get" action="/billing/invoices" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Filter invoices">
        <Field label="Search" hint="Patient, ID, mobile, invoice/payment/receipt no. or reference"><input name="q" defaultValue={sp.q ?? ""} maxLength={60} className="type-body min-h-control w-full rounded-md border border-line-strong bg-surface px-3" /></Field>
        <Field label="Status"><Select name="status" defaultValue={sp.status ?? ""} placeholder="Any status" options={STATUSES.map((v) => ({ value: v, label: INVOICE_STATUS_LABEL[v] }))} /></Field>
        <Field label="From"><input type="date" name="from" defaultValue={sp.from ?? ""} className="type-body min-h-control w-full rounded-md border border-line-strong bg-surface px-3" /></Field>
        <Field label="To"><input type="date" name="to" defaultValue={sp.to ?? ""} className="type-body min-h-control w-full rounded-md border border-line-strong bg-surface px-3" /></Field>
        <Field label="Doctor"><Select name="doctorId" defaultValue={sp.doctorId ?? ""} placeholder="All doctors" options={doctors.map((d: { id: string; name: string }) => ({ value: d.id, label: d.name }))} /></Field>
        <Field label="Payment method"><Select name="method" defaultValue={sp.method ?? ""} placeholder="Any method" options={Object.entries(METHOD_LABEL).map(([value, label]) => ({ value, label }))} /></Field>
        <Field label="Service"><Select name="serviceId" defaultValue={sp.serviceId ?? ""} placeholder="Any service" options={services.map((s) => ({ value: s.id, label: s.serviceName }))} /></Field>
        <Field label="Staff"><Select name="staffId" defaultValue={sp.staffId ?? ""} placeholder="Anyone" options={staff.map((d: { id: string; name: string }) => ({ value: d.id, label: d.name }))} /></Field>
        {sp.outstanding === "1" && <input type="hidden" name="outstanding" value="1" />}
        <div className="flex items-end gap-2"><button type="submit" className="type-button min-h-control rounded-md border border-line-strong px-4 hover:bg-surface-muted">Apply filters</button><Link href="/billing/invoices" className="type-label min-h-control content-center px-2">Clear</Link></div>
      </form>
      {!data.rows.length ? <Card><EmptyState title={sp.outstanding === "1" ? "No outstanding payments." : "No invoices found."} description={sp.q || sp.status ? "Nothing matches your filters." : undefined} /></Card> : (
        <>
          <Card className="hidden overflow-hidden md:block"><table className="w-full text-left"><caption className="sr-only">Invoices</caption>
            <thead><tr className="type-caption border-b border-line bg-surface-muted"><th className="p-3">Invoice</th><th className="p-3">Patient</th><th className="p-3">Date</th><th className="p-3 text-right">Total</th><th className="p-3 text-right">Paid</th><th className="p-3 text-right">Due</th><th className="p-3">Status</th><th className="p-3 text-right">Open</th></tr></thead>
            <tbody>{data.rows.map((r) => <Row key={r.id} r={r} />)}</tbody></table></Card>
          <ul className="space-y-3 md:hidden" aria-label="Invoices">{data.rows.map((r) => <Cardlet key={r.id} r={r} />)}</ul>
        </>
      )}
      <Pagination page={data.page} pageCount={Math.max(1, Math.ceil(data.total / data.pageSize))} hrefFor={(p) => qs({ page: String(p) })} />
    </div>
  );
}
function Row({ r }: { r: InvoiceRow }) {
  const m = (x: number) => formatMoney(x, r.currency);
  return (<tr className="border-b border-line last:border-0"><td className="p-3 tabular-nums"><Link href={`/billing/invoices/${r.id}`} className="font-semibold">{r.invoiceNumber}</Link></td><td className="p-3">{r.patient ? <><p className="type-label">{r.patient.name}</p><p className="type-caption tabular-nums">{r.patient.code}</p></> : "—"}</td><td className="p-3 type-secondary">{dayLabel(r.invoiceDate)}</td><td className="p-3 text-right tabular-nums">{m(r.totalMinor)}</td><td className="p-3 text-right tabular-nums">{m(r.paidMinor)}</td><td className="p-3 text-right tabular-nums">{m(r.dueMinor)}</td><td className="p-3"><StatusBadge tone={INVOICE_STATUS_TONE[r.displayStatus]}>{INVOICE_STATUS_LABEL[r.displayStatus]}</StatusBadge></td><td className="p-3 text-right"><ButtonLink href={`/billing/invoices/${r.id}`} size="sm" variant="outline" aria-label={`Open invoice ${r.invoiceNumber}`}>Open</ButtonLink></td></tr>);
}
function Cardlet({ r }: { r: InvoiceRow }) {
  const m = (x: number) => formatMoney(x, r.currency);
  return (<li className="space-y-1 rounded-lg border border-line bg-surface p-3"><div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="type-label"><Link href={`/billing/invoices/${r.id}`} className="tabular-nums">{r.invoiceNumber}</Link></p><p className="type-secondary">{r.patient?.name ?? "—"}</p></div><StatusBadge tone={INVOICE_STATUS_TONE[r.displayStatus]}>{INVOICE_STATUS_LABEL[r.displayStatus]}</StatusBadge></div>
    <p className="type-caption">{dayLabel(r.invoiceDate)}</p><div className="flex flex-wrap items-center justify-between gap-2"><span className="type-label tabular-nums">{m(r.totalMinor)}</span>{r.dueMinor > 0 && <Badge tone="warning">Due {m(r.dueMinor)}</Badge>}<ButtonLink href={`/billing/invoices/${r.id}`} size="sm" variant="outline">Open</ButtonLink></div></li>);
}
