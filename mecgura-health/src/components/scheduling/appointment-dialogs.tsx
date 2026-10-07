"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Alert, Button, Field, LoadingState, Modal, Select, Textarea, TextInput, useToast } from "@/components/ui";
import { apiFetch } from "@/lib/api/client";
import { AppointmentStatusBadge, CANCEL_REASON_LABEL, TYPE_LABEL } from "./labels";
import { PatientPicker, type PickerValue } from "./patient-picker";
import { SlotPicker } from "./slot-picker";

export interface DoctorOpt { id: string; name: string }
export interface ServiceOpt { id: string; title: string }
export interface Detail {
  id: string; publicId: string; type: string; source: string; status: string; startsAt: string; endsAt: string; date: string; time: string;
  doctor: DoctorOpt; patientLabel: string; patientCode: string | null; hasPatient: boolean; patientId?: string | null; serviceTitle: string | null; tokenLabel: string | null; queueStatus: string | null;
  reason?: string | null; notes?: string | null; contactPhone?: string | null; contactEmail?: string | null; cancellationReason?: string | null; checkedInAt?: string | null;
}

export interface Perms { canCreate: boolean; canEdit: boolean; canCheckIn: boolean; canPriority: boolean; canViewPatients?: boolean }

const pickerToPayload = (p: PickerValue) => (!p ? {} : p.kind === "ref" ? { patient: p.ref } : { contactName: p.name, contactPhone: p.phone });

export function NewAppointmentModal({ open, onClose, doctors, services, defaultDoctor, today, onDone, presetPatient }: { presetPatient?: { ref: import("./patient-picker").PatientRefValue; label: string }; open: boolean; onClose: () => void; doctors: DoctorOpt[]; services: ServiceOpt[]; defaultDoctor?: string; today: string; onDone: () => void }) {
  const toast = useToast();
  const [doctor, setDoctor] = useState(defaultDoctor ?? doctors[0]?.id ?? "");
  const [date, setDate] = useState(today);
  const [startsAt, setStartsAt] = useState("");
  const [type, setType] = useState("OPD");
  const [serviceId, setServiceId] = useState("");
  const [reason, setReason] = useState("");
  const preset: PickerValue = presetPatient ? { kind: "ref", ref: presetPatient.ref, label: presetPatient.label } : null;
  const [patient, setPatient] = useState<PickerValue>(preset);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string>();

  useEffect(() => { if (open) { setStartsAt(""); setErrors({}); setMsg(undefined); setPatient(presetPatient ? { kind: "ref", ref: presetPatient.ref, label: presetPatient.label } : null); setReason(""); setDate(today); setDoctor(defaultDoctor ?? doctors[0]?.id ?? ""); }   // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultDoctor, doctors, today, presetPatient?.label]);

  async function save() {
    setBusy(true); setErrors({}); setMsg(undefined);
    const r = await apiFetch("/api/appointments", { method: "POST", body: JSON.stringify({ doctorUserId: doctor, startsAt: startsAt || undefined, type, serviceId: serviceId || undefined, reason: reason || undefined, ...pickerToPayload(patient) }) });
    setBusy(false);
    if (!r.ok) { setErrors(r.error.fieldErrors ?? {}); setMsg(r.error.message); if (r.error.code === "CONFLICT") setStartsAt(""); return; }
    toast({ tone: "success", title: "Appointment booked" }); onDone(); onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title="New appointment" description="Slots shown are the doctor's free times."
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy} disabled={!startsAt || !patient}>Book appointment</Button></>}>
      <div className="space-y-4">
        {msg && <Alert tone="danger">{msg}</Alert>}
        <Field label="Doctor" required error={errors.doctorUserId}><Select value={doctor} onChange={(e) => { setDoctor(e.target.value); setStartsAt(""); }} options={doctors.map((d) => ({ value: d.id, label: d.name }))} /></Field>
        <SlotPicker doctorUserId={doctor} date={date} onDate={setDate} value={startsAt} onChange={setStartsAt} error={errors.startsAt} minDate={today} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Visit type"><Select value={type} onChange={(e) => setType(e.target.value)} options={["OPD", "FOLLOW_UP", "PROCEDURE", "OTHER"].map((v) => ({ value: v, label: TYPE_LABEL[v] }))} /></Field>
          {services.length > 0 && <Field label="Service" error={errors.serviceId}><Select value={serviceId} onChange={(e) => setServiceId(e.target.value)} placeholder="Not specified" options={services.map((s) => ({ value: s.id, label: s.title }))} /></Field>}
        </div>
        <Field label="Reason (optional)" error={errors.reason} hint="Keep this brief. No detailed medical notes."><TextInput value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} /></Field>
        {presetPatient ? <p className="type-secondary">Patient: <strong>{presetPatient.label}</strong></p> : <PatientPicker value={patient} onChange={setPatient} errors={errors} allowContactOnly />}
      </div>
    </Modal>
  );
}

export function AppointmentDetailModal({ id, onClose, perms, today, doctors, onChanged }: { id: string | null; onClose: () => void; perms: Perms; today: string; doctors: DoctorOpt[]; onChanged: () => void }) {
  const toast = useToast();
  const [a, setA] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string>();
  const [panel, setPanel] = useState<null | "cancel" | "reschedule" | "checkin" | "noshow">(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string>();
  const [cancelKind, setCancelKind] = useState("PATIENT_REQUEST");
  const [cancelText, setCancelText] = useState("");
  const [noshowText, setNoshowText] = useState("");
  const [rDoctor, setRDoctor] = useState("");
  const [rDate, setRDate] = useState("");
  const [rSlot, setRSlot] = useState("");
  const [patient, setPatient] = useState<PickerValue>(null);
  const [priority, setPriority] = useState("NORMAL");

  async function load() {
    if (!id) return;
    setLoading(true); setErr(undefined);
    const r = await apiFetch<Detail>(`/api/appointments/${id}`);
    setLoading(false);
    if (r.ok) { setA(r.data); setRDoctor(r.data.doctor.id); setRDate(r.data.date); } else setErr(r.error.message);
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setA(null); setPanel(null); setMsg(undefined); setPatient(null); setRSlot(""); setPriority("NORMAL"); void load(); }, [id]);

  async function act(body: Record<string, unknown>, ok: string) {
    if (!id) return;
    setBusy(true); setMsg(undefined);
    const r = await apiFetch(`/api/appointments/${id}`, { method: "POST", body: JSON.stringify(body) });
    setBusy(false);
    if (!r.ok) { setMsg(r.error.fieldErrors ? Object.values(r.error.fieldErrors).join(" ") : r.error.message); return; }
    toast({ tone: "success", title: ok }); setPanel(null); onChanged(); await load();
  }

  const st = a?.status ?? "";
  const pre = st === "REQUESTED" || st === "CONFIRMED";
  const canCheckIn = perms.canCheckIn && st === "CONFIRMED" && a?.date === today;

  return (
    <Modal open={!!id} onClose={onClose} title="Appointment" description={a ? `${a.publicId}` : undefined}>
      {loading && !a && <LoadingState />}
      {err && <Alert tone="danger">{err}</Alert>}
      {a && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2"><AppointmentStatusBadge status={a.status} />{a.tokenLabel && <span className="type-label rounded-pill bg-primary-soft px-2.5 py-0.5 text-primary">Token {a.tokenLabel}</span>}</div>
          <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-2 text-sm">
            <dt className="text-muted">Patient</dt><dd className="font-semibold">{a.patientLabel}{a.patientCode ? <span className="font-normal text-muted"> · {a.patientCode}</span> : null}{perms.canViewPatients && a.patientId ? <> · <Link href={`/patients/${a.patientId}`} className="font-normal">Open patient file</Link></> : null}</dd>
            {a.contactPhone && <><dt className="text-muted">Phone</dt><dd>{a.contactPhone}</dd></>}
            <dt className="text-muted">Doctor</dt><dd>{a.doctor.name}</dd>
            <dt className="text-muted">When</dt><dd>{a.date} · {a.time}</dd>
            <dt className="text-muted">Type</dt><dd>{TYPE_LABEL[a.type] ?? a.type}{a.serviceTitle ? ` · ${a.serviceTitle}` : ""}</dd>
            {a.reason && <><dt className="text-muted">Reason</dt><dd>{a.reason}</dd></>}
            {a.cancellationReason && <><dt className="text-muted">Cancelled</dt><dd>{a.cancellationReason}</dd></>}
          </dl>
          {msg && <Alert tone="danger">{msg}</Alert>}

          {!panel && (
            <div className="flex flex-wrap gap-2">
              {perms.canEdit && st === "REQUESTED" && <Button onClick={() => act({ action: "confirm" }, "Appointment confirmed")} loading={busy}>Confirm</Button>}
              {canCheckIn && <Button onClick={() => (a.hasPatient ? act({ action: "check-in", priority: priority === "NORMAL" ? undefined : priority }, "Patient checked in") : setPanel("checkin"))} loading={busy}>Check in</Button>}
              {perms.canEdit && pre && <Button variant="outline" onClick={() => setPanel("reschedule")}>Reschedule</Button>}
              {perms.canEdit && st === "CONFIRMED" && <Button variant="outline" onClick={() => setPanel("noshow")}>Mark no-show</Button>}
              {perms.canEdit && ["REQUESTED", "CONFIRMED", "CHECKED_IN", "WAITING", "ON_HOLD", "SKIPPED"].includes(st) && <Button variant="danger" onClick={() => setPanel("cancel")}>Cancel</Button>}
            </div>
          )}
          {!panel && canCheckIn && a.hasPatient && perms.canPriority && (
            <Field label="Queue priority at check-in"><Select value={priority} onChange={(e) => setPriority(e.target.value)} options={[{ value: "NORMAL", label: "Normal" }, { value: "HIGH", label: "High priority" }, { value: "EMERGENCY", label: "Emergency" }]} /></Field>
          )}
          {!canCheckIn && perms.canCheckIn && st === "CONFIRMED" && <p className="type-caption">Check-in opens on the day of the appointment.</p>}

          {panel === "cancel" && (
            <div className="space-y-3 rounded-md border border-line p-3">
              <Field label="Reason" required><Select value={cancelKind} onChange={(e) => setCancelKind(e.target.value)} options={Object.entries(CANCEL_REASON_LABEL).map(([v, l]) => ({ value: v, label: l }))} /></Field>
              <Field label="Note (optional)"><TextInput value={cancelText} onChange={(e) => setCancelText(e.target.value)} maxLength={300} /></Field>
              <div className="flex gap-2"><Button variant="danger" loading={busy} onClick={() => act({ action: "cancel", reasonKind: cancelKind, reason: cancelText || undefined }, "Appointment cancelled")}>Cancel appointment</Button><Button variant="outline" onClick={() => setPanel(null)}>Keep it</Button></div>
            </div>
          )}
          {panel === "noshow" && (
            <div className="space-y-3 rounded-md border border-line p-3">
              <Field label="Note (optional)"><Textarea value={noshowText} onChange={(e) => setNoshowText(e.target.value)} rows={2} maxLength={300} /></Field>
              <div className="flex gap-2"><Button variant="danger" loading={busy} onClick={() => act({ action: "no-show", reason: noshowText || undefined }, "Marked as no-show")}>Mark no-show</Button><Button variant="outline" onClick={() => setPanel(null)}>Back</Button></div>
            </div>
          )}
          {panel === "reschedule" && (
            <div className="space-y-3 rounded-md border border-line p-3">
              <Field label="Doctor"><Select value={rDoctor} onChange={(e) => { setRDoctor(e.target.value); setRSlot(""); }} options={doctors.map((d) => ({ value: d.id, label: d.name }))} /></Field>
              <SlotPicker doctorUserId={rDoctor} date={rDate} onDate={setRDate} value={rSlot} onChange={setRSlot} exceptId={a.id} minDate={today} />
              <div className="flex gap-2"><Button loading={busy} disabled={!rSlot} onClick={() => act({ action: "reschedule", startsAt: rSlot, doctorUserId: rDoctor }, "Appointment rescheduled")}>Reschedule</Button><Button variant="outline" onClick={() => setPanel(null)}>Back</Button></div>
            </div>
          )}
          {panel === "checkin" && (
            <div className="space-y-3 rounded-md border border-line p-3">
              <p className="type-secondary">This booking has no patient record yet. Find or register the patient to check them in.</p>
              <PatientPicker value={patient} onChange={setPatient} />
              <div className="flex gap-2"><Button loading={busy} disabled={!patient || patient.kind !== "ref"} onClick={() => patient && patient.kind === "ref" && act({ action: "check-in", patient: patient.ref }, "Patient checked in")}>Check in</Button><Button variant="outline" onClick={() => setPanel(null)}>Back</Button></div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
