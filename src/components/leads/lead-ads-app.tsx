"use client";

import * as React from "react";
import { Megaphone, Pause, Play, Send, Trash2 } from "lucide-react";
import { Alert, Badge, Button, Card, CardBody, CardHeader, Checkbox, ConfirmationDialog, EmptyState, ErrorState, Field, Input, LoadingState, Modal, PageHeader, Select, useToast } from "@/components/ds";
import { apiFetch } from "@/lib/client-api";
import { siteConfig } from "@/config/site";
import { istFmt } from "@/components/campaigns/types";

type Mapping = { source: "static"; value: string } | { source: "field"; field: string; key: string; fallback: string };
type Source = {
  id: string;
  name: string;
  pageId: string;
  formId: string;
  tokenLast4: string;
  whatsappAccountId: string;
  templateId: string | null;
  variables: Record<string, Mapping>;
  consentConfirmed: boolean;
  status: "active" | "paused";
  leadsCount: number;
  lastLeadAt: string | null;
};
type Lead = { id: string; status: string; error: string; isTest: boolean; createdAt: string };
type Template = { id: string; name: string; category: string; status: string; slots: { key: string; label: string; part: string; kind: string }[]; waba: { id: string } };
type Waba = { id: string; name: string; accounts: { id: string; displayName: string; phoneNumber: string }[] };

const LEAD_TONE: Record<string, "success" | "warning" | "danger" | "neutral"> = { messaged: "success", skipped: "warning", failed: "danger", received: "neutral" };
const FIELD_CHOICES = [
  { value: "first_name", label: "Lead's first name" },
  { value: "name", label: "Lead's full name" },
  { value: "phone", label: "Lead's phone" },
  { value: "email", label: "Lead's email" },
  { value: "static", label: "Fixed text" },
];

export function LeadAdsApp({ orgId, canManage }: { orgId: string; canManage: boolean }) {
  const base = `/api/organizations/${orgId}`;
  const toast = useToast();
  const [sources, setSources] = React.useState<Source[] | null>(null);
  const [wabas, setWabas] = React.useState<Waba[]>([]);
  const [templates, setTemplates] = React.useState<Template[]>([]);
  const [error, setError] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const [testing, setTesting] = React.useState<Source | null>(null);
  const [removing, setRemoving] = React.useState<Source | null>(null);
  const [leadsFor, setLeadsFor] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    const [s, t] = await Promise.all([apiFetch<{ sources: Source[] }>(`${base}/lead-sources`), apiFetch<{ templates: Template[]; accounts: Waba[] }>(`${base}/templates?status=approved`)]);
    if (!s.ok) return setError(s.error);
    setError("");
    setSources(s.data.sources);
    if (t.ok) {
      setTemplates(t.data.templates.filter((x) => x.category !== "AUTHENTICATION"));
      setWabas(t.data.accounts);
    }
  }, [base]);
  React.useEffect(() => {
    const id = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(id);
  }, [load]);

  async function toggle(s: Source) {
    const r = await apiFetch(`${base}/lead-sources/${s.id}`, { method: "PATCH", body: { status: s.status === "active" ? "paused" : "active" } });
    if (!r.ok) return toast(r.error, "error");
    void load();
  }
  async function remove() {
    if (!removing) return;
    const r = await apiFetch(`${base}/lead-sources/${removing.id}`, { method: "DELETE" });
    setRemoving(null);
    if (!r.ok) return toast(r.error, "error");
    toast("Lead source removed");
    void load();
  }

  if (error) return <ErrorState description={error} onRetry={load} />;
  if (!sources) return <LoadingState />;
  const numbers = wabas.flatMap((w) => w.accounts.map((a) => ({ ...a, wabaId: w.id })));
  return (
    <>
      <PageHeader
        title="Lead Ads"
        description="Facebook and Instagram lead forms become WhatsApp contacts, and get a reply within seconds."
        actions={
          canManage ? (
            <Button onClick={() => setOpen(true)} disabled={!numbers.length}>
              Connect a Page
            </Button>
          ) : null
        }
      />
      {!numbers.length ? <Alert tone="warning" className="mb-4">Connect a WhatsApp number and get a template approved first.</Alert> : null}
      <Card className="mb-4">
        <CardHeader title="How it works" />
        <CardBody>
          <ol className="list-decimal space-y-1.5 pl-5 text-small text-app-muted">
            <li>Someone submits your lead form on Facebook or Instagram.</li>
            <li>Meta tells MECGURA. The lead is saved as a contact, marked as opted in by the form you confirmed.</li>
            <li>The approved WhatsApp template you choose is sent to them right away.</li>
          </ol>
          <p className="mt-3 text-small text-app-muted">
            In your Meta app, add the <strong>Page</strong> webhook with callback <code className="rounded bg-app-hover px-1">{siteConfig.url}/api/webhooks/meta</code> and subscribe to <strong>leadgen</strong>. The Page access token needs the <code className="rounded bg-app-hover px-1">leads_retrieval</code> permission.
          </p>
        </CardBody>
      </Card>

      {sources.length === 0 ? (
        <Card>
          <EmptyState icon={Megaphone} title="No lead forms connected" description="Connect a Facebook Page to start turning leads into WhatsApp conversations." />
        </Card>
      ) : (
        <div className="space-y-3">
          {sources.map((s) => {
            const num = numbers.find((n) => n.id === s.whatsappAccountId);
            const tpl = templates.find((t) => t.id === s.templateId);
            return (
              <Card key={s.id}>
                <CardBody>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 font-semibold text-app-text">
                        {s.name} <Badge tone={s.status === "active" ? "success" : "neutral"}>{s.status === "active" ? "Active" : "Paused"}</Badge>
                      </p>
                      <p className="mt-1 text-small text-app-muted">
                        Page {s.pageId}
                        {s.formId ? ` · form ${s.formId}` : " · every form"} · token …{s.tokenLast4}
                      </p>
                      <p className="mt-1 text-small text-app-muted">
                        Replies from {num ? `${num.displayName} (${num.phoneNumber})` : "a number"} {tpl ? `with “${tpl.name}”` : s.templateId ? "with a template" : "— no reply, contacts only"}
                      </p>
                      <p className="mt-1 text-small text-app-muted">
                        {s.leadsCount} lead{s.leadsCount === 1 ? "" : "s"}
                        {s.lastLeadAt ? ` · last ${istFmt.format(new Date(s.lastLeadAt))}` : ""}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="secondary" onClick={() => setLeadsFor(leadsFor === s.id ? null : s.id)}>
                        Recent leads
                      </Button>
                      {canManage ? (
                        <>
                          <Button size="sm" variant="secondary" onClick={() => setTesting(s)}>
                            <Send aria-hidden="true" /> Test
                          </Button>
                          <Button size="sm" variant="secondary" onClick={() => void toggle(s)}>
                            {s.status === "active" ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />} {s.status === "active" ? "Pause" : "Resume"}
                          </Button>
                          <Button size="sm" variant="danger" onClick={() => setRemoving(s)}>
                            <Trash2 aria-hidden="true" /> Remove
                          </Button>
                        </>
                      ) : null}
                    </div>
                  </div>
                  {leadsFor === s.id ? <RecentLeads base={base} id={s.id} /> : null}
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}

      <ConnectModal open={open} onClose={() => setOpen(false)} base={base} wabas={wabas} templates={templates} onDone={() => { setOpen(false); void load(); }} />
      <TestModal source={testing} base={base} onClose={() => setTesting(null)} onDone={() => void load()} />
      <ConfirmationDialog open={Boolean(removing)} onClose={() => setRemoving(null)} onConfirm={() => void remove()} title="Remove this lead form?" description="New leads from this Page stop arriving in MECGURA. Contacts already saved stay." confirmLabel="Remove" />
    </>
  );
}

function RecentLeads({ base, id }: { base: string; id: string }) {
  const [leads, setLeads] = React.useState<Lead[] | null>(null);
  React.useEffect(() => {
    let off = false;
    void apiFetch<{ leads: Lead[] }>(`${base}/lead-sources/${id}/leads`).then((r) => {
      if (!off && r.ok) setLeads(r.data.leads);
    });
    return () => {
      off = true;
    };
  }, [base, id]);
  if (!leads) return <p className="mt-3 text-small text-app-muted">Loading…</p>;
  if (!leads.length) return <p className="mt-3 text-small text-app-muted">No leads yet.</p>;
  return (
    <ul className="mt-3 divide-y divide-app-border rounded-lg border border-app-border">
      {leads.map((l) => (
        <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-small">
          <span className="flex items-center gap-2">
            <Badge tone={LEAD_TONE[l.status] ?? "neutral"}>{l.status}</Badge>
            {l.isTest ? <Badge tone="info">test</Badge> : null}
            <span className="text-app-muted">{l.error}</span>
          </span>
          <span className="text-app-subtle">{istFmt.format(new Date(l.createdAt))}</span>
        </li>
      ))}
    </ul>
  );
}

function TestModal({ source, base, onClose, onDone }: { source: Source | null; base: string; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [phone, setPhone] = React.useState("");
  const [name, setName] = React.useState("Test lead");
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState("");
  if (!source) return null;
  async function run() {
    setBusy(true);
    setResult("");
    const r = await apiFetch<{ result: { status: string; error?: string } }>(`${base}/lead-sources/${source!.id}/test`, { method: "POST", body: { phone, name } });
    setBusy(false);
    if (!r.ok) return toast(r.details ? Object.values(r.details).flat()[0] ?? r.error : r.error, "error");
    setResult(r.data.result.status === "messaged" ? "Sent. Check that phone's WhatsApp." : `${r.data.result.status}: ${r.data.result.error || ""}`);
    onDone();
  }
  return (
    <Modal open onClose={onClose} title="Send a test lead" description="Runs a made-up lead through the real flow. If a reply template is set, it really messages this number.">
      <div className="space-y-4">
        <Field id="tl-phone" label="Phone number">
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="9876543210" inputMode="tel" />
        </Field>
        <Field id="tl-name" label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
        </Field>
        {result ? <Alert tone="info">{result}</Alert> : null}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button loading={busy} onClick={() => void run()} disabled={phone.trim().length < 8}>
            Send test lead
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function ConnectModal({ open, onClose, base, wabas, templates, onDone }: { open: boolean; onClose: () => void; base: string; wabas: Waba[]; templates: Template[]; onDone: () => void }) {
  const toast = useToast();
  const numbers = wabas.flatMap((w) => w.accounts.map((a) => ({ ...a, wabaId: w.id })));
  const [f, setF] = React.useState({ name: "", pageId: "", pageAccessToken: "", formId: "", accountId: "", templateId: "", consent: false });
  const [choices, setChoices] = React.useState<Record<string, { field: string; text: string }>>({});
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);
  const accountId = f.accountId || numbers[0]?.id || "";
  const wabaId = numbers.find((n) => n.id === accountId)?.wabaId;
  const usable = templates.filter((t) => t.waba.id === wabaId);
  const tpl = usable.find((t) => t.id === f.templateId);

  async function save() {
    const variables: Record<string, Mapping> = {};
    for (const s of tpl?.slots ?? []) {
      const c = choices[s.key] ?? { field: "first_name", text: "" };
      variables[s.key] = c.field === "static" ? { source: "static", value: c.text } : { source: "field", field: c.field, key: "", fallback: c.field === "first_name" ? "there" : "" };
    }
    setBusy(true);
    setErrors({});
    const r = await apiFetch(`${base}/lead-sources`, {
      method: "POST",
      body: { name: f.name, pageId: f.pageId, pageAccessToken: f.pageAccessToken, formId: f.formId, whatsappAccountId: accountId, templateId: f.templateId || null, variables, consentConfirmed: f.consent },
    });
    setBusy(false);
    if (!r.ok) {
      const first = r.details ? Object.fromEntries(Object.entries(r.details).map(([k, v]) => [k, (v ?? [])[0] ?? ""])) : {};
      setErrors({ ...first, form: r.error });
      return;
    }
    toast("Page connected");
    setF({ name: "", pageId: "", pageAccessToken: "", formId: "", accountId: "", templateId: "", consent: false });
    onDone();
  }

  return (
    <Modal open={open} onClose={onClose} title="Connect a Facebook Page" size="lg">
      <div className="space-y-4">
        {errors.form ? <Alert tone="danger">{errors.form}</Alert> : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="la-name" label="Name (for you)">
            <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Diwali offer leads" />
          </Field>
          <Field id="la-page" label="Facebook Page ID" error={errors.pageId}>
            <Input value={f.pageId} onChange={(e) => setF({ ...f, pageId: e.target.value })} inputMode="numeric" />
          </Field>
          <Field id="la-token" label="Page access token" error={errors.pageAccessToken} hint="Stored encrypted, never shown again.">
            <Input type="password" autoComplete="off" value={f.pageAccessToken} onChange={(e) => setF({ ...f, pageAccessToken: e.target.value })} />
          </Field>
          <Field id="la-form" label="Form ID (optional)" error={errors.formId} hint="Empty = every form on the Page.">
            <Input value={f.formId} onChange={(e) => setF({ ...f, formId: e.target.value })} inputMode="numeric" />
          </Field>
          <Field id="la-num" label="Reply from">
            <Select value={accountId} onChange={(e) => setF({ ...f, accountId: e.target.value, templateId: "" })}>
              {numbers.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.displayName} · {n.phoneNumber}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="la-tpl" label="Reply template" error={errors.templateId} hint="Approved marketing or utility templates only.">
            <Select value={f.templateId} onChange={(e) => setF({ ...f, templateId: e.target.value })}>
              <option value="">No reply (save contacts only)</option>
              {usable.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.category.toLowerCase()})
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {tpl?.slots.length ? (
          <div>
            <p className="mb-2 text-small font-medium text-app-text">What goes in each template variable</p>
            {errors.variables ? <p className="mb-2 text-small text-red-500">{errors.variables}</p> : null}
            <div className="space-y-2">
              {tpl.slots.map((s) => {
                const c = choices[s.key] ?? { field: "first_name", text: "" };
                return (
                  <div key={s.key} className="grid gap-2 sm:grid-cols-[10rem_1fr_1fr] sm:items-center">
                    <span className="text-small text-app-muted">{s.label}</span>
                    <Select aria-label={`Value for ${s.label}`} value={c.field} onChange={(e) => setChoices({ ...choices, [s.key]: { ...c, field: e.target.value } })}>
                      {FIELD_CHOICES.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </Select>
                    {c.field === "static" ? <Input aria-label={`Text for ${s.label}`} value={c.text} onChange={(e) => setChoices({ ...choices, [s.key]: { ...c, text: e.target.value } })} /> : <span />}
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}
        <Checkbox
          checked={f.consent}
          onChange={(e) => setF({ ...f, consent: e.target.checked })}
          label="My lead form clearly asks permission to message people on WhatsApp"
          description="Leads from this form are recorded as opted in. If your form doesn't ask, don't connect it."
        />
        {errors.consentConfirmed ? <p className="text-small text-red-500">{errors.consentConfirmed}</p> : null}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={busy} onClick={() => void save()} disabled={!f.pageId || !f.pageAccessToken || !f.consent}>
            Connect
          </Button>
        </div>
      </div>
    </Modal>
  );
}
