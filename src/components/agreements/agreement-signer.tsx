"use client";

import * as React from "react";
import { CheckCircle2, FileText, Pencil, Printer, Trash2, Upload } from "lucide-react";
import { Alert, Badge, Button, Card, CardBody, CardHeader, Checkbox, Field, Input, Select, useToast } from "@/components/ds";
import { apiFetch, apiUpload } from "@/lib/client-api";
import { AgreementDocument, type Details, type ProviderView, type Section } from "@/components/agreements/agreement-document";

type Doc = { id: string; kind: string; label: string; fileName: string; mimeType: string; sizeBytes: number; status: string; note: string; createdAt: string };
export type PublicView = {
  number: string;
  version: number;
  status: string;
  details: Details;
  sections: Section[] | null;
  signedText: string;
  provider: ProviderView;
  signedAt: string | null;
  signerName: string;
  signedHash: string;
  documents: Doc[];
};

export const DOC_OPTIONS = [
  ["gst", "GST certificate"],
  ["udyam", "Udyam / MSME certificate"],
  ["pan", "Business PAN card"],
  ["shop_licence", "Shop & Establishment licence"],
  ["incorporation", "Incorporation / partnership deed"],
  ["id_proof", "Owner ID proof (Aadhaar / PAN)"],
  ["other", "Other document"],
] as const;

const FIELDS: { key: keyof Details; label: string; type?: string; placeholder?: string; wide?: boolean }[] = [
  { key: "businessName", label: "Business name", placeholder: "Sharma Traders" },
  { key: "businessType", label: "Business type", placeholder: "Proprietorship / Pvt Ltd / Clinic…" },
  { key: "contactName", label: "Contact person", placeholder: "Full name" },
  { key: "designation", label: "Designation", placeholder: "Owner / Director" },
  { key: "phone", label: "Mobile (WhatsApp)", type: "tel", placeholder: "+91 98765 43210" },
  { key: "email", label: "Email", type: "email", placeholder: "you@business.com" },
  { key: "address", label: "Address", placeholder: "Shop / office address", wide: true },
  { key: "city", label: "City" },
  { key: "state", label: "State" },
  { key: "pincode", label: "PIN code", placeholder: "141001" },
  { key: "gstin", label: "GSTIN (if registered)", placeholder: "03ABCDE1234F1Z5" },
  { key: "pan", label: "PAN", placeholder: "ABCDE1234F" },
];
const EDITABLE = FIELDS.map((f) => f.key);

const kb = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const DOC_TONE: Record<string, "success" | "danger" | "neutral"> = { verified: "success", rejected: "danger", pending: "neutral" };

/** The client-facing agreement: 1. check details, 2. upload business proof, 3. read and accept. */
export function AgreementSigner({ token, initial, embedded = false }: { token: string; initial: PublicView; embedded?: boolean }) {
  const toast = useToast();
  const base = `/api/agreement/${token}`;
  const [a, setA] = React.useState(initial);
  const [editing, setEditing] = React.useState(false);
  const [form, setForm] = React.useState<Record<string, string>>(() => Object.fromEntries(EDITABLE.map((k) => [k, String(initial.details[k] ?? "")])));
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState("");
  const [kind, setKind] = React.useState("gst");
  const [signer, setSigner] = React.useState({ name: initial.details.contactName, designation: initial.details.designation, accept: false });
  const fileRef = React.useRef<HTMLInputElement>(null);

  const open = a.status === "sent" || a.status === "draft";
  const proofOk = a.documents.some((d) => d.status !== "rejected");

  async function saveDetails(e: React.FormEvent) {
    e.preventDefault();
    setBusy("details");
    setErrors({});
    const r = await apiFetch<{ agreement: PublicView }>(base, { method: "PUT", body: form });
    setBusy("");
    if (!r.ok) {
      setErrors(Object.fromEntries(Object.entries(r.details ?? {}).map(([k, v]) => [k, v?.[0] ?? ""])));
      return toast(r.error, "error");
    }
    setA(r.data.agreement);
    setEditing(false);
    toast("Details saved. MECGURA has been told about the change.");
  }

  async function upload(file: File) {
    const fd = new FormData();
    fd.set("kind", kind);
    fd.set("file", file);
    setBusy("upload");
    const r = await apiUpload<{ agreement: PublicView }>(`${base}/documents`, fd);
    setBusy("");
    if (fileRef.current) fileRef.current.value = "";
    if (!r.ok) return toast(r.error, "error");
    setA(r.data.agreement);
    toast("Document uploaded");
  }

  async function removeDoc(id: string) {
    setBusy(`del:${id}`);
    const r = await apiFetch<{ agreement: PublicView }>(`${base}/documents/${id}`, { method: "DELETE" });
    setBusy("");
    if (!r.ok) return toast(r.error, "error");
    setA(r.data.agreement);
  }

  async function sign() {
    setBusy("sign");
    const r = await apiFetch<{ agreement: PublicView }>(`${base}/sign`, { method: "POST", body: { signerName: signer.name, designation: signer.designation, accept: signer.accept } });
    setBusy("");
    if (!r.ok) return toast(r.error, "error");
    setA(r.data.agreement);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const doc = (
    <AgreementDocument
      details={a.details}
      sections={a.sections}
      signedText={a.signedText}
      provider={a.provider}
      signed={a.status === "signed" && a.signedAt ? { name: a.signerName, at: a.signedAt, hash: a.signedHash } : null}
    />
  );

  if (a.status === "signed") {
    return (
      <div className="space-y-5">
        <div className="print:hidden">
          <Alert tone="success" title="Agreement accepted. Thank you!">
            Signed by {a.signerName} on {new Date(a.signedAt!).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST. A copy has been emailed to {a.details.email}. Keep this link to view it again.
          </Alert>
          <div className="mt-3">
            <Button variant="secondary" onClick={() => window.print()}>
              <Printer aria-hidden="true" /> Download / print PDF
            </Button>
          </div>
        </div>
        {doc}
      </div>
    );
  }

  if (!open) {
    return (
      <Alert tone="warning" title={a.status === "superseded" ? "This agreement was replaced" : "This agreement was cancelled"}>
        {a.status === "superseded" ? "MECGURA sent you a corrected version. Please open the newest link from your WhatsApp or email." : "Please contact MECGURA if you think this is a mistake."}
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      <div className={embedded ? "hidden" : "print:hidden"}>
        <h1 className="font-display text-2xl font-bold text-app-text sm:text-3xl">Welcome to MECGURA, {a.details.contactName.split(" ")[0] || "there"}!</h1>
        <p className="mt-2 text-body text-app-muted">Three quick steps to start your services: check your details, upload one business proof, and accept the agreement. It takes about 3 minutes.</p>
      </div>

      <Card className="print:hidden">
        <CardHeader
          title={<span className="flex items-center gap-2"><Step n={1} done={!editing} /> Check your details</span>}
          description="Is anything wrong (name, mobile, GSTIN…)? Correct it here before you accept."
          action={!editing ? (
            <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
              <Pencil aria-hidden="true" /> Edit
            </Button>
          ) : null}
        />
        <CardBody>
          {editing ? (
            <form onSubmit={saveDetails} noValidate className="grid gap-4 sm:grid-cols-2">
              {FIELDS.map((f) => (
                <Field key={f.key} id={`ag-${f.key}`} label={f.label} error={errors[f.key]} className={f.wide ? "sm:col-span-2" : undefined}>
                  <Input type={f.type ?? "text"} value={form[f.key]} placeholder={f.placeholder} onChange={(e) => setForm((x) => ({ ...x, [f.key]: e.target.value }))} />
                </Field>
              ))}
              <div className="flex gap-2 sm:col-span-2">
                <Button type="submit" loading={busy === "details"}>Save details</Button>
                <Button type="button" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
              </div>
            </form>
          ) : (
            <dl className="grid gap-x-6 gap-y-2 text-small sm:grid-cols-2">
              {FIELDS.map((f) => (
                <div key={f.key} className={f.wide ? "sm:col-span-2" : undefined}>
                  <dt className="text-caption text-app-muted">{f.label}</dt>
                  <dd className="break-words font-medium text-app-text">{String(a.details[f.key] ?? "") || "—"}</dd>
                </div>
              ))}
            </dl>
          )}
        </CardBody>
      </Card>

      <Card className="print:hidden">
        <CardHeader title={<span className="flex items-center gap-2"><Step n={2} done={proofOk} /> Upload business proof</span>} description="Any one is enough: GST certificate, Udyam certificate or business PAN. PDF or a clear photo, up to 4 MB." />
        <CardBody className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <Field id="doc-kind" label="Document type">
              <Select value={kind} onChange={(e) => setKind(e.target.value)}>
                {DOC_OPTIONS.map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </Select>
            </Field>
            <input ref={fileRef} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
            <Button loading={busy === "upload"} onClick={() => fileRef.current?.click()}>
              <Upload aria-hidden="true" /> Choose file
            </Button>
          </div>
          {a.documents.length ? (
            <ul className="divide-y divide-app-border rounded-xl border border-app-border">
              {a.documents.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                  <FileText className="size-4 text-app-muted" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <a href={`${base}/documents/${d.id}`} target="_blank" rel="noreferrer" className="block truncate text-small font-medium text-app-text hover:underline">{d.label}</a>
                    <p className="truncate text-caption text-app-subtle">{d.fileName} · {kb(d.sizeBytes)}{d.note ? ` · ${d.note}` : ""}</p>
                  </div>
                  <Badge tone={DOC_TONE[d.status] ?? "neutral"}>{d.status === "pending" ? "Uploaded" : d.status === "verified" ? "Verified" : "Rejected"}</Badge>
                  {d.status !== "verified" ? (
                    <Button size="sm" variant="ghost" aria-label={`Remove ${d.label}`} loading={busy === `del:${d.id}`} onClick={() => void removeDoc(d.id)}>
                      <Trash2 aria-hidden="true" />
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </CardBody>
      </Card>

      <div>
        <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold text-app-text print:hidden"><Step n={3} done={false} /> Read the agreement</h2>
        {doc}
      </div>

      <Card className="print:hidden">
        <CardHeader title="Accept the agreement" description="Type your name as your signature. This is a legally valid electronic acceptance." />
        <CardBody className="space-y-4">
          {a.status === "draft" ? <Alert tone="info">MECGURA is still preparing this agreement. You&apos;ll get a WhatsApp / email when it&apos;s ready to accept.</Alert> : null}
          {!proofOk ? <Alert tone="warning">Upload at least one business proof (step 2) to accept.</Alert> : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="signer-name" label="Your full name">
              <Input value={signer.name} onChange={(e) => setSigner((s) => ({ ...s, name: e.target.value }))} autoComplete="name" />
            </Field>
            <Field id="signer-title" label="Designation">
              <Input value={signer.designation} onChange={(e) => setSigner((s) => ({ ...s, designation: e.target.value }))} placeholder="Owner / Director" />
            </Field>
          </div>
          <Checkbox
            checked={signer.accept}
            onChange={(e) => setSigner((s) => ({ ...s, accept: e.target.checked }))}
            label={`I have read and agree to this service agreement on behalf of ${a.details.businessName}, and I am authorised to sign for it.`}
          />
          <Button size="lg" loading={busy === "sign"} disabled={!signer.accept || signer.name.trim().length < 2 || !proofOk || a.status !== "sent" || editing} onClick={() => void sign()}>
            <CheckCircle2 aria-hidden="true" /> Accept and sign
          </Button>
        </CardBody>
      </Card>
    </div>
  );
}

function Step({ n, done }: { n: number; done: boolean }) {
  return (
    <span className={`grid size-6 place-items-center rounded-full text-caption font-bold ${done ? "bg-app-primary text-app-on-primary" : "border border-app-border text-app-muted"}`} aria-hidden="true">
      {done ? "✓" : n}
    </span>
  );
}
