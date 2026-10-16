"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, Badge, Button, Field, Modal, Select, TextInput, Textarea, useToast } from "@/components/ui";
import { apiFetch } from "@/lib/api/client";
import { dayLabel, REQUEST_KIND, REQUEST_STATUS } from "./portal-labels";
import { StatusBadge } from "@/components/ui";

interface Profile { patientCode: string; name: string; preferredName: string | null; dateOfBirth: string | null; gender: string | null; bloodGroup: string | null; phone: string | null; alternatePhone: string | null; email: string | null; addressLine: string | null; city: string | null; state: string | null; country: string | null; pincode: string | null; emergencyContactName: string | null; emergencyContactRelation: string | null; emergencyContactPhone: string | null; editable: string[]; fieldLabels: Record<string, string>; allergies: { allergen: string; reaction: string | null; severity: string | null }[]; clinic: { name: string; phone: string | null } }
interface Req { id: string; requestNumber: string; kind: string; field: string | null; requestedValue: string | null; reason: string; status: string; reviewNote: string | null; createdAt: string }
const FIELDS: [string, string][] = [["name", "Name"], ["phone", "Mobile number"], ["email", "Email"], ["dateOfBirth", "Date of birth (yyyy-mm-dd)"], ["gender", "Gender"], ["addressLine", "Address"], ["city", "City"], ["state", "State"], ["pincode", "Pincode"], ["bloodGroup", "Blood group"]];

export function ProfileView({ profile, requests }: { profile: Profile; requests: Req[] }) {
  const router = useRouter(); const toast = useToast();
  const [edit, setEdit] = useState(false); const [vals, setVals] = useState<Record<string, string>>(() => Object.fromEntries(profile.editable.map((k) => [k, ((profile as unknown as Record<string, string | null>)[k] ?? "") as string])));
  const [busy, setBusy] = useState(false); const [errors, setErrors] = useState<Record<string, string>>({}); const [msg, setMsg] = useState<string>();
  const [reqOpen, setReqOpen] = useState<null | "PROFILE_CORRECTION" | "MEDICAL_CORRECTION" | "SUPPORT">(null); const [deact, setDeact] = useState(false);
  async function save() {
    setBusy(true); setErrors({}); setMsg(undefined);
    const r = await apiFetch("/api/patient/profile", { method: "PATCH", body: JSON.stringify(vals) }); setBusy(false);
    if (!r.ok) { setErrors(r.error.fieldErrors ?? {}); setMsg(r.error.message); return; }
    toast({ tone: "success", title: "Profile updated" }); setEdit(false); router.refresh();
  }
  const row = (k: string, label: string, v: string | null) => <div key={k} className="flex flex-wrap justify-between gap-2 px-4 py-3"><dt className="type-secondary">{label}</dt><dd className="type-label break-words text-right">{v || "—"}</dd></div>;
  const p = profile as unknown as Record<string, string | null>;
  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-line bg-surface">
        <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3"><h2 className="type-card-title">My details</h2>{profile.editable.length > 0 && !edit && <Button size="sm" variant="outline" onClick={() => setEdit(true)}>Edit</Button>}</div>
        <dl className="divide-y divide-line">
          {row("code", "Patient ID", profile.patientCode)}{row("name", "Name", profile.name)}{row("dob", "Date of birth", profile.dateOfBirth ? dayLabel(profile.dateOfBirth) : null)}{row("gender", "Gender", profile.gender?.toLowerCase() ?? null)}{row("bg", "Blood group", profile.bloodGroup)}{row("phone", "Mobile", profile.phone)}
          {!edit && <>{profile.editable.map((k) => row(k, profile.fieldLabels[k], p[k]))}</>}
        </dl>
        {edit && (
          <div className="space-y-3 border-t border-line p-4">
            {msg && <Alert tone="danger">{msg}</Alert>}
            {profile.editable.map((k) => <Field key={k} label={profile.fieldLabels[k]} error={errors[k]}><TextInput value={vals[k] ?? ""} maxLength={200} onChange={(e) => setVals({ ...vals, [k]: e.target.value })} inputMode={k === "email" ? "email" : undefined} /></Field>)}
            <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setEdit(false)}>Cancel</Button><Button onClick={save} loading={busy}>Save changes</Button></div>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-line bg-surface">
        <div className="border-b border-line px-4 py-3"><h2 className="type-card-title">Medical information on file</h2><p className="type-caption">Recorded by your clinic. You can ask for a correction — it can&apos;t be edited here.</p></div>
        {profile.allergies.length ? <ul className="divide-y divide-line">{profile.allergies.map((a, i) => <li key={i} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"><span className="type-label">{a.allergen}{a.reaction ? ` — ${a.reaction}` : ""}</span>{a.severity && a.severity !== "UNKNOWN" && <Badge>{a.severity.toLowerCase()}</Badge>}</li>)}</ul> : <p className="type-secondary px-4 py-4">No allergies recorded.</p>}
      </section>

      <section className="rounded-2xl border border-line bg-surface p-4">
        <h2 className="type-card-title">Something wrong or missing?</h2>
        <p className="type-secondary mt-1">Tell the clinic. A staff member reviews it — nothing changes in your record until they approve it.</p>
        <div className="mt-3 flex flex-wrap gap-2"><Button variant="outline" onClick={() => setReqOpen("PROFILE_CORRECTION")}>Correct my details</Button><Button variant="outline" onClick={() => setReqOpen("MEDICAL_CORRECTION")}>Correct medical information</Button><Button variant="outline" onClick={() => setReqOpen("SUPPORT")}>Message the clinic</Button></div>
      </section>

      {requests.length > 0 && (
        <section className="rounded-2xl border border-line bg-surface"><div className="border-b border-line px-4 py-3"><h2 className="type-card-title">My requests</h2></div>
          <ul className="divide-y divide-line">{requests.map((r) => (
            <li key={r.id} className="space-y-1 px-4 py-3"><div className="flex flex-wrap items-center justify-between gap-2"><span className="type-label">{REQUEST_KIND[r.kind] ?? r.kind}{r.field ? ` — ${FIELDS.find(([k]) => k === r.field)?.[1] ?? r.field}` : ""}</span><StatusBadge tone={REQUEST_STATUS[r.status]?.[1]}>{REQUEST_STATUS[r.status]?.[0] ?? r.status}</StatusBadge></div><p className="type-secondary break-words">{r.reason}</p>{r.reviewNote && <p className="type-caption">Clinic: {r.reviewNote}</p>}<p className="type-caption">{r.requestNumber} · {dayLabel(r.createdAt)}</p>{r.status === "PENDING" && <CancelReq id={r.id} />}</li>
          ))}</ul>
        </section>
      )}

      <section className="rounded-2xl border border-line bg-surface p-4">
        <h2 className="type-card-title">Close my portal login</h2>
        <p className="type-secondary mt-1">This only closes your online login. The clinic keeps your medical records as the law requires.</p>
        <Button className="mt-3" variant="outline" onClick={() => setDeact(true)}>Ask the clinic to deactivate my account</Button>
      </section>

      {reqOpen && <RequestModal kind={reqOpen} onClose={() => setReqOpen(null)} onDone={() => { setReqOpen(null); router.refresh(); }} />}
      {deact && <DeactivateModal onClose={() => setDeact(false)} onDone={() => { setDeact(false); router.refresh(); }} />}
    </div>
  );
}
function CancelReq({ id }: { id: string }) {
  const router = useRouter(); const [busy, setBusy] = useState(false);
  return <Button size="sm" variant="ghost" loading={busy} onClick={async () => { setBusy(true); await apiFetch(`/api/patient/requests/${id}/cancel`, { method: "POST" }); setBusy(false); router.refresh(); }}>Cancel this request</Button>;
}
function RequestModal({ kind, onClose, onDone }: { kind: "PROFILE_CORRECTION" | "MEDICAL_CORRECTION" | "SUPPORT"; onClose: () => void; onDone: () => void }) {
  const toast = useToast(); const [field, setField] = useState(""); const [value, setValue] = useState(""); const [reason, setReason] = useState(""); const [errors, setErrors] = useState<Record<string, string>>({}); const [msg, setMsg] = useState<string>(); const [busy, setBusy] = useState(false);
  async function send() { setBusy(true); setErrors({}); setMsg(undefined); const r = await apiFetch("/api/patient/requests", { method: "POST", body: JSON.stringify({ kind, field: field || undefined, requestedValue: value || undefined, reason }) }); setBusy(false); if (!r.ok) { setErrors(r.error.fieldErrors ?? {}); setMsg(r.error.message); return; } toast({ tone: "success", title: "Sent to the clinic" }); onDone(); }
  const title = kind === "PROFILE_CORRECTION" ? "Correct my details" : kind === "MEDICAL_CORRECTION" ? "Correct medical information" : "Message the clinic";
  return (
    <Modal open onClose={onClose} title={title} description="A staff member will review this. Your record isn't changed until they approve." footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={send} loading={busy}>Send</Button></>}>
      <div className="space-y-3">{msg && <Alert tone="danger">{msg}</Alert>}
        {kind === "PROFILE_CORRECTION" && <><Field label="Which detail?" required error={errors.field}><Select value={field} placeholder="Choose" onChange={(e) => setField(e.target.value)} options={FIELDS.map(([v, l]) => ({ value: v, label: l }))} /></Field><Field label="The correct value" required error={errors.requestedValue}><TextInput value={value} maxLength={300} onChange={(e) => setValue(e.target.value)} /></Field></>}
        <Field label={kind === "MEDICAL_CORRECTION" ? "What should be corrected or added?" : kind === "SUPPORT" ? "Your message" : "Why is it wrong?"} required error={errors.reason} hint={kind === "MEDICAL_CORRECTION" ? "For example a new allergy, or a wrong entry. Your doctor will review it." : undefined}><Textarea rows={4} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}
function DeactivateModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const toast = useToast(); const [reason, setReason] = useState(""); const [msg, setMsg] = useState<string>(); const [busy, setBusy] = useState(false); const [ok, setOk] = useState(false);
  async function send() { setBusy(true); setMsg(undefined); const r = await apiFetch("/api/patient/deactivate", { method: "POST", body: JSON.stringify({ reason }) }); setBusy(false); if (!r.ok) { setMsg(r.error.fieldErrors?.reason ?? r.error.message); return; } setOk(true); toast({ tone: "success", title: "Request sent" }); }
  return (
    <Modal open onClose={ok ? onDone : onClose} title="Ask to deactivate your portal account?" description={ok ? "The clinic will review your request. Your medical records stay with the clinic." : "The clinic reviews the request. Until they approve it you can keep using the portal."} footer={ok ? <Button onClick={onDone}>Done</Button> : <><Button variant="outline" onClick={onClose}>Close</Button><Button variant="danger" onClick={send} loading={busy}>Send request</Button></>}>
      {!ok && <div className="space-y-2">{msg && <Alert tone="danger">{msg}</Alert>}<Field label="Reason" required><Textarea rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} /></Field></div>}
    </Modal>
  );
}
