"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { Alert, Badge, Button, Card, CardHeader, DatePicker, EmptyState, ErrorState, Field, LoadingState, Modal, NumberInput, Select, StatusBadge, TextInput, Textarea, useToast } from "@/components/ui";
import type { PatientCard } from "@/components/scheduling/patient-picker";
import { apiFetch } from "@/lib/api/client";
import { FREQ_LABEL, dateLabel } from "./followup-ui";

interface Row { id: string; title: string; dueDate: string; frequency: string; occurrence: number; maxOccurrences: number; status: string; followUpId: string | null; due: boolean; patient: { id: string; code: string; name: string } }

/** Planned future patient recalls. A recall becomes a follow-up only when you create it (or the clinic switched that rule on). */
export function RecallsPanel({ canCreateFollowUp, presetPatient }: { canCreateFollowUp: boolean; presetPatient?: { id: string; label: string } }) {
  const toast = useToast();
  const [rows, setRows] = useState<Row[] | null>(null); const [err, setErr] = useState<string>(); const [open, setOpen] = useState(false);
  const load = useCallback(async () => { const r = await apiFetch<{ rows: Row[] }>(`/api/recalls${presetPatient ? `?patientId=${presetPatient.id}` : ""}`); if (r.ok) { setRows(r.data.rows); setErr(undefined); } else setErr(r.error.message); }, [presetPatient]);
  useEffect(() => { load(); }, [load]);
  async function act(id: string, body: Record<string, unknown>, ok: string) { const r = await apiFetch(`/api/recalls/${id}/action`, { method: "POST", body: JSON.stringify(body) }); if (r.ok) { toast({ tone: "success", title: ok }); await load(); } else toast({ tone: "danger", title: r.error.message }); }
  return (
    <Card>
      <CardHeader title="Recalls" description="Planned reminders such as an annual check-up. Repeats are limited and created only when you ask." action={<Button size="sm" onClick={() => setOpen(true)}><Plus aria-hidden className="size-4" />New recall</Button>} />
      {err && !rows ? <ErrorState description={err} action={<Button onClick={load}>Try again</Button>} /> : !rows ? <LoadingState /> : !rows.length ? <EmptyState title="No upcoming recalls" description="Recalls you create appear here." /> : (
        <ul className="divide-y divide-line">{rows.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 p-card">
            <div className="min-w-0"><p className="type-label">{r.title}</p><p className="type-caption">{presetPatient ? "" : <><Link href={`/patients/${r.patient.id}`}>{r.patient.name}</Link> · {r.patient.code} · </>}Due {dateLabel(r.dueDate)} · {FREQ_LABEL[r.frequency]}{r.maxOccurrences > 1 ? ` (${r.occurrence} of ${r.maxOccurrences})` : ""}</p></div>
            <div className="flex flex-wrap items-center gap-2">
              {r.due && <Badge tone="warning">Due</Badge>}<StatusBadge tone={r.status === "ACTIVE" ? "info" : "success"}>{r.status === "ACTIVE" ? "Active" : "Follow-up created"}</StatusBadge>
              {r.followUpId && <Link href={`/followups/${r.followUpId}`}><Button size="sm" variant="outline">Open follow-up</Button></Link>}
              {r.status === "ACTIVE" && canCreateFollowUp && <Button size="sm" onClick={() => act(r.id, { action: "createFollowUp" }, "Follow-up created")}>Create follow-up</Button>}
              <Button size="sm" variant="outline" onClick={() => act(r.id, { action: "complete" }, "Recall completed")}>Complete</Button>
              {r.frequency !== "ONE_TIME" && r.occurrence < r.maxOccurrences && <Button size="sm" variant="outline" onClick={() => act(r.id, { action: "complete", scheduleNext: true }, "Completed — next recall scheduled")}>Complete &amp; schedule next</Button>}
              <Button size="sm" variant="ghost" onClick={() => act(r.id, { action: "cancel" }, "Recall cancelled")}>Cancel</Button>
            </div>
          </li>))}</ul>
      )}
      {open && <NewRecallModal presetPatient={presetPatient} onClose={() => setOpen(false)} onDone={async () => { setOpen(false); await load(); }} />}
    </Card>
  );
}

function NewRecallModal({ presetPatient, onClose, onDone }: { presetPatient?: { id: string; label: string }; onClose: () => void; onDone: () => Promise<void> }) {
  const toast = useToast();
  const [f, setF] = useState({ title: "", dueDate: "", frequency: "ONE_TIME", customMonths: "", maxOccurrences: "", notes: "" });
  const [patient, setPatient] = useState<PatientCard | null>(null); const [q, setQ] = useState(""); const [results, setResults] = useState<PatientCard[] | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({}); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<string>();
  useEffect(() => { if (presetPatient || q.trim().length < 3) { setResults(null); return; } const t = setTimeout(async () => { const r = await apiFetch<PatientCard[]>(`/api/patients/search?q=${encodeURIComponent(q.trim())}`); if (r.ok) setResults(r.data); }, 300); return () => clearTimeout(t); }, [q, presetPatient]);
  async function save() {
    setBusy(true); setErrors({}); setMsg(undefined);
    const r = await apiFetch("/api/recalls", { method: "POST", body: JSON.stringify({ patientId: presetPatient?.id ?? patient?.id, ...f, customMonths: f.customMonths || undefined, maxOccurrences: f.maxOccurrences || undefined, notes: f.notes || undefined }) });
    setBusy(false);
    if (!r.ok) { setErrors(r.error.fieldErrors ?? {}); setMsg(r.error.message); return; }
    toast({ tone: "success", title: "Recall created" }); await onDone();
  }
  return (
    <Modal open onClose={onClose} title="New recall" description="A planned future reminder. Nothing is sent to the patient." footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy} disabled={!presetPatient && !patient}>Create recall</Button></>}>
      <div className="space-y-3">
        {msg && <Alert tone="danger">{msg}</Alert>}
        {presetPatient ? <p className="type-secondary">Patient: <strong>{presetPatient.label}</strong></p> : patient ? <p className="type-label">{patient.name} · {patient.code}</p> : (
          <div className="space-y-2"><Field label="Patient" required error={errors.patientId} hint="Search by name, ID or mobile"><TextInput value={q} onChange={(e) => setQ(e.target.value)} /></Field>
            {results && (results.length ? <ul className="max-h-36 divide-y divide-line overflow-y-auto rounded-md border border-line">{results.map((p) => <li key={p.id}><button type="button" className="w-full p-2 text-left hover:bg-surface-muted" onClick={() => setPatient(p)}>{p.name} <span className="type-caption">{p.code}</span></button></li>)}</ul> : <p className="type-secondary">No matching patient.</p>)}</div>)}
        <Field label="Title" required error={errors.title}><TextInput value={f.title} maxLength={120} placeholder="Annual check-up" onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Due date" required error={errors.dueDate}><DatePicker value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} /></Field>
          <Field label="Repeats" error={errors.frequency}><Select value={f.frequency} onChange={(e) => setF({ ...f, frequency: e.target.value })} options={Object.entries(FREQ_LABEL).map(([value, label]) => ({ value, label }))} /></Field>
        </div>
        {f.frequency === "CUSTOM" && <Field label="Every how many months" error={errors.customMonths}><NumberInput value={f.customMonths} inputMode="numeric" onChange={(e) => setF({ ...f, customMonths: e.target.value })} /></Field>}
        {f.frequency !== "ONE_TIME" && <Field label="At most how many times (up to 12)" required error={errors.maxOccurrences}><NumberInput value={f.maxOccurrences} inputMode="numeric" onChange={(e) => setF({ ...f, maxOccurrences: e.target.value })} /></Field>}
        <Field label="Notes" error={errors.notes}><Textarea rows={2} value={f.notes} maxLength={500} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}
