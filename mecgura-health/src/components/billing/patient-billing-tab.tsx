"use client";
import Link from "next/link";
import { Plus } from "lucide-react";
import { Button, ButtonLink, Card, CardHeader, EmptyState, ErrorState, LoadingState, StatusBadge } from "@/components/ui";
import { useApi } from "@/components/patients/use-api";
import { formatMoney } from "@/lib/billing/money";
import type { patientBilling } from "@/lib/services/billing-docs";
import { INVOICE_STATUS_LABEL, INVOICE_STATUS_TONE, METHOD_LABEL, REFUND_STATUS_LABEL, REFUND_STATUS_TONE, dayLabel } from "./billing-ui";

type B = Awaited<ReturnType<typeof patientBilling>>;
/** Patient 360 "Billing" tab: financial records only. No clinical notes. */
export function PatientBillingTab({ patientId }: { patientId: string }) {
  const { data, error, loading, reload } = useApi<B>(`/api/patients/${patientId}/billing`);
  if (loading && !data) return <Card><LoadingState /></Card>;
  if (error) return <Card>{error.code === "FORBIDDEN" ? <EmptyState title="Billing isn't available to your role" /> : <ErrorState code={error.code} description={error.message} action={<Button onClick={reload}>Try again</Button>} />}</Card>;
  if (!data) return null;
  const m = (x: number) => formatMoney(x, data.currency);
  return (
    <div className="space-y-section">
      <Card><CardHeader title="Billing" description="Invoices, payments, receipts and refunds for this patient." action={<div className="flex gap-2">{data.can.newInvoice && <ButtonLink href={`/billing/invoices/new?patientId=${patientId}`} size="sm"><Plus aria-hidden className="size-4" />New invoice</ButtonLink>}{data.outstandingMinor > 0 && <ButtonLink href={`/billing/outstanding/statement/${patientId}`} size="sm" variant="outline">Statement</ButtonLink>}</div>} />
        <div className="p-card"><p className="type-caption">Outstanding</p><p className="type-page-title tabular-nums">{m(data.outstandingMinor)}</p></div></Card>
      <Card><CardHeader title="Invoices" />{!data.invoices.length ? <EmptyState title="No invoices" /> : <ul className="divide-y divide-line">{data.invoices.map((i) => <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 p-card"><div><p className="type-label"><Link href={`/billing/invoices/${i.id}`} className="tabular-nums">{i.invoiceNumber}</Link></p><p className="type-caption">{dayLabel(i.invoiceDate)} · total {m(i.totalMinor)}{i.dueMinor > 0 ? ` · due ${m(i.dueMinor)}` : ""}</p></div><StatusBadge tone={INVOICE_STATUS_TONE[i.overdue ? "OVERDUE" : i.status]}>{INVOICE_STATUS_LABEL[i.overdue ? "OVERDUE" : i.status]}</StatusBadge></li>)}</ul>}</Card>
      <Card><CardHeader title="Payments & receipts" />{!data.payments.length ? <EmptyState title="No payments" /> : <ul className="divide-y divide-line">{data.payments.map((p) => <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 p-card"><div><p className="type-label tabular-nums">{p.receiptNumber ?? p.paymentNumber} · {m(p.amountMinor)}</p><p className="type-caption">{dayLabel(p.date)} · {METHOD_LABEL[p.method]} · {p.invoiceNumber}</p></div><ButtonLink href={`/billing/payments/${p.id}/receipt`} size="sm" variant="outline">Receipt</ButtonLink></li>)}</ul>}</Card>
      {data.refunds.length > 0 && <Card><CardHeader title="Refunds" /><ul className="divide-y divide-line">{data.refunds.map((r) => <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 p-card"><span className="type-secondary tabular-nums">{r.refundNumber} · {r.invoiceNumber} · {m(r.amountMinor)}</span><StatusBadge tone={REFUND_STATUS_TONE[r.status]}>{REFUND_STATUS_LABEL[r.status]}</StatusBadge></li>)}</ul></Card>}
    </div>
  );
}
