"use client";
import { useState } from "react";
import { Alert, Button, Card, CardBody, CardHeader, ErrorState, Field, LoadingState, NumberInput, Textarea, TextInput, Toggle, useToast } from "@/components/ui";
import { useApi } from "@/components/patients/use-api";
import { apiFetch } from "@/lib/api/client";

interface Policy { enabled: boolean; allowBooking: boolean; allowCancel: boolean; allowReschedule: boolean; changeCutoffHours: number; showDiagnoses: boolean; editableFields: string[]; supportNote: string | null; privacyNotice: string | null; consentVersion: string; canConfigure: boolean }
const FIELDS: [string, string][] = [["preferredName", "Preferred name"], ["email", "Email"], ["alternatePhone", "Alternate mobile"], ["addressLine", "Address"], ["city", "City"], ["state", "State"], ["country", "Country"], ["pincode", "Pincode"], ["emergencyContactName", "Emergency contact name"], ["emergencyContactRelation", "Emergency contact relation"], ["emergencyContactPhone", "Emergency contact mobile"]];
export function PortalPolicyForm() {
  const toast = useToast(); const { data, error, reload } = useApi<Policy>("/api/portal/staff/policy"); const [f, setF] = useState<Policy | null>(null); const [busy, setBusy] = useState(false); const [errors, setErrors] = useState<Record<string, string>>({}); const [msg, setMsg] = useState<string>();
  const cur = f ?? data;
  if (error) return <ErrorState code={error.code} description={error.message} />;
  if (!cur) return <LoadingState />;
  const ro = !cur.canConfigure;
  async function save() { setBusy(true); setErrors({}); setMsg(undefined); const { canConfigure, ...body } = cur!; void canConfigure; const r = await apiFetch("/api/portal/staff/policy", { method: "PUT", body: JSON.stringify(body) }); setBusy(false); if (!r.ok) { setErrors(r.error.fieldErrors ?? {}); setMsg(r.error.message); return; } toast({ tone: "success", title: "Patient portal settings saved" }); setF(null); await reload(); }
  const set = (patch: Partial<Policy>) => setF({ ...cur, ...patch });
  return (
    <div className="space-y-section">
      {ro && <Alert tone="info">Only a clinic admin can change these settings.</Alert>}{msg && <Alert tone="danger">{msg}</Alert>}
      <Card><CardHeader title="Patient portal" description="What your patients can do online. Changes are audited." />
        <CardBody className="space-y-4">
          <Toggle label="Patient portal is on" checked={cur.enabled} disabled={ro} onChange={(v) => set({ enabled: v })} />
          {!cur.enabled && <Alert tone="warning">Turning the portal off signs every patient out and stops new activations.</Alert>}
          <Toggle label="Patients can book appointments online" checked={cur.allowBooking} disabled={ro} onChange={(v) => set({ allowBooking: v })} />
          <Toggle label="Patients can cancel appointments" checked={cur.allowCancel} disabled={ro} onChange={(v) => set({ allowCancel: v })} />
          <Toggle label="Patients can reschedule appointments" checked={cur.allowReschedule} disabled={ro} onChange={(v) => set({ allowReschedule: v })} />
          <Field label="Cancel / reschedule cut-off (hours before the appointment)" error={errors.changeCutoffHours}><div className="max-w-40"><NumberInput value={String(cur.changeCutoffHours)} inputMode="numeric" disabled={ro} onChange={(e) => set({ changeCutoffHours: Number(e.target.value) })} /></div></Field>
          <Toggle label="Show diagnoses in the portal (consultation summary and prescription copy)" checked={cur.showDiagnoses} disabled={ro} onChange={(v) => set({ showDiagnoses: v })} />
          <p className="type-caption">Off by default. The doctor&apos;s private notes, history and examination findings are never shown in the portal.</p>
        </CardBody></Card>
      <Card><CardHeader title="Details patients can edit themselves" description="Everything else (name, date of birth, gender, mobile…) needs a correction request that your staff review." />
        <CardBody><ul className="grid gap-2 sm:grid-cols-2">{FIELDS.map(([k, l]) => <li key={k}><Toggle label={l} checked={cur.editableFields.includes(k)} disabled={ro} onChange={(v) => set({ editableFields: v ? [...cur.editableFields, k] : cur.editableFields.filter((x) => x !== k) })} /></li>)}</ul></CardBody></Card>
      <Card><CardHeader title="Texts" /><CardBody className="space-y-4">
        <Field label="Message on the “Need help?” page" error={errors.supportNote}><Textarea rows={2} maxLength={300} value={cur.supportNote ?? ""} disabled={ro} onChange={(e) => set({ supportNote: e.target.value })} /></Field>
        <Field label="Privacy notice shown to patients" error={errors.privacyNotice} hint="Leave empty to use the standard wording. Have your own legal text reviewed by a professional."><Textarea rows={5} maxLength={3000} value={cur.privacyNotice ?? ""} disabled={ro} onChange={(e) => set({ privacyNotice: e.target.value })} /></Field>
        <Field label="Notice version" error={errors.consentVersion} hint="Change it when you change the notice — each patient's consent records the version they accepted."><div className="max-w-32"><TextInput value={cur.consentVersion} maxLength={20} disabled={ro} onChange={(e) => set({ consentVersion: e.target.value })} /></div></Field>
      </CardBody></Card>
      {!ro && <div className="flex justify-end"><Button onClick={save} loading={busy}>Save settings</Button></div>}
    </div>
  );
}
