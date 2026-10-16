"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { Alert, Badge, Button, Card, CardHeader, Checkbox, EmptyState, ErrorState, Field, LoadingState, Modal, SearchInput, Select, StatusBadge, Textarea, useToast } from "@/components/ui";
import { ORDER_STATUS_LABEL, ORDER_STATUS_TONE, PRIORITY_LABEL, PRIORITY_TONE, fmt } from "@/components/lab/lab-ui";
import { apiFetch } from "@/lib/api/client";
import type { LabOrderRow } from "@/lib/services/lab-orders";
import type { InvestigationView } from "@/lib/services/lab-master";
import type { CView } from "./types";

/** Investigations tab: order tests, see their progress and open released reports. The doctor picks the tests and the priority. */
export function InvestigationsSection({ c, reload }: { c: CView; reload: () => Promise<void> }) {
  const toast = useToast();
  const [orders, setOrders] = useState<LabOrderRow[] | null>(null);
  const [err, setErr] = useState<string>();
  const [open, setOpen] = useState(false);
  const load = useCallback(async () => {
    const r = await apiFetch<{ rows: LabOrderRow[] }>(`/api/consultations/${c.id}/investigations`);
    if (r.ok) { setOrders(r.data.rows); setErr(undefined); } else setErr(r.error.message);
  }, [c.id]);
  useEffect(() => { load(); const t = setInterval(load, 20000); return () => clearInterval(t); }, [load]);
  const canOrder = c.can.owner && c.status !== "CANCELLED";
  return (
    <Card>
      <CardHeader title="Investigations" description="Lab tests ordered from this consultation. They appear in the laboratory worklist; released reports open here." action={canOrder ? <Button size="sm" onClick={() => setOpen(true)}><Plus aria-hidden className="size-4" />Order tests</Button> : undefined} />
      {err && !orders ? <ErrorState description={err} action={<Button onClick={load}>Try again</Button>} /> : !orders ? <LoadingState /> : !orders.length ? <EmptyState title="No investigations ordered" description={canOrder ? "Order lab tests for this patient." : undefined} /> : (
        <ul className="divide-y divide-line">{orders.map((o) => (
          <li key={o.id} className="flex flex-wrap items-center justify-between gap-3 p-card">
            <div className="min-w-0"><p className="type-label"><Link href={`/lab/orders/${o.id}`} className="tabular-nums">{o.orderNumber}</Link> · {o.tests.join(", ")}</p><p className="type-caption">Ordered {fmt(o.orderedAt)}</p></div>
            <div className="flex flex-wrap items-center gap-2">
              {o.priority !== "NORMAL" && <Badge tone={PRIORITY_TONE[o.priority]}>{PRIORITY_LABEL[o.priority]}</Badge>}
              <StatusBadge tone={ORDER_STATUS_TONE[o.status]}>{o.status === "REPORT_GENERATED" ? "Report ready" : ORDER_STATUS_LABEL[o.status]}</StatusBadge>
              {o.report && ["RELEASED", "AMENDED"].includes(o.report.status) && <Link href={`/lab/reports/${o.report.id}`}><Button size="sm" variant="outline" aria-label={`Open report for ${o.orderNumber}`}>Open report</Button></Link>}
            </div>
          </li>))}</ul>
      )}
      {open && <OrderModal consultationId={c.id} onClose={() => setOpen(false)} onDone={async () => { setOpen(false); toast({ tone: "success", title: "Investigations ordered" }); await load(); await reload(); }} />}
    </Card>
  );
}

function OrderModal({ consultationId, onClose, onDone }: { consultationId: string; onClose: () => void; onDone: () => Promise<void> }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<InvestigationView[]>([]);
  const [picked, setPicked] = useState<Record<string, InvestigationView>>({});
  const [priority, setPriority] = useState("");
  const [notes, setNotes] = useState("");
  const [source, setSource] = useState("INTERNAL");
  const [partner, setPartner] = useState("");
  const [partners, setPartners] = useState<{ id: string; name: string; active: boolean }[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => { const t = setTimeout(async () => { const r = await apiFetch<{ items: InvestigationView[] }>(`/api/lab/investigations?q=${encodeURIComponent(q)}`); if (r.ok) setResults(r.data.items); }, 200); return () => clearTimeout(t); }, [q]);
  useEffect(() => { apiFetch<{ partners: { id: string; name: string; active: boolean }[] }>("/api/lab/partners").then((r) => { if (r.ok) setPartners(r.data.partners.filter((p) => p.active)); }); }, []);
  const ids = Object.keys(picked);
  async function save() {
    setBusy(true); setErrors({});
    const r = await apiFetch(`/api/consultations/${consultationId}/investigations`, { method: "POST", body: JSON.stringify({ investigationIds: ids, priority: priority || undefined, clinicalNotes: notes || undefined, source, labPartnerId: source === "EXTERNAL" ? partner || undefined : undefined }) });
    setBusy(false);
    if (!r.ok) { setErrors(r.error.fieldErrors ?? { investigationIds: r.error.message }); return; }
    await onDone();
  }
  return (
    <Modal open onClose={onClose} title="Order investigations" description="Choose the tests and how urgent they are. Staff collect the sample and enter results."
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy} disabled={!ids.length}>Order {ids.length || ""} test{ids.length === 1 ? "" : "s"}</Button></>}>
      <div className="space-y-4">
        <Field label="Find a test" error={errors.investigationIds}><SearchInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or code" aria-label="Find a test" /></Field>
        <div className="max-h-56 space-y-1 overflow-y-auto rounded-md border border-line p-2" role="group" aria-label="Available tests">
          {!results.length ? <p className="type-secondary p-2">No tests found. A clinic admin can add tests under Settings → Laboratory.</p> : results.map((t) => (
            <Checkbox key={t.id} label={`${t.testCode} · ${t.testName}`} description={[t.category, t.sampleType, t.preparation].filter(Boolean).join(" · ")} checked={!!picked[t.id]} onChange={(e) => { const n = { ...picked }; if (e.target.checked) n[t.id] = t; else delete n[t.id]; setPicked(n); }} />
          ))}
        </div>
        {ids.length > 0 && <p className="type-secondary"><strong>Selected:</strong> {ids.map((i) => picked[i].testName).join(", ")}</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Priority" required error={errors.priority}><Select value={priority} onChange={(e) => setPriority(e.target.value)} placeholder="Choose priority" options={Object.entries(PRIORITY_LABEL).map(([value, label]) => ({ value, label }))} /></Field>
          <Field label="Where will it be done?"><Select value={source} onChange={(e) => setSource(e.target.value)} options={[{ value: "INTERNAL", label: "This clinic's laboratory" }, { value: "EXTERNAL", label: "External laboratory" }]} /></Field>
        </div>
        {source === "EXTERNAL" && (partners.length ? <Field label="External laboratory" required error={errors.labPartnerId}><Select value={partner} onChange={(e) => setPartner(e.target.value)} placeholder="Choose" options={partners.map((p) => ({ value: p.id, label: p.name }))} /></Field> : <Alert tone="warning">No external laboratory is set up. A clinic admin can add one under Settings → Laboratory.</Alert>)}
        <Field label="Clinical note for the lab (optional)" error={errors.clinicalNotes}><Textarea rows={2} value={notes} maxLength={1000} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}
