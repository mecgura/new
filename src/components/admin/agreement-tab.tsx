"use client";

import * as React from "react";
import Link from "next/link";
import { CheckCircle2, Copy, ExternalLink, FileText, Mail, MessageCircle, Pencil, Send, Trash2, Upload, XCircle } from "lucide-react";
import { Alert, Badge, Button, Card, CardBody, CardHeader, Checkbox, ConfirmationDialog, EmptyState, ErrorState, Field, Input, LoadingState, Select, Textarea, useToast } from "@/components/ds";
import { apiFetch, apiUpload } from "@/lib/client-api";
import { AgreementDocument, type Details, type ProviderView, type Section } from "@/components/agreements/agreement-document";
import { DOC_OPTIONS } from "@/components/agreements/agreement-signer";

type Channel = { sent: boolean; message: string; at: string };
type Doc = { id: string; kind: string; label: string; fileName: string; sizeBytes: number; status: string; note: string; uploadedBy: string; createdAt: string };
type Agreement = {
  id: string;
  number: string;
  version: number;
  status: string;
  link: string;
  manualWhatsApp: string;
  details: Details;
  sections: Section[] | null;
  signedText: string;
  provider: ProviderView;
  sentAt: string | null;
  sendLog: { whatsapp?: Channel; email?: Channel };
  viewedAt: string | null;
  signedAt: string | null;
  signerName: string;
  signerIp: string;
  signedHash: string;
  createdAt: string;
  documents: Doc[];
};
type WaStatus = { account: { id: string; label: string; status: string } | null; template: { id: string; status: string; rejectedReason: string } | null };

const STATUS: Record<string, { label: string; tone: "neutral" | "info" | "success" | "warning" | "danger" }> = {
  draft: { label: "Draft", tone: "neutral" },
  sent: { label: "Sent, waiting for client", tone: "info" },
  signed: { label: "Signed", tone: "success" },
  superseded: { label: "Replaced by newer version", tone: "warning" },
  void: { label: "Cancelled", tone: "danger" },
};
const when = (d: string | null) => (d ? new Date(d).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "—");
const rupees = (p: number) => (p ? String(p / 100) : "0");

/** Super Admin: the client's service agreement — edit details, send on WhatsApp + email, check documents, see signature. */
export function AgreementTab({ organizationId, onChanged }: { organizationId: string; onChanged?: () => void }) {
  const toast = useToast();
  const listUrl = `/api/admin/organizations/${organizationId}/agreements`;
  const [data, setData] = React.useState<{ agreements: Agreement[]; whatsapp: WaStatus } | null>(null);
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState("");
  const [editing, setEditing] = React.useState(false);
  const [confirmVoid, setConfirmVoid] = React.useState(false);

  const load = React.useCallback(async () => {
    const r = await apiFetch<{ agreements: Agreement[]; whatsapp: WaStatus }>(listUrl);
    if (!r.ok) return setError(r.error);
    setError("");
    setData(r.data);
  }, [listUrl]);

  React.useEffect(() => {
    const t = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(t);
  }, [load]);

  async function create() {
    setBusy("create");
    const r = await apiFetch(listUrl, { method: "POST" });
    setBusy("");
    if (!r.ok) return toast(r.error, "error");
    toast("Agreement created. Check the details, then send it.");
    void load();
  }

  if (error) return <ErrorState description={error} onRetry={load} />;
  if (!data) return <LoadingState label="Loading agreement…" />;
  const current = data.agreements.find((a) => a.status !== "superseded" && a.status !== "void") ?? data.agreements[0];
  const history = data.agreements.filter((a) => a.id !== current?.id);
  const waReady = data.whatsapp.template?.status === "approved";

  if (!current) {
    return (
      <EmptyState
        icon={FileText}
        title="No agreement yet"
        description="Create the service agreement. It is prefilled from this client's details, plan and services. You can correct anything before sending."
        action={<Button loading={busy === "create"} onClick={() => void create()}>Create agreement</Button>}
      />
    );
  }

  async function send(channels: { whatsapp: boolean; email: boolean }) {
    setBusy("send");
    const r = await apiFetch<{ log: { whatsapp?: Channel; email?: Channel } }>(`/api/admin/agreements/${current.id}/send`, { method: "POST", body: channels });
    setBusy("");
    if (!r.ok) return toast(r.error, "error");
    const parts = [r.data.log.whatsapp && `WhatsApp: ${r.data.log.whatsapp.message}`, r.data.log.email && `Email: ${r.data.log.email.message}`].filter(Boolean);
    toast(parts.join(" · ") || "Marked as sent", r.data.log.whatsapp?.sent === false || r.data.log.email?.sent === false ? "error" : "success");
    void load();
  }

  async function review(doc: Doc, status: "verified" | "rejected") {
    const note = status === "rejected" ? window.prompt("Why is it rejected? (the client sees this)", "Not clear, please upload again") ?? "" : "";
    setBusy(`doc:${doc.id}`);
    const r = await apiFetch(`/api/admin/agreements/documents/${doc.id}`, { method: "PATCH", body: { status, note } });
    setBusy("");
    if (!r.ok) return toast(r.error, "error");
    void load();
  }

  async function removeDoc(doc: Doc) {
    if (!window.confirm(`Delete ${doc.label}?`)) return;
    const r = await apiFetch(`/api/admin/agreements/documents/${doc.id}`, { method: "DELETE" });
    if (!r.ok) return toast(r.error, "error");
    void load();
  }

  async function voidIt() {
    setBusy("void");
    const r = await apiFetch(`/api/admin/agreements/${current.id}`, { method: "DELETE" });
    setBusy("");
    setConfirmVoid(false);
    if (!r.ok) return toast(r.error, "error");
    void load();
  }

  const st = STATUS[current.status] ?? STATUS.draft;
  const open = current.status === "draft" || current.status === "sent";
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title={
            <span className="flex flex-wrap items-center gap-2">
              {current.number} <span className="text-small font-normal text-app-muted">v{current.version}</span>
              <Badge tone={st.tone} dot>{st.label}</Badge>
            </span>
          }
          description={`Created ${when(current.createdAt)} · Sent ${when(current.sentAt)} · Opened ${when(current.viewedAt)} · Signed ${when(current.signedAt)}`}
          action={
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => void navigator.clipboard.writeText(current.link).then(() => toast("Link copied"))}>
                <Copy aria-hidden="true" /> Copy link
              </Button>
              <a href={current.link} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-control)] border border-app-border px-3 text-small text-app-text hover:bg-app-hover">
                <ExternalLink className="size-4" aria-hidden="true" /> Open
              </a>
            </div>
          }
        />
        <CardBody className="space-y-4">
          {current.status === "signed" ? (
            <Alert tone="success" title={`Signed by ${current.signerName}`}>
              {when(current.signedAt)} IST · IP {current.signerIp || "unknown"} · SHA-256 <span className="break-all font-mono text-[11px]">{current.signedHash}</span>
            </Alert>
          ) : null}
          {open ? (
            <>
              {!waReady ? (
                <Alert tone="warning" title="WhatsApp auto-send is not ready yet">
                  {data.whatsapp.account
                    ? `The agreement template on ${data.whatsapp.account.label} is ${data.whatsapp.template ? data.whatsapp.template.status : "not created"}. `
                    : "No MECGURA WhatsApp number is chosen to send from. "}
                  Set it up in <Link className="underline" href="/admin/agreements">Admin → Agreements</Link>. Until then use &quot;Send from my phone&quot;.
                </Alert>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <Button loading={busy === "send"} onClick={() => void send({ whatsapp: true, email: true })}>
                  <Send aria-hidden="true" /> {current.status === "sent" ? "Resend" : "Send"} on WhatsApp + email
                </Button>
                <Button variant="secondary" disabled={busy === "send"} onClick={() => void send({ whatsapp: false, email: true })}>
                  <Mail aria-hidden="true" /> Email only
                </Button>
                {current.manualWhatsApp ? (
                  <a
                    href={current.manualWhatsApp}
                    target="_blank"
                    rel="noreferrer"
                    onClick={() => current.status === "draft" && void send({ whatsapp: false, email: false })}
                    className="inline-flex h-10 items-center gap-2 rounded-[var(--radius-control)] border border-app-border px-4 text-body text-app-text hover:bg-app-hover"
                  >
                    <MessageCircle className="size-4" aria-hidden="true" /> Send from my phone
                  </a>
                ) : null}
              </div>
              {current.sendLog.whatsapp || current.sendLog.email ? (
                <ul className="space-y-1 text-small text-app-muted">
                  {current.sendLog.whatsapp ? <li>{current.sendLog.whatsapp.sent ? "✅" : "⚠️"} WhatsApp: {current.sendLog.whatsapp.message}</li> : null}
                  {current.sendLog.email ? <li>{current.sendLog.email.sent ? "✅" : "⚠️"} Email: {current.sendLog.email.message}</li> : null}
                </ul>
              ) : null}
            </>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {current.status !== "void" && current.status !== "superseded" ? (
              <Button variant="secondary" onClick={() => setEditing((e) => !e)}>
                <Pencil aria-hidden="true" /> {editing ? "Close editor" : current.status === "signed" ? "Correct details (new version)" : "Edit details"}
              </Button>
            ) : null}
            {open ? (
              <Button variant="ghost" onClick={() => setConfirmVoid(true)}>
                <XCircle aria-hidden="true" /> Cancel agreement
              </Button>
            ) : null}
            {current.status === "void" ? <Button loading={busy === "create"} onClick={() => void create()}>Create new agreement</Button> : null}
          </div>
        </CardBody>
      </Card>

      {editing ? (
        <DetailsEditor
          agreement={current}
          onSaved={() => {
            setEditing(false);
            void load();
            onChanged?.();
          }}
        />
      ) : null}

      <DocumentsCard agreement={current} busy={busy} onReview={review} onRemove={removeDoc} onUploaded={load} />

      <details className="group">
        <summary className="cursor-pointer select-none text-small font-semibold text-app-primary">Preview agreement</summary>
        <div className="mt-3">
          <AgreementDocument
            details={current.details}
            sections={current.sections}
            signedText={current.signedText}
            provider={current.provider}
            signed={current.status === "signed" && current.signedAt ? { name: current.signerName, at: current.signedAt, hash: current.signedHash } : null}
          />
        </div>
      </details>

      {history.length ? (
        <Card>
          <CardHeader title="Earlier versions" />
          <CardBody>
            <ul className="space-y-2 text-small">
              {history.map((h) => (
                <li key={h.id} className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-app-text">{h.number} v{h.version}</span>
                  <Badge tone={(STATUS[h.status] ?? STATUS.draft).tone}>{(STATUS[h.status] ?? STATUS.draft).label}</Badge>
                  <span className="text-app-muted">{h.signedAt ? `signed ${when(h.signedAt)} by ${h.signerName}` : `created ${when(h.createdAt)}`}</span>
                  <a className="text-app-primary underline" href={h.link} target="_blank" rel="noreferrer">View</a>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ) : null}

      <ConfirmationDialog
        open={confirmVoid}
        onClose={() => setConfirmVoid(false)}
        onConfirm={() => void voidIt()}
        loading={busy === "void"}
        title="Cancel this agreement?"
        description="The client's link will stop accepting changes or a signature. The record is kept."
        confirmLabel="Cancel agreement"
      />
    </div>
  );
}

const FIELDS: { key: keyof Details; label: string; wide?: boolean }[] = [
  { key: "businessName", label: "Business name" },
  { key: "businessType", label: "Business type" },
  { key: "contactName", label: "Contact person" },
  { key: "designation", label: "Designation" },
  { key: "phone", label: "Mobile (WhatsApp)" },
  { key: "email", label: "Email" },
  { key: "address", label: "Address", wide: true },
  { key: "city", label: "City" },
  { key: "state", label: "State" },
  { key: "pincode", label: "PIN code" },
  { key: "gstin", label: "GSTIN" },
  { key: "pan", label: "PAN" },
  { key: "planName", label: "Plan name" },
];

function DetailsEditor({ agreement: a, onSaved }: { agreement: Agreement; onSaved: () => void }) {
  const toast = useToast();
  const d = a.details;
  const [form, setForm] = React.useState<Record<string, string>>(() => ({
    ...Object.fromEntries(FIELDS.map((f) => [f.key, String(d[f.key] ?? "")])),
    priceRupees: rupees(d.pricePaise),
    setupFeeRupees: rupees(d.setupFeePaise),
    services: d.services.join(", "),
    billingMode: d.billingMode,
    startDate: d.startDate,
    termMonths: String(d.termMonths),
    extraTerms: d.extraTerms,
  }));
  const [sync, setSync] = React.useState(true);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [saving, setSaving] = React.useState(false);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setErrors({});
    const body = { ...form, services: form.services.split(",").map((s) => s.trim()).filter(Boolean), syncClient: sync };
    const r = await apiFetch<{ agreement: Agreement }>(`/api/admin/agreements/${a.id}`, { method: "PUT", body });
    setSaving(false);
    if (!r.ok) {
      setErrors(Object.fromEntries(Object.entries(r.details ?? {}).map(([k, v]) => [k, v?.[0] ?? ""])));
      return toast(r.error, "error");
    }
    toast(r.data.agreement.id !== a.id ? `Saved as version ${r.data.agreement.version}. Send it to the client to accept again.` : "Agreement updated");
    onSaved();
  }

  return (
    <Card>
      <CardHeader
        title="Correct agreement details"
        description={a.status === "signed" ? "This agreement is signed, so it won't be changed. Saving creates a new version for the client to accept; the signed one is kept in history." : "Changes show on the client's link straight away."}
      />
      <CardBody>
        <form onSubmit={save} noValidate className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FIELDS.map((f) => (
            <Field key={f.key} id={`adm-${f.key}`} label={f.label} error={errors[f.key]} className={f.wide ? "sm:col-span-2 lg:col-span-3" : undefined}>
              <Input value={form[f.key]} onChange={set(f.key)} />
            </Field>
          ))}
          <Field id="adm-price" label="Monthly fee (₹)" error={errors.priceRupees}>
            <Input inputMode="decimal" value={form.priceRupees} onChange={set("priceRupees")} />
          </Field>
          <Field id="adm-setup" label="Setup fee (₹)" error={errors.setupFeeRupees}>
            <Input inputMode="decimal" value={form.setupFeeRupees} onChange={set("setupFeeRupees")} />
          </Field>
          <Field id="adm-services" label="Services (comma separated)" className="sm:col-span-2 lg:col-span-3">
            <Input value={form.services} onChange={set("services")} />
          </Field>
          <Field id="adm-billing" label="Meta charges">
            <Select value={form.billingMode} onChange={set("billingMode")}>
              <option value="client_pays">Client pays Meta</option>
              <option value="prepaid_wallet">Prepaid wallet</option>
            </Select>
          </Field>
          <Field id="adm-start" label="Start date" error={errors.startDate}>
            <Input type="date" value={form.startDate} onChange={set("startDate")} />
          </Field>
          <Field id="adm-term" label="Term (months)" error={errors.termMonths}>
            <Input inputMode="numeric" value={form.termMonths} onChange={set("termMonths")} />
          </Field>
          <Field id="adm-extra" label="Additional terms (optional)" hint="Shown as an extra clause. Leave a blank line between points." className="sm:col-span-2 lg:col-span-3">
            <Textarea rows={4} value={form.extraTerms} onChange={set("extraTerms")} />
          </Field>
          <div className="sm:col-span-2 lg:col-span-3">
            <Checkbox checked={sync} onChange={(e) => setSync(e.target.checked)} label="Also correct the client record (business name, mobile, email)" />
          </div>
          <div className="sm:col-span-2 lg:col-span-3">
            <Button type="submit" loading={saving}>
              <CheckCircle2 aria-hidden="true" /> Save
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

function DocumentsCard({ agreement: a, busy, onReview, onRemove, onUploaded }: { agreement: Agreement; busy: string; onReview: (d: Doc, s: "verified" | "rejected") => void; onRemove: (d: Doc) => void; onUploaded: () => void }) {
  const toast = useToast();
  const [kind, setKind] = React.useState("gst");
  const [uploading, setUploading] = React.useState(false);
  const ref = React.useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    const fd = new FormData();
    fd.set("kind", kind);
    fd.set("file", file);
    setUploading(true);
    const r = await apiUpload(`/api/admin/agreements/${a.id}/documents`, fd);
    setUploading(false);
    if (ref.current) ref.current.value = "";
    if (!r.ok) return toast(r.error, "error");
    toast("Document added");
    onUploaded();
  }

  return (
    <Card>
      <CardHeader title="Business proof (KYC)" description="Documents the client uploaded. Verify them, or reject with a reason so the client uploads again." />
      <CardBody className="space-y-4">
        {a.documents.length ? (
          <ul className="divide-y divide-app-border rounded-xl border border-app-border">
            {a.documents.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                <FileText className="size-4 text-app-muted" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <a href={`/api/admin/agreements/documents/${d.id}`} target="_blank" rel="noreferrer" className="block truncate text-small font-medium text-app-text hover:underline">{d.label}</a>
                  <p className="truncate text-caption text-app-subtle">{d.fileName} · by {d.uploadedBy} · {when(d.createdAt)}{d.note ? ` · ${d.note}` : ""}</p>
                </div>
                <Badge tone={d.status === "verified" ? "success" : d.status === "rejected" ? "danger" : "warning"}>{d.status === "pending" ? "To check" : d.status}</Badge>
                <Button size="sm" variant="secondary" loading={busy === `doc:${d.id}`} disabled={d.status === "verified"} onClick={() => onReview(d, "verified")}>Verify</Button>
                <Button size="sm" variant="ghost" disabled={d.status === "rejected"} onClick={() => onReview(d, "rejected")}>Reject</Button>
                <Button size="sm" variant="ghost" aria-label={`Delete ${d.label}`} onClick={() => onRemove(d)}>
                  <Trash2 aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-small text-app-muted">No documents yet. The client uploads them from their agreement link.</p>
        )}
        <div className="flex flex-wrap items-end gap-3">
          <Field id="adm-doc-kind" label="Add a document they sent you">
            <Select value={kind} onChange={(e) => setKind(e.target.value)}>
              {DOC_OPTIONS.map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </Select>
          </Field>
          <input ref={ref} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
          <Button variant="secondary" loading={uploading} onClick={() => ref.current?.click()}>
            <Upload aria-hidden="true" /> Upload
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
