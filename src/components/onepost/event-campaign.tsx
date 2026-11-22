"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Field, Input, Modal, Select, Textarea } from "@/components/ds";
import { apiFetch } from "@/lib/client-api";
import { LANGUAGES, TONES } from "@/lib/onepost";
import { EVENT_PHASES } from "@/lib/onepost-event";

type Created = { groupId: string; posts: { id: string; phase: string }[] };
const EMPTY = { eventName: "", eventDate: "", eventPlace: "", highlights: "", city: "", language: "en", tone: "friendly" };

/** Creates the five event posts, then writes each one in turn so the person sees progress. Nothing is published. */
export function EventCampaignModal({ orgId, open, onClose }: { orgId: string; open: boolean; onClose: () => void }) {
  const base = `/api/organizations/${orgId}/onepost`;
  const router = useRouter();
  const [f, setF] = React.useState(EMPTY);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [error, setError] = React.useState("");
  const [step, setStep] = React.useState<{ done: number; total: number; label: string } | null>(null);
  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF((s) => ({ ...s, [k]: e.target.value }));

  async function go() {
    setErrors({});
    setError("");
    setStep({ done: 0, total: EVENT_PHASES.length, label: "Creating the posts…" });
    const r = await apiFetch<Created>(`${base}/events`, { method: "POST", body: f });
    if (!r.ok) {
      setStep(null);
      setErrors(Object.fromEntries(Object.entries(r.details ?? {}).map(([k, v]) => [k, v[0] ?? ""])));
      return setError(r.error);
    }
    let failed = 0;
    for (const [i, p] of r.data.posts.entries()) {
      const label = EVENT_PHASES.find((x) => x.key === p.phase)?.label ?? p.phase;
      setStep({ done: i, total: r.data.posts.length, label: `Writing: ${label}…` });
      const g = await apiFetch(`${base}/posts/${p.id}/generate`, { method: "POST", body: {} });
      if (!g.ok) failed++;
    }
    setStep(null);
    setF(EMPTY);
    onClose();
    router.push(`/onepost/${r.data.posts[0].id}${failed ? "?note=some" : ""}`);
  }

  return (
    <Modal
      open={open}
      onClose={() => (step ? undefined : onClose())}
      title="New event campaign"
      description="One event becomes five drafts: teaser, live update, recap blog, gallery post and press release. You approve each one before anything goes out."
      footer={<><Button variant="ghost" disabled={Boolean(step)} onClick={onClose}>Cancel</Button><Button onClick={() => void go()} loading={Boolean(step)}>Create and write</Button></>}
    >
      <form onSubmit={(e) => { e.preventDefault(); void go(); }} className="space-y-3">
        {error && !Object.keys(errors).length ? <Alert tone="danger">{error}</Alert> : null}
        {step ? <Alert tone="info">{step.label} ({step.done}/{step.total})</Alert> : null}
        <Field id="ev-name" label="Event name" error={errors.eventName}><Input value={f.eventName} onChange={set("eventName")} placeholder="Winter Health Camp" /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="ev-date" label="Date (India time)" error={errors.eventDate}><Input type="date" value={f.eventDate} onChange={set("eventDate")} /></Field>
          <Field id="ev-city" label="City" error={errors.city}><Input value={f.city} onChange={set("city")} /></Field>
        </div>
        <Field id="ev-place" label="Place" error={errors.eventPlace}><Input value={f.eventPlace} onChange={set("eventPlace")} placeholder="Mehta Clinic, Mall Road" /></Field>
        <Field id="ev-hl" label="What will happen" hint="Only facts you write here are used. Nothing is invented." error={errors.highlights}><Textarea rows={4} value={f.highlights} onChange={set("highlights")} /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="ev-lang" label="Language"><Select value={f.language} onChange={set("language")}>{LANGUAGES.map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}</Select></Field>
          <Field id="ev-tone" label="Tone"><Select value={f.tone} onChange={set("tone")}>{TONES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</Select></Field>
        </div>
      </form>
    </Modal>
  );
}
