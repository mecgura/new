"use client";

import * as React from "react";
import Link from "next/link";
import { Alert, Badge, Button, Card, CardBody, CardHeader, ErrorState, Field, Input, LoadingState, PageHeader, Select, Table, TBody, TD, TH, THead, TR, useToast } from "@/components/ds";
import { apiFetch } from "@/lib/client-api";

type Provider = { legalName: string; address: string; gstin: string; email: string; phone: string; signatoryName: string; signatoryTitle: string; jurisdiction: string; sendFromAccountId: string };
type WaStatus = { account: { id: string; label: string; status: string } | null; template: { id: string; status: string; rejectedReason: string } | null };
type Row = { id: string; organizationId: string; number: string; version: number; status: string; businessName: string; clientName: string; contactName: string; phone: string; sentAt: string | null; viewedAt: string | null; signedAt: string | null; documents: number };

const TONE: Record<string, "neutral" | "info" | "success" | "warning" | "danger"> = { draft: "neutral", sent: "info", signed: "success", superseded: "warning", void: "danger" };
const when = (d: string | null) => (d ? new Date(d).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" }) : "—");

const FIELDS: { key: keyof Provider; label: string; hint?: string; wide?: boolean }[] = [
  { key: "legalName", label: "Your legal / business name", hint: "As on GST or bank account, e.g. MECGURA or your proprietorship name" },
  { key: "gstin", label: "Your GSTIN (if any)" },
  { key: "address", label: "Registered address", wide: true },
  { key: "email", label: "Contact email" },
  { key: "phone", label: "Contact phone" },
  { key: "signatoryName", label: "Signatory name", hint: "Printed under 'For MECGURA'" },
  { key: "signatoryTitle", label: "Signatory title" },
  { key: "jurisdiction", label: "Courts at (city, state)", hint: "e.g. Ludhiana, Punjab" },
];

/** Admin → Agreements: MECGURA's details printed on every agreement, WhatsApp sending setup, and every client's agreement. */
export function AgreementsAdmin() {
  const toast = useToast();
  const [settings, setSettings] = React.useState<{ provider: Provider; whatsapp: WaStatus; accounts: { id: string; label: string }[] } | null>(null);
  const [form, setForm] = React.useState<Provider | null>(null);
  const [rows, setRows] = React.useState<{ items: Row[]; total: number } | null>(null);
  const [status, setStatus] = React.useState("");
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState("");

  const loadSettings = React.useCallback(async () => {
    const r = await apiFetch<{ provider: Provider; whatsapp: WaStatus; accounts: { id: string; label: string }[] }>("/api/admin/agreements/settings");
    if (!r.ok) return setError(r.error);
    setSettings(r.data);
    setForm(r.data.provider);
  }, []);
  const loadRows = React.useCallback(async () => {
    const r = await apiFetch<{ items: Row[]; total: number }>(`/api/admin/agreements?pageSize=100&status=${status}`);
    if (r.ok) setRows(r.data);
  }, [status]);

  React.useEffect(() => {
    const t = window.setTimeout(() => void loadSettings(), 0);
    return () => window.clearTimeout(t);
  }, [loadSettings]);
  React.useEffect(() => {
    const t = window.setTimeout(() => void loadRows(), 0);
    return () => window.clearTimeout(t);
  }, [loadRows]);

  async function save() {
    if (!form) return;
    setBusy("save");
    const r = await apiFetch<{ whatsapp: WaStatus }>("/api/admin/agreements/settings", { method: "PUT", body: form });
    setBusy("");
    if (!r.ok) return toast(r.error, "error");
    toast("Saved. New and unsigned agreements use these details.");
    void loadSettings();
  }

  async function template() {
    setBusy("tpl");
    const r = await apiFetch<{ whatsapp: WaStatus }>("/api/admin/agreements/settings/template", { method: "POST" });
    setBusy("");
    if (!r.ok) return toast(r.error, "error");
    toast("Template sent to Meta for approval. It usually takes a few minutes to a few hours.");
    void loadSettings();
  }

  if (error) return <ErrorState description={error} onRetry={loadSettings} />;
  if (!settings || !form) return <LoadingState label="Loading agreements…" />;
  const t = settings.whatsapp.template;

  return (
    <>
      <PageHeader breadcrumb={[{ label: "Admin", href: "/admin" }, { label: "Agreements" }]} title="Client agreements" description="Every client gets a service agreement at onboarding: they check their details, upload business proof and accept online." />
      <div className="space-y-6">
        <Card>
          <CardHeader title="WhatsApp sending" description="The agreement link goes from your MECGURA WhatsApp number using an approved Meta template." />
          <CardBody className="space-y-4">
            <Field id="send-from" label="Send from number" hint="Leave on default to use the number connected as the website WhatsApp assistant.">
              <Select value={form.sendFromAccountId} onChange={(e) => setForm({ ...form, sendFromAccountId: e.target.value })}>
                <option value="">Default (website assistant number)</option>
                {settings.accounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.label}</option>
                ))}
              </Select>
            </Field>
            {settings.whatsapp.account ? (
              <div className="flex flex-wrap items-center gap-3 text-small">
                <span className="text-app-muted">Template <code>mecgura_client_agreement</code> on {settings.whatsapp.account.label}:</span>
                <Badge tone={t?.status === "approved" ? "success" : t?.status === "rejected" ? "danger" : t ? "warning" : "neutral"}>{t ? t.status : "not created"}</Badge>
                {!t || t.status === "draft" ? (
                  <Button size="sm" loading={busy === "tpl"} onClick={() => void template()}>
                    Create & submit to Meta
                  </Button>
                ) : null}
                {t?.status === "rejected" ? (
                  <Link className="text-app-primary underline" href="/templates">
                    Edit it in Templates and submit again
                  </Link>
                ) : null}
                {t?.rejectedReason ? <span className="text-red-300">{t.rejectedReason}</span> : null}
              </div>
            ) : (
              <Alert tone="warning">No sending number yet. Pick one above and save, or connect your number as the website WhatsApp assistant (Admin → Website).</Alert>
            )}
            <p className="text-caption text-app-subtle">Until the template is approved, use &quot;Send from my phone&quot; on the client&apos;s Agreement tab. Email works as soon as RESEND_API_KEY and EMAIL_FROM are set in Vercel.</p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Your details on the agreement" description="Printed as the service provider on every agreement. Signed agreements keep the text they were signed with." />
          <CardBody>
            <div className="grid gap-4 sm:grid-cols-2">
              {FIELDS.map((f) => (
                <Field key={f.key} id={`prov-${f.key}`} label={f.label} hint={f.hint} className={f.wide ? "sm:col-span-2" : undefined}>
                  <Input value={form[f.key]} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />
                </Field>
              ))}
            </div>
            <div className="mt-4">
              <Button loading={busy === "save"} onClick={() => void save()}>Save</Button>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="All agreements"
            action={
              <Select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)} className="h-9 w-40">
                <option value="">All</option>
                <option value="draft">Draft</option>
                <option value="sent">Waiting</option>
                <option value="signed">Signed</option>
                <option value="superseded">Replaced</option>
                <option value="void">Cancelled</option>
              </Select>
            }
          />
          <CardBody>
            {!rows ? (
              <LoadingState />
            ) : rows.items.length ? (
              <Table>
                <THead>
                  <TR>
                    <TH>Agreement</TH>
                    <TH>Client</TH>
                    <TH>Status</TH>
                    <TH>Sent</TH>
                    <TH>Opened</TH>
                    <TH>Signed</TH>
                    <TH>Docs</TH>
                  </TR>
                </THead>
                <TBody>
                  {rows.items.map((r) => (
                    <TR key={r.id}>
                      <TD>
                        <Link className="font-medium text-app-primary hover:underline" href={`/admin/clients/${r.organizationId}?tab=agreement`}>
                          {r.number}
                        </Link>
                        <span className="ml-1 text-caption text-app-subtle">v{r.version}</span>
                      </TD>
                      <TD>
                        <span className="block text-app-text">{r.businessName}</span>
                        <span className="text-caption text-app-subtle">{r.contactName} · {r.phone}</span>
                      </TD>
                      <TD><Badge tone={TONE[r.status] ?? "neutral"}>{r.status}</Badge></TD>
                      <TD>{when(r.sentAt)}</TD>
                      <TD>{when(r.viewedAt)}</TD>
                      <TD>{when(r.signedAt)}</TD>
                      <TD>{r.documents}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            ) : (
              <p className="text-small text-app-muted">No agreements yet. Open a client → Agreement tab, or tick &quot;Send agreement&quot; when creating a client.</p>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
