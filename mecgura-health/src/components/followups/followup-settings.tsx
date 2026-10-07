"use client";
import { useEffect, useState } from "react";
import { Alert, Button, Card, CardBody, CardHeader, ErrorState, Field, LoadingState, StatusBadge, TextInput, Toggle, useToast } from "@/components/ui";
import { apiFetch } from "@/lib/api/client";
import { pretty } from "./followup-ui";

interface S { createOnNoShow: boolean; createOnCancellation: boolean; recallCreatesFollowUp: boolean; completeWhenVisitDone: boolean; contactOutcomes: string[]; completionOutcomes: string[]; canConfigure: boolean; integrations: { whatsapp: boolean; sms: boolean; email: boolean } }
const toList = (s: string) => s.split(",").map((x) => x.trim().toUpperCase().replace(/\s+/g, "_")).filter(Boolean);

export function FollowUpSettings() {
  const toast = useToast();
  const [s, setS] = useState<S | null>(null); const [err, setErr] = useState<string>();
  const [contact, setContact] = useState(""); const [completion, setCompletion] = useState(""); const [busy, setBusy] = useState(false); const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => { apiFetch<S>("/api/followups/settings").then((r) => { if (r.ok) { setS(r.data); setContact(r.data.contactOutcomes.join(", ")); setCompletion(r.data.completionOutcomes.join(", ")); } else setErr(r.error.message); }); }, []);
  if (err) return <ErrorState description={err} />;
  if (!s) return <LoadingState />;
  const ro = !s.canConfigure;
  async function save() {
    if (!s) return; setBusy(true); setErrors({});
    const r = await apiFetch("/api/followups/settings", { method: "PUT", body: JSON.stringify({ createOnNoShow: s.createOnNoShow, createOnCancellation: s.createOnCancellation, recallCreatesFollowUp: s.recallCreatesFollowUp, completeWhenVisitDone: s.completeWhenVisitDone, contactOutcomes: toList(contact), completionOutcomes: toList(completion) }) });
    setBusy(false);
    if (!r.ok) { setErrors(r.error.fieldErrors ?? {}); toast({ tone: "danger", title: r.error.message }); return; }
    toast({ tone: "success", title: "Follow-up rules saved" });
  }
  return (
    <div className="space-y-section">
      {ro && <Alert tone="info">You can view the follow-up rules. Only a clinic admin can change them.</Alert>}
      <Card><CardHeader title="Automatic rules" description="Nothing happens automatically unless it is switched on here. These rules only create internal tasks; they never contact the patient." />
        <CardBody className="space-y-4">
          <Toggle label="Create a follow-up when a patient misses an appointment (no-show)" checked={s.createOnNoShow} disabled={ro} onChange={(v) => setS({ ...s, createOnNoShow: v })} />
          <Toggle label="Create a follow-up when an appointment is cancelled" checked={s.createOnCancellation} disabled={ro} onChange={(v) => setS({ ...s, createOnCancellation: v })} />
          <Toggle label="Turn a due recall into a follow-up task automatically" checked={s.recallCreatesFollowUp} disabled={ro} onChange={(v) => setS({ ...s, recallCreatesFollowUp: v })} />
          <Toggle label="Close a follow-up automatically when its booked visit is completed" checked={s.completeWhenVisitDone} disabled={ro} onChange={(v) => setS({ ...s, completeWhenVisitDone: v })} />
          <p className="type-caption">A doctor&apos;s follow-up plan in a consultation always creates a follow-up, because the doctor chose it. Booking an appointment never closes a follow-up by itself.</p>
        </CardBody></Card>
      <Card><CardHeader title="Outcomes" description="Add your own outcome names (comma separated). The standard ones stay available." />
        <CardBody className="space-y-3">
          <Field label="Extra contact outcomes" error={errors.contactOutcomes} hint="Example: LEFT_MESSAGE, VISITED_CLINIC"><TextInput value={contact} disabled={ro} onChange={(e) => setContact(e.target.value)} /></Field>
          <Field label="Extra completion outcomes" error={errors.completionOutcomes} hint="Example: REFERRED, TREATMENT_DONE"><TextInput value={completion} disabled={ro} onChange={(e) => setCompletion(e.target.value)} /></Field>
        </CardBody></Card>
      <Card><CardHeader title="Patient messaging" description="Not available yet. Contacts are logged manually; no WhatsApp, SMS or email is sent by the system." />
        <CardBody className="flex flex-wrap gap-2">{(["whatsapp", "sms", "email"] as const).map((k) => <StatusBadge key={k} tone={s.integrations[k] ? "success" : "neutral"}>{pretty(k)}: {s.integrations[k] ? "connected" : "integration not configured"}</StatusBadge>)}</CardBody></Card>
      {!ro && <div><Button onClick={save} loading={busy}>Save rules</Button></div>}
    </div>
  );
}
