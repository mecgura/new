"use client";
import { useEffect, useState } from "react";
import { Search, UserPlus, X } from "lucide-react";
import { Alert, Button, Checkbox, Field, PhoneInput, Select, TextInput, DatePicker, NumberInput } from "@/components/ui";
import { apiFetch } from "@/lib/api/client";

export interface PatientCard { id: string; code: string; name: string; gender: string | null; age: string | null; phoneMasked: string }
/** What the server receives: an EXISTING patient + proof of identity, or a NEW patient. Never just an id. */
export type PatientRefValue = { patientId: string; verification: { phoneLast4?: string; dateOfBirth?: string; code?: string } } | { newPatient: Record<string, unknown>; allowDuplicate: boolean };
export type PickerValue = { kind: "ref"; ref: PatientRefValue; label: string } | { kind: "contact"; name: string; phone: string } | null;

/**
 * Staff-side patient selection. Searching shows MASKED details only; linking an existing patient requires a
 * verification (last 4 digits / date of birth / patient ID) which the SERVER checks. New patients go through a
 * duplicate check first.
 */
export function PatientPicker({ value, onChange, errors, allowContactOnly, label = "Patient" }: { value: PickerValue; onChange: (v: PickerValue) => void; errors?: Record<string, string>; allowContactOnly?: boolean; label?: string }) {
  const [mode, setMode] = useState<"search" | "new" | "contact">("search");
  const [q, setQ] = useState("");
  const [results, setResults] = useState<PatientCard[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<PatientCard | null>(null);
  const [vKind, setVKind] = useState<"phoneLast4" | "dateOfBirth" | "code">("phoneLast4");
  const [vVal, setVVal] = useState("");
  const [np, setNp] = useState({ name: "", phone: "", gender: "", dateOfBirth: "", ageYears: "" });
  const [dupes, setDupes] = useState<PatientCard[]>([]);
  const [allowDup, setAllowDup] = useState(false);
  const [msg, setMsg] = useState<string>();

  useEffect(() => {
    if (mode !== "search" || q.trim().length < 3) { setResults(null); return; }
    const t = setTimeout(async () => {
      setSearching(true);
      const r = await apiFetch<PatientCard[]>(`/api/patients/search?q=${encodeURIComponent(q.trim())}`);
      setSearching(false);
      if (r.ok) { setResults(r.data); setMsg(undefined); } else setMsg(r.error.message);
    }, 300);
    return () => clearTimeout(t);
  }, [q, mode]);

  if (value) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-md border border-line bg-surface-muted p-3">
        <div className="min-w-0"><p className="type-caption">{label}</p><p className="type-label truncate">{value.kind === "contact" ? `${value.name} · ${value.phone}` : value.label}</p>
          {value.kind === "contact" && <p className="type-caption">Contact only — register the patient at check-in.</p>}</div>
        <Button variant="ghost" size="sm" onClick={() => { onChange(null); setPicked(null); setVVal(""); setDupes([]); setAllowDup(false); }} aria-label="Change patient"><X aria-hidden className="size-4" />Change</Button>
      </div>
    );
  }

  function confirmVerification() {
    if (!picked) return;
    const v = vVal.trim();
    if (!v) { setMsg("Enter the verification detail."); return; }
    if (vKind === "phoneLast4" && !/^\d{4}$/.test(v)) { setMsg("Enter exactly the last 4 digits of the mobile number."); return; }
    onChange({ kind: "ref", label: `${picked.name} · ${picked.code}`, ref: { patientId: picked.id, verification: { [vKind]: v } } });
  }

  async function continueNew() {
    setMsg(undefined);
    if (np.name.trim().length < 2) { setMsg("Enter the patient's name."); return; }
    if (!np.phone.trim()) { setMsg("Enter a mobile number."); return; }
    const r = await apiFetch<PatientCard[]>("/api/patients/check-duplicates", { method: "POST", body: JSON.stringify({ phone: np.phone, name: np.name, dateOfBirth: np.dateOfBirth }) });
    if (r.ok && r.data.length && !allowDup) { setDupes(r.data); setMsg("A patient with these details may already exist. Pick them below, or confirm this is a new patient."); return; }
    const newPatient = { name: np.name, phone: np.phone, gender: np.gender || undefined, dateOfBirth: np.dateOfBirth || undefined, ageYears: np.dateOfBirth ? undefined : np.ageYears || undefined };
    onChange({ kind: "ref", label: `${np.name} (new patient)`, ref: { newPatient, allowDuplicate: allowDup } });
  }

  return (
    <fieldset className="space-y-3">
      <legend className="type-label">{label}</legend>
      <div className="flex flex-wrap gap-2" role="group" aria-label="How to choose the patient">
        <Button size="sm" variant={mode === "search" ? "primary" : "outline"} onClick={() => { setMode("search"); setMsg(undefined); }}><Search aria-hidden className="size-4" />Find existing</Button>
        <Button size="sm" variant={mode === "new" ? "primary" : "outline"} onClick={() => { setMode("new"); setMsg(undefined); }}><UserPlus aria-hidden className="size-4" />New patient</Button>
        {allowContactOnly && <Button size="sm" variant={mode === "contact" ? "primary" : "outline"} onClick={() => { setMode("contact"); setMsg(undefined); }}>Name &amp; phone only</Button>}
      </div>
      {msg && <Alert tone="warning">{msg}</Alert>}
      {errors?.patient && <p role="alert" className="type-caption !text-danger">{errors.patient}</p>}

      {mode === "search" && !picked && (
        <div className="space-y-2">
          <Field label="Search by name, mobile number or patient ID" hint="Type at least 3 characters"><TextInput value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" /></Field>
          {searching && <p role="status" className="type-caption">Searching…</p>}
          {results && !results.length && <p className="type-secondary">No matching patient. Try “New patient”.</p>}
          {results && results.length > 0 && (
            <ul className="divide-y divide-line rounded-md border border-line">
              {results.map((p) => (
                <li key={p.id}><button type="button" onClick={() => { setPicked(p); setMsg(undefined); }} className="flex min-h-control w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-surface-muted">
                  <span className="min-w-0"><span className="type-label block truncate">{p.name}</span><span className="type-caption">{p.code} · {p.phoneMasked}{p.age ? ` · ${p.age}` : ""}{p.gender ? ` · ${p.gender.toLowerCase()}` : ""}</span></span>
                  <span className="type-caption text-primary">Select</span></button></li>
              ))}
            </ul>
          )}
        </div>
      )}

      {mode === "search" && picked && (
        <div className="space-y-3 rounded-md border border-line p-3">
          <p className="type-label">{picked.name} <span className="type-caption">· {picked.code}</span></p>
          <p className="type-secondary">Confirm you are speaking to the right person before linking this record.</p>
          <Field label="Verify with">
            <Select value={vKind} onChange={(e) => { setVKind(e.target.value as typeof vKind); setVVal(""); }} options={[{ value: "phoneLast4", label: "Last 4 digits of mobile" }, { value: "dateOfBirth", label: "Date of birth" }, { value: "code", label: "Patient ID" }]} />
          </Field>
          <Field label={vKind === "phoneLast4" ? "Last 4 digits" : vKind === "dateOfBirth" ? "Date of birth" : "Patient ID"}>
            {vKind === "dateOfBirth" ? <DatePicker value={vVal} onChange={(e) => setVVal(e.target.value)} /> : <TextInput value={vVal} onChange={(e) => setVVal(e.target.value)} inputMode={vKind === "phoneLast4" ? "numeric" : "text"} maxLength={vKind === "phoneLast4" ? 4 : 20} autoComplete="off" />}
          </Field>
          <div className="flex gap-2"><Button onClick={confirmVerification}>Use this patient</Button><Button variant="outline" onClick={() => { setPicked(null); setVVal(""); }}>Back</Button></div>
        </div>
      )}

      {mode === "new" && (
        <div className="space-y-3">
          <Field label="Full name" required><TextInput value={np.name} onChange={(e) => setNp({ ...np, name: e.target.value })} autoComplete="off" maxLength={120} /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Mobile number" required><PhoneInput value={np.phone} onChange={(e) => setNp({ ...np, phone: e.target.value })} /></Field>
            <Field label="Gender"><Select value={np.gender} onChange={(e) => setNp({ ...np, gender: e.target.value })} placeholder="Not stated" options={[{ value: "FEMALE", label: "Female" }, { value: "MALE", label: "Male" }, { value: "OTHER", label: "Other" }]} /></Field>
            <Field label="Date of birth"><DatePicker value={np.dateOfBirth} onChange={(e) => setNp({ ...np, dateOfBirth: e.target.value })} max={new Date().toISOString().slice(0, 10)} /></Field>
            <Field label="Or age (years)"><NumberInput value={np.ageYears} onChange={(e) => setNp({ ...np, ageYears: e.target.value })} min={0} max={120} disabled={!!np.dateOfBirth} /></Field>
          </div>
          {dupes.length > 0 && (
            <div className="space-y-2 rounded-md border border-warning/40 bg-warning-soft p-3">
              <p className="type-label">Possible existing patients</p>
              <ul className="space-y-1">{dupes.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2"><span className="type-secondary">{p.name} · {p.code} · {p.phoneMasked}</span>
                  <Button size="sm" variant="outline" onClick={() => { setMode("search"); setQ(p.code); setPicked(p); setDupes([]); }}>This is them</Button></li>))}</ul>
              <Checkbox label="This is a different, new patient" checked={allowDup} onChange={(e) => setAllowDup(e.target.checked)} />
            </div>
          )}
          <Button onClick={continueNew}>Continue</Button>
        </div>
      )}

      {mode === "contact" && <ContactOnly onDone={(name, phone) => onChange({ kind: "contact", name, phone })} />}
    </fieldset>
  );
}

function ContactOnly({ onDone }: { onDone: (n: string, p: string) => void }) {
  const [name, setName] = useState(""); const [phone, setPhone] = useState(""); const [err, setErr] = useState<string>();
  return (
    <div className="space-y-3">
      <Field label="Name" required><TextInput value={name} onChange={(e) => setName(e.target.value)} maxLength={100} /></Field>
      <Field label="Mobile number" required error={err}><PhoneInput value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
      <Button onClick={() => (name.trim().length < 2 || phone.replace(/\D/g, "").length < 10 ? setErr("Enter a name and a 10-digit mobile number.") : onDone(name.trim(), phone.trim()))}>Continue</Button>
    </div>
  );
}
