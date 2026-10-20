"use client";

import * as React from "react";
import { Phone } from "lucide-react";
import { Alert, Badge, Button, Card, CardBody, EmptyState, ErrorState, Field, Input, LoadingState, Modal, PageHeader, Select, Textarea, useToast } from "@/components/ds";
import { apiFetch } from "@/lib/client-api";
import { istFmt } from "@/components/campaigns/types";

type Turn = { role: string; text: string };
type Call = { id: string; mode: string; status: string; goal: string; summary: string; outcome: string; durationSec: number; error: string; createdAt: string; transcript: Turn[]; consentNote: string; contact: { id: string; name: string; phone: string } };
type Contact = { id: string; name: string; phone: string };

const OUTCOME: Record<string, string> = { interested: "Interested", callback: "Call back", not_interested: "Not interested", no_answer: "No answer" };
const TONE: Record<string, "success" | "warning" | "danger" | "neutral"> = { completed: "success", in_progress: "neutral", queued: "neutral", no_answer: "warning", failed: "danger" };

export function VoiceApp({ orgId, canManage, initialPhone = "" }: { orgId: string; canManage: boolean; initialPhone?: string }) {
  const base = `/api/organizations/${orgId}`;
  const [calls, setCalls] = React.useState<Call[] | null>(null);
  const [live, setLive] = React.useState(false);
  const [note, setNote] = React.useState("");
  const [error, setError] = React.useState("");
  const [open, setOpen] = React.useState(Boolean(initialPhone) && canManage);
  const [expanded, setExpanded] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    const r = await apiFetch<{ calls: Call[]; status: { live: boolean; note: string } }>(`${base}/voice/calls`);
    if (!r.ok) return setError(r.error);
    setError("");
    setCalls(r.data.calls);
    setLive(r.data.status.live);
    setNote(r.data.status.note);
  }, [base]);
  React.useEffect(() => {
    const id = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(id);
  }, [load]);

  if (error) return <ErrorState description={error} onRetry={load} />;
  if (!calls) return <LoadingState />;
  return (
    <>
      <PageHeader title="AI Calling" description="An AI agent phones a contact with a goal, then saves the transcript and a summary." actions={canManage ? <Button onClick={() => setOpen(true)}>New call</Button> : null} />
      {!live ? (
        <Alert tone="warning" className="mb-4" title="Practice mode: nobody is phoned">
          {note} Practice calls show exactly what a finished call record looks like (transcript, summary, outcome). Calls become real once MECGURA connects a voice provider, and only for contacts who agreed to be called.
        </Alert>
      ) : null}
      {calls.length === 0 ? (
        <Card>
          <EmptyState icon={Phone} title="No calls yet" description="Start a practice call to see how the transcript and summary look." />
        </Card>
      ) : (
        <div className="space-y-3">
          {calls.map((c) => (
            <Card key={c.id}>
              <CardBody>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 font-semibold text-app-text">
                      {c.contact.name || c.contact.phone}
                      <Badge tone={TONE[c.status] ?? "neutral"}>{c.status.replace("_", " ")}</Badge>
                      {c.mode === "demo" ? <Badge tone="warning">Practice</Badge> : <Badge tone="success">Live</Badge>}
                      {c.outcome ? <Badge tone="neutral">{OUTCOME[c.outcome] ?? c.outcome}</Badge> : null}
                    </p>
                    <p className="mt-1 text-small text-app-muted">Goal: {c.goal}</p>
                    <p className="mt-1 text-small text-app-muted">
                      {istFmt.format(new Date(c.createdAt))}
                      {c.durationSec ? ` · ${c.durationSec}s` : ""}
                    </p>
                    {c.summary ? <p className="mt-2 text-small text-app-text">{c.summary}</p> : null}
                    {c.error ? <p className="mt-2 text-small text-red-600">{c.error}</p> : null}
                  </div>
                  {c.transcript.length ? (
                    <Button size="sm" variant="secondary" onClick={() => setExpanded(expanded === c.id ? null : c.id)}>
                      {expanded === c.id ? "Hide transcript" : "Transcript"}
                    </Button>
                  ) : null}
                </div>
                {expanded === c.id ? (
                  <ul className="mt-3 space-y-1.5 border-t border-app-border pt-3 text-small">
                    {c.transcript.map((t, i) => (
                      <li key={i}>
                        <strong>{t.role === "agent" ? "AI agent" : "Customer"}:</strong> {t.text}
                      </li>
                    ))}
                    <li className="pt-1 text-caption text-app-muted">Consent recorded: {c.consentNote}</li>
                  </ul>
                ) : null}
              </CardBody>
            </Card>
          ))}
        </div>
      )}
      <NewCallModal initialPhone={initialPhone} open={open} onClose={() => setOpen(false)} base={base} onDone={() => { setOpen(false); void load(); }} />
    </>
  );
}

function NewCallModal({ open, onClose, base, onDone, initialPhone = "" }: { open: boolean; onClose: () => void; base: string; onDone: () => void; initialPhone?: string }) {
  const toast = useToast();
  const [contacts, setContacts] = React.useState<Contact[]>([]);
  const [f, setF] = React.useState({ contactId: "", goal: "", script: "", language: "en", consentNote: "" });
  const [saving, setSaving] = React.useState(false);
  const [err, setErr] = React.useState<Record<string, string[]>>({});
  React.useEffect(() => {
    if (!open) return;
    const q = initialPhone ? `&q=${encodeURIComponent(initialPhone)}` : "";
    void apiFetch<{ items: Contact[] }>(`${base}/contacts?pageSize=100${q}`).then((r) => {
      if (!r.ok) return;
      const list = r.data.items.filter((c) => /^\+?\d{8,15}$/.test(c.phone));
      setContacts(list);
      const match = list.find((c) => c.phone === initialPhone);
      if (match) setF((x) => (x.contactId ? x : { ...x, contactId: match.id }));
    });
  }, [open, base, initialPhone]);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const r = await apiFetch(`${base}/voice/calls`, { method: "POST", body: f });
    setSaving(false);
    if (!r.ok) {
      setErr(r.details ?? {});
      return toast(r.error, "error");
    }
    setErr({});
    toast("Call recorded");
    onDone();
  }
  return (
    <Modal open={open} onClose={onClose} title="New AI call" description="Only call people who agreed to be called. Record who agreed and how.">
      <form onSubmit={submit} className="space-y-3">
        <Field id="vc-contact" label="Contact" error={err.contactId?.[0]}>
          <Select value={f.contactId} onChange={(e) => setF({ ...f, contactId: e.target.value })} required>
            <option value="">Choose a contact…</option>
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name || c.phone} ({c.phone})
              </option>
            ))}
          </Select>
        </Field>
        <Field id="vc-goal" label="Goal of the call" error={err.goal?.[0]}>
          <Input value={f.goal} onChange={(e) => setF({ ...f, goal: e.target.value })} placeholder="Confirm tomorrow's appointment" required />
        </Field>
        <Field id="vc-script" label="Opening line (optional)" error={err.script?.[0]}>
          <Textarea value={f.script} onChange={(e) => setF({ ...f, script: e.target.value })} rows={2} />
        </Field>
        <Field id="vc-lang" label="Language">
          <Select value={f.language} onChange={(e) => setF({ ...f, language: e.target.value })}>
            <option value="en">English</option>
            <option value="hi">Hindi</option>
            <option value="pa">Punjabi</option>
          </Select>
        </Field>
        <Field id="vc-consent" label="Consent to be called" error={err.consentNote?.[0]}>
          <Input value={f.consentNote} onChange={(e) => setF({ ...f, consentNote: e.target.value })} placeholder="Customer asked for a call on the enquiry form, 12 Oct" required />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={saving} disabled={!f.contactId}>Place call</Button>
        </div>
      </form>
    </Modal>
  );
}
