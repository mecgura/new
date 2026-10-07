"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { CalendarPlus, CheckCircle2, Phone, Play } from "lucide-react";
import { Alert, Badge, Button, Card, CardBody, CardHeader, DatePicker, EmptyState, Field, Modal, NumberInput, Select, StatusBadge, TextInput, Textarea, Toggle, useToast } from "@/components/ui";
import { NewAppointmentModal, type DoctorOpt, type ServiceOpt } from "@/components/scheduling/appointment-dialogs";
import { apiFetch } from "@/lib/api/client";
import type { FollowUpDetail } from "@/lib/services/followups";
import { EVENT_LABEL, METHOD_LABEL, PRIORITY_LABEL, PRIORITY_TONE, SOURCE_LABEL, STATUS_LABEL, STATUS_TONE, TYPE_LABEL, dateLabel, dueText, pretty, when } from "./followup-ui";

type Panel = null | "contact" | "reschedule" | "complete" | "cancel" | "assign" | "edit";
const APPT_TONE: Record<string, "success" | "danger" | "info" | "neutral" | "warning"> = { COMPLETED: "success", CANCELLED: "danger", NO_SHOW: "danger", CONFIRMED: "info", REQUESTED: "warning" };

export function FollowUpWorkspace({ initial, doctors, services, today, initialAction, assignees }: { initial: FollowUpDetail; doctors: DoctorOpt[]; services: ServiceOpt[]; today: string; initialAction?: string; assignees: { id: string; name: string; role: string }[] }) {
  const toast = useToast();
  const [d, setD] = useState(initial);
  const [panel, setPanel] = useState<Panel>(initialAction && ["contact", "reschedule", "complete"].includes(initialAction) && initial.can[initialAction as "reschedule"] !== false ? (initialAction as Panel) : null);
  const [book, setBook] = useState(initialAction === "book" && initial.can.book);
  const [error, setError] = useState<string>();
  const reload = useCallback(async () => { const r = await apiFetch<FollowUpDetail>(`/api/followups/${initial.id}`); if (r.ok) { setD(r.data); setError(undefined); } else setError(r.error.message); }, [initial.id]);
  useEffect(() => { const t = setInterval(reload, 30000); return () => clearInterval(t); }, [reload]);
  async function run(body: Record<string, unknown>, ok: string) {
    const r = await apiFetch(`/api/followups/${d.id}/action`, { method: "POST", body: JSON.stringify(body) });
    if (!r.ok) { toast({ tone: "danger", title: r.error.message }); await reload(); return { ok: false as const, error: r.error }; }
    toast({ tone: "success", title: ok }); await reload(); return { ok: true as const, data: r.data };
  }
  const open = !["COMPLETED", "PATIENT_DECLINED", "CANCELLED", "EXPIRED"].includes(d.status);
  const p = d.patient;
  return (
    <div className="space-y-section">
      {error && <Alert tone="danger">{error}</Alert>}
      <Card>
        <CardBody className="space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="type-caption tabular-nums">{d.followUpNumber} · {TYPE_LABEL[d.type]}</p>
              <h1 className="type-page-title">{d.title}</h1>
              <p className="type-secondary mt-1">{p ? <><Link href={`/patients/${p.id}`} className="font-semibold">{p.name}</Link> · <span className="tabular-nums">{p.code}</span>{p.phone ? <> · <a href={`tel:${p.phone}`} className="tabular-nums">{p.phone}</a></> : null}</> : "Patient details hidden for your role"}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={PRIORITY_TONE[d.priority]}>{PRIORITY_LABEL[d.priority]}</Badge>
              <StatusBadge tone={STATUS_TONE[d.status]}>{STATUS_LABEL[d.status]}</StatusBadge>
            </div>
          </div>
          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Info label="Due" value={dueText(d.dueDate, d.overdueDays)} tone={d.overdueDays > 0 ? "danger" : undefined} />
            <Info label="Doctor" value={d.doctorName ?? "—"} />
            <Info label="Assigned to" value={d.assignedTo ? d.assignedTo.name : "Unassigned"} />
            <Info label="Source" value={`${SOURCE_LABEL[d.source] ?? d.source} · created ${when(d.createdAt)}${d.createdBy ? ` by ${d.createdBy}` : ""}`} />
          </dl>
          {d.description && <p className="type-body">{d.description}</p>}
          {d.doctorNotes && <p className="type-secondary rounded-md bg-surface-muted p-2"><strong>Doctor note:</strong> {d.doctorNotes}</p>}
          {d.notes && <p className="type-secondary"><strong>Internal notes:</strong> {d.notes}</p>}
          {d.rescheduleCount > 0 && <p className="type-caption">Rescheduled {d.rescheduleCount} time{d.rescheduleCount === 1 ? "" : "s"}.</p>}
          {d.visitCompleted && <Alert tone="success" title="The follow-up visit was completed">Close this follow-up when you are satisfied it is done.</Alert>}
          {!open && <Alert tone={d.status === "CANCELLED" ? "warning" : "success"} title={d.status === "CANCELLED" ? "Cancelled" : `Closed — ${pretty(d.outcome ?? d.status)}`}>{d.status === "CANCELLED" ? d.cancelReason : d.outcomeNotes}{d.completedBy ? ` (${d.completedBy}, ${when(d.completedAt)})` : ""}</Alert>}
          {(d.links.consultationId || d.links.labReportId) && <p className="type-caption print:hidden">Linked: {d.links.consultationId && <Link href={`/consultations/${d.links.consultationId}`}>consultation</Link>}{d.links.consultationId && d.links.labReportId ? " · " : ""}{d.links.labReportId && <Link href={`/lab/reports/${d.links.labReportId}`}>lab report</Link>}</p>}
          <div className="flex flex-wrap gap-2 print:hidden">
            {d.can.start && d.status !== "IN_PROGRESS" && <Button size="sm" variant="outline" onClick={() => run({ action: "start" }, "Follow-up started")}><Play aria-hidden className="size-4" />Start follow-up</Button>}
            {d.can.contact && <Button size="sm" onClick={() => setPanel("contact")}><Phone aria-hidden className="size-4" />Log contact</Button>}
            {d.can.book && <Button size="sm" onClick={() => setBook(true)}><CalendarPlus aria-hidden className="size-4" />Book appointment</Button>}
            {d.can.reschedule && <Button size="sm" variant="outline" onClick={() => setPanel("reschedule")}>Reschedule</Button>}
            {d.can.complete && <Button size="sm" variant="outline" onClick={() => setPanel("complete")}><CheckCircle2 aria-hidden className="size-4" />Mark completed</Button>}
            {d.can.assign && <Button size="sm" variant="ghost" onClick={() => setPanel("assign")}>Assign</Button>}
            {d.can.edit && <Button size="sm" variant="ghost" onClick={() => setPanel("edit")}>Edit</Button>}
            {d.can.cancel && <Button size="sm" variant="ghost" onClick={() => setPanel("cancel")}>Cancel</Button>}
          </div>
        </CardBody>
      </Card>

      {p && <Card><CardHeader title="Communication preferences" description="Respected when logging contact. Nothing is sent by the system." />
        <CardBody className="flex flex-wrap gap-2">{(["phone", "whatsapp", "sms", "email"] as const).map((k) => <StatusBadge key={k} tone={p.prefs[k] === "ALLOWED" ? "success" : p.prefs[k] === "NOT_ALLOWED" ? "danger" : "neutral"}>{pretty(k)}: {p.prefs[k] === "NOT_ALLOWED" ? "not allowed" : p.prefs[k].toLowerCase()}</StatusBadge>)}</CardBody></Card>}

      <div className="grid gap-section lg:grid-cols-2">
        <Card><CardHeader title="Contact history" />
          {!d.contacts.length ? <EmptyState title="No contact history" description="Log each call or visit so the next person knows what happened." /> : (
            <ol className="divide-y divide-line">{d.contacts.map((c) => (
              <li key={c.id} className="space-y-0.5 p-card"><p className="type-label">{when(c.contactedAt)} · {c.by ?? "Staff"}</p><p className="type-secondary">{METHOD_LABEL[c.method] ?? c.method} · {pretty(c.outcome)}</p>{c.notes && <p className="type-body">{c.notes}</p>}{c.nextAction && <p className="type-caption">Next: {c.nextAction}{c.nextActionDate ? ` (${dateLabel(c.nextActionDate)})` : ""}</p>}</li>))}</ol>
          )}
        </Card>
        <Card><CardHeader title="Appointments" description="From the appointment records. Nothing is copied." />
          {d.appointment && <div className="border-b border-line p-card"><p className="type-label">Booked for this follow-up</p><p className="type-secondary">{when(d.appointment.startsAt)} · {d.appointment.doctorName ?? "Doctor"} · <StatusBadge tone={APPT_TONE[d.appointment.status] ?? "neutral"}>{pretty(d.appointment.status)}</StatusBadge></p></div>}
          {!d.appointments.length ? <EmptyState title="No appointments yet" /> : (
            <ul className="divide-y divide-line">{d.appointments.map((a) => <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 p-card"><span className="type-secondary tabular-nums">{when(a.startsAt)} · {a.doctorName ?? "Doctor"} · {pretty(a.type)}</span><StatusBadge tone={APPT_TONE[a.status] ?? "neutral"}>{pretty(a.status)}</StatusBadge></li>)}</ul>
          )}
        </Card>
      </div>

      <Card><CardHeader title="History" description="Every change is kept, including reschedules." />
        <ol className="divide-y divide-line">{d.events.map((e) => (
          <li key={e.id} className="p-card"><p className="type-label">{EVENT_LABEL[e.type] ?? e.type} <span className="type-caption">· {when(e.at)} · {e.by ?? "System"}</span></p>
            {(e.fromValue || e.toValue) && e.type === "RESCHEDULED" && <p className="type-secondary">{dateLabel(e.fromValue)} → {dateLabel(e.toValue)}</p>}{e.note && e.type !== "CONTACTED" && e.type !== "CREATED" && <p className="type-secondary">{e.note}</p>}</li>))}</ol>
      </Card>

      {panel === "contact" && <ContactModal d={d} onClose={() => setPanel(null)} onDone={async () => { setPanel(null); await reload(); }} />}
      {panel === "reschedule" && <RescheduleModal d={d} today={today} onClose={() => setPanel(null)} run={run} />}
      {panel === "complete" && <CompleteModal d={d} today={today} onClose={() => setPanel(null)} run={run} />}
      {panel === "cancel" && <ReasonModal title="Cancel this follow-up?" confirm="Cancel follow-up" tone="danger" onClose={() => setPanel(null)} onSubmit={async (reason) => (await run({ action: "cancel", reason }, "Follow-up cancelled")).ok} />}
      {panel === "assign" && <AssignModal d={d} assignees={assignees} onClose={() => setPanel(null)} run={run} />}
      {panel === "edit" && <EditModal d={d} onClose={() => setPanel(null)} onDone={async () => { setPanel(null); await reload(); }} />}
      {p && d.can.book && <NewAppointmentModal open={book} onClose={() => setBook(false)} doctors={doctors} services={services} today={today} defaultDoctor={d.doctorId ?? undefined} presetPatient={{ ref: { patientId: p.id, viaProfile: true }, label: `${p.name} (${p.code})` }} presetType="FOLLOW_UP" presetReason={d.title.slice(0, 300)} presetDate={d.preferredDate ?? d.dueDate} followUpId={d.id} onDone={reload} />}
    </div>
  );
}

function Info({ label, value, tone }: { label: string; value: string; tone?: "danger" }) {
  return <div><dt className="type-caption">{label}</dt><dd className={tone === "danger" ? "type-label text-danger" : "type-label"}>{value}</dd></div>;
}

function ContactModal({ d, onClose, onDone }: { d: FollowUpDetail; onClose: () => void; onDone: () => Promise<void> }) {
  const toast = useToast();
  const [f, setF] = useState({ method: "PHONE", outcome: "CONTACTED", notes: "", nextAction: "", nextActionDate: "" });
  const [errors, setErrors] = useState<Record<string, string>>({}); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<string>();
  const pref = d.patient ? ({ PHONE: d.patient.prefs.phone, WHATSAPP: d.patient.prefs.whatsapp, SMS: d.patient.prefs.sms, EMAIL: d.patient.prefs.email } as Record<string, string>)[f.method] : undefined;
  const manualOnly = ["WHATSAPP", "SMS", "EMAIL"].includes(f.method);
  async function save() {
    setBusy(true); setErrors({}); setMsg(undefined);
    const r = await apiFetch(`/api/followups/${d.id}/contact`, { method: "POST", body: JSON.stringify({ ...f, notes: f.notes || undefined, nextAction: f.nextAction || undefined, nextActionDate: f.nextActionDate || undefined }) });
    setBusy(false);
    if (!r.ok) { setErrors(r.error.fieldErrors ?? {}); setMsg(r.error.message); return; }
    toast({ tone: "success", title: "Contact logged" }); await onDone();
  }
  return (
    <Modal open onClose={onClose} title="Log patient contact" description="Record what you did. The system does not contact the patient." footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy} disabled={pref === "NOT_ALLOWED"}>Save contact</Button></>}>
      <div className="space-y-3">
        {msg && <Alert tone="danger">{msg}</Alert>}
        {pref === "NOT_ALLOWED" && <Alert tone="warning">This patient has asked not to be contacted this way. Choose another method.</Alert>}
        {manualOnly && <Alert tone="info">{METHOD_LABEL[f.method]} integration is not configured. Log what you did manually.</Alert>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Method" error={errors.method}><Select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })} options={Object.entries(METHOD_LABEL).map(([value, label]) => ({ value, label: manualOnly || ["WHATSAPP", "SMS", "EMAIL"].includes(value) ? `${label}${["WHATSAPP", "SMS", "EMAIL"].includes(value) ? " (logged manually)" : ""}` : label }))} /></Field>
          <Field label="Outcome" error={errors.outcome}><Select value={f.outcome} onChange={(e) => setF({ ...f, outcome: e.target.value })} options={d.outcomes.contact.map((v) => ({ value: v, label: pretty(v) }))} /></Field>
        </div>
        <Field label="Notes" error={errors.notes}><Textarea rows={3} value={f.notes} maxLength={500} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Next action" error={errors.nextAction}><TextInput value={f.nextAction} maxLength={200} onChange={(e) => setF({ ...f, nextAction: e.target.value })} /></Field>
          <Field label="Next action date" error={errors.nextActionDate}><DatePicker value={f.nextActionDate} onChange={(e) => setF({ ...f, nextActionDate: e.target.value })} /></Field>
        </div>
        <p className="type-caption">Logging a contact never completes the follow-up.</p>
      </div>
    </Modal>
  );
}

type Run = (body: Record<string, unknown>, ok: string) => Promise<{ ok: boolean; error?: { fieldErrors?: Record<string, string>; message: string } }>;
function RescheduleModal({ d, today, onClose, run }: { d: FollowUpDetail; today: string; onClose: () => void; run: Run }) {
  const [date, setDate] = useState(""); const [reason, setReason] = useState(""); const [busy, setBusy] = useState(false); const [errors, setErrors] = useState<Record<string, string>>({});
  return (
    <Modal open onClose={onClose} title="Reschedule follow-up" description={`Currently due ${dateLabel(d.dueDate)}. The previous date stays in the history.`} footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={async () => { setBusy(true); const r = await run({ action: "reschedule", dueDate: date, reason }, "Follow-up rescheduled"); setBusy(false); if (r.ok) onClose(); else setErrors(r.error?.fieldErrors ?? {}); }}>Reschedule</Button></>}>
      <div className="space-y-3"><Field label="New date" required error={errors.dueDate}><DatePicker min={today} value={date} onChange={(e) => setDate(e.target.value)} /></Field><Field label="Reason" required error={errors.reason}><Textarea rows={2} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} /></Field></div>
    </Modal>
  );
}
function CompleteModal({ d, today, onClose, run }: { d: FollowUpDetail; today: string; onClose: () => void; run: Run }) {
  const [f, setF] = useState({ outcome: "COMPLETED", notes: "", next: false, afterDays: "30", nextTitle: "" }); const [busy, setBusy] = useState(false); const [errors, setErrors] = useState<Record<string, string>>({});
  return (
    <Modal open onClose={onClose} title="Follow-up completed?" description="Choose the outcome and say what happened." footer={<><Button variant="outline" onClick={onClose}>Not yet</Button><Button loading={busy} onClick={async () => { setBusy(true); const r = await run({ action: "complete", outcome: f.outcome, notes: f.notes, ...(f.next ? { nextAfterDays: f.afterDays, nextTitle: f.nextTitle || undefined } : {}) }, "Follow-up closed"); setBusy(false); if (r.ok) onClose(); else setErrors(r.error?.fieldErrors ?? {}); }}>Mark completed</Button></>}>
      <div className="space-y-3">
        <Field label="Outcome" required error={errors.outcome}><Select value={f.outcome} onChange={(e) => setF({ ...f, outcome: e.target.value })} options={d.outcomes.completion.map((v) => ({ value: v, label: pretty(v) }))} /></Field>
        <Field label="Notes" required error={errors.notes}><Textarea rows={3} value={f.notes} maxLength={500} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        {d.can.createNext && <><Toggle label="Create a next follow-up" checked={f.next} onChange={(v) => setF({ ...f, next: v })} />
          {f.next && <div className="grid gap-3 sm:grid-cols-2"><Field label="Days from today" error={errors.nextAfterDays}><NumberInput value={f.afterDays} inputMode="numeric" onChange={(e) => setF({ ...f, afterDays: e.target.value })} /></Field><Field label="Title (optional)"><TextInput value={f.nextTitle} maxLength={120} placeholder={d.title} onChange={(e) => setF({ ...f, nextTitle: e.target.value })} /></Field></div>}</>}
        <p className="type-caption">Today is {dateLabel(today)}. Recorded with your name and the time.</p>
      </div>
    </Modal>
  );
}
function ReasonModal({ title, confirm, tone, onClose, onSubmit }: { title: string; confirm: string; tone: "danger" | "primary"; onClose: () => void; onSubmit: (reason: string) => Promise<boolean> }) {
  const [reason, setReason] = useState(""); const [busy, setBusy] = useState(false);
  return <Modal open onClose={onClose} title={title} footer={<><Button variant="outline" onClick={onClose}>Keep</Button><Button variant={tone} loading={busy} disabled={reason.trim().length < 2} onClick={async () => { setBusy(true); const ok = await onSubmit(reason); setBusy(false); if (ok) onClose(); }}>{confirm}</Button></>}><Field label="Reason" required><Textarea rows={2} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} /></Field></Modal>;
}
function AssignModal({ d, assignees, onClose, run }: { d: FollowUpDetail; assignees: { id: string; name: string; role: string }[]; onClose: () => void; run: Run }) {
  const [to, setTo] = useState(d.assignedTo?.id ?? ""); const [busy, setBusy] = useState(false);
  return <Modal open onClose={onClose} title="Assign follow-up" footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={async () => { setBusy(true); const r = await run({ action: "assign", assignedToId: to || null }, "Assignment saved"); setBusy(false); if (r.ok) onClose(); }}>Save</Button></>}><Field label="Assigned to"><Select value={to} onChange={(e) => setTo(e.target.value)} placeholder="Unassigned" options={assignees.map((u) => ({ value: u.id, label: `${u.name} (${u.role.toLowerCase().replace("_", " ")})` }))} /></Field></Modal>;
}
function EditModal({ d, onClose, onDone }: { d: FollowUpDetail; onClose: () => void; onDone: () => Promise<void> }) {
  const toast = useToast();
  const [f, setF] = useState({ title: d.title, description: d.description ?? "", notes: d.notes ?? "", priority: d.priority, doctorNotes: d.doctorNotes ?? "" }); const [busy, setBusy] = useState(false); const [errors, setErrors] = useState<Record<string, string>>({});
  const clinical = d.clinicalAccess;
  async function save() {
    setBusy(true); setErrors({});
    const r = await apiFetch(`/api/followups/${d.id}`, { method: "PATCH", body: JSON.stringify({ title: f.title, description: f.description, notes: f.notes, priority: f.priority, ...(clinical ? { doctorNotes: f.doctorNotes } : {}) }) });
    setBusy(false);
    if (!r.ok) { setErrors(r.error.fieldErrors ?? {}); toast({ tone: "danger", title: r.error.message }); return; }
    toast({ tone: "success", title: "Saved" }); await onDone();
  }
  return (
    <Modal open onClose={onClose} title="Edit follow-up" description="To change the date, use Reschedule so the history is kept." footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy}>Save</Button></>}>
      <div className="space-y-3">
        <Field label="Title" error={errors.title}><TextInput value={f.title} maxLength={120} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <Field label="Priority"><Select value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })} options={Object.entries(PRIORITY_LABEL).map(([value, label]) => ({ value, label }))} /></Field>
        <Field label="Description" error={errors.description}><Textarea rows={2} value={f.description} maxLength={500} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <Field label="Internal notes" error={errors.notes}><Textarea rows={2} value={f.notes} maxLength={1000} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        {clinical && <Field label="Doctor note" error={errors.doctorNotes}><Textarea rows={2} value={f.doctorNotes} maxLength={1000} onChange={(e) => setF({ ...f, doctorNotes: e.target.value })} /></Field>}
      </div>
    </Modal>
  );
}
