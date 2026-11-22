"use client";

import * as React from "react";
import { CheckCircle2, MessageSquareWarning } from "lucide-react";
import { Alert, Button, Field, Input, Textarea } from "@/components/ds";
import { apiFetch } from "@/lib/client-api";
import { CHANNELS, type Channel } from "@/lib/onepost";
import { ChannelPreview } from "@/components/onepost/previews";

export type ReviewView = {
  business: string;
  website: string;
  title: string;
  expiresAt: string;
  versions: { channel: Channel; content: unknown }[];
  media: { id: string; kind: "image" | "video"; name: string; url: string }[];
};

/** What a client sees at their private link: every version as it will look, and two buttons. No login. */
export function ReviewClient({ token, view }: { token: string; view: ReviewView }) {
  const [name, setName] = React.useState("");
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState<"" | "approved" | "changes_requested">("");
  const [done, setDone] = React.useState<"" | "approved" | "changes_requested">("");
  const [error, setError] = React.useState("");
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const images = view.media.filter((m) => m.kind === "image").map((m) => m.url);
  const brand = { businessName: view.business, logoUrl: null, website: view.website };
  const by = new Map(view.versions.map((v) => [v.channel, v.content]));

  async function send(decision: "approved" | "changes_requested") {
    setBusy(decision);
    setError("");
    setErrors({});
    const r = await apiFetch(`/api/onepost-review/${token}`, { method: "POST", body: { decision, name, note } });
    setBusy("");
    if (!r.ok) {
      setError(r.details ? "Please fix the highlighted fields." : r.error);
      return setErrors(Object.fromEntries(Object.entries(r.details ?? {}).map(([k, v]) => [k, v[0] ?? ""])));
    }
    setDone(decision);
  }

  if (done) {
    return (
      <div className="mx-auto max-w-xl py-16 text-center">
        <CheckCircle2 className="mx-auto size-10 text-green-300" aria-hidden="true" />
        <h1 className="mt-4 text-h2 text-app-text">{done === "approved" ? "Thank you. Approved." : "Thank you. Your changes were sent."}</h1>
        <p className="mt-2 text-body text-app-muted">{done === "approved" ? `${view.business || "The team"} has been told this post is approved.` : `${view.business || "The team"} will update the post and may send you a new link.`}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header>
        <p className="text-small text-app-muted">{view.business}</p>
        <h1 className="text-h1 text-app-text">{view.title}</h1>
        <p className="mt-1 text-body text-app-muted">Please look at each version below. You can approve everything, or ask for changes. Nothing is published until the team does it, after your answer.</p>
      </header>

      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {CHANNELS.filter((c) => by.has(c.key)).map((c) => (
          <section key={c.key} aria-label={c.label} className="min-w-0 space-y-2 rounded-[var(--radius-card)] border border-app-border bg-app-elevated/40 p-3">
            <h2 className="text-body font-semibold text-app-text">{c.label}</h2>
            <ChannelPreview channel={c.key} content={by.get(c.key)} brand={brand} images={images} />
          </section>
        ))}
      </div>

      {view.media.some((m) => m.kind === "video") ? <p className="text-small text-app-muted">This post also has a video, which will be posted where the channel supports it.</p> : null}

      <section className="glass max-w-xl space-y-4 rounded-[var(--radius-card)] p-5" aria-label="Your answer">
        <h2 className="text-h3 text-app-text">Your answer</h2>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <Field id="rv-name" label="Your name" error={errors.name}>
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoComplete="name" />
        </Field>
        <Field id="rv-note" label="Comments (needed if you want changes)" error={errors.note}>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={4} />
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void send("approved")} loading={busy === "approved"} disabled={Boolean(busy) || name.trim().length < 2}>
            <CheckCircle2 aria-hidden="true" /> Approve
          </Button>
          <Button variant="secondary" onClick={() => void send("changes_requested")} loading={busy === "changes_requested"} disabled={Boolean(busy) || name.trim().length < 2 || !note.trim()}>
            <MessageSquareWarning aria-hidden="true" /> Ask for changes
          </Button>
        </div>
        <p className="text-caption text-app-subtle">This link works once and expires on {new Date(view.expiresAt).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}.</p>
      </section>
    </div>
  );
}
