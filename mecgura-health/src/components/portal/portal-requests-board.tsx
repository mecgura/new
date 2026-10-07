"use client";
import Link from "next/link";
import { useState } from "react";
import { Alert, Button, Card, CardHeader, DataTable, ErrorState, Field, Modal, Pagination, Select, StatusBadge, Textarea, useToast } from "@/components/ui";
import { useApi } from "@/components/patients/use-api";
import { apiFetch } from "@/lib/api/client";
import { REQUEST_KIND, REQUEST_STATUS, dayLabel } from "./portal-labels";

interface Row { id: string; requestNumber: string; patientId: string; patientName: string; patientCode: string; kind: string; field: string | null; currentValue: string | null; requestedValue: string | null; reason: string; status: string; reviewNote: string | null; applied: boolean; createdAt: string; canApply: boolean }
interface Page { rows: Row[]; total: number; page: number; pageSize: number }
/** Staff review of patient portal requests. Nothing is changed in a patient's record unless a named reviewer approves AND applies it. */
export function PortalRequestsBoard() {
  const toast = useToast(); const [status, setStatus] = useState("PENDING"); const [kind, setKind] = useState(""); const [page, setPage] = useState(1); const [act, setAct] = useState<{ row: Row; action: "approve" | "reject" } | null>(null);
  const { data, error, loading, reload } = useApi<Page>(`/api/portal/staff/requests?${new URLSearchParams({ status, kind, page: String(page) })}`);
  async function simple(row: Row, action: "start" | "apply") { const r = await apiFetch(`/api/portal/staff/requests/${row.id}`, { method: "POST", body: JSON.stringify({ action }) }); if (!r.ok) { toast({ tone: "danger", title: r.error.message }); return; } toast({ tone: "success", title: action === "apply" ? "Applied to the patient record" : "Marked under review" }); await reload(); }
  return (
    <Card><CardHeader title="Patient portal requests" description="Corrections, messages and account requests from patients. Review each one; approving a profile correction does not change the record until you apply it." />
      <div className="grid gap-3 border-b border-line p-card sm:grid-cols-2 lg:grid-cols-[14rem_16rem]">
        <Select aria-label="Status" value={status} placeholder="All statuses" onChange={(e) => { setStatus(e.target.value); setPage(1); }} options={Object.entries(REQUEST_STATUS).map(([value, [label]]) => ({ value, label }))} />
        <Select aria-label="Type" value={kind} placeholder="All types" onChange={(e) => { setKind(e.target.value); setPage(1); }} options={Object.entries(REQUEST_KIND).map(([value, label]) => ({ value, label }))} />
      </div>
      {error ? <ErrorState description={error.message} action={<Button onClick={reload}>Try again</Button>} /> : (
        <DataTable caption="Patient requests" loading={loading && !data} rows={data?.rows ?? []} rowKey={(r) => r.id} empty={{ title: "No requests." }} columns={[
          { key: "n", header: "Request", cell: (r) => <span className="tabular-nums">{r.requestNumber}</span> },
          { key: "p", header: "Patient", cell: (r) => <Link href={`/patients/${r.patientId}`} className="type-label">{r.patientName} <span className="type-caption">{r.patientCode}</span></Link> },
          { key: "k", header: "What", cell: (r) => <span className="break-words"><strong>{REQUEST_KIND[r.kind] ?? r.kind}</strong>{r.field ? ` — ${r.field}` : ""}{r.requestedValue ? <><br /><span className="type-caption">now: {r.currentValue ?? "—"} → asked: {r.requestedValue}</span></> : null}<br /><span className="type-secondary">{r.reason}</span></span> },
          { key: "d", header: "Date", cell: (r) => dayLabel(r.createdAt), hideOnMobile: true },
          { key: "s", header: "Status", cell: (r) => <StatusBadge tone={REQUEST_STATUS[r.status]?.[1]}>{REQUEST_STATUS[r.status]?.[0] ?? r.status}</StatusBadge> },
          { key: "a", header: "", align: "right", cell: (r) => (
            <div className="flex flex-wrap justify-end gap-1">
              {r.status === "PENDING" && <Button size="sm" variant="outline" onClick={() => simple(r, "start")}>Start review</Button>}
              {(r.status === "PENDING" || r.status === "UNDER_REVIEW") && <><Button size="sm" onClick={() => setAct({ row: r, action: "approve" })}>Approve</Button><Button size="sm" variant="outline" onClick={() => setAct({ row: r, action: "reject" })}>Reject</Button></>}
              {r.status === "APPROVED" && r.canApply && <Button size="sm" onClick={() => simple(r, "apply")}>Apply to record</Button>}
              {r.status === "APPROVED" && r.applied && <span className="type-caption">Applied</span>}
            </div>) },
        ]} />
      )}
      <div className="px-card pb-card"><Pagination page={data?.page ?? 1} pageCount={Math.max(1, Math.ceil((data?.total ?? 0) / (data?.pageSize ?? 15)))} onPageChange={setPage} /></div>
      {act && <ReviewModal row={act.row} action={act.action} onClose={() => setAct(null)} onDone={async () => { setAct(null); await reload(); }} />}
    </Card>
  );
}
function ReviewModal({ row, action, onClose, onDone }: { row: Row; action: "approve" | "reject"; onClose: () => void; onDone: () => Promise<void> }) {
  const toast = useToast(); const [note, setNote] = useState(""); const [msg, setMsg] = useState<string>(); const [busy, setBusy] = useState(false);
  async function go() { setBusy(true); setMsg(undefined); const r = await apiFetch(`/api/portal/staff/requests/${row.id}`, { method: "POST", body: JSON.stringify({ action, note }) }); setBusy(false); if (!r.ok) { setMsg(r.error.fieldErrors?.note ?? r.error.message); return; } toast({ tone: "success", title: action === "approve" ? "Request approved" : "Request closed" }); await onDone(); }
  return (
    <Modal open onClose={onClose} title={action === "approve" ? "Approve this request" : "Reject this request"} description={`${row.requestNumber} · ${row.patientName}`} footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button variant={action === "approve" ? "primary" : "danger"} onClick={go} loading={busy}>{action === "approve" ? "Approve" : "Reject"}</Button></>}>
      <div className="space-y-3">{msg && <Alert tone="danger">{msg}</Alert>}
        {action === "approve" && row.kind === "ACCOUNT_DEACTIVATION" && <Alert tone="warning">Approving closes the patient&apos;s portal login. Their medical record is not touched.</Alert>}
        {action === "approve" && row.kind === "PROFILE_CORRECTION" && <Alert tone="info">Approving records your decision. Use “Apply to record” afterwards to write the corrected value.</Alert>}
        <Field label={action === "reject" ? "Reason shown to the patient" : "Note to the patient (optional)"} required={action === "reject"}><Textarea rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></Field></div>
    </Modal>
  );
}
