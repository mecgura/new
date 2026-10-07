"use client";
import { useMemo, useState } from "react";
import { AlertOctagon, Clock, Megaphone, Pause, Play, Plus, SkipForward, Siren, Check, RotateCcw, UserRoundCheck } from "lucide-react";
import { Alert, Badge, Button, Card, EmptyState, ErrorState, Field, LoadingState, Modal, Select, TextInput, useToast } from "@/components/ui";
import { apiFetch } from "@/lib/api/client";
import { cn } from "@/lib/cn";
import { compareQueue } from "@/lib/scheduling/states";
import { PatientPicker, type PickerValue } from "./patient-picker";
import { PriorityBadge, STATUS_LABEL } from "./labels";
import { usePolling } from "./use-poll";

interface Visit {
  id: string; token: string; status: string; priority: string; queueType: string; doctorUserId: string; patientName: string; patientCode: string; patientAge: string | null; patientGender: string | null;
  visitType: string; note: string | null; waitedMinutes: number; estimatedWaitMinutes: number | null; stale: boolean;
}
interface Snapshot { date: string; doctors: { id: string; name: string; room: string | null; avgConsultMinutes: number }[]; visits: Visit[] }
export interface OpdPerms { manage: boolean; call: boolean; priority: boolean }

async function post(url: string, body: unknown) { return apiFetch<Record<string, unknown>>(url, { method: "POST", body: JSON.stringify(body) }); }

export function OpdBoard({ mode, perms, doctors: allDoctors }: { mode: "reception" | "doctor"; perms: OpdPerms; doctors: { id: string; name: string }[] }) {
  const toast = useToast();
  const { data, error, loading, updatedAt, refresh } = usePolling<Snapshot>("/api/opd", { intervalMs: 5000 });
  const [filter, setFilter] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [register, setRegister] = useState<null | "walkin" | "emergency">(null);
  const [priorityFor, setPriorityFor] = useState<Visit | null>(null);
  const [reassignFor, setReassignFor] = useState<Visit | null>(null);
  const [cancelFor, setCancelFor] = useState<Visit | null>(null);
  const [actionError, setActionError] = useState<string>();

  async function run(v: Visit, action: string, extra: Record<string, unknown> = {}, okMsg?: string) {
    setBusyId(v.id); setActionError(undefined);
    const r = await post(`/api/opd/${v.id}`, { action, ...extra });
    setBusyId(null);
    if (!r.ok) { setActionError(r.error.fieldErrors ? Object.values(r.error.fieldErrors).join(" ") : r.error.message); await refresh(); return false; }
    if (okMsg) toast({ tone: "success", title: okMsg });
    await refresh(); return true;
  }
  async function callNext(doctorUserId: string) {
    setBusyId(`next:${doctorUserId}`); setActionError(undefined);
    const r = await post("/api/opd/call-next", { doctorUserId });
    setBusyId(null);
    if (!r.ok) { setActionError(r.error.message); return; }
    toast({ tone: "success", title: `Called token ${String(r.data.token)}` }); await refresh();
  }

  const doctors = useMemo(() => (data?.doctors ?? []).filter((d) => !filter || d.id === filter), [data, filter]);
  const visitsOf = (id: string) => (data?.visits ?? []).filter((v) => v.doctorUserId === id);

  const header = (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="type-page-title">{mode === "doctor" ? "My queue" : "Live OPD"}</h1>
        <p className="type-secondary mt-1">Today&apos;s queue{data ? ` · ${data.date}` : ""}. Updates automatically every few seconds{updatedAt ? ` · last updated ${updatedAt.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}` : ""}.</p></div>
      {perms.manage && (
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setRegister("walkin")}><Plus aria-hidden className="size-4" />Walk-in patient</Button>
          {perms.priority && <Button variant="danger" onClick={() => setRegister("emergency")}><Siren aria-hidden className="size-4" />Emergency</Button>}
        </div>
      )}
    </div>
  );

  if (loading && !data) return <div className="space-y-section">{header}<LoadingState label="Loading the queue…" /></div>;
  if (error && !data) return <div className="space-y-section">{header}<ErrorState code={error.code} description={error.message} action={<Button onClick={refresh}>Try again</Button>} /></div>;

  return (
    <div className="space-y-section">
      {header}
      {error && <Alert tone="warning" title="Connection problem">We couldn&apos;t refresh the queue. The list below may be out of date — retrying automatically.</Alert>}
      {actionError && <Alert tone="danger">{actionError}</Alert>}
      {mode === "reception" && (data?.doctors.length ?? 0) > 1 && (
        <Card className="p-card"><Field label="Show doctor"><Select value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="All doctors" options={(data?.doctors ?? []).map((d) => ({ value: d.id, label: d.name }))} /></Field></Card>
      )}
      {!doctors.length && <Card><EmptyState title="No doctors to show" description="Add a doctor and set their schedule to start using the queue." /></Card>}
      <div className={cn("grid gap-section", doctors.length > 1 && "xl:grid-cols-2")}>
        {doctors.map((d) => {
          const list = visitsOf(d.id);
          const withDoc = list.filter((v) => v.status === "CALLED" || v.status === "IN_CONSULTATION");
          const waiting = list.filter((v) => v.status === "WAITING").sort((a, b) => compareQueue({ priority: a.priority, queueSeq: list.indexOf(a) }, { priority: b.priority, queueSeq: list.indexOf(b) }));
          const parked = list.filter((v) => v.status === "ON_HOLD" || v.status === "SKIPPED");
          const done = list.filter((v) => v.status === "COMPLETED").length;
          return (
            <Card key={d.id} className="space-y-4 p-card" aria-label={`Queue for ${d.name}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0"><h2 className="type-section truncate">{d.name}</h2><p className="type-caption">{d.room ? `${d.room} · ` : ""}{waiting.length} waiting · {done} done · ≈{d.avgConsultMinutes} min per patient</p></div>
                {(perms.manage || perms.call) && <Button onClick={() => callNext(d.id)} loading={busyId === `next:${d.id}`} disabled={!waiting.length || withDoc.some((v) => v.status === "CALLED" || v.status === "IN_CONSULTATION")}><Megaphone aria-hidden className="size-4" />Call next</Button>}
              </div>

              <section aria-label="With the doctor">
                {withDoc.length ? withDoc.map((v) => (
                  <div key={v.id} className={cn("rounded-md border-2 p-3", v.priority === "EMERGENCY" ? "border-emergency bg-danger-soft" : "border-success bg-success-soft")}>
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="rounded-md bg-ink px-3 py-1 text-2xl font-bold tabular-nums text-surface" aria-label={`Token ${v.token}`}>{v.token}</span>
                      <div className="min-w-0 flex-1"><p className="type-card-title truncate">{v.patientName}</p><p className="type-caption">{v.patientCode}{v.patientAge ? ` · ${v.patientAge}` : ""}{v.patientGender ? ` · ${v.patientGender.toLowerCase()}` : ""}</p></div>
                      <Badge tone={v.status === "CALLED" ? "info" : "success"}>{STATUS_LABEL[v.status]}</Badge><PriorityBadge priority={v.priority} />
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {v.status === "CALLED" && <Button size="sm" onClick={() => run(v, "start", {}, "Consultation started")} loading={busyId === v.id}><Play aria-hidden className="size-4" />Start</Button>}
                      {v.status === "IN_CONSULTATION" && <Button size="sm" variant="success" onClick={() => run(v, "complete", {}, "Visit completed")} loading={busyId === v.id}><Check aria-hidden className="size-4" />Complete</Button>}
                      {v.status === "CALLED" && <Button size="sm" variant="outline" onClick={() => run(v, "skip", {}, "Skipped")}><SkipForward aria-hidden className="size-4" />Skip</Button>}
                      {v.status === "CALLED" && perms.manage && <Button size="sm" variant="outline" onClick={() => run(v, "recall", {}, "Back to waiting")}><RotateCcw aria-hidden className="size-4" />Back to waiting</Button>}
                      <Button size="sm" variant="outline" onClick={() => run(v, "hold", {}, "Put on hold")}><Pause aria-hidden className="size-4" />Hold</Button>
                    </div>
                  </div>
                )) : <p className="type-secondary rounded-md border border-dashed border-line p-3">No patient with the doctor right now.</p>}
              </section>

              <section aria-label="Waiting">
                <h3 className="type-label mb-2 flex items-center gap-1.5"><Clock aria-hidden className="size-4" />Waiting ({waiting.length})</h3>
                {waiting.length ? <ul className="space-y-2">{waiting.map((v, i) => (
                  <li key={v.id} className={cn("rounded-md border p-3", v.priority === "EMERGENCY" ? "border-emergency bg-danger-soft" : v.priority === "HIGH" ? "border-warning bg-warning-soft" : "border-line bg-surface")}>
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="min-w-12 rounded-md bg-surface-muted px-2.5 py-1 text-center text-lg font-bold tabular-nums">{v.token}</span>
                      <div className="min-w-0 flex-1 basis-36"><p className="type-label truncate">{v.patientName}{v.stale && <span className="type-caption ml-1 !text-warning">(from an earlier day)</span>}</p>
                        <p className="type-caption">{v.patientCode} · waiting {v.waitedMinutes} min{v.estimatedWaitMinutes != null ? ` · ≈${v.estimatedWaitMinutes} min to go` : ""}{i === 0 ? " · next" : ""}</p></div>
                      <PriorityBadge priority={v.priority} />
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {(perms.manage || perms.call) && <Button size="sm" variant="outline" onClick={() => run(v, "call", {}, `Called ${v.token}`)} loading={busyId === v.id}>Call</Button>}
                      {(perms.manage || perms.call) && <Button size="sm" variant="ghost" onClick={() => run(v, "hold", {}, "Put on hold")}>Hold</Button>}
                      {(perms.manage || perms.call) && <Button size="sm" variant="ghost" onClick={() => run(v, "skip", {}, "Skipped")}>Skip</Button>}
                      {perms.priority && <Button size="sm" variant="ghost" onClick={() => setPriorityFor(v)}><AlertOctagon aria-hidden className="size-4" />Priority</Button>}
                      {perms.manage && (data?.doctors.length ?? 0) > 1 && <Button size="sm" variant="ghost" onClick={() => setReassignFor(v)}>Move</Button>}
                      {perms.manage && <Button size="sm" variant="ghost" onClick={() => setCancelFor(v)}>Cancel</Button>}
                    </div>
                  </li>))}</ul>
                  : <p className="type-secondary">Nobody is waiting.</p>}
              </section>

              {parked.length > 0 && (
                <section aria-label="On hold or skipped">
                  <h3 className="type-label mb-2">On hold / skipped ({parked.length})</h3>
                  <ul className="space-y-2">{parked.map((v) => (
                    <li key={v.id} className="flex flex-wrap items-center gap-3 rounded-md border border-line p-3">
                      <span className="min-w-12 rounded-md bg-surface-muted px-2.5 py-1 text-center text-lg font-bold tabular-nums">{v.token}</span>
                      <div className="min-w-0 flex-1 basis-32"><p className="type-label truncate">{v.patientName}</p><p className="type-caption">{STATUS_LABEL[v.status]}</p></div>
                      {v.status === "ON_HOLD" && <Button size="sm" variant="outline" onClick={() => run(v, "resume", {}, "Back in the queue")}><UserRoundCheck aria-hidden className="size-4" />Resume (same place)</Button>}
                      {v.status === "SKIPPED" && <Button size="sm" variant="outline" onClick={() => run(v, "requeue", {}, "Moved to the end of the queue")}>Back to end of queue</Button>}
                      {perms.manage && <Button size="sm" variant="ghost" onClick={() => setCancelFor(v)}>Cancel</Button>}
                    </li>))}</ul>
                </section>
              )}
            </Card>
          );
        })}
      </div>

      <RegisterModal mode={register} onClose={() => setRegister(null)} doctors={allDoctors} onDone={refresh} />
      <PriorityModal v={priorityFor} onClose={() => setPriorityFor(null)} onSave={async (p, reason) => { if (priorityFor && (await run(priorityFor, "priority", { priority: p, reason }, "Priority updated"))) setPriorityFor(null); }} />
      <Modal open={!!reassignFor} onClose={() => setReassignFor(null)} title="Move to another doctor" description={reassignFor ? `Token ${reassignFor.token} keeps its number and place in line.` : undefined}>
        <div className="space-y-2">{allDoctors.filter((d) => d.id !== reassignFor?.doctorUserId).map((d) => <Button key={d.id} variant="outline" className="w-full justify-start" onClick={async () => { if (reassignFor && (await run(reassignFor, "reassign", { doctorUserId: d.id }, `Moved to ${d.name}`))) setReassignFor(null); }}>{d.name}</Button>)}</div>
      </Modal>
      <Modal open={!!cancelFor} onClose={() => setCancelFor(null)} title="Cancel this token?" description={cancelFor ? `Token ${cancelFor.token} (${cancelFor.patientName}) will be removed from the queue.` : undefined}
        footer={<><Button variant="outline" onClick={() => setCancelFor(null)} autoFocus>Keep</Button><Button variant="danger" onClick={async () => { if (cancelFor && (await run(cancelFor, "cancel", {}, "Token cancelled"))) setCancelFor(null); }}>Cancel token</Button></>} />
    </div>
  );
}

function PriorityModal({ v, onClose, onSave }: { v: Visit | null; onClose: () => void; onSave: (p: string, reason?: string) => void }) {
  const [p, setP] = useState("HIGH"); const [reason, setReason] = useState("");
  return (
    <Modal open={!!v} onClose={onClose} title="Change priority" description={v ? `Token ${v.token}. Priority changes are recorded in the audit log.` : undefined}
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button variant={p === "EMERGENCY" ? "danger" : "primary"} onClick={() => onSave(p, reason || undefined)}>Save priority</Button></>}>
      <div className="space-y-3">
        <Field label="Priority"><Select value={p} onChange={(e) => setP(e.target.value)} options={[{ value: "NORMAL", label: "Normal" }, { value: "HIGH", label: "High priority" }, { value: "EMERGENCY", label: "Emergency (goes first)" }]} /></Field>
        <Field label="Reason (optional)"><TextInput value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} /></Field>
      </div>
    </Modal>
  );
}

function RegisterModal({ mode, onClose, doctors, onDone }: { mode: null | "walkin" | "emergency"; onClose: () => void; doctors: { id: string; name: string }[]; onDone: () => void }) {
  const toast = useToast();
  const [patient, setPatient] = useState<PickerValue>(null);
  const [doctor, setDoctor] = useState(doctors[0]?.id ?? "");
  const [queueType, setQueueType] = useState("GENERAL");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string>();
  const emergency = mode === "emergency";

  async function save() {
    if (!patient || patient.kind !== "ref") return;
    setBusy(true); setErrors({}); setMsg(undefined);
    const r = await post("/api/opd", { patient: patient.ref, doctorUserId: doctor, emergency, queueType: emergency ? "EMERGENCY" : queueType, visitType: emergency ? "EMERGENCY" : queueType === "FOLLOW_UP" ? "FOLLOW_UP" : queueType === "PROCEDURE" ? "PROCEDURE" : "WALK_IN", note: note || undefined });
    setBusy(false);
    if (!r.ok) { setErrors(r.error.fieldErrors ?? {}); setMsg(r.error.message); return; }
    toast({ tone: "success", title: `Token ${String(r.data.token)} issued`, description: emergency ? "Marked as emergency — goes to the front." : undefined });
    setPatient(null); setNote(""); onDone(); onClose();
  }
  return (
    <Modal open={!!mode} onClose={onClose} title={emergency ? "Register emergency" : "Register walk-in"} description={emergency ? "Emergency patients are placed first in the doctor's queue. This is recorded in the audit log." : "The patient gets the next token."}
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button variant={emergency ? "danger" : "primary"} onClick={save} loading={busy} disabled={!patient || patient.kind !== "ref" || !doctor}>{emergency ? "Register emergency" : "Issue token"}</Button></>}>
      <div className="space-y-4">
        {msg && <Alert tone="danger">{msg}</Alert>}
        <Field label="Doctor" required error={errors.doctorUserId}><Select value={doctor} onChange={(e) => setDoctor(e.target.value)} options={doctors.map((d) => ({ value: d.id, label: d.name }))} /></Field>
        {!emergency && <Field label="Queue"><Select value={queueType} onChange={(e) => setQueueType(e.target.value)} options={[{ value: "GENERAL", label: "General OPD" }, { value: "FOLLOW_UP", label: "Follow-up" }, { value: "PROCEDURE", label: "Procedure" }]} /></Field>}
        <Field label="Note (optional)" hint="Brief, e.g. “brought by relative”."><TextInput value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} /></Field>
        <PatientPicker value={patient} onChange={setPatient} errors={errors} />
      </div>
    </Modal>
  );
}
