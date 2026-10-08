import type { Metadata } from "next";
import { Empty, FilterTabs, PageTitle, Pager, Pill, RowLink, Section } from "@/components/portal/portal-server";
import { INVOICE_STATUS, METHOD, dayLabel, money } from "@/components/portal/portal-labels";
import { requirePatientContext } from "@/lib/portal/ctx";
import { listInvoices, listPayments } from "@/lib/services/portal-records";

export const metadata: Metadata = { title: "Bills" };
export const dynamic = "force-dynamic";
export default async function BillingPage({ searchParams }: { searchParams: Promise<{ view?: string; filter?: string; page?: string }> }) {
  const sp = await searchParams; const ctx = await requirePatientContext(); const view = sp.view === "payments" ? "payments" : "bills";
  const inv = view === "bills" ? await listInvoices(ctx, { filter: sp.filter, page: Number(sp.page) }) : null; const pay = view === "payments" ? await listPayments(ctx, { page: Number(sp.page) }) : null;
  return (
    <div>
      <PageTitle title="Bills and payments" />
      <FilterTabs base="/portal/billing" param="view" current={view === "payments" ? "payments" : ""} items={[["", "Bills"], ["payments", "Payments & receipts"]]} />
      {inv && (
        <>
          {inv.outstandingMinor > 0 && <div className="mb-4 rounded-2xl border border-line bg-surface p-4"><p className="type-caption">Total outstanding</p><p className="type-page-title tabular-nums">{money(inv.outstandingMinor)}</p><p className="type-caption mt-1">Online payment isn&apos;t available yet. Please pay at the clinic.</p></div>}
          <FilterTabs base="/portal/billing" current={inv.filter === "all" ? "" : inv.filter} items={[["", "All"], ["unpaid", "Unpaid"], ["overdue", "Overdue"], ["paid", "Paid"]]} />
          <Section>{!inv.rows.length ? <Empty title="No bills" hint="Bills the clinic issues to you appear here." /> : <ul className="divide-y divide-line">{inv.rows.map((i) => <RowLink key={i.id} href={`/portal/billing/invoices/${i.id}`} title={`${i.invoiceNumber} · ${dayLabel(i.date)}`} meta={i.outstandingMinor > 0 ? `${money(i.outstandingMinor, i.currency)} due${i.dueDate ? ` by ${dayLabel(i.dueDate)}` : ""}` : `Total ${money(i.totalMinor, i.currency)}`} right={<><span className="type-label tabular-nums">{money(i.totalMinor, i.currency)}</span><Pill status={i.status} map={INVOICE_STATUS} /></>} />)}</ul>}</Section>
          <Pager page={inv.page} total={inv.total} pageSize={inv.pageSize} href={(n) => `/portal/billing?${new URLSearchParams({ ...(sp.filter ? { filter: sp.filter } : {}), page: String(n) })}`} />
        </>
      )}
      {pay && (
        <>
          <Section>{!pay.rows.length ? <Empty title="No payments yet" /> : <ul className="divide-y divide-line">{pay.rows.map((p) => <RowLink key={p.id} href={p.receiptNumber ? `/portal/billing/receipts/${p.id}` : undefined} title={`${money(p.amountMinor, p.currency)} · ${METHOD[p.method] ?? p.method}`} meta={`${dayLabel(p.date)} · Bill ${p.invoiceNumber}${p.receiptNumber ? ` · Receipt ${p.receiptNumber}` : ""}`} right={p.status !== "SUCCESS" ? <span className="type-caption">{p.status === "REFUNDED" ? "Refunded" : "Partly refunded"}</span> : undefined} />)}</ul>}</Section>
          <Pager page={pay.page} total={pay.total} pageSize={pay.pageSize} href={(n) => `/portal/billing?view=payments&page=${n}`} />
        </>
      )}
    </div>
  );
}
