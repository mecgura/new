import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardBody, CardHeader, EmptyState, Field, Select } from "@/components/ui";
import { METHOD_LABEL, dayLabel } from "@/components/billing/billing-ui";
import { requireTenantPagePermission } from "@/lib/auth/context";
import { formatMoney } from "@/lib/billing/money";
import { AppError } from "@/lib/errors";
import { todayIn } from "@/lib/scheduling/time";
import { financialReport } from "@/lib/services/billing-reports";
import { listServices } from "@/lib/services/billing-master";
import { tenantDb } from "@/lib/tenant/db";

export const metadata: Metadata = { title: "Financial reports" };
export const dynamic = "force-dynamic";
type SP = { from?: string; to?: string; doctorId?: string; serviceId?: string; method?: string };

export default async function ReportsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireTenantPagePermission("billing.reports");
  const sp = await searchParams;
  const today = todayIn(ctx.tenant.timezone);
  const filters = { from: sp.from || today, to: sp.to || today, doctorId: sp.doctorId, serviceId: sp.serviceId, method: sp.method };
  let rep: Awaited<ReturnType<typeof financialReport>> | undefined, error: string | undefined;
  try { rep = await financialReport(ctx, filters); } catch (e) { if (e instanceof AppError) error = e.message; else throw e; }
  const tdb = tenantDb(ctx);
  const [doctors, services] = await Promise.all([tdb.user.findMany({ where: { role: { key: "DOCTOR" }, status: "ACTIVE", deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }), listServices(ctx, {}).then((r) => r.services)]);
  const m = (x: number) => formatMoney(x, rep?.currency ?? "INR");
  const exp = (kind: string) => `/api/billing/reports/export?${new URLSearchParams({ kind, from: filters.from, to: filters.to, ...(sp.doctorId ? { doctorId: sp.doctorId } : {}), ...(sp.serviceId ? { serviceId: sp.serviceId } : {}), ...(sp.method ? { method: sp.method } : {}) })}`;
  const canExport = ctx.permissions.has("billing.export");
  return (
    <div className="space-y-section">
      <p className="type-secondary">Operational financial summary from the clinic&apos;s own records. This is not profit or accounting.</p>
      <form method="get" action="/billing/reports" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5" aria-label="Report filters">
        <Field label="From"><input type="date" name="from" defaultValue={filters.from} className="type-body min-h-control w-full rounded-md border border-line-strong bg-surface px-3" /></Field>
        <Field label="To"><input type="date" name="to" defaultValue={filters.to} className="type-body min-h-control w-full rounded-md border border-line-strong bg-surface px-3" /></Field>
        <Field label="Doctor"><Select name="doctorId" defaultValue={sp.doctorId ?? ""} placeholder="All doctors" options={doctors.map((d: { id: string; name: string }) => ({ value: d.id, label: d.name }))} /></Field>
        <Field label="Service"><Select name="serviceId" defaultValue={sp.serviceId ?? ""} placeholder="All services" options={services.map((s) => ({ value: s.id, label: s.serviceName }))} /></Field>
        <Field label="Payment method"><Select name="method" defaultValue={sp.method ?? ""} placeholder="All methods" options={Object.entries(METHOD_LABEL).map(([value, label]) => ({ value, label }))} /></Field>
        <div className="flex items-end"><button type="submit" className="type-button min-h-control rounded-md border border-line-strong px-4 hover:bg-surface-muted">Apply filters</button></div>
      </form>
      {error && <Card><EmptyState title="Can't show this report" description={error} /></Card>}
      {rep && (
        <>
          <section aria-label="Financial summary" role="list" className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            {([["Gross billing", rep.summary.grossBilledMinor], ["Collected", rep.summary.collectedMinor], ["Outstanding", rep.summary.outstandingMinor], ["Refunded", rep.summary.refundedMinor], ["Net collection", rep.summary.netCollectionMinor]] as [string, number][]).map(([l, v]) => <div key={l} role="listitem" className="rounded-lg border border-line bg-surface p-3"><p className="type-caption">{l}</p><p className="type-card-title tabular-nums break-words">{m(v)}</p></div>)}
          </section>
          <Card><CardHeader title="Collection by payment method" description={`${dayLabel(rep.from)} – ${dayLabel(rep.to)} · received payments only; refunds shown separately.`} action={canExport ? <a href={exp("methods")} className="type-label">Export CSV</a> : undefined} />
            <div className="overflow-x-auto"><table className="w-full text-left"><thead><tr className="type-caption border-b border-line bg-surface-muted"><th className="p-3">Method</th><th className="p-3 text-right">Collected</th><th className="p-3 text-right">Refunded</th></tr></thead><tbody>{rep.methods.map((r) => <tr key={r.method} className="border-b border-line last:border-0"><td className="p-3">{METHOD_LABEL[r.method]}</td><td className="p-3 text-right tabular-nums">{m(r.collectedMinor)}</td><td className="p-3 text-right tabular-nums">{m(r.refundedMinor)}</td></tr>)}<tr className="font-semibold"><td className="p-3">Total</td><td className="p-3 text-right tabular-nums">{m(rep.summary.collectedMinor)}</td><td className="p-3 text-right tabular-nums">{m(rep.summary.refundedMinor)}</td></tr></tbody></table></div></Card>
          <Card><CardHeader title="Date-wise collection" action={canExport ? <a href={exp("collection")} className="type-label">Export CSV</a> : undefined} />
            {!rep.days.length ? <EmptyState title="No transactions for the selected period." /> : <div className="overflow-x-auto"><table className="w-full text-left"><thead><tr className="type-caption border-b border-line bg-surface-muted"><th className="p-3">Date</th><th className="p-3 text-right">Collected</th><th className="p-3 text-right">Refunded</th><th className="p-3 text-right">Net</th></tr></thead><tbody>{rep.days.map((d) => <tr key={d.date} className="border-b border-line last:border-0"><td className="p-3">{dayLabel(d.date)}</td><td className="p-3 text-right tabular-nums">{m(d.collectedMinor)}</td><td className="p-3 text-right tabular-nums">{m(d.refundedMinor)}</td><td className="p-3 text-right tabular-nums">{m(d.netMinor)}</td></tr>)}</tbody></table></div>}</Card>
          <Card><CardHeader title="Service-wise billing" action={canExport ? <a href={exp("services")} className="type-label">Export CSV</a> : undefined} />
            {!rep.services.length ? <EmptyState title="No billed services for the selected period." /> : <div className="overflow-x-auto"><table className="w-full text-left"><thead><tr className="type-caption border-b border-line bg-surface-muted"><th className="p-3">Service</th><th className="p-3 text-right">Quantity</th><th className="p-3 text-right">Billed</th></tr></thead><tbody>{rep.services.map((s) => <tr key={`${s.code}|${s.name}`} className="border-b border-line last:border-0"><td className="p-3">{s.name} {s.code && <span className="type-caption">{s.code}</span>}</td><td className="p-3 text-right tabular-nums">{s.qty}</td><td className="p-3 text-right tabular-nums">{m(s.totalMinor)}</td></tr>)}</tbody></table></div>}</Card>
          <Card><CardHeader title="Outstanding invoices" action={canExport ? <a href={exp("outstanding")} className="type-label">Export CSV</a> : undefined} />
            {!rep.outstanding.length ? <EmptyState title="No outstanding payments." /> : <div className="overflow-x-auto"><table className="w-full text-left"><thead><tr className="type-caption border-b border-line bg-surface-muted"><th className="p-3">Invoice</th><th className="p-3">Patient</th><th className="p-3">Due date</th><th className="p-3 text-right">Total</th><th className="p-3 text-right">Due</th></tr></thead><tbody>{rep.outstanding.map((o) => <tr key={o.id} className="border-b border-line last:border-0"><td className="p-3 tabular-nums"><Link href={`/billing/invoices/${o.id}`}>{o.invoiceNumber}</Link></td><td className="p-3">{o.patientName}</td><td className="p-3">{dayLabel(o.dueDate)}{o.overdue ? " (overdue)" : ""}</td><td className="p-3 text-right tabular-nums">{m(o.totalMinor)}</td><td className="p-3 text-right tabular-nums">{m(o.dueMinor)}</td></tr>)}</tbody></table></div>}</Card>
          <Card><CardHeader title="Refund summary" action={canExport ? <a href={exp("refunds")} className="type-label">Export CSV</a> : undefined} /><CardBody>{!rep.refunds.length ? <p className="type-secondary">No refunds.</p> : <ul className="divide-y divide-line">{rep.refunds.map((r) => <li key={r.refundNumber} className="flex flex-wrap justify-between gap-2 py-2 type-secondary"><span className="tabular-nums">{r.refundNumber} · {r.invoiceNumber} · {dayLabel(r.date)} · {r.status.toLowerCase()}</span><span className="tabular-nums">{m(r.amountMinor)}</span></li>)}</ul>}</CardBody></Card>
        </>
      )}
    </div>
  );
}
