import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ButtonLink } from "@/components/ui";
import { PageTitle, Pill, Section } from "@/components/portal/portal-server";
import { INVOICE_STATUS, METHOD, dayLabel, money } from "@/components/portal/portal-labels";
import { AppError } from "@/lib/errors";
import { requirePatientContext } from "@/lib/portal/ctx";
import { getInvoice } from "@/lib/services/portal-records";

export const metadata: Metadata = { title: "Bill" };
export const dynamic = "force-dynamic";
export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; const ctx = await requirePatientContext();
  let i; try { i = await getInvoice(ctx, id); } catch (e) { if (e instanceof AppError) notFound(); throw e; }
  const m = (x: number) => money(x, i.currency);
  return (
    <div className="space-y-4">
      <PageTitle title={`Bill ${i.invoiceNumber}`} subtitle={`${dayLabel(i.date)}${i.dueDate ? ` · due ${dayLabel(i.dueDate)}` : ""}`} back={{ href: "/portal/billing", label: "Bills" }} action={<Pill status={i.status} map={INVOICE_STATUS} />} />
      <Section title="Items">
        <ul className="divide-y divide-line">{i.items.map((x, n) => <li key={n} className="flex justify-between gap-3 px-4 py-3"><span className="min-w-0"><span className="type-label block break-words">{x.description}</span><span className="type-caption">{x.quantity} × {m(x.unitPriceMinor)}{x.discountMinor ? ` · discount ${m(x.discountMinor)}` : ""}{x.taxMinor ? ` · tax ${m(x.taxMinor)}` : ""}</span></span><span className="type-label tabular-nums">{m(x.totalMinor)}</span></li>)}</ul>
        <dl className="space-y-1 border-t border-line px-4 py-3">
          <div className="type-secondary flex justify-between"><dt>Subtotal</dt><dd className="tabular-nums">{m(i.subtotalMinor)}</dd></div>
          {i.discountMinor > 0 && <div className="type-secondary flex justify-between"><dt>Discount</dt><dd className="tabular-nums">−{m(i.discountMinor)}</dd></div>}
          <div className="type-secondary flex justify-between"><dt>Tax</dt><dd className="tabular-nums">{m(i.taxMinor)}</dd></div>
          <div className="type-card-title flex justify-between"><dt>Total</dt><dd className="tabular-nums">{m(i.totalMinor)}</dd></div>
          <div className="type-secondary flex justify-between"><dt>Paid</dt><dd className="tabular-nums">{m(i.paidMinor)}</dd></div>
          <div className="type-label flex justify-between"><dt>Outstanding</dt><dd className="tabular-nums">{m(i.outstandingMinor)}</dd></div>
        </dl>
      </Section>
      {i.payMessage && <p className="type-secondary rounded-lg bg-surface-muted p-3">{i.payMessage}</p>}
      {i.payments.length > 0 && <Section title="Payments"><ul className="divide-y divide-line">{i.payments.map((p) => <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-3"><span className="type-label">{m(p.amountMinor)} · {METHOD[p.method] ?? p.method}<span className="type-caption block">{dayLabel(p.date)}</span></span>{p.receiptNumber && <Link href={`/portal/billing/receipts/${p.id}`} className="type-label">Receipt {p.receiptNumber}</Link>}</li>)}</ul></Section>}
      <ButtonLink href={`/portal/billing/invoices/${i.id}/document`} variant="outline">View, print or download the bill</ButtonLink>
    </div>
  );
}
