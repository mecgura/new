"use client";

import * as React from "react";
import Link from "next/link";
import { Download, Newspaper, Pencil, Plus, Trash2, Upload } from "lucide-react";
import { Alert, Badge, Button, Card, CardBody, CardHeader, ConfirmationDialog, EmptyState, ErrorState, Field, Input, LoadingState, Modal, Textarea, useToast } from "@/components/ds";
import { apiFetch } from "@/lib/client-api";
import type { ContactDto } from "@/services/onepost/pr";

type Release = { postId: string; title: string; headline: string; status: string; approved: boolean; updatedAt: string; stats: { sent: number; opened: number; covered: number } };
type Form = { id?: string; name: string; outlet: string; email: string; city: string; beat: string };
const EMPTY: Form = { name: "", outlet: "", email: "", city: "", beat: "" };
const SAMPLE = "name,outlet,email,city,beat\nAnu Sharma,Shimla Times,anu@example.com,Shimla,Health\n";

/** Press releases, journalist contacts and how each release did. Emailing happens from a post, after approval. */
export function PrPanel({ orgId, canManage }: { orgId: string; canManage: boolean }) {
  const base = `/api/organizations/${orgId}/onepost`;
  const toast = useToast();
  const [releases, setReleases] = React.useState<{ releases: Release[]; emailReady: boolean } | null>(null);
  const [contacts, setContacts] = React.useState<ContactDto[] | null>(null);
  const [error, setError] = React.useState("");
  const [form, setForm] = React.useState<Form | null>(null);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);
  const [csv, setCsv] = React.useState<string | null>(null);
  const [removing, setRemoving] = React.useState<ContactDto | null>(null);

  const load = React.useCallback(async () => {
    const [r, c] = await Promise.all([apiFetch<{ releases: Release[]; emailReady: boolean }>(`${base}/pr/releases`), apiFetch<{ contacts: ContactDto[] }>(`${base}/pr/contacts`)]);
    if (!r.ok) return setError(r.error);
    if (!c.ok) return setError(c.error);
    setError("");
    setReleases(r.data);
    setContacts(c.data.contacts);
  }, [base]);
  React.useEffect(() => {
    const id = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(id);
  }, [load]);

  async function save() {
    if (!form) return;
    setBusy(true);
    setErrors({});
    const { id, ...body } = form;
    const r = await apiFetch(id ? `${base}/pr/contacts/${id}` : `${base}/pr/contacts`, { method: id ? "PATCH" : "POST", body });
    setBusy(false);
    if (!r.ok) return setErrors({ ...Object.fromEntries(Object.entries(r.details ?? {}).map(([k, v]) => [k, v[0] ?? ""])), form: r.error });
    setForm(null);
    void load();
  }
  async function importCsv() {
    if (csv === null) return;
    setBusy(true);
    const r = await apiFetch<{ added: number; updated: number; skipped: { row: number; reason: string }[] }>(`${base}/pr/contacts/import`, { method: "POST", body: { csv } });
    setBusy(false);
    if (!r.ok) return toast(r.error, "error");
    setCsv(null);
    toast(`${r.data.added} added, ${r.data.updated} updated${r.data.skipped.length ? `, ${r.data.skipped.length} skipped (row ${r.data.skipped.map((s) => s.row).join(", ")})` : ""}`, r.data.skipped.length ? "error" : "success");
    void load();
  }
  async function remove() {
    if (!removing) return;
    setBusy(true);
    const r = await apiFetch(`${base}/pr/contacts/${removing.id}`, { method: "DELETE" });
    setBusy(false);
    if (!r.ok) return toast(r.error, "error");
    setRemoving(null);
    void load();
  }
  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => (f ? { ...f, [k]: e.target.value } : f));

  if (error) return <ErrorState description={error} onRetry={load} />;
  if (!releases || !contacts) return <LoadingState label="Loading PR…" />;

  return (
    <div className="mt-5 space-y-4">
      {!releases.emailReady ? <Alert tone="warning" title="Email sending isn't set up">You can still write and download press releases. To email journalists, MECGURA needs to add RESEND_API_KEY and EMAIL_FROM on the server.</Alert> : null}

      <Card>
        <CardHeader title="Press releases" description="Open a post and write its Press release and Journalist pitch email versions. Emailing happens from the post, after approval." />
        <CardBody>
          {!releases.releases.length ? (
            <EmptyState icon={Newspaper} title="No press releases yet" description="Create a post of type “News” or an Event Mode campaign. The press release is written with the other versions." />
          ) : (
            <ul className="space-y-2">
              {releases.releases.map((r) => (
                <li key={r.postId} className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-control)] border border-app-border p-3">
                  <div className="min-w-0">
                    <Link href={`/onepost/${r.postId}`} className="break-words text-body font-medium text-app-text hover:underline">{r.headline}</Link>
                    <p className="mt-1 flex flex-wrap items-center gap-2 text-caption text-app-subtle">
                      <Badge tone={r.approved ? "success" : "neutral"} dot>{r.approved ? "Approved" : "Not approved yet"}</Badge>
                      Emailed {r.stats.sent} · opened {r.stats.opened} · covered {r.stats.covered}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <a href={`${base}/posts/${r.postId}/press/export?format=docx`}><Button size="sm" variant="secondary" type="button" tabIndex={-1}><Download aria-hidden="true" /> Word</Button></a>
                    <a href={`${base}/posts/${r.postId}/press/export?format=pdf`}><Button size="sm" variant="secondary" type="button" tabIndex={-1}><Download aria-hidden="true" /> PDF</Button></a>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Media contacts"
          description="Journalists and editors you have a reason to write to. People who unsubscribe are never emailed again."
          action={
            canManage ? (
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => setCsv("")}><Upload aria-hidden="true" /> Import CSV</Button>
                <Button onClick={() => { setForm(EMPTY); setErrors({}); }}><Plus aria-hidden="true" /> Add</Button>
              </div>
            ) : null
          }
        />
        <CardBody>
          {!contacts.length ? (
            <p className="text-small text-app-muted">No contacts yet.</p>
          ) : (
            <ul className="divide-y divide-app-border">
              {contacts.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <div className="min-w-0 text-small">
                    <p className="font-medium text-app-text">{c.name}{c.outlet ? <span className="font-normal text-app-muted"> · {c.outlet}</span> : null} {c.optedOut ? <Badge tone="warning">Unsubscribed</Badge> : null}</p>
                    <p className="break-all text-caption text-app-subtle">{c.email}{c.city ? ` · ${c.city}` : ""}{c.beat ? ` · ${c.beat}` : ""}</p>
                  </div>
                  {canManage ? (
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" aria-label={`Edit ${c.name}`} onClick={() => { setForm({ id: c.id, name: c.name, outlet: c.outlet, email: c.email, city: c.city, beat: c.beat }); setErrors({}); }}><Pencil aria-hidden="true" /></Button>
                      <Button size="sm" variant="ghost" aria-label={`Delete ${c.name}`} onClick={() => setRemoving(c)}><Trash2 aria-hidden="true" /></Button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Modal open={Boolean(form)} onClose={() => setForm(null)} title={form?.id ? "Edit contact" : "Add a media contact"} footer={<><Button variant="ghost" onClick={() => setForm(null)}>Cancel</Button><Button onClick={() => void save()} loading={busy}>Save</Button></>}>
        {form ? (
          <form onSubmit={(e) => { e.preventDefault(); void save(); }} className="space-y-3">
            {errors.form && !Object.keys(errors).some((k) => k !== "form") ? <Alert tone="danger">{errors.form}</Alert> : null}
            <Field id="pc-name" label="Name" error={errors.name}><Input value={form.name} onChange={set("name")} /></Field>
            <Field id="pc-email" label="Email" error={errors.email}><Input type="email" value={form.email} onChange={set("email")} /></Field>
            <Field id="pc-outlet" label="Newspaper / channel" error={errors.outlet}><Input value={form.outlet} onChange={set("outlet")} /></Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field id="pc-city" label="City" error={errors.city}><Input value={form.city} onChange={set("city")} /></Field>
              <Field id="pc-beat" label="Covers" error={errors.beat}><Input value={form.beat} onChange={set("beat")} placeholder="Health, business…" /></Field>
            </div>
          </form>
        ) : null}
      </Modal>

      <Modal open={csv !== null} onClose={() => setCsv(null)} title="Import media contacts" description="Paste CSV with the first row: name, outlet, email, city, beat. Existing emails are updated." footer={<><Button variant="ghost" onClick={() => setCsv(null)}>Cancel</Button><Button onClick={() => void importCsv()} loading={busy} disabled={!csv?.trim()}>Import</Button></>}>
        <Field id="pc-csv" label="CSV">
          <Textarea rows={8} value={csv ?? ""} onChange={(e) => setCsv(e.target.value)} placeholder={SAMPLE} />
        </Field>
      </Modal>

      <ConfirmationDialog open={Boolean(removing)} onClose={() => setRemoving(null)} onConfirm={() => void remove()} loading={busy} title={`Delete ${removing?.name ?? ""}?`} description="Their sent-email history for past releases is removed too." confirmLabel="Delete" />
    </div>
  );
}
