"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { MessageCircle, Trash2 } from "lucide-react";
import { Alert, Badge, Button, Card, CardBody, CardHeader, Checkbox, ConfirmationDialog, ErrorState, Field, Input, LoadingState, PageHeader, Select, useToast } from "@/components/ds";
import { apiFetch } from "@/lib/client-api";
import type { InboxPerms } from "@/lib/inbox-context";
import type { Account, TeamMember } from "@/components/inbox/types";
import { CustomerPanel, LEAD_STATUSES } from "@/components/inbox/customer-panel";
import { CONSENT } from "@/components/contacts/contacts-app";

type C = { id: string; name: string; phone: string; email: string; lifecycle: string; leadStatus: string; source: string; owner: { id: string } | null; optInStatus: string; suppressed: boolean; suppressionReason: string };

export function ContactProfile({ orgId, contactId, perms, accounts }: { orgId: string; contactId: string; perms: InboxPerms; accounts: Account[] }) {
  const router = useRouter();
  const toast = useToast();
  const [c, setC] = React.useState<C | null>(null);
  const [error, setError] = React.useState("");
  const [form, setForm] = React.useState<Record<string, string>>({});
  const [suppressed, setSuppressed] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [team, setTeam] = React.useState<TeamMember[]>([]);
  const [saving, setSaving] = React.useState(false);
  const [refresh, setRefresh] = React.useState(0);
  const [evidence, setEvidence] = React.useState("");
  const [accountId, setAccountId] = React.useState(accounts[0]?.id ?? "");
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const base = `/api/organizations/${orgId}/contacts/${contactId}`;
  const canWrite = perms["contacts:write"];

  const load = React.useCallback(async () => {
    const r = await apiFetch<{ contact: C }>(base);
    if (!r.ok) return setError(r.status === 404 ? "Contact not found." : r.error);
    const x = r.data.contact;
    setC(x);
    setForm({ name: x.name, phone: x.phone, email: x.email, lifecycle: x.lifecycle, leadStatus: x.leadStatus, source: x.source, ownerUserId: x.owner?.id ?? "", suppressionReason: x.suppressionReason });
    setSuppressed(x.suppressed);
  }, [base]);
  React.useEffect(() => {
    // Initial load (external data sync).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    void apiFetch<{ members: TeamMember[] }>(`/api/organizations/${orgId}/team`).then((r) => r.ok && setTeam(r.data.members));
  }, [load, orgId]);

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const r = await apiFetch(base, { method: "PATCH", body: { ...form, ownerUserId: form.ownerUserId || null, suppressed, suppressionReason: suppressed ? form.suppressionReason : "" } });
    setSaving(false);
    if (!r.ok) return setErrors({ ...Object.fromEntries(Object.entries(r.details ?? {}).map(([k, v]) => [k, v?.[0] ?? ""])), form: r.details ? "" : r.error });
    setErrors({});
    toast("Contact saved");
    void load();
    setRefresh((x) => x + 1);
  }
  async function consent(status: "opted_in" | "opted_out") {
    const r = await apiFetch(`${base}/consent`, { method: "POST", body: { status, evidence } });
    if (!r.ok) return toast(r.error, "error");
    setEvidence("");
    toast(status === "opted_in" ? "Opt-in recorded" : "Opt-out recorded");
    void load();
    setRefresh((x) => x + 1);
  }
  async function message() {
    const r = await apiFetch<{ conversation: { id: string } }>(`/api/organizations/${orgId}/inbox/conversations`, { method: "POST", body: { contactId, whatsappAccountId: accountId } });
    if (!r.ok) return toast(r.error, "error");
    router.push(`/inbox?c=${r.data.conversation.id}`);
  }
  async function remove() {
    const r = await apiFetch(base, { method: "DELETE" });
    if (!r.ok) return toast(r.error, "error");
    toast("Contact deleted");
    router.push("/contacts");
  }

  if (error) return <ErrorState title="Can't open contact" description={error} onRetry={() => router.push("/contacts")} />;
  if (!c) return <LoadingState />;
  const consentInfo = CONSENT[c.optInStatus] ?? CONSENT.unknown;

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: "Contacts", href: "/contacts" }, { label: c.name || c.phone }]}
        title={c.name || c.phone}
        description={<span className="flex flex-wrap items-center gap-2"><span className="font-mono">{c.phone}</span><Badge tone={consentInfo.tone} dot>{consentInfo.label}</Badge>{c.suppressed ? <Badge tone="danger">Suppressed</Badge> : null}</span>}
        actions={perms["contacts:delete"] ? <Button variant="ghost" onClick={() => setDeleteOpen(true)} aria-label="Delete contact"><Trash2 aria-hidden="true" /></Button> : null}
      />
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card>
            <CardHeader title="Message on WhatsApp" />
            <CardBody>
              {accounts.length ? (
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                  <Field id="cp-acc" label="From number" className="flex-1">
                    <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                      {accounts.map((a) => <option key={a.id} value={a.id}>{a.displayName} · {a.phoneNumber}{a.isDemo ? " (demo)" : ""}</option>)}
                    </Select>
                  </Field>
                  <Button onClick={message} disabled={!perms["inbox:reply"]}><MessageCircle aria-hidden="true" /> Open chat</Button>
                </div>
              ) : (
                <Alert tone="info">Connect a WhatsApp number first.</Alert>
              )}
              {c.optInStatus !== "opted_in" ? <p className="mt-2 text-caption text-app-subtle">Outside a customer-started 24-hour window, only approved templates can be sent — and only to contacts who opted in.</p> : null}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Details" />
            <CardBody>
              <form onSubmit={save} noValidate className="space-y-4">
                {errors.form ? <Alert tone="danger">{errors.form}</Alert> : null}
                <fieldset disabled={!canWrite} className="grid gap-4 sm:grid-cols-2">
                  <Field id="pf-name" label="Name" error={errors.name}><Input value={form.name ?? ""} onChange={set("name")} /></Field>
                  <Field id="pf-phone" label="Phone" error={errors.phone}><Input type="tel" value={form.phone ?? ""} onChange={set("phone")} /></Field>
                  <Field id="pf-email" label="Email" error={errors.email}><Input type="email" value={form.email ?? ""} onChange={set("email")} /></Field>
                  <Field id="pf-owner" label="Assigned agent" error={errors.ownerUserId}>
                    <Select value={form.ownerUserId ?? ""} onChange={set("ownerUserId")}>
                      <option value="">Unassigned</option>
                      {team.map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}
                    </Select>
                  </Field>
                  <Field id="pf-life" label="Type"><Select value={form.lifecycle ?? "lead"} onChange={set("lifecycle")}><option value="lead">Lead</option><option value="customer">Customer</option></Select></Field>
                  <Field id="pf-status" label="Lead status"><Select value={form.leadStatus ?? "new"} onChange={set("leadStatus")} className="capitalize">{LEAD_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}</Select></Field>
                  <Field id="pf-source" label="Source">
                    <Select value={form.source ?? "manual"} onChange={set("source")}>{["manual", "whatsapp", "import", "api"].map((s) => <option key={s} value={s}>{s}</option>)}</Select>
                  </Field>
                  <div className="sm:col-span-2 space-y-2">
                    <Checkbox label="Suppress — never send messages to this contact" checked={suppressed} onChange={(e) => setSuppressed(e.target.checked)} />
                    {suppressed ? <Field id="pf-reason" label="Reason"><Input value={form.suppressionReason ?? ""} onChange={set("suppressionReason")} placeholder="e.g. Asked not to be contacted" /></Field> : null}
                  </div>
                </fieldset>
                {canWrite ? <div className="flex justify-end"><Button type="submit" loading={saving}>Save contact</Button></div> : null}
              </form>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Consent" description="Every change is recorded with who made it and the evidence." />
            <CardBody className="space-y-3">
              <p className="text-body">Current status: <Badge tone={consentInfo.tone} dot>{consentInfo.label}</Badge></p>
              {canWrite ? (
                <>
                  <Field id="pf-evidence" label="Evidence (how / when consent was given or withdrawn)"><Input value={evidence} onChange={(e) => setEvidence(e.target.value)} maxLength={500} /></Field>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="secondary" onClick={() => consent("opted_in")} disabled={c.optInStatus === "opted_in"}>Record opt-in</Button>
                    <Button variant="danger" onClick={() => consent("opted_out")} disabled={c.optInStatus === "opted_out"}>Record opt-out</Button>
                  </div>
                </>
              ) : null}
            </CardBody>
          </Card>
        </div>
        <Card className="h-fit overflow-hidden xl:sticky xl:top-20">
          <CustomerPanel orgId={orgId} contactId={contactId} team={team} canWrite={canWrite} refreshKey={refresh} />
        </Card>
      </div>
      <ConfirmationDialog open={deleteOpen} onClose={() => setDeleteOpen(false)} onConfirm={remove} title="Delete contact?" description="The contact, their conversations, notes and consent history are permanently deleted." confirmLabel="Delete" />
    </>
  );
}
