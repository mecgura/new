"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AlertTriangle, CalendarPlus, Download, MoreHorizontal, Pencil, ShieldAlert, Stethoscope, UserPlus } from "lucide-react";
import { Alert, Badge, Button, ButtonLink, Card, CardBody, CardHeader, ConfirmDialog, Dropdown, EmptyState, ErrorState, Field, LoadingState, Modal, Select, StatusBadge, TextInput, Textarea, useToast } from "@/components/ui";
import { NewAppointmentModal, type DoctorOpt, type ServiceOpt } from "@/components/scheduling/appointment-dialogs";
import { AppointmentStatusBadge, PriorityBadge, STATUS_LABEL, TYPE_LABEL } from "@/components/scheduling/labels";
import { apiFetch } from "@/lib/api/client";
import { cn } from "@/lib/cn";
import type { getPatientProfile } from "@/lib/services/patient-crm";
import { PortalAccessCard } from "@/components/portal/portal-access-card";
import { CommunicationStatus } from "@/components/communications/communication-status";
import { PatientPharmacyTab } from "@/components/pharmacy/patient-pharmacy-tab";
import { PatientBillingTab } from "@/components/billing/patient-billing-tab";
import { PatientFollowUpsTab } from "@/components/followups/patient-followups-tab";
import { LabReportsTab } from "@/components/lab/lab-reports-tab";
import { RecordSection, type RecordConfig } from "./record-section";
import { useApi } from "./use-api";

export type ProfileFull = Extract<Awaited<ReturnType<typeof getPatientProfile>>, { tier: "full" }>;
const cap = (s: string | null | undefined) => (s ? s[0] + s.slice(1).toLowerCase().replace(/_/g, " ") : "—");
const maskPhone = (p: string | null) => (p ? `+91 ••••••${p.slice(-4)}` : "—");
const day = (iso?: string | null) => (iso ? iso.slice(0, 10) : "—");

/* ------------------------------ record section configs ------------------------------ */
const SEV = [{ value: "MILD", label: "Mild" }, { value: "MODERATE", label: "Moderate" }, { value: "SEVERE", label: "Severe" }, { value: "UNKNOWN", label: "Unknown" }];
const sevTone = (s: string) => (s === "SEVERE" ? "danger" : s === "MODERATE" ? "warning" : "neutral");
const ALLERGY: RecordConfig = {
  kind: "allergies", title: "Allergies", description: "Recorded from what the patient or clinician reports.", addLabel: "Add allergy", empty: "No allergies recorded", modalTitle: "Add allergy", editable: true,
  defaults: { allergen: "", reaction: "", severity: "UNKNOWN", notes: "", status: "ACTIVE" },
  fields: [
    { name: "allergen", label: "Allergen", type: "text", required: true, maxLength: 100 }, { name: "reaction", label: "Reaction", type: "text", maxLength: 200 },
    { name: "severity", label: "Severity", type: "select", options: SEV }, { name: "status", label: "Status", type: "select", options: [{ value: "ACTIVE", label: "Active" }, { value: "INACTIVE", label: "Inactive" }, { value: "UNKNOWN", label: "Unknown" }] },
    { name: "notes", label: "Notes", type: "textarea", maxLength: 500 },
  ],
  render: (i) => ({ title: String(i.allergen), sub: i.reaction ? `Reaction: ${i.reaction}` : undefined, body: i.notes ? String(i.notes) : undefined, meta: `Recorded ${day(String(i.recordedAt))}`,
    badges: <><StatusBadge tone={sevTone(String(i.severity)) as "danger" | "warning" | "neutral"}>{cap(String(i.severity))}</StatusBadge><Badge>{cap(String(i.status))}</Badge></> }),
};
const MEDS: RecordConfig = {
  kind: "medications", title: "Current medicines (summary)", description: "A record of what the patient says they take. This is not a prescription.", addLabel: "Add medicine", empty: "No medicines recorded", modalTitle: "Add medicine", editable: true,
  defaults: { name: "", strength: "", frequency: "", notes: "", source: "PATIENT_REPORTED", active: true },
  fields: [
    { name: "name", label: "Medicine name", type: "text", required: true, maxLength: 120 }, { name: "strength", label: "Strength", type: "text", maxLength: 60 }, { name: "frequency", label: "How often", type: "text", maxLength: 80 },
    { name: "source", label: "Source", type: "select", options: [{ value: "PATIENT_REPORTED", label: "Patient reported" }, { value: "CLINICIAN_RECORDED", label: "Clinician recorded" }, { value: "OTHER", label: "Other" }] },
    { name: "active", label: "Currently taking", type: "checkbox" }, { name: "notes", label: "Notes", type: "textarea", maxLength: 500 },
  ],
  render: (i) => ({ title: [i.name, i.strength].filter(Boolean).join(" · "), sub: i.frequency ? String(i.frequency) : undefined, body: i.notes ? String(i.notes) : undefined, meta: `${cap(String(i.source))} · recorded ${day(String(i.recordedAt))}`, badges: <Badge tone={i.active ? "success" : "neutral"}>{i.active ? "Active" : "Stopped"}</Badge> }),
};
const HISTORY: RecordConfig = {
  kind: "history", title: "Medical history", description: "Conditions, surgeries and other background, as stated.", addLabel: "Add entry", empty: "No history recorded", modalTitle: "Add history entry", editable: true,
  defaults: { category: "", title: "", description: "", occurredOn: "", status: "UNKNOWN", notes: "" },
  fields: [
    { name: "category", label: "Category", type: "select", required: true, options: [["CONDITION", "Condition"], ["SURGERY", "Surgery"], ["HOSPITALIZATION", "Hospitalisation"], ["CHRONIC_CONDITION", "Chronic condition"], ["PROCEDURE", "Procedure"], ["OTHER", "Other"]].map(([value, label]) => ({ value, label })) },
    { name: "title", label: "Title", type: "text", required: true, maxLength: 150 }, { name: "occurredOn", label: "When", type: "text", hint: "A year (2019) or date (2019-03-15)", maxLength: 10 },
    { name: "status", label: "Status", type: "select", options: [{ value: "ACTIVE", label: "Active" }, { value: "RESOLVED", label: "Resolved" }, { value: "UNKNOWN", label: "Unknown" }] },
    { name: "description", label: "Description", type: "textarea", maxLength: 1000 }, { name: "notes", label: "Notes", type: "textarea", maxLength: 500 },
  ],
  render: (i) => ({ title: String(i.title), sub: `${cap(String(i.category))}${i.occurredOn ? ` · ${i.occurredOn}` : ""}`, body: [i.description, i.notes].filter(Boolean).join("\n") || undefined, meta: `Recorded ${day(String(i.recordedAt))}`, badges: <Badge>{cap(String(i.status))}</Badge> }),
};
const FAMILY_HISTORY: RecordConfig = {
  kind: "family-history", title: "Family medical history", description: "Optional. Conditions in blood relatives, as stated.", addLabel: "Add entry", empty: "No family history recorded", modalTitle: "Add family history", editable: true,
  defaults: { relation: "", condition: "", notes: "" },
  fields: [
    { name: "relation", label: "Relation", type: "select", required: true, options: ["FATHER", "MOTHER", "SIBLING", "GRANDPARENT", "CHILD", "OTHER"].map((v) => ({ value: v, label: cap(v) })) },
    { name: "condition", label: "Condition", type: "text", required: true, maxLength: 150 }, { name: "notes", label: "Notes", type: "textarea", maxLength: 500 },
  ],
  render: (i) => ({ title: String(i.condition), sub: cap(String(i.relation)), body: i.notes ? String(i.notes) : undefined, meta: `Recorded ${day(String(i.recordedAt))}` }),
};
const NOTES: RecordConfig = {
  kind: "notes", title: "Notes", description: "Internal notes. Clinical notes are visible only to clinical staff. Notes can't be edited — add a new one.", addLabel: "Add note", empty: "No notes yet", modalTitle: "Add note", editable: false,
  defaults: { kind: "GENERAL", content: "" },
  fields: [
    { name: "kind", label: "Type", type: "select", required: true, options: [{ value: "GENERAL", label: "General" }, { value: "RECEPTION", label: "Reception" }, { value: "CLINICAL", label: "Clinical (clinical staff only)" }] },
    { name: "content", label: "Note", type: "textarea", required: true, maxLength: 2000 },
  ],
  render: (i) => ({ title: `${i.author} · ${cap(String(i.authorRole))}`, body: String(i.content), meta: `${String(i.createdAt).replace("T", " ").slice(0, 16)} UTC`, badges: <Badge tone={i.kind === "CLINICAL" ? "primary" : "neutral"}>{cap(String(i.kind))}</Badge> }),
};

/* ------------------------------------ workspace ------------------------------------ */
interface Props { profile: ProfileFull; doctors: DoctorOpt[]; services: ServiceOpt[]; today: string }
type SectionKey = "overview" | "consultations" | "timeline" | "visits" | "appointments" | "medical" | "allergies" | "medications" | "documents" | "reports" | "notes" | "family" | "billing" | "pharmacy" | "followup";

export function PatientWorkspace({ profile, doctors, services, today }: Props) {
  const router = useRouter();
  const toast = useToast();
  const { patient: p, access, overview, alerts } = profile;
  const archived = p.status === "ARCHIVED";
  const [tab, setTab] = useState<SectionKey>("overview");
  const [apptOpen, setApptOpen] = useState(false);
  const [opdOpen, setOpdOpen] = useState(false);
  const [confirm, setConfirm] = useState<null | "archive" | "restore">(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const sections: { key: SectionKey; label: string; show: boolean }[] = [
    { key: "overview", label: "Overview", show: true }, { key: "timeline", label: "Timeline", show: true }, { key: "visits", label: "Visits", show: true },
    { key: "appointments", label: "Appointments", show: true },
    { key: "consultations", label: "Consultations", show: access.consultations },
    { key: "medical", label: "Medical information", show: access.clinical }, { key: "allergies", label: "Allergies", show: access.clinical }, { key: "medications", label: "Medications", show: access.clinical },
    { key: "documents", label: "Documents", show: true }, { key: "reports", label: "Reports", show: true }, { key: "notes", label: "Notes", show: true }, { key: "family", label: "Family", show: true },
    { key: "billing", label: "Billing", show: true }, { key: "pharmacy", label: "Pharmacy", show: access.clinical }, { key: "followup", label: "Follow-up", show: true },
  ];

  async function run(url: string, body: unknown, ok: string) {
    setBusy(true);
    const r = await apiFetch(url, { method: "POST", body: JSON.stringify(body) });
    setBusy(false);
    if (!r.ok) { toast({ tone: "danger", title: r.error.message }); return false; }
    toast({ tone: "success", title: ok }); setConfirm(null); setReason(""); router.refresh(); return true;
  }
  async function exportFile() {
    const r = await apiFetch<unknown>(`/api/patients/${p.id}/export`, { method: "POST" });
    if (!r.ok) { toast({ tone: "danger", title: r.error.message }); return; }
    const url = URL.createObjectURL(new Blob([JSON.stringify(r.data, null, 2)], { type: "application/json" }));
    const a = document.createElement("a"); a.href = url; a.download = `${p.code}-export.json`; a.click(); URL.revokeObjectURL(url);
    toast({ tone: "success", title: "Export downloaded", description: "It is not stored or linked anywhere. Handle the file as confidential." });
  }

  const moreItems = [
    ...(access.edit && !archived ? [{ label: p.status === "ACTIVE" ? "Mark inactive" : "Mark active", onSelect: () => void run(`/api/patients/${p.id}/status`, { status: p.status === "ACTIVE" ? "INACTIVE" : "ACTIVE" }, "Status updated") }] : []),
    ...(access.export ? [{ label: "Export patient data", icon: <Download aria-hidden className="size-4" />, onSelect: () => void exportFile() }] : []),
    ...(access.archive ? [archived ? { label: "Restore patient", onSelect: () => setConfirm("restore") } : { label: "Archive patient", tone: "danger" as const, onSelect: () => setConfirm("archive") }] : []),
  ];

  return (
    <div className="space-y-section">
      {archived && <Alert tone="warning" title="This patient is archived">The file is read-only and hidden from the normal patient list{p.archivedAt ? ` since ${day(p.archivedAt)}` : ""}. {access.archive ? "You can restore it from the More menu." : "A clinic admin can restore it."}</Alert>}

      <header className="rounded-card border border-line bg-surface p-card shadow-card">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="type-caption uppercase tracking-wide">Patient</p>
            <h1 className="type-page-title break-words">{p.name}{p.preferredName ? <span className="type-secondary font-normal"> ({p.preferredName})</span> : null}</h1>
            <p className="type-label mt-0.5 tabular-nums">{p.code}</p>
            <p className="type-secondary mt-1">{[p.age, p.gender ? cap(p.gender) : null].filter(Boolean).join(" • ") || "Age not recorded"} · <span className="tabular-nums">{maskPhone(p.phone)}</span></p>
            <div className="mt-2 flex flex-wrap gap-2"><StatusBadge tone={p.status === "ACTIVE" ? "success" : archived ? "neutral" : "warning"}>{cap(p.status)}</StatusBadge>{overview.todayVisit && <Badge tone="primary">Today: token {overview.todayVisit.token} · {STATUS_LABEL[overview.todayVisit.status] ?? overview.todayVisit.status}</Badge>}</div>
          </div>
          {!archived && (
            <div className="flex flex-wrap gap-2">
              {access.edit && <ButtonLink href={`/patients/${p.id}/edit`} variant="outline"><Pencil aria-hidden className="size-4" />Edit</ButtonLink>}
              {access.opd && <Button onClick={() => setOpdOpen(true)} disabled={!doctors.length}><UserPlus aria-hidden className="size-4" />New OPD visit</Button>}
              {access.appointments && <Button variant="outline" onClick={() => setApptOpen(true)} disabled={!doctors.length}><CalendarPlus aria-hidden className="size-4" />Appointment</Button>}
              <Button variant="outline" onClick={() => setTab("timeline")}>View timeline</Button>
              {moreItems.length > 0 && <Dropdown triggerLabel="More actions" trigger={<><MoreHorizontal aria-hidden className="size-4" /><span>More</span></>} triggerClassName="type-button inline-flex min-h-control items-center gap-2 rounded-md border border-line-strong bg-surface px-4 hover:bg-surface-muted" items={moreItems} />}
            </div>
          )}
          {archived && moreItems.length > 0 && <Dropdown triggerLabel="More actions" trigger={<><MoreHorizontal aria-hidden className="size-4" /><span>More</span></>} triggerClassName="type-button inline-flex min-h-control items-center gap-2 rounded-md border border-line-strong bg-surface px-4 hover:bg-surface-muted" items={moreItems} />}
        </div>
        {alerts && alerts.allergies.length > 0 && (
          <div role="alert" className="mt-4 flex gap-3 rounded-md border-2 border-danger bg-danger-soft p-3">
            <AlertTriangle aria-hidden className="mt-0.5 size-5 shrink-0 text-danger" />
            <div><p className="type-label !text-danger">ALLERGY</p><ul className="type-body">{alerts.allergies.map((a, i) => <li key={i}><strong>{a.allergen}</strong>{a.reaction ? ` — ${a.reaction}` : ""}{a.severity !== "UNKNOWN" ? ` (${a.severity.toLowerCase()})` : ""}</li>)}</ul></div>
          </div>
        )}
      </header>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-section lg:grid-cols-[13rem_minmax(0,1fr)_17rem]">
        <nav aria-label="Patient file sections" className="-mx-page min-w-0 lg:mx-0">
          <div role="tablist" aria-label="Patient file sections" aria-orientation="vertical" className="flex gap-1 overflow-x-auto px-page pb-1 lg:flex-col lg:overflow-visible lg:px-0"
            onKeyDown={(e) => {
              const vis = sections.filter((s) => s.show); const i = vis.findIndex((s) => s.key === tab);
              const next = e.key === "ArrowRight" || e.key === "ArrowDown" ? (i + 1) % vis.length : e.key === "ArrowLeft" || e.key === "ArrowUp" ? (i - 1 + vis.length) % vis.length : e.key === "Home" ? 0 : e.key === "End" ? vis.length - 1 : -1;
              if (next >= 0) { e.preventDefault(); setTab(vis[next].key); document.getElementById(`tab-${vis[next].key}`)?.focus(); }
            }}>
            {sections.filter((s) => s.show).map((s) => (
              <button key={s.key} id={`tab-${s.key}`} role="tab" type="button" aria-selected={tab === s.key} aria-controls="patient-panel" tabIndex={tab === s.key ? 0 : -1} onClick={() => setTab(s.key)}
                className={cn("type-label min-h-control shrink-0 whitespace-nowrap rounded-md px-3 text-left", tab === s.key ? "bg-primary-soft !text-primary" : "hover:bg-surface-muted")}>{s.label}</button>
            ))}
          </div>
        </nav>

        <div id="patient-panel" role="tabpanel" aria-labelledby={`tab-${tab}`} tabIndex={0} className="min-w-0 space-y-section focus:outline-none">
          {tab === "overview" && <><Overview profile={profile} /><div className="mt-section"><PortalAccessCard patientId={p.id} patientName={p.name} /></div><div className="mt-section"><CommunicationStatus patientId={p.id} title="Recent messages to this patient" /></div></>}
          {tab === "timeline" && <Timeline id={p.id} clinical={access.clinical} />}
          {tab === "consultations" && <Consultations id={p.id} />}
          {tab === "visits" && <Visits id={p.id} />}
          {tab === "appointments" && <Appointments id={p.id} />}
          {tab === "medical" && <><RecordSection patientId={p.id} cfg={HISTORY} readOnly={archived} /><RecordSection patientId={p.id} cfg={FAMILY_HISTORY} readOnly={archived} /></>}
          {tab === "allergies" && <RecordSection patientId={p.id} cfg={ALLERGY} readOnly={archived} />}
          {tab === "medications" && <RecordSection patientId={p.id} cfg={MEDS} readOnly={archived} />}
          {tab === "notes" && <RecordSection patientId={p.id} cfg={NOTES} readOnly={archived} />}
          {tab === "family" && <Family id={p.id} readOnly={archived} />}
          {tab === "documents" && <Soon title="Documents" text="Identity, medical, insurance and referral documents will be stored here in a later phase (Phase 7). Nothing is uploaded yet." />}
          {tab === "reports" && <LabReportsTab patientId={p.id} />}
          {tab === "billing" && <PatientBillingTab patientId={p.id} />}
          {tab === "pharmacy" && <PatientPharmacyTab patientId={p.id} />}
          {tab === "followup" && <PatientFollowUpsTab patientId={p.id} patientLabel={`${p.name} (${p.code})`} />}
        </div>

        <aside aria-label="Patient summary" className="space-y-4">
          <Card><CardHeader title="Summary" />
            <CardBody className="space-y-3 text-sm">
              <Row label="Total visits" value={String(overview.totalVisits)} />
              <Row label="Last visit" value={overview.lastVisitAt ? `${day(overview.lastVisitAt)}${overview.lastVisitDoctor ? ` · ${overview.lastVisitDoctor}` : ""}` : "None yet"} />
              <Row label="Next appointment" value={overview.nextAppointment ? `${overview.nextAppointment.when} · ${overview.nextAppointment.doctor}` : "None booked"} />
              <Row label="Blood group" value={p.bloodGroup ?? "Not recorded"} />
              {p.emergencyContact && <Row label="Emergency contact" value={`${p.emergencyContact.name}${p.emergencyContact.relation ? ` (${p.emergencyContact.relation})` : ""} · ${maskPhone(p.emergencyContact.phone)}`} />}
              {p.familyMembers > 0 && <Row label="Family group" value={`${p.familyMembers} other member${p.familyMembers === 1 ? "" : "s"}`} />}
            </CardBody>
          </Card>
          {!access.clinical && <p className="type-caption flex gap-2"><ShieldAlert aria-hidden className="size-4 shrink-0" />Medical information is visible to clinical staff only.</p>}
        </aside>
      </div>

      <NewAppointmentModal open={apptOpen} onClose={() => setApptOpen(false)} doctors={doctors} services={services} today={today} onDone={() => router.refresh()} presetPatient={{ ref: { patientId: p.id, viaProfile: true }, label: `${p.name} · ${p.code}` }} />
      <QuickOpd open={opdOpen} onClose={() => setOpdOpen(false)} patientId={p.id} doctors={doctors} canPriority={ctx(access)} onDone={() => router.refresh()} />
      <ConfirmDialog open={confirm === "restore"} onCancel={() => setConfirm(null)} tone="primary" title="Restore this patient?" description="The patient returns to the active list and can be booked again." confirmLabel="Restore" loading={busy} onConfirm={() => void run(`/api/patients/${p.id}/restore`, {}, "Patient restored")} />
      <Modal open={confirm === "archive"} onClose={() => setConfirm(null)} title="Archive this patient?" description="The file stays on record and can be restored by an admin, but the patient disappears from the normal list and can't be booked."
        footer={<><Button variant="outline" onClick={() => setConfirm(null)} autoFocus>Cancel</Button><Button variant="danger" loading={busy} onClick={() => void run(`/api/patients/${p.id}/archive`, { reason: reason || undefined }, "Patient archived")}>Archive patient</Button></>}>
        <Field label="Reason (optional)"><TextInput value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} /></Field>
      </Modal>
    </div>
  );
}
const ctx = (a: ProfileFull["access"]) => a.opd;

function Row({ label, value }: { label: string; value: string }) {
  return <div><p className="type-caption">{label}</p><p className="type-body break-words">{value}</p></div>;
}
function Soon({ title, text }: { title: string; text: string }) {
  return <Card><CardHeader title={title} /><EmptyState icon={<Stethoscope aria-hidden className="size-6" />} title="Coming in a later phase" description={text} /></Card>;
}

/* -------------------------------------- overview -------------------------------------- */
function Overview({ profile }: { profile: ProfileFull }) {
  const { patient: p, consents, access } = profile;
  const toast = useToast(); const router = useRouter();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ type: "COMMUNICATION", status: "GRANTED", note: "" });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string>();
  const address = [p.addressLine, p.city, p.state, p.pincode, p.country].filter(Boolean).join(", ");
  async function save() {
    setBusy(true); setErr(undefined);
    const r = await apiFetch(`/api/patients/${p.id}/records/consents`, { method: "POST", body: JSON.stringify({ ...v, note: v.note || undefined }) });
    setBusy(false);
    if (!r.ok) { setErr(r.error.message); return; }
    toast({ tone: "success", title: "Consent recorded" }); setOpen(false); router.refresh();
  }
  const CONSENT_LABEL: Record<string, string> = { PRIVACY: "Privacy notice", COMMUNICATION: "Communication", DATA_PROCESSING: "Data processing" };
  return (
    <>
      <Card><CardHeader title="Personal & contact" />
        <CardBody><dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 text-sm">
          <Row label="Patient ID" value={p.code} /><Row label="Registered" value={day(p.registeredAt)} />
          <Row label="Date of birth" value={p.dateOfBirth ?? (p.ageYears != null ? `About ${p.ageYears} years` : "Not recorded")} /><Row label="Gender" value={cap(p.gender)} />
          <Row label="Mobile" value={p.phone ?? "—"} /><Row label="Alternate mobile" value={p.alternatePhone ?? "—"} />
          <Row label="Email" value={p.email ?? "—"} /><Row label="Occupation" value={p.occupation ?? "—"} />
          <div className="sm:col-span-2"><Row label="Address" value={address || "Not recorded"} /></div>
          <Row label="Marital status" value={cap(p.maritalStatus)} /><Row label="Blood group" value={p.bloodGroup ?? "Not recorded"} />
          <div className="sm:col-span-2"><Row label="Emergency contact" value={p.emergencyContact ? `${p.emergencyContact.name}${p.emergencyContact.relation ? ` (${p.emergencyContact.relation})` : ""} · ${p.emergencyContact.phone ?? "—"}` : "Not recorded"} /></div>
        </dl></CardBody>
      </Card>
      <Card><CardHeader title="Consent & contact preferences" description="Records only. No messages are sent from this system yet." action={access.edit && p.status !== "ARCHIVED" ? <Button size="sm" variant="outline" onClick={() => setOpen(true)}>Record consent</Button> : undefined} />
        <CardBody className="space-y-4 text-sm">
          <ul className="divide-y divide-line rounded-md border border-line">
            {["PRIVACY", "COMMUNICATION", "DATA_PROCESSING"].map((t) => (
              <li key={t} className="flex flex-wrap items-center justify-between gap-2 p-3"><span>{CONSENT_LABEL[t]}</span>
                {consents[t] ? <span className="type-caption">{consents[t].status === "GRANTED" ? "Granted" : "Withdrawn"} · {consents[t].version} · {day(consents[t].recordedAt)}</span> : <Badge>Not recorded</Badge>}</li>
            ))}
          </ul>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4"><Row label="Phone" value={cap(p.prefs.phone)} /><Row label="WhatsApp" value={cap(p.prefs.whatsapp)} /><Row label="SMS" value={cap(p.prefs.sms)} /><Row label="Email" value={cap(p.prefs.email)} /></dl>
        </CardBody>
      </Card>
      <Modal open={open} onClose={() => setOpen(false)} title="Record consent" description="Adds a new entry to the consent history. Earlier entries are kept." footer={<><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={save} loading={busy}>Save</Button></>}>
        <div className="space-y-4">{err && <Alert tone="danger">{err}</Alert>}
          <Field label="Type"><Select value={v.type} onChange={(e) => setV({ ...v, type: e.target.value })} options={Object.entries(CONSENT_LABEL).map(([value, label]) => ({ value, label }))} /></Field>
          <Field label="Decision"><Select value={v.status} onChange={(e) => setV({ ...v, status: e.target.value })} options={[{ value: "GRANTED", label: "Granted" }, { value: "WITHDRAWN", label: "Withdrawn" }]} /></Field>
          <Field label="Note (optional)"><TextInput value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} maxLength={200} /></Field>
        </div>
      </Modal>
    </>
  );
}

/* -------------------------------------- timeline -------------------------------------- */
interface Ev { id: string; type: string; category: string; at: string; title: string; detail?: string; href?: string }
interface TL { filter: string; available: boolean; restricted: boolean; page: number; pageSize: number; total: number; events: Ev[] }
const FILTERS: [string, string, boolean][] = [["all", "All", true], ["appointments", "Appointments", true], ["opd", "OPD visits", true], ["clinical", "Clinical", true], ["documents", "Documents", false], ["reports", "Reports", true], ["billing", "Billing", true], ["pharmacy", "Pharmacy", true], ["followup", "Follow-up", true]];
function Timeline({ id, clinical }: { id: string; clinical: boolean }) {
  const [filter, setFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [more, setMore] = useState<Ev[]>([]);
  const { data, error, loading, reload } = useApi<TL>(`/api/patients/${id}/timeline?filter=${filter}&page=1`);
  const [loadingMore, setLoadingMore] = useState(false);
  async function loadMore() {
    setLoadingMore(true);
    const r = await apiFetch<TL>(`/api/patients/${id}/timeline?filter=${filter}&page=${page + 1}`);
    setLoadingMore(false);
    if (r.ok) { setMore([...more, ...r.data.events]); setPage(page + 1); }
  }
  const events = [...(data?.events ?? []), ...more];
  const total = data?.total ?? 0;
  return (
    <Card>
      <CardHeader title="Patient timeline" description="Newest first. Built from appointments, OPD visits and the patient file. Other modules will add their events later." />
      <CardBody className="space-y-4">
        <div role="group" aria-label="Filter timeline" className="flex flex-wrap gap-2">
          {FILTERS.map(([k, label, on]) => (
            <button key={k} type="button" disabled={!on || (k === "clinical" && !clinical)} aria-pressed={filter === k} onClick={() => { setFilter(k); setPage(1); setMore([]); }}
              className={cn("type-label min-h-9 rounded-pill border px-3 disabled:cursor-not-allowed disabled:opacity-50", filter === k ? "border-primary bg-primary text-on-brand" : "border-line-strong bg-surface hover:bg-surface-muted")}>{label}{!on && <span className="type-caption ml-1">· soon</span>}</button>
          ))}
        </div>
        {loading && !data ? <LoadingState /> : error ? <ErrorState code={error.code} description={error.message} action={<Button onClick={reload}>Try again</Button>} /> : !events.length ? <EmptyState title="No events yet" description="Appointments, visits and record updates will appear here." /> : (
          <ol className="relative space-y-4 border-l-2 border-line pl-5">
            {events.map((e) => (
              <li key={e.id} className="relative">
                <span aria-hidden className={cn("absolute -left-[1.6rem] top-1.5 size-3 rounded-full border-2 border-surface", e.category === "opd" ? "bg-primary" : e.category === "appointments" ? "bg-info" : e.category === "billing" ? "bg-info" : e.category === "pharmacy" ? "bg-success" : e.category === "followup" ? "bg-primary" : e.category === "reports" ? "bg-success" : e.category === "clinical" ? "bg-warning" : "bg-muted")} />
                <p className="type-label">{e.href ? <Link href={e.href}>{e.title}</Link> : e.title}</p>
                {e.detail && <p className="type-secondary">{e.detail}</p>}
                <p className="type-caption"><time dateTime={e.at}>{e.at.replace("T", " ").slice(0, 16)} UTC</time></p>
              </li>
            ))}
          </ol>
        )}
        {events.length < total && <Button variant="outline" onClick={loadMore} loading={loadingMore}>Load more</Button>}
      </CardBody>
    </Card>
  );
}

/* ---------------------------------- visits / appointments ---------------------------------- */
interface Vis { id: string; date: string; doctor: string; visitType: string; token: string; status: string; priority: string; appointmentRef: string | null; checkedInAt: string; calledAt: string | null; startedAt: string | null; completedAt: string | null; note: string | null }
function Visits({ id }: { id: string }) {
  const [page, setPage] = useState(1);
  const { data, error, loading, reload } = useApi<{ page: number; pageSize: number; total: number; visits: Vis[] }>(`/api/patients/${id}/visits?page=${page}`);
  return (
    <Card><CardHeader title="Visits (OPD)" description="Each clinic visit with its queue token. Consultation details arrive with the consultation module." />
      {loading && !data ? <LoadingState /> : error ? <ErrorState code={error.code} description={error.message} action={<Button onClick={reload}>Try again</Button>} /> : !data?.visits.length ? <EmptyState title="No visits yet" description="Visits appear here once the patient is checked in or registered in the OPD queue." /> : (
        <ul className="divide-y divide-line">
          {data.visits.map((v) => (
            <li key={v.id} className="space-y-1 p-card">
              <div className="flex flex-wrap items-center justify-between gap-2"><p className="type-label">{v.date} · {v.doctor}</p><div className="flex gap-2"><PriorityBadge priority={v.priority} /><AppointmentStatusBadge status={v.status} /></div></div>
              <p className="type-secondary">Token {v.token} · {TYPE_LABEL[v.visitType] ?? cap(v.visitType)}{v.appointmentRef ? ` · booking ${v.appointmentRef}` : ""}</p>
              <p className="type-caption">Checked in {v.checkedInAt}{v.calledAt ? ` · called ${v.calledAt}` : ""}{v.startedAt ? ` · started ${v.startedAt}` : ""}{v.completedAt ? ` · completed ${v.completedAt}` : ""}</p>
              {v.note && <p className="type-body">{v.note}</p>}
            </li>
          ))}
        </ul>
      )}
      {data && data.total > data.pageSize && <CardBody className="flex items-center justify-between border-t border-line"><Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button><span className="type-caption">Page {page} of {Math.ceil(data.total / data.pageSize)}</span><Button size="sm" variant="outline" disabled={page * data.pageSize >= data.total} onClick={() => setPage(page + 1)}>Next</Button></CardBody>}
    </Card>
  );
}
interface Ap { id: string; publicId: string; date: string; time: string; doctor: string; type: string; status: string; token: string | null }
function Appointments({ id }: { id: string }) {
  const { data, error, loading, reload } = useApi<{ upcoming: Ap[]; past: Ap[] }>(`/api/patients/${id}/appointments`);
  const list = (items: Ap[]) => (
    <ul className="divide-y divide-line">{items.map((a) => (
      <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 p-card"><div><p className="type-label">{a.date} · {a.time}</p><p className="type-secondary">{a.doctor} · {TYPE_LABEL[a.type] ?? cap(a.type)}{a.token ? ` · token ${a.token}` : ""}</p><p className="type-caption">{a.publicId}</p></div><AppointmentStatusBadge status={a.status} /></li>
    ))}</ul>
  );
  if (loading && !data) return <Card><LoadingState /></Card>;
  if (error) return <Card><ErrorState code={error.code} description={error.message} action={<Button onClick={reload}>Try again</Button>} /></Card>;
  return (
    <>
      <Card><CardHeader title="Upcoming appointments" />{data?.upcoming.length ? list(data.upcoming) : <EmptyState title="Nothing upcoming" />}</Card>
      <Card><CardHeader title="Past appointments" description="Completed, cancelled and no-show bookings." />{data?.past.length ? list(data.past) : <EmptyState title="No past appointments" />}</Card>
    </>
  );
}

/* ------------------------------------------ family ------------------------------------------ */
interface Fam { relation: string | null; members: { id: string; code: string; name: string; familyRelation: string | null; status: string }[]; canEdit: boolean }
interface Card0 { id: string; code: string; name: string; phoneMasked: string; age: string | null }
function Family({ id, readOnly }: { id: string; readOnly: boolean }) {
  const toast = useToast();
  const { data, error, loading, reload } = useApi<Fam>(`/api/patients/${id}/family`);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState(""); const [results, setResults] = useState<Card0[]>([]); const [relation, setRelation] = useState(""); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<string>();
  async function search(text: string) { setQ(text); if (text.trim().length < 3) { setResults([]); return; } const r = await apiFetch<Card0[]>(`/api/patients/search?q=${encodeURIComponent(text.trim())}`); if (r.ok) setResults(r.data.filter((x) => x.id !== id)); }
  async function link(other: string) {
    setBusy(true); setMsg(undefined);
    const r = await apiFetch(`/api/patients/${id}/family`, { method: "POST", body: JSON.stringify({ otherPatientId: other, relation: relation || undefined }) });
    setBusy(false);
    if (!r.ok) { setMsg(r.error.message); return; }
    toast({ tone: "success", title: "Added to family group" }); setOpen(false); setQ(""); setResults([]); await reload();
  }
  async function unlink() { const r = await apiFetch(`/api/patients/${id}/family`, { method: "DELETE" }); if (r.ok) { toast({ tone: "success", title: "Removed from family group" }); await reload(); } else toast({ tone: "danger", title: r.error.message }); }
  const canEdit = !readOnly && data?.canEdit;
  return (
    <Card><CardHeader title="Family / household" description="Groups relatives for convenience only. Each person keeps a separate medical record; nothing is shared or merged." action={canEdit ? <Button size="sm" variant="outline" onClick={() => setOpen(true)}>Add family member</Button> : undefined} />
      {loading && !data ? <LoadingState /> : error ? <ErrorState code={error.code} description={error.message} action={<Button onClick={reload}>Try again</Button>} /> : !data?.members.length ? <EmptyState title="Not in a family group" /> : (
        <>
          <ul className="divide-y divide-line">{data.members.map((m) => <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 p-card"><div><Link href={`/patients/${m.id}`} className="type-label">{m.name}</Link><p className="type-caption">{m.code}{m.familyRelation ? ` · ${m.familyRelation}` : ""}</p></div>{m.status === "ARCHIVED" && <Badge>Archived</Badge>}</li>)}</ul>
          {canEdit && <CardBody className="border-t border-line"><Button size="sm" variant="ghost" onClick={unlink}>Remove this patient from the group</Button></CardBody>}
        </>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="Add family member" description="Search this clinic's patients. Linking doesn't share any medical information.">
        <div className="space-y-3">{msg && <Alert tone="danger">{msg}</Alert>}
          <Field label="Search by name, mobile or patient ID" hint="At least 3 characters"><TextInput value={q} onChange={(e) => void search(e.target.value)} autoComplete="off" /></Field>
          <Field label="Relation to this patient (optional)"><TextInput value={relation} onChange={(e) => setRelation(e.target.value)} maxLength={40} /></Field>
          <ul className="divide-y divide-line rounded-md border border-line">{results.map((r) => <li key={r.id}><button type="button" disabled={busy} onClick={() => void link(r.id)} className="flex min-h-control w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-surface-muted"><span><span className="type-label block">{r.name}</span><span className="type-caption">{r.code} · {r.phoneMasked}</span></span><span className="type-caption text-primary">Add</span></button></li>)}</ul>
        </div>
      </Modal>
    </Card>
  );
}

/* ---------------------------------------- quick OPD ---------------------------------------- */
function QuickOpd({ open, onClose, patientId, doctors, canPriority, onDone }: { open: boolean; onClose: () => void; patientId: string; doctors: DoctorOpt[]; canPriority: boolean; onDone: () => void }) {
  const toast = useToast();
  const [doctor, setDoctor] = useState(doctors[0]?.id ?? ""); const [queue, setQueue] = useState("GENERAL"); const [emergency, setEmergency] = useState(false); const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<string>();
  async function save() {
    setBusy(true); setMsg(undefined);
    const r = await apiFetch<{ token: string }>("/api/opd", { method: "POST", body: JSON.stringify({ patient: { patientId, viaProfile: true }, doctorUserId: doctor, emergency, queueType: emergency ? "EMERGENCY" : queue, visitType: emergency ? "EMERGENCY" : queue === "FOLLOW_UP" ? "FOLLOW_UP" : queue === "PROCEDURE" ? "PROCEDURE" : "WALK_IN", note: note || undefined }) });
    setBusy(false);
    if (!r.ok) { setMsg(r.error.message); return; }
    toast({ tone: "success", title: `Token ${r.data.token} issued` }); onDone(); onClose();
  }
  return (
    <Modal open={open} onClose={onClose} title="New OPD visit" description="Puts this patient in today's live queue." footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button variant={emergency ? "danger" : "primary"} onClick={save} loading={busy} disabled={!doctor}>{emergency ? "Register emergency" : "Issue token"}</Button></>}>
      <div className="space-y-4">{msg && <Alert tone="danger">{msg}</Alert>}
        <Field label="Doctor" required><Select value={doctor} onChange={(e) => setDoctor(e.target.value)} options={doctors.map((d) => ({ value: d.id, label: d.name }))} /></Field>
        {!emergency && <Field label="Queue"><Select value={queue} onChange={(e) => setQueue(e.target.value)} options={[{ value: "GENERAL", label: "General OPD" }, { value: "FOLLOW_UP", label: "Follow-up" }, { value: "PROCEDURE", label: "Procedure" }]} /></Field>}
        {canPriority && <label className="flex items-start gap-3"><input type="checkbox" checked={emergency} onChange={(e) => setEmergency(e.target.checked)} className="mt-0.5 size-5 accent-[var(--brand-primary)]" /><span className="type-body">This is an emergency (goes to the front of the queue; recorded in the audit log)</span></label>}
        <Field label="Note (optional)"><Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={200} /></Field>
      </div>
    </Modal>
  );
}

/* --------------------------------------- consultations (Phase 5) --------------------------------------- */
interface Cons { id: string; number: string; status: string; date: string; doctor: string; complaint: string | null; diagnoses: string[]; prescription: string | null; followUp: string | null }
function Consultations({ id }: { id: string }) {
  const { data, error, loading, reload } = useApi<{ total: number; rows: Cons[] }>(`/api/consultations?patientId=${id}`);
  return (
    <Card><CardHeader title="Consultations" description="Clinical visits with the doctor. Open one to read it in full." />
      {loading && !data ? <LoadingState /> : error ? <ErrorState code={error.code} description={error.message} action={<Button onClick={reload}>Try again</Button>} /> : !data?.rows.length ? <EmptyState title="No consultations yet" description="They appear here after a doctor starts a consultation from the Live OPD queue." /> : (
        <ul className="divide-y divide-line">{data.rows.map((c) => (
          <li key={c.id} className="space-y-1 p-card"><div className="flex flex-wrap items-center justify-between gap-2"><p className="type-label">{c.date} · {c.doctor}</p><StatusBadge tone={c.status === "FINALIZED" ? "success" : c.status === "CANCELLED" ? "danger" : "info"}>{cap(c.status.replace(/_/g, " "))}</StatusBadge></div>
            <p className="type-secondary">{c.complaint ?? "No complaint recorded"}{c.diagnoses.length ? ` → ${c.diagnoses.join(", ")}` : ""}</p>
            <p className="type-caption">{c.number}{c.prescription ? ` · ${c.prescription}` : ""}{c.followUp ? ` · follow-up ${c.followUp}` : ""} · <Link href={`/consultations/${c.id}`}>View full consultation</Link></p></li>
        ))}</ul>
      )}
    </Card>
  );
}
