"use client";
import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { Alert, Button, DatePicker, Field, Modal, NumberInput, Select, TextInput, Textarea, useToast } from "@/components/ui";
import type { PatientCard } from "@/components/scheduling/patient-picker";
import { apiFetch } from "@/lib/api/client";
import { PRIORITY_LABEL, TYPE_LABEL } from "./followup-ui";

export interface FollowUpContext { patientId?: string; patientLabel?: string; consultationId?: string; prescriptionId?: string; labReportId?: string }
type Assignee = { id: string; name: string; role: string };

/** Creates a follow-up. Patient / doctor / links come from the record on the server; the person only chooses what and when. */
export function NewFollowUpModal({ open, onClose, context = {}, defaultType = "MANUAL_FOLLOW_UP", defaultTitle = "", types, canClinical, onCreated }: { open: boolean; onClose: () => void; context?: FollowUpContext; defaultType?: string; defaultTitle?: string; types?: string[]; canClinical?: boolean; onCreated: (id: string) => void }) {
  const toast = useToast();
  const [f, setF] = useState({ type: defaultType, title: defaultTitle, priority: "NORMAL", mode: "days", afterDays: "7", dueDate: "", description: "", doctorNotes: "", assignedToId: "" });
  const [patient, setPatient] = useState<PatientCard | null>(null);
  const [q, setQ] = useState(""); const [results, setResults] = useState<PatientCard[] | null>(null);
  const [assignees, setAssignees] = useState<Assignee[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({}); const [msg, setMsg] = useState<string>(); const [busy, setBusy] = useState(false);
  const needsPatient = !context.patientId && !context.consultationId && !context.prescriptionId && !context.labReportId;
  useEffect(() => { if (open) { setF((x) => ({ ...x, type: defaultType, title: defaultTitle })); setErrors({}); setMsg(undefined); setPatient(null); setQ(""); setResults(null); apiFetch<{ users: Assignee[] }>("/api/followups/assignees").then((r) => { if (r.ok) setAssignees(r.data.users); }); } }, [open, defaultType, defaultTitle]);
  useEffect(() => {
    if (!needsPatient || q.trim().length < 3) { setResults(null); return; }
    const t = setTimeout(async () => { const r = await apiFetch<PatientCard[]>(`/api/patients/search?q=${encodeURIComponent(q.trim())}`); if (r.ok) setResults(r.data); }, 300);
    return () => clearTimeout(t);
  }, [q, needsPatient]);
  const typeList = types ?? Object.keys(TYPE_LABEL);
  async function save() {
    setBusy(true); setErrors({}); setMsg(undefined);
    const link = f.type === "MEDICATION_REVIEW" && context.prescriptionId ? { prescriptionId: context.prescriptionId } : context.labReportId ? { labReportId: context.labReportId } : context.consultationId ? { consultationId: context.consultationId } : { patientId: context.patientId ?? patient?.id };
    const r = await apiFetch<{ id: string }>("/api/followups", { method: "POST", body: JSON.stringify({ ...link, type: f.type, title: f.title, priority: f.priority, description: f.description || undefined, doctorNotes: canClinical && f.doctorNotes ? f.doctorNotes : undefined, assignedToId: f.assignedToId || undefined, ...(f.mode === "days" ? { afterDays: f.afterDays } : { dueDate: f.dueDate }) }) });
    setBusy(false);
    if (!r.ok) { setErrors(r.error.fieldErrors ?? {}); setMsg(r.error.message); return; }
    toast({ tone: "success", title: "Follow-up created" }); onCreated(r.data.id); onClose();
  }
  return (
    <Modal open={open} onClose={onClose} title="New follow-up" description="A task so this patient is not missed. Nothing is sent to the patient."
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy} disabled={needsPatient && !patient}>Create follow-up</Button></>}>
      <div className="space-y-4">
        {msg && <Alert tone="danger">{msg}</Alert>}
        {needsPatient ? (patient ? <div className="flex items-center justify-between rounded-md border border-line p-2"><span className="type-label">{patient.name} · {patient.code}</span><Button size="sm" variant="ghost" aria-label="Choose a different patient" onClick={() => setPatient(null)}><X aria-hidden className="size-4" /></Button></div> : (
          <div className="space-y-2">
            <Field label="Patient" required error={errors.patientId} hint="Search by name, ID or mobile (at least 3 characters)"><TextInput value={q} onChange={(e) => setQ(e.target.value)} /></Field>
            {results && (results.length ? <ul className="max-h-40 divide-y divide-line overflow-y-auto rounded-md border border-line">{results.map((p) => <li key={p.id}><button type="button" className="w-full p-2 text-left hover:bg-surface-muted" onClick={() => setPatient(p)}><span className="type-label">{p.name}</span> <span className="type-caption">{p.code} · {p.phoneMasked}</span></button></li>)}</ul> : <p className="type-secondary">No matching patient.</p>)}
          </div>)) : context.patientLabel ? <p className="type-secondary">Patient: <strong>{context.patientLabel}</strong></p> : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Type" error={errors.type}><Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} options={typeList.map((v) => ({ value: v, label: TYPE_LABEL[v] }))} /></Field>
          <Field label="Priority" error={errors.priority}><Select value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })} options={Object.entries(PRIORITY_LABEL).map(([value, label]) => ({ value, label }))} /></Field>
        </div>
        <Field label="Title" required error={errors.title}><TextInput value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} maxLength={120} /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Due"><Select value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value })} options={[{ value: "days", label: "After a number of days" }, { value: "date", label: "On a date" }]} /></Field>
          {f.mode === "days" ? <Field label="Days from today" error={errors.dueDate ?? errors.afterDays}><NumberInput value={f.afterDays} onChange={(e) => setF({ ...f, afterDays: e.target.value })} inputMode="numeric" /></Field> : <Field label="Due date" error={errors.dueDate}><DatePicker value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} /></Field>}
        </div>
        <Field label="Description (for the team)" error={errors.description} hint="Keep it operational, e.g. “Call to book the review visit”."><Textarea rows={2} value={f.description} maxLength={500} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        {canClinical && <Field label="Doctor note (clinical staff only)" error={errors.doctorNotes}><Textarea rows={2} value={f.doctorNotes} maxLength={1000} onChange={(e) => setF({ ...f, doctorNotes: e.target.value })} /></Field>}
        {assignees.length > 0 && <Field label="Assign to (optional)" error={errors.assignedToId}><Select value={f.assignedToId} onChange={(e) => setF({ ...f, assignedToId: e.target.value })} placeholder="Unassigned" options={assignees.map((u) => ({ value: u.id, label: `${u.name} (${u.role.toLowerCase().replace("_", " ")})` }))} /></Field>}
      </div>
    </Modal>
  );
}
