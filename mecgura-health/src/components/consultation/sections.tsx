"use client";
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Alert, Badge, Button, Card, CardBody, CardHeader, EmptyState, Field, Modal, NumberInput, Select, StatusBadge, TextInput, Textarea, useToast } from "@/components/ui";
import { apiFetch } from "@/lib/api/client";
import type { CView, Form, Staff } from "./types";

type Set = <K extends keyof Form>(k: K, v: Form[K]) => void;
const HIST: [string, string][] = [["hpi", "History of present illness"], ["pastMedical", "Past medical history"], ["surgical", "Surgical history"], ["family", "Family history"], ["medication", "Medication history"], ["allergy", "Allergy history"], ["social", "Social history"], ["other", "Other relevant history"]];
const EXAM: [string, string][] = [["general", "General"], ["respiratory", "Respiratory"], ["cardiovascular", "Cardiovascular"], ["abdomen", "Abdomen"], ["neurological", "Neurological"], ["other", "Other"]];

/* ----------------------------------------------- vitals ----------------------------------------------- */
const tile = (label: string, value: string | null) => <div key={label} className="rounded-md border border-line p-2"><p className="type-caption">{label}</p><p className="type-card-title tabular-nums">{value ?? "—"}</p></div>;
export function VitalsSection({ c, reload }: { c: CView; reload: () => Promise<void> }) {
  const toast = useToast();
  const v = c.vitals[0] as Record<string, number | string | null> | undefined;
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<Record<string, string>>({ tempUnit: "F" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string>();
  const [busy, setBusy] = useState(false);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const bmiPreview = f.weightKg && f.heightCm ? Math.round((Number(f.weightKg) / (Number(f.heightCm) / 100) ** 2) * 10) / 10 : null;
  async function save() {
    setBusy(true); setErrors({}); setMsg(undefined);
    const r = await apiFetch(`/api/consultations/${c.id}/vitals`, { method: "POST", body: JSON.stringify(f) });
    setBusy(false);
    if (!r.ok) { setErrors(r.error.fieldErrors ?? {}); setMsg(r.error.fieldErrors?._form ?? (r.error.fieldErrors ? "Please check the highlighted values." : r.error.message)); return; }
    toast({ tone: "success", title: "Vitals recorded" }); setOpen(false); setF({ tempUnit: "F" }); await reload();
  }
  return (
    <Card>
      <CardHeader title="Vitals" description="As measured. Values are recorded, never interpreted." action={c.can.vitals ? <Button size="sm" onClick={() => setOpen(true)}><Plus aria-hidden className="size-4" />Record vitals</Button> : undefined} />
      <CardBody className="space-y-3">
        {!v ? <EmptyState title="No vitals recorded yet" description={c.can.vitals ? "Record the first set of vitals." : undefined} /> : (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {tile("Blood pressure", v.systolic ? `${v.systolic} / ${v.diastolic} mmHg` : null)}{tile("Pulse", v.pulse ? `${v.pulse} bpm` : null)}{tile("Temperature", v.temperature != null ? `${v.temperature} °${v.tempUnit}` : null)}{tile("SpO₂", v.spo2 ? `${v.spo2} %` : null)}
              {tile("Resp. rate", v.respRate ? `${v.respRate} /min` : null)}{tile("Weight", v.weightKg ? `${v.weightKg} kg` : null)}{tile("Height", v.heightCm ? `${v.heightCm} cm` : null)}{tile("BMI", v.bmi ? String(v.bmi) : null)}
              {v.bloodSugar != null && tile(`Blood sugar${v.sugarType ? ` (${String(v.sugarType).toLowerCase().replace("_", "-")})` : ""}`, `${v.bloodSugar} mg/dL`)}{v.painScore != null && tile("Pain score", `${v.painScore} / 10`)}
            </div>
            <p className="type-caption">Latest entry · {String(v.recordedAt).slice(0, 16).replace("T", " ")} UTC · by {String(v.recordedBy)}{c.vitals.length > 1 ? ` · ${c.vitals.length} entries in this consultation` : ""}</p>
          </>
        )}
      </CardBody>
      <Modal open={open} onClose={() => setOpen(false)} title="Record vitals" description="Enter what you measured. Leave the rest empty."
        footer={<><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={save} loading={busy}>Save vitals</Button></>}>
        <div className="space-y-3">
          {msg && <Alert tone="danger">{msg}</Alert>}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Systolic (mmHg)" error={errors.systolic}><NumberInput value={f.systolic ?? ""} onChange={set("systolic")} inputMode="numeric" /></Field>
            <Field label="Diastolic (mmHg)" error={errors.diastolic}><NumberInput value={f.diastolic ?? ""} onChange={set("diastolic")} inputMode="numeric" /></Field>
            <Field label="Pulse (bpm)" error={errors.pulse}><NumberInput value={f.pulse ?? ""} onChange={set("pulse")} inputMode="numeric" /></Field>
            <Field label="SpO₂ (%)" error={errors.spo2}><NumberInput value={f.spo2 ?? ""} onChange={set("spo2")} inputMode="numeric" /></Field>
            <Field label="Temperature" error={errors.temperature}><NumberInput value={f.temperature ?? ""} onChange={set("temperature")} step="0.1" /></Field>
            <Field label="Unit"><Select value={f.tempUnit} onChange={set("tempUnit")} options={[{ value: "F", label: "°F" }, { value: "C", label: "°C" }]} /></Field>
            <Field label="Respiratory rate (/min)" error={errors.respRate}><NumberInput value={f.respRate ?? ""} onChange={set("respRate")} inputMode="numeric" /></Field>
            <Field label="Pain score (0–10)" error={errors.painScore}><NumberInput value={f.painScore ?? ""} onChange={set("painScore")} inputMode="numeric" /></Field>
            <Field label="Weight (kg)" error={errors.weightKg}><NumberInput value={f.weightKg ?? ""} onChange={set("weightKg")} step="0.1" /></Field>
            <Field label="Height (cm)" error={errors.heightCm}><NumberInput value={f.heightCm ?? ""} onChange={set("heightCm")} step="0.1" /></Field>
            <Field label="Blood sugar (mg/dL)" error={errors.bloodSugar}><NumberInput value={f.bloodSugar ?? ""} onChange={set("bloodSugar")} /></Field>
            <Field label="Sugar reading type"><Select value={f.sugarType ?? ""} onChange={set("sugarType")} placeholder="Not specified" options={[{ value: "FASTING", label: "Fasting" }, { value: "RANDOM", label: "Random" }, { value: "PRE_MEAL", label: "Pre-meal" }, { value: "POST_MEAL", label: "Post-meal" }]} /></Field>
          </div>
          {bmiPreview ? <p className="type-secondary">BMI (calculated): <strong>{bmiPreview}</strong></p> : null}
          <Field label="Notes" error={errors.notes}><TextInput value={f.notes ?? ""} onChange={set("notes")} maxLength={300} /></Field>
        </div>
      </Modal>
    </Card>
  );
}

/* ------------------------------------------------ notes ------------------------------------------------ */
export function NotesSection({ c, form, set, ro }: { c: CView; form: Form; set: Set; ro: boolean }) {
  const toast = useToast();
  const [tpl, setTpl] = useState<{ builtin: { key: string; name: string; content: Record<string, string> }[]; mine: { id: string; name: string; content: Record<string, string> }[] } | null>(null);
  const [saveName, setSaveName] = useState<string | null>(null);
  async function loadTpl() { if (tpl) return; const r = await apiFetch<NonNullable<typeof tpl>>("/api/consultation-templates"); if (r.ok) setTpl(r.data); }
  function apply(content: Record<string, string>) {
    const filled: string[] = [];
    if (content.chiefComplaint && !form.chiefComplaints.length) { set("chiefComplaints", [{ text: content.chiefComplaint }]); filled.push("complaint"); }
    if (content.history && !form.history.hpi) { set("history", { ...form.history, hpi: content.history }); filled.push("history"); }
    if (content.examination && !form.examination.general) { set("examination", { ...form.examination, general: content.examination }); filled.push("examination"); }
    if (content.assessment && !form.assessment) { set("assessment", content.assessment); filled.push("assessment"); }
    if (content.advice && !form.advice) { set("advice", content.advice); filled.push("advice"); }
    if (content.clinicalNotes && !form.clinicalNotes) { set("clinicalNotes", content.clinicalNotes); filled.push("notes"); }
    toast({ tone: "info", title: filled.length ? `Template added to: ${filled.join(", ")}` : "Nothing added — those fields already have text", description: "It's only a starting structure. Review and edit before finalizing." });
  }
  async function saveTemplate() {
    if (!saveName) return;
    const r = await apiFetch("/api/consultation-templates", { method: "POST", body: JSON.stringify({ name: saveName, content: { chiefComplaint: form.chiefComplaints[0]?.text, history: form.history.hpi, examination: form.examination.general, assessment: form.assessment, advice: form.advice, clinicalNotes: form.clinicalNotes } }) });
    if (r.ok) { toast({ tone: "success", title: "Template saved" }); setSaveName(null); setTpl(null); } else toast({ tone: "danger", title: r.error.message });
  }
  const upd = <T,>(arr: T[], i: number, patch: Partial<T>) => arr.map((x, k) => (k === i ? { ...x, ...patch } : x));
  return (
    <div className="space-y-section">
      {!ro && (
        <Card><CardBody className="flex flex-wrap items-end gap-3">
          <Field label="Start from a template (optional)" className="min-w-52 flex-1"><Select onFocus={loadTpl} onMouseDown={loadTpl} value="" onChange={(e) => { const [kind, key] = e.target.value.split(":"); const t = kind === "b" ? tpl?.builtin.find((x) => x.key === key) : tpl?.mine.find((x) => x.id === key); if (t) apply(t.content as Record<string, string>); }} placeholder="Choose a template…" options={[...(tpl?.builtin ?? []).map((t) => ({ value: `b:${t.key}`, label: t.name })), ...(tpl?.mine ?? []).map((t) => ({ value: `m:${t.id}`, label: `${t.name} (mine)` }))]} /></Field>
          {c.can.owner && <Button variant="outline" size="sm" onClick={() => setSaveName("")}>Save my notes as a template</Button>}
          <p className="type-caption basis-full">Templates only add empty headings or your own wording. They never fill in findings for this patient.</p>
        </CardBody></Card>
      )}
      <Card>
        <CardHeader title="Chief complaint" action={!ro ? <Button size="sm" variant="outline" onClick={() => set("chiefComplaints", [...form.chiefComplaints, { text: "" }])}><Plus aria-hidden className="size-4" />Add complaint</Button> : undefined} />
        <CardBody className="space-y-3">
          {!form.chiefComplaints.length && <p className="type-secondary">No complaint recorded.</p>}
          {form.chiefComplaints.map((x, i) => (
            <div key={i} className="grid gap-2 rounded-md border border-line p-3 sm:grid-cols-[2fr_1fr_1fr_auto]">
              <Field label="Complaint"><TextInput value={x.text} disabled={ro} onChange={(e) => set("chiefComplaints", upd(form.chiefComplaints, i, { text: e.target.value }))} maxLength={200} /></Field>
              <Field label="Duration"><TextInput value={x.duration ?? ""} disabled={ro} onChange={(e) => set("chiefComplaints", upd(form.chiefComplaints, i, { duration: e.target.value }))} maxLength={60} /></Field>
              <Field label="Severity"><TextInput value={x.severity ?? ""} disabled={ro} onChange={(e) => set("chiefComplaints", upd(form.chiefComplaints, i, { severity: e.target.value }))} maxLength={40} /></Field>
              {!ro && <Button variant="ghost" size="sm" className="self-end" onClick={() => set("chiefComplaints", form.chiefComplaints.filter((_, k) => k !== i))} aria-label={`Remove complaint ${i + 1}`}><Trash2 aria-hidden className="size-4" /></Button>}
              <div className="sm:col-span-4"><Field label="Notes"><TextInput value={x.notes ?? ""} disabled={ro} onChange={(e) => set("chiefComplaints", upd(form.chiefComplaints, i, { notes: e.target.value }))} maxLength={500} /></Field></div>
            </div>
          ))}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Symptoms" description="Free entries — you aren't limited to a list." action={!ro ? <Button size="sm" variant="outline" onClick={() => set("symptoms", [...form.symptoms, { name: "" }])}><Plus aria-hidden className="size-4" />Add symptom</Button> : undefined} />
        <CardBody className="space-y-3">
          {!form.symptoms.length && <p className="type-secondary">No symptoms recorded.</p>}
          {form.symptoms.map((x, i) => (
            <div key={i} className="grid gap-2 rounded-md border border-line p-3 sm:grid-cols-4">
              <Field label="Symptom"><TextInput value={x.name} disabled={ro} onChange={(e) => set("symptoms", upd(form.symptoms, i, { name: e.target.value }))} maxLength={120} /></Field>
              <Field label="Duration"><TextInput value={x.duration ?? ""} disabled={ro} onChange={(e) => set("symptoms", upd(form.symptoms, i, { duration: e.target.value }))} maxLength={60} /></Field>
              <Field label="Severity"><TextInput value={x.severity ?? ""} disabled={ro} onChange={(e) => set("symptoms", upd(form.symptoms, i, { severity: e.target.value }))} maxLength={40} /></Field>
              <Field label="Onset"><TextInput value={x.onset ?? ""} disabled={ro} onChange={(e) => set("symptoms", upd(form.symptoms, i, { onset: e.target.value }))} maxLength={60} /></Field>
              <div className="sm:col-span-3"><Field label="Notes"><TextInput value={x.notes ?? ""} disabled={ro} onChange={(e) => set("symptoms", upd(form.symptoms, i, { notes: e.target.value }))} maxLength={500} /></Field></div>
              {!ro && <Button variant="ghost" size="sm" className="self-end justify-self-start" onClick={() => set("symptoms", form.symptoms.filter((_, k) => k !== i))}><Trash2 aria-hidden className="size-4" />Remove</Button>}
            </div>
          ))}
        </CardBody>
      </Card>
      <Card><CardHeader title="History" description="Structured background from the patient file appears in the side panel — it isn't copied here." />
        <CardBody className="grid gap-3 lg:grid-cols-2">{HIST.map(([k, label]) => <Field key={k} label={label}><Textarea value={form.history[k] ?? ""} disabled={ro} onChange={(e) => set("history", { ...form.history, [k]: e.target.value })} rows={3} maxLength={4000} /></Field>)}</CardBody></Card>
      <Card><CardHeader title="Clinical examination" action={!ro ? <Button size="sm" variant="outline" onClick={() => set("examination", { ...form.examination, custom: [...(form.examination.custom ?? []), { title: "", text: "" }] })}><Plus aria-hidden className="size-4" />Add section</Button> : undefined} />
        <CardBody className="grid gap-3 lg:grid-cols-2">
          {EXAM.map(([k, label]) => <Field key={k} label={label}><Textarea value={(form.examination[k] as string) ?? ""} disabled={ro} onChange={(e) => set("examination", { ...form.examination, [k]: e.target.value })} rows={3} maxLength={4000} /></Field>)}
          {(form.examination.custom ?? []).map((x, i) => (
            <div key={i} className="space-y-2 rounded-md border border-line p-3">
              <Field label="Section title"><TextInput value={x.title} disabled={ro} onChange={(e) => set("examination", { ...form.examination, custom: upd(form.examination.custom ?? [], i, { title: e.target.value }) })} maxLength={60} /></Field>
              <Field label="Findings"><Textarea value={x.text} disabled={ro} onChange={(e) => set("examination", { ...form.examination, custom: upd(form.examination.custom ?? [], i, { text: e.target.value }) })} rows={2} maxLength={4000} /></Field>
              {!ro && <Button size="sm" variant="ghost" onClick={() => set("examination", { ...form.examination, custom: (form.examination.custom ?? []).filter((_, k) => k !== i) })}><Trash2 aria-hidden className="size-4" />Remove section</Button>}
            </div>
          ))}
        </CardBody></Card>
      <Card><CardHeader title="Clinical notes" /><CardBody><Field label="Notes" hint="Your own wording. Review before finalizing."><Textarea value={form.clinicalNotes} disabled={ro} onChange={(e) => set("clinicalNotes", e.target.value)} rows={5} maxLength={8000} /></Field></CardBody></Card>
      <Modal open={saveName !== null} onClose={() => setSaveName(null)} title="Save as template" description="Saves the headings/wording you've typed (not patient details) for your own reuse." footer={<><Button variant="outline" onClick={() => setSaveName(null)}>Cancel</Button><Button onClick={saveTemplate} disabled={(saveName ?? "").trim().length < 2}>Save template</Button></>}>
        <Field label="Template name" required><TextInput value={saveName ?? ""} onChange={(e) => setSaveName(e.target.value)} maxLength={60} /></Field>
        <Alert tone="warning" className="mt-3">Remove anything specific to this patient before saving — templates are reused for other patients.</Alert>
      </Modal>
    </div>
  );
}

/* ---------------------------------------------- assessment ---------------------------------------------- */
export function AssessmentSection({ c, form, set, ro, reload }: { c: CView; form: Form; set: Set; ro: boolean; reload: () => Promise<void> }) {
  const toast = useToast();
  const [dx, setDx] = useState<{ id?: string; name: string; code: string; type: string; notes: string } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  async function save() {
    if (!dx) return;
    setBusy(true); setErrors({});
    const body = { name: dx.name, code: dx.code || undefined, type: dx.type, notes: dx.notes || undefined };
    const r = await apiFetch(dx.id ? `/api/consultations/${c.id}/diagnoses/${dx.id}` : `/api/consultations/${c.id}/diagnoses`, { method: dx.id ? "PATCH" : "POST", body: JSON.stringify(body) });
    setBusy(false);
    if (!r.ok) { setErrors(r.error.fieldErrors ?? { name: r.error.message }); return; }
    toast({ tone: "success", title: "Diagnosis saved" }); setDx(null); await reload();
  }
  async function remove(id: string) { const r = await apiFetch(`/api/consultations/${c.id}/diagnoses/${id}`, { method: "DELETE" }); if (r.ok) await reload(); else toast({ tone: "danger", title: r.error.message }); }
  return (
    <div className="space-y-section">
      <Card><CardHeader title="Clinical assessment" description="Your own assessment. The system never diagnoses or suggests treatment." />
        <CardBody className="grid gap-3 lg:grid-cols-2">
          <Field label="Assessment"><Textarea value={form.assessment} disabled={ro} onChange={(e) => set("assessment", e.target.value)} rows={4} maxLength={4000} /></Field>
          <Field label="Clinical impression"><Textarea value={form.impression} disabled={ro} onChange={(e) => set("impression", e.target.value)} rows={4} maxLength={2000} /></Field>
          <Field label="Differential diagnosis"><Textarea value={form.differential} disabled={ro} onChange={(e) => set("differential", e.target.value)} rows={3} maxLength={2000} /></Field>
          <Field label="Notes"><Textarea value={form.assessmentNotes} disabled={ro} onChange={(e) => set("assessmentNotes", e.target.value)} rows={3} maxLength={2000} /></Field>
        </CardBody></Card>
      <Card><CardHeader title="Diagnosis" description="Enter diagnoses yourself. No diagnosis database is configured, so there's no automatic search or coding." action={!ro ? <Button size="sm" onClick={() => setDx({ name: "", code: "", type: c.diagnoses.length ? "SECONDARY" : "PRIMARY", notes: "" })}><Plus aria-hidden className="size-4" />Add diagnosis</Button> : undefined} />
        {!c.diagnoses.length ? <EmptyState title="No diagnosis added" /> : (
          <ul className="divide-y divide-line">{(c.diagnoses as { id: string; name: string; code: string | null; type: string; notes: string | null }[]).map((d) => (
            <li key={d.id} className="flex flex-wrap items-start justify-between gap-2 p-card"><div className="min-w-0"><p className="type-label">{d.name}{d.code ? <span className="type-caption"> · {d.code}</span> : null}</p>{d.notes && <p className="type-secondary">{d.notes}</p>}</div>
              <div className="flex items-center gap-2"><StatusBadge tone={d.type === "PRIMARY" ? "primary" : "neutral"}>{d.type === "PRIMARY" ? "Primary" : "Secondary"}</StatusBadge>{!ro && <><Button size="sm" variant="ghost" onClick={() => setDx({ id: d.id, name: d.name, code: d.code ?? "", type: d.type, notes: d.notes ?? "" })}>Edit</Button><Button size="sm" variant="ghost" onClick={() => remove(d.id)} aria-label={`Remove ${d.name}`}><Trash2 aria-hidden className="size-4" /></Button></>}</div></li>
          ))}</ul>
        )}
      </Card>
      <Modal open={!!dx} onClose={() => setDx(null)} title={dx?.id ? "Edit diagnosis" : "Add diagnosis"} footer={<><Button variant="outline" onClick={() => setDx(null)}>Cancel</Button><Button onClick={save} loading={busy}>Save</Button></>}>
        {dx && <div className="space-y-3">
          <Field label="Diagnosis" required error={errors.name}><TextInput value={dx.name} onChange={(e) => setDx({ ...dx, name: e.target.value })} maxLength={200} autoComplete="off" /></Field>
          <div className="grid gap-3 sm:grid-cols-2"><Field label="Type"><Select value={dx.type} onChange={(e) => setDx({ ...dx, type: e.target.value })} options={[{ value: "PRIMARY", label: "Primary" }, { value: "SECONDARY", label: "Secondary" }]} /></Field>
            <Field label="Code (optional)" hint="Only if you use one" error={errors.code}><TextInput value={dx.code} onChange={(e) => setDx({ ...dx, code: e.target.value })} maxLength={20} /></Field></div>
          <Field label="Notes"><Textarea value={dx.notes} onChange={(e) => setDx({ ...dx, notes: e.target.value })} rows={2} maxLength={1000} /></Field>
        </div>}
      </Modal>
    </div>
  );
}

/* --------------------------------------------- advice & follow-up --------------------------------------------- */
export function AdviceSection({ form, set, ro }: { form: Form; set: Set; ro: boolean }) {
  return (
    <div className="space-y-section">
      <Card><CardHeader title="Advice" description="Instructions for the patient, in your own words." /><CardBody><Field label="Doctor's advice"><Textarea value={form.advice} disabled={ro} onChange={(e) => set("advice", e.target.value)} rows={5} maxLength={4000} /></Field></CardBody></Card>
      <Card><CardHeader title="Follow-up plan" description="Records your instruction only. Reminders and follow-up management arrive in a later phase." />
        <CardBody className="space-y-3">
          <label className="flex items-start gap-3"><input type="checkbox" disabled={ro} checked={form.followUpRequired} onChange={(e) => set("followUpRequired", e.target.checked)} className="mt-0.5 size-5 accent-[var(--brand-primary)]" /><span className="type-body">Follow-up required</span></label>
          {form.followUpRequired && <div className="grid gap-3 sm:grid-cols-2"><Field label="After (days)"><NumberInput value={form.followUpAfterDays} disabled={ro} onChange={(e) => set("followUpAfterDays", e.target.value)} min={1} max={730} /></Field><Field label="Or recommended date"><TextInput type="date" value={form.followUpDate} disabled={ro} onChange={(e) => set("followUpDate", e.target.value)} /></Field></div>}
          {form.followUpRequired && <Field label="Notes"><Textarea value={form.followUpNotes} disabled={ro} onChange={(e) => set("followUpNotes", e.target.value)} rows={2} maxLength={1000} /></Field>}
        </CardBody></Card>
    </div>
  );
}

/* ------------------------------------------------- orders ------------------------------------------------- */
const OT = [["MEDICATION", "Medication"], ["INVESTIGATION", "Investigation"], ["DOCUMENT", "Document"], ["FOLLOW_UP", "Follow-up"], ["OTHER", "Other"]].map(([value, label]) => ({ value, label }));
const OS: Record<string, "warning" | "info" | "success" | "neutral"> = { PENDING: "warning", IN_PROGRESS: "info", COMPLETED: "success", CANCELLED: "neutral" };
type Order = { id: string; type: string; title: string; description: string | null; priority: string; status: string; assignedTo: string | null };
export function OrdersSection({ c, staff, reload }: { c: CView; staff: Staff[]; reload: () => Promise<void> }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ type: "MEDICATION", title: "", description: "", priority: "NORMAL", assignedToId: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  async function create() {
    setBusy(true); setErrors({});
    const r = await apiFetch(`/api/consultations/${c.id}/orders`, { method: "POST", body: JSON.stringify({ ...f, assignedToId: f.assignedToId || undefined, description: f.description || undefined }) });
    setBusy(false);
    if (!r.ok) { setErrors(r.error.fieldErrors ?? { title: r.error.message }); return; }
    toast({ tone: "success", title: "Order created" }); setOpen(false); setF({ ...f, title: "", description: "" }); await reload();
  }
  async function setStatus(id: string, status: string) { const r = await apiFetch(`/api/orders/${id}`, { method: "PATCH", body: JSON.stringify({ status }) }); if (r.ok) await reload(); else toast({ tone: "danger", title: r.error.message }); }
  return (
    <Card><CardHeader title="Doctor orders" description="Tasks for the team (dispense, test, dressing…). They don't change the prescription." action={c.can.orders ? <Button size="sm" onClick={() => setOpen(true)}><Plus aria-hidden className="size-4" />New order</Button> : undefined} />
      {!c.orders.length ? <EmptyState title="No doctor orders" /> : (
        <ul className="divide-y divide-line">{(c.orders as Order[]).map((o) => (
          <li key={o.id} className="flex flex-wrap items-start justify-between gap-2 p-card"><div className="min-w-0"><p className="type-label">{o.title}</p><p className="type-caption">{OT.find((t) => t.value === o.type)?.label}{o.assignedTo ? ` · for ${o.assignedTo}` : ""}</p>{o.description && <p className="type-secondary">{o.description}</p>}</div>
            <div className="flex flex-wrap items-center gap-2">{o.priority !== "NORMAL" && <Badge tone={o.priority === "URGENT" ? "danger" : "warning"}>{o.priority === "URGENT" ? "Urgent" : "High"}</Badge>}<StatusBadge tone={OS[o.status]}>{o.status.replace("_", " ").toLowerCase()}</StatusBadge>
              {c.can.orders && (o.status === "PENDING" || o.status === "IN_PROGRESS") && <><Button size="sm" variant="outline" onClick={() => setStatus(o.id, "COMPLETED")}>Complete</Button><Button size="sm" variant="ghost" onClick={() => setStatus(o.id, "CANCELLED")}>Cancel</Button></>}</div></li>
        ))}</ul>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="New doctor order" footer={<><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={create} loading={busy}>Create order</Button></>}>
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2"><Field label="Type"><Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} options={OT} /></Field><Field label="Priority"><Select value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })} options={[{ value: "NORMAL", label: "Normal" }, { value: "HIGH", label: "High" }, { value: "URGENT", label: "Urgent" }]} /></Field></div>
          <Field label="Title" required error={errors.title}><TextInput value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} maxLength={150} /></Field>
          <Field label="Description"><Textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} rows={2} maxLength={1000} /></Field>
          <Field label="Assign to (optional)" error={errors.assignedToId}><Select value={f.assignedToId} onChange={(e) => setF({ ...f, assignedToId: e.target.value })} placeholder="Anyone on the team" options={staff.map((s) => ({ value: s.id, label: `${s.name} (${s.role.toLowerCase()})` }))} /></Field>
        </div>
      </Modal>
    </Card>
  );
}
