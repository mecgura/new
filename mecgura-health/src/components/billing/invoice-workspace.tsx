"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Download, Printer, Wallet } from "lucide-react";
import { Alert, Badge, Button, ButtonLink, Card, CardBody, CardHeader, EmptyState, Field, Modal, Select, StatusBadge, TextInput, Textarea, useToast } from "@/components/ui";
import { apiFetch } from "@/lib/api/client";
import { bpToInput, formatMoney, moneyToMinor } from "@/lib/billing/money";
import type { InvoiceDetail } from "@/lib/services/billing-invoices";
import { EVENT_LABEL, INVOICE_STATUS_LABEL, INVOICE_STATUS_TONE, METHOD_LABEL, PAYMENT_STATUS_LABEL, PAYMENT_STATUS_TONE, REFUND_STATUS_LABEL, REFUND_STATUS_TONE, dayLabel, stamp } from "./billing-ui";

type Dlg = null | "pay" | "cancel" | "refund" | "cancelPayment";

export function InvoiceWorkspace({ initial, initialAction }: { initial: InvoiceDetail; initialAction?: string }) {
  const toast = useToast(); const router = useRouter();
  const [d, setD] = useState(initial);
  const [dlg, setDlg] = useState<Dlg>(initialAction === "pay" && initial.can.collect ? "pay" : null);
  const [target, setTarget] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  const reload = useCallback(async () => { const r = await apiFetch<InvoiceDetail>(`/api/billing/invoices/${initial.id}`); if (r.ok) { setD(r.data); setError(undefined); } else setError(r.error.message); }, [initial.id]);
  useEffect(() => { const t = setInterval(reload, 30000); return () => clearInterval(t); }, [reload]);
  const m = (x: number) => formatMoney(x, d.currency);
  async function issue() { const r = await apiFetch(`/api/billing/invoices/${d.id}/issue`, { method: "POST" }); if (r.ok) { toast({ tone: "success", title: "Invoice issued" }); await reload(); } else toast({ tone: "danger", title: r.error.message }); }
  const doc = `/api/billing/docs/invoice/${d.id}`;
  return (
    <div className="space-y-section">
      {error && <Alert tone="danger">{error}</Alert>}
      <Card><CardBody className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0"><h2 className="type-page-title tabular-nums">{d.invoiceNumber}</h2>
            <p className="type-secondary mt-1">{d.patient ? <><Link href={`/patients/${d.patient.id}`} className="font-semibold">{d.patient.name}</Link> · <span className="tabular-nums">{d.patient.code}</span></> : "Patient details hidden for your role"}</p>
            <p className="type-caption">Invoice date {dayLabel(d.invoiceDate)}{d.dueDate ? ` · due ${dayLabel(d.dueDate)}` : ""}{d.doctorName ? ` · ${d.doctorName}` : ""} · created by {d.createdBy ?? "—"}{d.issuedBy ? ` · issued by ${d.issuedBy}` : ""}</p></div>
          <StatusBadge tone={INVOICE_STATUS_TONE[d.displayStatus]}>{INVOICE_STATUS_LABEL[d.displayStatus]}</StatusBadge>
        </div>
        {d.status === "CANCELLED" && <Alert tone="warning" title="This invoice was cancelled">{d.cancelReason}</Alert>}
        <div className="flex flex-wrap gap-2 print:hidden">
          {d.can.edit && <ButtonLink href={`/billing/invoices/${d.id}/edit`} variant="outline" size="sm">Edit draft</ButtonLink>}
          {d.can.issue && <Button size="sm" onClick={issue}>Issue invoice</Button>}
          {d.can.collect && <Button size="sm" onClick={() => setDlg("pay")}><Wallet aria-hidden className="size-4" />Collect payment</Button>}
          {d.can.print && <><ButtonLink href={`/billing/invoices/${d.id}/print`} variant="outline" size="sm"><Printer aria-hidden className="size-4" />Print</ButtonLink><a href={doc} className="type-button inline-flex min-h-9 items-center gap-2 rounded-md border border-line-strong px-3 !text-ink no-underline hover:bg-surface-muted"><Download aria-hidden className="size-4" />Download</a></>}
          {d.can.refund && <Button size="sm" variant="outline" onClick={() => { setTarget(d.payments.find((p) => p.refundableMinor > 0)?.id ?? null); setDlg("refund"); }}>Request refund</Button>}
          {d.can.cancel && <Button size="sm" variant="ghost" onClick={() => setDlg("cancel")}>Cancel invoice</Button>}
          {d.links.consultationId && <Link href={`/consultations/${d.links.consultationId}`} className="type-label self-center">Consultation →</Link>}
          {d.links.investigationOrderId && <Link href={`/lab/orders/${d.links.investigationOrderId}`} className="type-label self-center">Lab order →</Link>}
        </div>
      </CardBody></Card>

      <Card><CardHeader title="Items" description={d.taxMode === "INCLUSIVE" ? "Prices include tax." : "Tax is added to the prices."} />
        <div className="overflow-x-auto"><table className="w-full text-left"><caption className="sr-only">Invoice items</caption>
          <thead><tr className="type-caption border-b border-line bg-surface-muted"><th className="p-3">Service</th><th className="p-3 text-right">Qty</th><th className="p-3 text-right">Price</th><th className="p-3 text-right">Discount</th><th className="p-3 text-right">Tax</th><th className="p-3 text-right">Total</th></tr></thead>
          <tbody>{d.items.map((i) => <tr key={i.id} className="border-b border-line last:border-0"><td className="p-3"><p className="type-label">{i.description}</p>{i.serviceCode && <p className="type-caption">{i.serviceCode}</p>}</td><td className="p-3 text-right tabular-nums">{i.quantity}</td><td className="p-3 text-right tabular-nums">{m(i.unitPriceMinor)}</td><td className="p-3 text-right tabular-nums">{i.discountMinor + i.invoiceDiscountMinor ? m(i.discountMinor + i.invoiceDiscountMinor) : "—"}</td><td className="p-3 text-right tabular-nums">{i.taxRateBp ? <>{i.taxName} {bpToInput(i.taxRateBp)}%<br /><span className="type-caption">{m(i.taxMinor)}</span></> : "—"}</td><td className="p-3 text-right tabular-nums">{m(i.lineTotalMinor)}</td></tr>)}</tbody></table></div>
        <CardBody><dl className="ml-auto w-full max-w-xs space-y-1.5 type-secondary tabular-nums">
          <div className="flex justify-between"><dt>Subtotal</dt><dd>{m(d.subtotalMinor)}</dd></div>
          {d.discountMinor > 0 && <div className="flex justify-between"><dt>Discount{d.discountReason ? ` (${d.discountReason})` : ""}</dt><dd>− {m(d.discountMinor)}</dd></div>}
          <div className="flex justify-between"><dt>{d.taxMode === "INCLUSIVE" ? "Tax (included)" : "Tax"}</dt><dd>{m(d.taxMinor)}</dd></div>
          <div className="flex justify-between border-t border-line pt-2 type-card-title"><dt>Grand total</dt><dd>{m(d.totalMinor)}</dd></div>
          <div className="flex justify-between"><dt>Paid</dt><dd>{m(d.paidMinor)}</dd></div>
          {d.refundedMinor > 0 && <div className="flex justify-between"><dt>Refunded</dt><dd>{m(d.refundedMinor)}</dd></div>}
          <div className="flex justify-between type-label"><dt>Outstanding</dt><dd>{m(d.dueMinor)}</dd></div></dl>
          {d.notes && <p className="type-secondary mt-3"><strong>Notes:</strong> {d.notes}</p>}</CardBody></Card>

      <Card><CardHeader title="Payments" description="Receipts are issued for each payment received." />
        {!d.payments.length ? <EmptyState title="No payments yet" /> : <ul className="divide-y divide-line">{d.payments.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 p-card">
            <div className="min-w-0"><p className="type-label tabular-nums">{p.receiptNumber ?? p.paymentNumber} · {m(p.amountMinor)}</p><p className="type-caption">{METHOD_LABEL[p.method]} · {dayLabel(p.paymentDate)}{p.transactionReference ? ` · ref ${p.transactionReference}` : ""} · {p.receivedBy ?? "—"}{p.refundedMinor ? ` · refunded ${m(p.refundedMinor)}` : ""}</p></div>
            <div className="flex flex-wrap items-center gap-2"><StatusBadge tone={PAYMENT_STATUS_TONE[p.status]}>{PAYMENT_STATUS_LABEL[p.status]}</StatusBadge>
              {["SUCCESS", "PARTIALLY_REFUNDED", "REFUNDED"].includes(p.status) && <ButtonLink href={`/billing/payments/${p.id}/receipt`} size="sm" variant="outline" aria-label={`Receipt ${p.receiptNumber}`}>Receipt</ButtonLink>}
              {d.can.cancelPayment && p.status === "SUCCESS" && p.refundedMinor === 0 && <Button size="sm" variant="ghost" onClick={() => { setTarget(p.id); setDlg("cancelPayment"); }}>Cancel payment</Button>}</div>
          </li>))}</ul>}
      </Card>

      {d.refunds.length > 0 && <Card><CardHeader title="Refunds" action={<Link href="/billing/refunds" className="type-label">All refunds →</Link>} /><ul className="divide-y divide-line">{d.refunds.map((r) => <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 p-card"><div className="min-w-0"><p className="type-label tabular-nums">{r.refundNumber} · {m(r.amountMinor)}</p><p className="type-caption">{r.reason} · requested by {r.requestedBy ?? "—"}{r.approvedBy ? ` · approved by ${r.approvedBy}` : ""}{r.processedBy ? ` · processed by ${r.processedBy}` : ""}</p></div><div className="flex items-center gap-2"><StatusBadge tone={REFUND_STATUS_TONE[r.status]}>{REFUND_STATUS_LABEL[r.status]}</StatusBadge>{r.status === "PROCESSED" && <ButtonLink href={`/billing/refunds/${r.id}/receipt`} size="sm" variant="outline">Receipt</ButtonLink>}</div></li>)}</ul></Card>}

      <Card><CardHeader title="History" description="Every financial change is kept." />
        <ol className="divide-y divide-line">{d.events.map((e) => <li key={e.id} className="p-card"><p className="type-label">{EVENT_LABEL[e.type] ?? e.type}{e.amountMinor != null ? ` · ${m(e.amountMinor)}` : ""} <span className="type-caption">· {stamp(e.at)} · {e.by ?? "System"}</span></p>{e.note && <p className="type-secondary">{e.note}</p>}</li>)}</ol></Card>

      {dlg === "pay" && <PaymentModal d={d} onClose={() => setDlg(null)} onDone={async (paymentId) => { setDlg(null); await reload(); toast({ tone: "success", title: "Payment recorded" }); if (paymentId) router.push(`/billing/payments/${paymentId}/receipt`); }} />}
      {dlg === "cancel" && <ReasonModal title="Cancel this invoice?" confirm="Cancel invoice" onClose={() => setDlg(null)} onSubmit={async (reason) => { const r = await apiFetch(`/api/billing/invoices/${d.id}/cancel`, { method: "POST", body: JSON.stringify({ reason }) }); if (!r.ok) { toast({ tone: "danger", title: r.error.message }); return false; } toast({ tone: "success", title: "Invoice cancelled" }); await reload(); return true; }} />}
      {dlg === "cancelPayment" && target && <ReasonModal title="Cancel this payment?" confirm="Cancel payment" onClose={() => setDlg(null)} onSubmit={async (reason) => { const r = await apiFetch(`/api/billing/payments/${target}/cancel`, { method: "POST", body: JSON.stringify({ reason }) }); if (!r.ok) { toast({ tone: "danger", title: r.error.message }); return false; } toast({ tone: "success", title: "Payment cancelled" }); await reload(); return true; }} />}
      {dlg === "refund" && <RefundModal d={d} initialPayment={target} onClose={() => setDlg(null)} onDone={async () => { setDlg(null); await reload(); toast({ tone: "success", title: "Refund requested" }); }} />}
    </div>
  );
}

function PaymentModal({ d, onClose, onDone }: { d: InvoiceDetail; onClose: () => void; onDone: (paymentId?: string) => Promise<void> }) {
  const [key] = useState(() => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `k-${Date.now()}-${Math.random().toString(36).slice(2)}`));
  const m = (x: number) => formatMoney(x, d.currency);
  const [f, setF] = useState({ amount: (d.dueMinor / 100).toFixed(2), method: d.settings.paymentMethods[0] ?? "CASH", ref: "", notes: "" });
  const [errors, setErrors] = useState<Record<string, string>>({}); const [msg, setMsg] = useState<string>(); const [busy, setBusy] = useState(false);
  async function save() {
    const minor = moneyToMinor(f.amount); if (minor == null || minor <= 0) { setErrors({ amountMinor: "Enter a valid amount." }); return; }
    setBusy(true); setErrors({}); setMsg(undefined);
    const r = await apiFetch<{ id: string }>(`/api/billing/invoices/${d.id}/payments`, { method: "POST", body: JSON.stringify({ amountMinor: minor, method: f.method, transactionReference: f.ref || undefined, notes: f.notes || undefined, idempotencyKey: key }) });
    setBusy(false);
    if (!r.ok) { setErrors(r.error.fieldErrors ?? {}); setMsg(r.error.message); return; }
    await onDone(r.data.id);
  }
  return (
    <Modal open onClose={onClose} title="Collect payment" description="Record money you have actually received." footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy}>Record payment</Button></>}>
      <div className="space-y-3">
        {msg && <Alert tone="danger">{msg}</Alert>}
        <dl className="grid grid-cols-3 gap-2 rounded-md bg-surface-muted p-3 type-secondary tabular-nums"><div><dt className="type-caption">Invoice total</dt><dd className="type-label">{m(d.totalMinor)}</dd></div><div><dt className="type-caption">Already paid</dt><dd className="type-label">{m(d.collectedMinor)}</dd></div><div><dt className="type-caption">Outstanding</dt><dd className="type-label">{m(d.dueMinor)}</dd></div></dl>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Amount" required error={errors.amountMinor}><TextInput value={f.amount} inputMode="decimal" onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
          <Field label="Method" required error={errors.method}><Select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })} options={d.settings.paymentMethods.map((v) => ({ value: v, label: METHOD_LABEL[v] }))} /></Field>
        </div>
        <Field label="Transaction reference" error={errors.transactionReference} hint="UPI/bank/card reference, if any"><TextInput value={f.ref} maxLength={80} onChange={(e) => setF({ ...f, ref: e.target.value })} /></Field>
        <Field label="Notes" error={errors.notes}><Textarea rows={2} value={f.notes} maxLength={300} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        <p className="type-caption">Online payment: <Badge>Payment gateway not configured</Badge></p>
      </div>
    </Modal>
  );
}
function ReasonModal({ title, confirm, onClose, onSubmit }: { title: string; confirm: string; onClose: () => void; onSubmit: (reason: string) => Promise<boolean> }) {
  const [reason, setReason] = useState(""); const [busy, setBusy] = useState(false);
  return <Modal open onClose={onClose} title={title} footer={<><Button variant="outline" onClick={onClose}>Keep</Button><Button variant="danger" loading={busy} disabled={reason.trim().length < 2} onClick={async () => { setBusy(true); const ok = await onSubmit(reason); setBusy(false); if (ok) onClose(); }}>{confirm}</Button></>}><Field label="Reason" required><Textarea rows={2} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} /></Field></Modal>;
}
function RefundModal({ d, initialPayment, onClose, onDone }: { d: InvoiceDetail; initialPayment: string | null; onClose: () => void; onDone: () => Promise<void> }) {
  const refundable = d.payments.filter((p) => p.refundableMinor > 0);
  const [pid, setPid] = useState(initialPayment ?? refundable[0]?.id ?? ""); const [amount, setAmount] = useState(""); const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({}); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<string>();
  const p = refundable.find((x) => x.id === pid);
  async function save() {
    const minor = moneyToMinor(amount); if (minor == null || minor <= 0) { setErrors({ amountMinor: "Enter a valid amount." }); return; }
    setBusy(true); setErrors({}); setMsg(undefined);
    const r = await apiFetch("/api/billing/refunds", { method: "POST", body: JSON.stringify({ paymentId: pid, amountMinor: minor, reason }) });
    setBusy(false);
    if (!r.ok) { setErrors(r.error.fieldErrors ?? {}); setMsg(r.error.message); return; }
    await onDone();
  }
  return (
    <Modal open onClose={onClose} title="Request a refund" description="A refund needs approval and is processed separately. Nothing is returned yet." footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy} disabled={!pid}>Request refund</Button></>}>
      <div className="space-y-3">{msg && <Alert tone="danger">{msg}</Alert>}
        <Field label="Payment"><Select value={pid} onChange={(e) => setPid(e.target.value)} options={refundable.map((x) => ({ value: x.id, label: `${x.receiptNumber ?? x.paymentNumber} — ${formatMoney(x.amountMinor, d.currency)} (refundable ${formatMoney(x.refundableMinor, d.currency)})` }))} /></Field>
        <Field label="Refund amount" required error={errors.amountMinor} hint={p ? `Up to ${formatMoney(p.refundableMinor, d.currency)}` : undefined}><TextInput value={amount} inputMode="decimal" onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field label="Reason" required error={errors.reason}><Textarea rows={2} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} /></Field></div>
    </Modal>
  );
}
