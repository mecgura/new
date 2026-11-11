import type { Metadata } from "next";
import Link from "next/link";
import { Badge, ButtonLink, Card, EmptyState, Field, Pagination, StatusBadge } from "@/components/ui";
import { INVOICE_STATUS_LABEL, INVOICE_STATUS_TONE, dayLabel } from "@/components/billing/billing-ui";
import { requireTenantPagePermission } from "@/lib/auth/context";
import { formatMoney } from "@/lib/billing/money";
import { listInvoices } from "@/lib/services/billing-invoices";

export const metadata: Metadata = { title: "Outstanding" };
export const dynamic = "force-dynamic";

export default async function OutstandingPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string; overdue?: string }> }) {
  const ctx = await requireTenantPagePermission("billing.view");
  const sp = await searchParams;
  const data = await listInvoices(ctx, { outstanding: true, status: sp.overdue === "1" ? "OVERDUE" : undefined, q: sp.q, page: Math.max(1, Number(sp.page) || 1) });
  const canCollect = ctx.permissions.has("billing.collect");
  const qs = (over: Record<string, string | undefined>) => `/billing/outstanding?${new URLSearchParams(Object.entries({ ...sp, ...over }).filter(([, v]) => v) as [string, string][])}`;
  return (
    <div className="space-y-section">
      <p className="type-secondary">Invoices with money still to collect. Nobody is contacted automatically.</p>
      <form method="get" action="/billing/outstanding" className="flex flex-wrap items-end gap-3" aria-label="Filter outstanding">
        <Field label="Search" hint="Patient, ID, mobile or invoice number"><input name="q" defaultValue={sp.q ?? ""} maxLength={60} className="type-body min-h-control w-full min-w-56 rounded-md border border-line-strong bg-surface px-3" /></Field>
        <label className="type-label flex min-h-control items-center gap-2"><input type="checkbox" name="overdue" value="1" defaultChecked={sp.overdue === "1"} />Overdue only</label>
        <button type="submit" className="type-button min-h-control rounded-md border border-line-strong px-4 hover:bg-surface-muted">Apply</button>
      </form>
      {!data.rows.length ? <Card><EmptyState title="No outstanding payments." /></Card> : (
        <>
          <Card className="hidden overflow-hidden md:block"><table className="w-full text-left"><caption className="sr-only">Outstanding invoices</caption>
            <thead><tr className="type-caption border-b border-line bg-surface-muted"><th className="p-3">Patient</th><th className="p-3">Invoice</th><th className="p-3">Date</th><th className="p-3 text-right">Total</th><th className="p-3 text-right">Paid</th><th className="p-3 text-right">Due</th><th className="p-3">Due date</th><th className="p-3">Status</th><th className="p-3 text-right">Action</th></tr></thead>
            <tbody>{data.rows.map((r) => <tr key={r.id} className="border-b border-line last:border-0"><td className="p-3"><p className="type-label">{r.patient?.name}</p><p className="type-caption tabular-nums">{r.patient?.code}</p></td><td className="p-3 tabular-nums"><Link href={`/billing/invoices/${r.id}`}>{r.invoiceNumber}</Link></td><td className="p-3 type-secondary">{dayLabel(r.invoiceDate)}</td><td className="p-3 text-right tabular-nums">{formatMoney(r.totalMinor, r.currency)}</td><td className="p-3 text-right tabular-nums">{formatMoney(r.paidMinor, r.currency)}</td><td className="p-3 text-right tabular-nums font-semibold">{formatMoney(r.dueMinor, r.currency)}</td><td className="p-3 type-secondary">{dayLabel(r.dueDate)}</td><td className="p-3"><StatusBadge tone={INVOICE_STATUS_TONE[r.displayStatus]}>{INVOICE_STATUS_LABEL[r.displayStatus]}</StatusBadge></td>
              <td className="p-3"><div className="flex flex-wrap justify-end gap-1.5"><ButtonLink href={`/billing/invoices/${r.id}`} size="sm" variant="outline" aria-label={`View ${r.invoiceNumber}`}>View</ButtonLink>{canCollect && <ButtonLink href={`/billing/invoices/${r.id}?do=pay`} size="sm" aria-label={`Collect payment for ${r.invoiceNumber}`}>Collect</ButtonLink>}{r.patient && <ButtonLink href={`/billing/outstanding/statement/${r.patient.id}`} size="sm" variant="ghost">Statement</ButtonLink>}</div></td></tr>)}</tbody></table></Card>
          <ul className="space-y-3 md:hidden" aria-label="Outstanding invoices">{data.rows.map((r) => <li key={r.id} className="space-y-1.5 rounded-lg border border-line bg-surface p-3"><div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="type-label">{r.patient?.name}</p><p className="type-caption"><Link href={`/billing/invoices/${r.id}`} className="tabular-nums">{r.invoiceNumber}</Link> · due {dayLabel(r.dueDate)}</p></div><Badge tone={r.displayStatus === "OVERDUE" ? "danger" : "warning"}>{formatMoney(r.dueMinor, r.currency)}</Badge></div><div className="flex flex-wrap gap-1.5"><ButtonLink href={`/billing/invoices/${r.id}`} size="sm" variant="outline">View</ButtonLink>{canCollect && <ButtonLink href={`/billing/invoices/${r.id}?do=pay`} size="sm">Collect</ButtonLink>}{r.patient && <ButtonLink href={`/billing/outstanding/statement/${r.patient.id}`} size="sm" variant="ghost">Statement</ButtonLink>}</div></li>)}</ul>
        </>
      )}
      <Pagination page={data.page} pageCount={Math.max(1, Math.ceil(data.total / data.pageSize))} hrefFor={(p) => qs({ page: String(p) })} />
    </div>
  );
}
