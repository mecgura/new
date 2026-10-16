"use client";
import Link from "next/link";
import { useState } from "react";
import { Alert, Button, Card, CardHeader, DataTable, ErrorState, Field, Modal, NumberInput, Pagination, Select, StatusBadge, TextInput, useToast } from "@/components/ui";
import { useApi } from "@/components/patients/use-api";
import { apiFetch } from "@/lib/api/client";
import type { BatchRow } from "@/lib/services/pharmacy-inventory";
import type { ReturnRow } from "@/lib/services/pharmacy-dispensing";
import { CONDITION_LABEL, RETURN_LABEL, RETURN_TONE, RETURN_TYPE_LABEL, stamp, usePharmacy } from "./pharmacy-ui";

interface Page { rows: ReturnRow[]; total: number; page: number; pageSize: number }
export function ReturnsBoard() {
  const { perms } = usePharmacy(); const toast = useToast(); const [status, setStatus] = useState(""); const [page, setPage] = useState(1); const [act, setAct] = useState<{ row: ReturnRow; action: string } | null>(null); const [supplier, setSupplier] = useState(false);
  const { data, error, loading, reload } = useApi<Page>(`/api/pharmacy/returns?${new URLSearchParams({ status, page: String(page) })}`);
  async function simple(row: ReturnRow, action: string) { const r = await apiFetch(`/api/pharmacy/returns/${row.id}/action`, { method: "POST", body: JSON.stringify({ action }) }); if (!r.ok) { toast({ tone: "danger", title: r.error.message }); return; } toast({ tone: "success", title: `Return ${action === "approve" ? "approved" : action === "restock" ? "restocked" : "updated"}` }); await reload(); }
  return (
    <Card><CardHeader title="Returns" description="Patient returns: requested → approved → received → restocked or disposed. Returned medicine never goes back into sellable stock automatically." action={perms.purchase ? <Button size="sm" onClick={() => setSupplier(true)}>Return to supplier</Button> : undefined} />
      <div className="border-b border-line p-card sm:w-64"><Select aria-label="Status" value={status} placeholder="All statuses" onChange={(e) => { setStatus(e.target.value); setPage(1); }} options={Object.entries(RETURN_LABEL).map(([value, label]) => ({ value, label }))} /></div>
      {error ? <ErrorState description={error.message} action={<Button onClick={reload}>Try again</Button>} /> : <DataTable caption="Medicine returns" loading={loading && !data} rows={data?.rows ?? []} rowKey={(r) => r.id} empty={{ title: "No returns." }} columns={[
        { key: "n", header: "Return", cell: (r) => <span className="tabular-nums type-label">{r.returnNumber}</span> }, { key: "t", header: "Type", cell: (r) => RETURN_TYPE_LABEL[r.type] ?? r.type, hideOnMobile: true }, { key: "m", header: "Medicine", cell: (r) => <span>{r.medicineName} <span className="type-caption">batch {r.batchNumber}</span></span> },
        { key: "q", header: "Qty", align: "right", cell: (r) => r.quantity }, { key: "r", header: "Reason", cell: (r) => <span className="break-words">{r.reason}{r.condition ? ` · ${CONDITION_LABEL[r.condition] ?? r.condition}` : ""}</span>, hideOnMobile: true }, { key: "w", header: "When", cell: (r) => stamp(r.createdAt), hideOnMobile: true },
        { key: "s", header: "Status", cell: (r) => <StatusBadge tone={RETURN_TONE[r.status]}>{RETURN_LABEL[r.status]}</StatusBadge> },
        { key: "a", header: "", align: "right", cell: (r) => (
          <div className="flex flex-wrap justify-end gap-1">
            {perms.returnApprove && r.type !== "PURCHASE_RETURN" && r.status === "REQUESTED" && <><Button size="sm" onClick={() => simple(r, "approve")}>Approve</Button><Button size="sm" variant="outline" onClick={() => setAct({ row: r, action: "reject" })}>Reject</Button></>}
            {perms.returnApprove && r.status === "APPROVED" && <Button size="sm" onClick={() => setAct({ row: r, action: "receive" })}>Receive</Button>}
            {perms.returnApprove && r.status === "RECEIVED" && <><Button size="sm" onClick={() => simple(r, "restock")}>Restock</Button><Button size="sm" variant="outline" onClick={() => simple(r, "dispose")}>Dispose</Button></>}
            <Link href={`/pharmacy/docs/return/${r.id}`} className="type-label inline-flex min-h-9 items-center px-2">Document</Link>
          </div>) },
      ]} />}
      <div className="px-card pb-card"><Pagination page={data?.page ?? 1} pageCount={Math.max(1, Math.ceil((data?.total ?? 0) / (data?.pageSize ?? 20)))} onPageChange={setPage} /></div>
      {act && <ActionModal row={act.row} action={act.action} onClose={() => setAct(null)} onDone={async () => { setAct(null); await reload(); }} />}
      {supplier && <SupplierReturnModal onClose={() => setSupplier(false)} onDone={async () => { setSupplier(false); await reload(); }} />}
    </Card>
  );
}
function ActionModal({ row, action, onClose, onDone }: { row: ReturnRow; action: string; onClose: () => void; onDone: () => Promise<void> }) {
  const toast = useToast(); const [condition, setCondition] = useState(""); const [reason, setReason] = useState(""); const [errors, setErrors] = useState<Record<string, string>>({}); const [msg, setMsg] = useState<string>(); const [busy, setBusy] = useState(false);
  async function go() { setBusy(true); setErrors({}); setMsg(undefined); const r = await apiFetch(`/api/pharmacy/returns/${row.id}/action`, { method: "POST", body: JSON.stringify({ action, condition: condition || undefined, reason: reason || undefined }) }); setBusy(false); if (!r.ok) { setErrors(r.error.fieldErrors ?? {}); setMsg(r.error.message); return; } toast({ tone: "success", title: action === "receive" ? "Return received" : "Return rejected" }); await onDone(); }
  return (
    <Modal open onClose={onClose} title={action === "receive" ? "Receive returned medicine" : "Reject return"} description={`${row.returnNumber} · ${row.medicineName} × ${row.quantity}`} footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={go} loading={busy} variant={action === "reject" ? "danger" : "primary"}>{action === "receive" ? "Record as received" : "Reject"}</Button></>}>
      <div className="space-y-3">{msg && <Alert tone="danger">{msg}</Alert>}
        {action === "receive" ? <><Alert tone="info">Receiving does not add the medicine back to stock. Only sealed, intact medicine can be restocked later.</Alert><Field label="Condition of the returned medicine" required error={errors.condition}><Select value={condition} placeholder="Choose" onChange={(e) => setCondition(e.target.value)} options={Object.entries(CONDITION_LABEL).map(([value, label]) => ({ value, label }))} /></Field></> : <Field label="Reason" required error={errors.reason}><TextInput value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} /></Field>}
      </div>
    </Modal>
  );
}
function SupplierReturnModal({ onClose, onDone }: { onClose: () => void; onDone: () => Promise<void> }) {
  const toast = useToast(); const suppliers = useApi<{ rows: { id: string; supplierName: string; supplierCode: string }[] }>("/api/pharmacy/suppliers?q="); const [q, setQ] = useState(""); const batches = useApi<{ rows: BatchRow[] }>(q.length >= 2 ? `/api/pharmacy/batches?${new URLSearchParams({ q, state: "available" })}` : null);
  const [f, setF] = useState({ supplierId: "", batchId: "", quantity: "", reason: "", reference: "" }); const [errors, setErrors] = useState<Record<string, string>>({}); const [msg, setMsg] = useState<string>(); const [busy, setBusy] = useState(false);
  async function go() { setBusy(true); setErrors({}); setMsg(undefined); const r = await apiFetch("/api/pharmacy/returns/supplier", { method: "POST", body: JSON.stringify(f) }); setBusy(false); if (!r.ok) { setErrors(r.error.fieldErrors ?? {}); setMsg(r.error.message); return; } toast({ tone: "success", title: "Stock returned to supplier" }); await onDone(); }
  return (
    <Modal open onClose={onClose} title="Return stock to supplier" description="The units leave stock immediately (PURCHASE_RETURN ledger entry)." footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={go} loading={busy}>Return stock</Button></>}>
      <div className="space-y-3">{msg && <Alert tone="danger">{msg}</Alert>}
        <Field label="Supplier" required error={errors.supplierId}><Select value={f.supplierId} placeholder="Choose supplier" onChange={(e) => setF({ ...f, supplierId: e.target.value })} options={(suppliers.data?.rows ?? []).map((s) => ({ value: s.id, label: `${s.supplierName} (${s.supplierCode})` }))} /></Field>
        <Field label="Find the batch" hint="Search by medicine or batch number"><TextInput value={q} onChange={(e) => setQ(e.target.value)} /></Field>
        <Field label="Batch" required error={errors.batchId}><Select value={f.batchId} placeholder={q.length < 2 ? "Search first" : "Choose batch"} onChange={(e) => setF({ ...f, batchId: e.target.value })} options={(batches.data?.rows ?? []).map((b) => ({ value: b.id, label: `${b.medicineName} · batch ${b.batchNumber} · ${b.quantityAvailable} in stock` }))} /></Field>
        <div className="grid gap-3 sm:grid-cols-2"><Field label="Quantity" required error={errors.quantity}><NumberInput value={f.quantity} inputMode="numeric" onChange={(e) => setF({ ...f, quantity: e.target.value })} /></Field><Field label="Reference" error={errors.reference}><TextInput value={f.reference} maxLength={80} onChange={(e) => setF({ ...f, reference: e.target.value })} placeholder="Credit note no." /></Field></div>
        <Field label="Reason" required error={errors.reason}><TextInput value={f.reason} maxLength={200} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}
