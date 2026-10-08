"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, Button, Checkbox, DatePicker, EmailInput, Field, NumberInput, PhoneInput, Select, TextInput, useToast } from "@/components/ui";
import { apiFetch } from "@/lib/api/client";

export interface PatientFormValues {
  name: string; preferredName: string; gender: string; dateOfBirth: string; ageYears: string; phone: string; alternatePhone: string; email: string;
  addressLine: string; city: string; state: string; country: string; pincode: string; bloodGroup: string; maritalStatus: string; occupation: string;
  emergencyContactName: string; emergencyContactRelation: string; emergencyContactPhone: string;
  prefPhone: string; prefWhatsapp: string; prefSms: string; prefEmail: string;
}
export const EMPTY_PATIENT: PatientFormValues = { name: "", preferredName: "", gender: "", dateOfBirth: "", ageYears: "", phone: "", alternatePhone: "", email: "", addressLine: "", city: "", state: "", country: "", pincode: "", bloodGroup: "", maritalStatus: "", occupation: "", emergencyContactName: "", emergencyContactRelation: "", emergencyContactPhone: "", prefPhone: "UNKNOWN", prefWhatsapp: "UNKNOWN", prefSms: "UNKNOWN", prefEmail: "UNKNOWN" };

interface Card { id: string; code: string; name: string; gender: string | null; age: string | null; phoneMasked: string }
const PREF = [{ value: "UNKNOWN", label: "Not asked" }, { value: "ALLOWED", label: "Allowed" }, { value: "NOT_ALLOWED", label: "Not allowed" }];
const GENDER = [{ value: "FEMALE", label: "Female" }, { value: "MALE", label: "Male" }, { value: "OTHER", label: "Other" }, { value: "UNDISCLOSED", label: "Prefer not to say" }];
const BLOOD = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"].map((v) => ({ value: v, label: v }));
const MARITAL = ["SINGLE", "MARRIED", "DIVORCED", "WIDOWED", "OTHER"].map((v) => ({ value: v, label: v[0] + v.slice(1).toLowerCase() }));

/** Registration (mode "new") and editing (mode "edit"). Only essentials are required: name and mobile number. */
export function PatientForm({ mode, patientId, initial }: { mode: "new" | "edit"; patientId?: string; initial?: PatientFormValues }) {
  const router = useRouter();
  const toast = useToast();
  const [v, setV] = useState<PatientFormValues>(initial ?? EMPTY_PATIENT);
  const [privacy, setPrivacy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [dupes, setDupes] = useState<Card[] | null>(null);
  const set = (k: keyof PatientFormValues) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setV({ ...v, [k]: e.target.value });

  async function save(allowDuplicate = false) {
    setBusy(true); setErrors({}); setMsg(undefined);
    if (mode === "new" && !allowDuplicate) {
      const d = await apiFetch<Card[]>("/api/patients/check-duplicates", { method: "POST", body: JSON.stringify({ phone: v.phone, email: v.email, name: v.name, dateOfBirth: v.dateOfBirth }) });
      if (d.ok && d.data.length) { setDupes(d.data); setBusy(false); return; }
    }
    const body = { ...v, ...(mode === "new" ? { privacyAcknowledged: privacy, allowDuplicate } : {}) };
    const r = await apiFetch<{ id: string }>(mode === "new" ? "/api/patients" : `/api/patients/${patientId}`, { method: mode === "new" ? "POST" : "PATCH", body: JSON.stringify(body) });
    setBusy(false);
    if (!r.ok) { setErrors(r.error.fieldErrors ?? {}); setMsg(r.error.fieldErrors ? "Please check the highlighted fields." : r.error.message); setDupes(null); return; }
    toast({ tone: "success", title: mode === "new" ? "Patient registered" : "Patient updated" });
    router.push(`/patients/${mode === "new" ? r.data.id : patientId}`); router.refresh();
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); void save(); }} noValidate className="space-y-section">
      {msg && <Alert tone="danger">{msg}</Alert>}
      {dupes && (
        <div role="alert" className="space-y-3 rounded-card border border-warning/40 bg-warning-soft p-card">
          <h2 className="type-card-title">Possible existing patient found</h2>
          <p className="type-secondary">Check whether this is the same person before creating a new record. Nothing is merged automatically.</p>
          <ul className="divide-y divide-line rounded-md border border-line bg-surface">
            {dupes.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                <span className="min-w-0"><span className="type-label block">{p.name} <span className="type-caption">· {p.code}</span></span><span className="type-caption">{p.phoneMasked}{p.age ? ` · ${p.age}` : ""}{p.gender ? ` · ${p.gender.toLowerCase()}` : ""}</span></span>
                <Button variant="outline" size="sm" onClick={() => router.push(`/patients/${p.id}`)}>Use existing patient</Button>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2"><Button type="button" onClick={() => save(true)} loading={busy}>Continue new registration</Button><Button type="button" variant="outline" onClick={() => setDupes(null)}>Cancel</Button></div>
        </div>
      )}

      <Section title="Basic details">
        <Field label="Full name" required error={errors.name}><TextInput value={v.name} onChange={set("name")} autoComplete="off" maxLength={120} /></Field>
        <div className="grid gap-form sm:grid-cols-2">
          <Field label="Preferred name" error={errors.preferredName}><TextInput value={v.preferredName} onChange={set("preferredName")} maxLength={60} /></Field>
          <Field label="Gender" error={errors.gender}><Select value={v.gender} onChange={set("gender")} placeholder="Not stated" options={GENDER} /></Field>
          <Field label="Date of birth" error={errors.dateOfBirth}><DatePicker value={v.dateOfBirth} onChange={set("dateOfBirth")} max={new Date().toISOString().slice(0, 10)} /></Field>
          <Field label="Or age (years)" hint="Only if the date of birth isn't known" error={errors.ageYears}><NumberInput value={v.ageYears} onChange={set("ageYears")} min={0} max={120} disabled={!!v.dateOfBirth} /></Field>
        </div>
      </Section>

      <Section title="Contact">
        <div className="grid gap-form sm:grid-cols-2">
          <Field label="Mobile number" required error={errors.phone}><PhoneInput value={v.phone} onChange={set("phone")} /></Field>
          <Field label="Alternate mobile" error={errors.alternatePhone}><PhoneInput value={v.alternatePhone} onChange={set("alternatePhone")} /></Field>
        </div>
        <Field label="Email" error={errors.email}><EmailInput value={v.email} onChange={set("email")} /></Field>
        <Field label="Address" error={errors.addressLine}><TextInput value={v.addressLine} onChange={set("addressLine")} maxLength={200} autoComplete="off" /></Field>
        <div className="grid gap-form sm:grid-cols-2 lg:grid-cols-4">
          <Field label="City" error={errors.city}><TextInput value={v.city} onChange={set("city")} maxLength={80} /></Field>
          <Field label="State" error={errors.state}><TextInput value={v.state} onChange={set("state")} maxLength={80} /></Field>
          <Field label="Country" error={errors.country}><TextInput value={v.country} onChange={set("country")} maxLength={80} /></Field>
          <Field label="Pincode" error={errors.pincode}><TextInput value={v.pincode} onChange={set("pincode")} maxLength={12} /></Field>
        </div>
      </Section>

      <Section title="Emergency contact" hint="Optional. Name and phone go together.">
        <div className="grid gap-form sm:grid-cols-3">
          <Field label="Name" error={errors.emergencyContactName}><TextInput value={v.emergencyContactName} onChange={set("emergencyContactName")} maxLength={100} /></Field>
          <Field label="Relation" error={errors.emergencyContactRelation}><TextInput value={v.emergencyContactRelation} onChange={set("emergencyContactRelation")} maxLength={40} /></Field>
          <Field label="Phone" error={errors.emergencyContactPhone}><PhoneInput value={v.emergencyContactPhone} onChange={set("emergencyContactPhone")} /></Field>
        </div>
      </Section>

      <Section title="Basic information" hint="Only what the patient tells you. Allergies and medical history are added on the patient file by authorised staff.">
        <div className="grid gap-form sm:grid-cols-3">
          <Field label="Blood group" error={errors.bloodGroup}><Select value={v.bloodGroup} onChange={set("bloodGroup")} placeholder="Not known" options={BLOOD} /></Field>
          <Field label="Marital status" error={errors.maritalStatus}><Select value={v.maritalStatus} onChange={set("maritalStatus")} placeholder="Not stated" options={MARITAL} /></Field>
          <Field label="Occupation" error={errors.occupation}><TextInput value={v.occupation} onChange={set("occupation")} maxLength={80} /></Field>
        </div>
      </Section>

      <Section title="How may we contact the patient?" hint="Records the patient's preference. No messages are sent from this system yet.">
        <div className="grid gap-form sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Phone call"><Select value={v.prefPhone} onChange={set("prefPhone")} options={PREF} /></Field>
          <Field label="WhatsApp"><Select value={v.prefWhatsapp} onChange={set("prefWhatsapp")} options={PREF} /></Field>
          <Field label="SMS"><Select value={v.prefSms} onChange={set("prefSms")} options={PREF} /></Field>
          <Field label="Email"><Select value={v.prefEmail} onChange={set("prefEmail")} options={PREF} /></Field>
        </div>
      </Section>

      {mode === "new" && (
        <Section title="Privacy">
          <Checkbox label="The patient has been shown the clinic's privacy notice and agrees that the clinic may keep their details." description="This records that your clinic informed the patient. Your clinic is responsible for the wording of its notice and for any further consent the law requires." checked={privacy} onChange={(e) => setPrivacy(e.target.checked)} />
        </Section>
      )}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="lg" loading={busy && !dupes}>{mode === "new" ? "Register patient" : "Save changes"}</Button>
        <Button type="button" size="lg" variant="outline" onClick={() => router.back()}>Cancel</Button>
      </div>
    </form>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-form rounded-card border border-line bg-surface p-card shadow-card">
      <legend className="type-card-title px-1">{title}</legend>
      {hint && <p className="type-caption -mt-2">{hint}</p>}
      {children}
    </fieldset>
  );
}
