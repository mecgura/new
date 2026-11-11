"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, ButtonLink, Card, EmptyState, Field, Modal, Pagination, StatusBadge, TextInput, useToast } from "@/components/ui";
import { apiFetch } from "@/lib/api/client";
import { formatMoney } from "@/lib/billing/money";
import type { RefundRow } from "@/lib/services/billing-payments";
import { METHOD_LABEL, REFUND_STATUS_LABEL, REFUND_STATUS_TONE, stamp } from "./billing-ui";

export function RefundsBoard({ rows, page, pageCount, query }: { rows: RefundRow[]; page: number; pageCount: number; query: { status?: string; q?: string } }) {
  const router = useRouter(); const toast = useToast();
  const [dlg, setDlg] = useState<{ r: RefundRow; action: "reject" | "process" } | null>(null); const [text, setText] = useState(""); const [busy, setBusy] = useState(false);
  async function act(r: RefundRow, action: string, extra: Record<string, unknown> = {}) {
    setBusy(true);
    const res = await apiFetch(`/api/billing/refunds/${r.id}/action`, { method: "POST", body: JSON.stringify({ action, ...extra }) });
    setBusy(false);
    if (!res.ok) { toast({ tone: "danger", title: res.error.message }); router.refresh(); return false; }
    toast({ tone: "success", title: `Refund ${REFUND_STATUS_LABEL[({ approve: "APPROVED", reject: "REJECTED", process: "PROCESSED", cancel: "CANCELLED" } as Record<string, string>)[action]].toLowerCase()}` }); router.refresh(); return true;
  }
  if (!rows.length) return <Card><EmptyState title="No refunds." /></Card>;
  const hrefFor = (p: number) => `/billing/refunds?${new URLSearchParams(Object.entries({ ...query, page: String(p) }).filter(([, v]) => v) as [string, string][])}`;
  return (
    <div className="space-y-3">
      <ul className="space-y-3" aria-label="Refunds">{rows.map((r) => (
        <li key={r.id} className="space-y-2 rounded-lg border border-line bg-surface p-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0"><p className="type-label tabular-nums">{r.refundNumber} · {formatMoney(r.amountMinor)}</p><p className="type-secondary">{r.patient?.name} <span className="tabular-nums">({r.patient?.code})</span> · <Link href={`/billing/invoices/${r.invoiceId}`} className="tabular-nums">{r.invoiceNumber}</Link> · payment {r.paymentNumber} · {METHOD_LABEL[r.method]}</p><p className="type-caption">{r.reason} · requested by {r.requestedBy ?? "—"} {stamp(r.createdAt)}{r.approvedBy ? ` · approved by ${r.approvedBy}` : ""}{r.processedAt ? ` · processed ${stamp(r.processedAt)}` : ""}</p></div>
            <StatusBadge tone={REFUND_STATUS_TONE[r.status]}>{REFUND_STATUS_LABEL[r.status]}</StatusBadge>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {r.can.approve && <Button size="sm" loading={busy} onClick={() => act(r, "approve")}>Approve</Button>}
            {r.can.process && <Button size="sm" onClick={() => { setText(""); setDlg({ r, action: "process" }); }}>Process refund</Button>}
            {r.can.reject && <Button size="sm" variant="outline" onClick={() => { setText(""); setDlg({ r, action: "reject" }); }}>Reject</Button>}
            {r.can.cancel && <Button size="sm" variant="ghost" onClick={() => act(r, "cancel")}>Cancel request</Button>}
            {r.status === "PROCESSED" && <ButtonLink href={`/billing/refunds/${r.id}/receipt`} size="sm" variant="outline">Refund receipt</ButtonLink>}
          </div>
        </li>))}</ul>
      <Pagination page={page} pageCount={pageCount} hrefFor={hrefFor} />
      {dlg && <Modal open onClose={() => setDlg(null)} title={dlg.action === "process" ? `Process ${dlg.r.refundNumber}?` : `Reject ${dlg.r.refundNumber}?`} description={dlg.action === "process" ? "Confirm that you have returned the money to the patient." : "The patient keeps their payment."}
        footer={<><Button variant="outline" onClick={() => setDlg(null)}>Back</Button><Button variant={dlg.action === "reject" ? "danger" : "primary"} loading={busy} disabled={dlg.action === "reject" && text.trim().length < 2} onClick={async () => { if (await act(dlg.r, dlg.action, dlg.action === "reject" ? { reason: text } : { reference: text || undefined })) setDlg(null); }}>{dlg.action === "process" ? "Process refund" : "Reject refund"}</Button></>}>
        <Field label={dlg.action === "process" ? "Reference (optional)" : "Reason"} required={dlg.action === "reject"}><TextInput value={text} maxLength={dlg.action === "process" ? 80 : 300} onChange={(e) => setText(e.target.value)} /></Field></Modal>}
    </div>
  );
}
