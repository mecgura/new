"use client";

import * as React from "react";
import { Mail, Trash2 } from "lucide-react";
import { Alert, Badge, Button, Card, CardBody, CardHeader, ConfirmationDialog, EmptyState, ErrorState, Field, Input, LoadingState, Modal, PageHeader, useToast } from "@/components/ds";
import { apiFetch } from "@/lib/client-api";
import { siteConfig } from "@/config/site";

type Channel = { id: string; kind: string; name: string; address: string; status: "demo" | "active" | "disabled"; inboundPath: string; conversations: number };

const TONE = { demo: "warning", active: "success", disabled: "neutral" } as const;
const LABEL = { demo: "Demo", active: "Live", disabled: "Off" } as const;

export function ChannelsApp({ orgId, canManage }: { orgId: string; canManage: boolean }) {
  const base = `/api/organizations/${orgId}/channels`;
  const toast = useToast();
  const [channels, setChannels] = React.useState<Channel[] | null>(null);
  const [emailSending, setEmailSending] = React.useState("not_configured");
  const [error, setError] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const [removing, setRemoving] = React.useState<Channel | null>(null);
  const [simulating, setSimulating] = React.useState<Channel | null>(null);

  const load = React.useCallback(async () => {
    const r = await apiFetch<{ channels: Channel[]; emailSending: string }>(base);
    if (!r.ok) return setError(r.error);
    setError("");
    setChannels(r.data.channels);
    setEmailSending(r.data.emailSending);
  }, [base]);
  React.useEffect(() => {
    const id = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(id);
  }, [load]);

  async function setStatus(c: Channel, status: Channel["status"]) {
    const r = await apiFetch(`${base}/${c.id}`, { method: "PATCH", body: { status } });
    if (!r.ok) return toast(r.error, "error");
    void load();
  }
  async function remove() {
    if (!removing) return;
    const r = await apiFetch(`${base}/${removing.id}`, { method: "DELETE" });
    setRemoving(null);
    if (!r.ok) return toast(r.error, "error");
    toast("Inbox removed");
    void load();
  }

  if (error) return <ErrorState description={error} onRetry={load} />;
  if (!channels) return <LoadingState />;
  return (
    <>
      <PageHeader
        title="Channels"
        description="Email and other inboxes that land in the same team inbox as WhatsApp."
        actions={canManage ? <Button onClick={() => setOpen(true)}>Add email inbox</Button> : null}
      />
      {emailSending !== "ready" ? (
        <Alert tone="info" className="mb-4" title="Email sending is in demo mode">
          Replies are stored but not sent until MECGURA connects an email provider and your sender domain is verified. You can set everything up and try it now with simulated customer emails.
        </Alert>
      ) : null}
      {channels.length === 0 ? (
        <Card>
          <EmptyState icon={Mail} title="No extra inboxes yet" description="Add an email address (for example support@yourbusiness.com) to answer customer emails next to WhatsApp chats." />
        </Card>
      ) : (
        <div className="space-y-3">
          {channels.map((c) => (
            <Card key={c.id}>
              <CardBody>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 font-semibold text-app-text">
                      {c.name} <Badge tone={TONE[c.status]}>{LABEL[c.status]}</Badge>
                    </p>
                    <p className="mt-1 text-small text-app-muted">
                      Email · {c.address} · {c.conversations} conversation{c.conversations === 1 ? "" : "s"}
                    </p>
                    {c.inboundPath ? (
                      <p className="mt-2 break-all text-caption text-app-muted">
                        Incoming mail URL (keep secret): <code className="rounded bg-app-hover px-1">{siteConfig.url}{c.inboundPath}</code>
                      </p>
                    ) : null}
                  </div>
                  {canManage ? (
                    <div className="flex flex-wrap gap-2">
                      {c.status === "demo" ? (
                        <Button size="sm" variant="secondary" onClick={() => setSimulating(c)}>
                          Simulate customer email
                        </Button>
                      ) : null}
                      {c.status !== "active" ? (
                        <Button size="sm" variant="secondary" onClick={() => setStatus(c, "active")}>
                          Go live
                        </Button>
                      ) : null}
                      {c.status !== "disabled" ? (
                        <Button size="sm" variant="secondary" onClick={() => setStatus(c, "disabled")}>
                          Turn off
                        </Button>
                      ) : (
                        <Button size="sm" variant="secondary" onClick={() => setStatus(c, "demo")}>
                          Back to demo
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => setRemoving(c)} aria-label={`Remove ${c.name}`}>
                        <Trash2 aria-hidden="true" />
                      </Button>
                    </div>
                  ) : null}
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
      <Card className="mt-4">
        <CardHeader title="How email works" />
        <CardBody>
          <ol className="list-decimal space-y-1.5 pl-5 text-small text-app-muted">
            <li>Add the address customers write to. Start in demo mode to try the inbox.</li>
            <li>Forward incoming mail to the secret URL above (any inbound-mail provider or forwarder can post JSON with from, subject and text).</li>
            <li>Verify your sending domain with the email provider, then press “Go live”. Replies are sent from your address.</li>
          </ol>
          <p className="mt-3 text-small text-app-muted">Email is plain text for now. WhatsApp campaigns and templates stay WhatsApp-only.</p>
        </CardBody>
      </Card>
      <AddModal open={open} onClose={() => setOpen(false)} base={base} onDone={() => { setOpen(false); void load(); }} />
      <SimulateModal channel={simulating} onClose={() => setSimulating(null)} base={base} />
      <ConfirmationDialog open={Boolean(removing)} onClose={() => setRemoving(null)} onConfirm={remove} title="Remove this inbox?" description="Its conversations and messages are deleted from MECGURA. This cannot be undone." confirmLabel="Remove" tone="danger" />
    </>
  );
}

function AddModal({ open, onClose, base, onDone }: { open: boolean; onClose: () => void; base: string; onDone: () => void }) {
  const toast = useToast();
  const [name, setName] = React.useState("");
  const [address, setAddress] = React.useState("");
  const [err, setErr] = React.useState<Record<string, string[]>>({});
  const [saving, setSaving] = React.useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const r = await apiFetch(base, { method: "POST", body: { kind: "email", name, address } });
    setSaving(false);
    if (!r.ok) return setErr(r.details ?? { name: [r.error] });
    toast("Inbox added in demo mode");
    setName("");
    setAddress("");
    setErr({});
    onDone();
  }
  return (
    <Modal open={open} onClose={onClose} title="Add an email inbox" description="Customers email this address; the team answers from the shared inbox.">
      <form onSubmit={submit} className="space-y-3">
        <Field id="ch-name" label="Name" error={err.name?.[0]}>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Support" required />
        </Field>
        <Field id="ch-address" label="Email address" error={err.address?.[0]}>
          <Input type="email" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="support@yourbusiness.com" required />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={saving}>Add inbox</Button>
        </div>
      </form>
    </Modal>
  );
}

function SimulateModal({ channel, onClose, base }: { channel: Channel | null; onClose: () => void; base: string }) {
  const toast = useToast();
  const [form, setForm] = React.useState({ from: "", name: "", subject: "", body: "" });
  const [saving, setSaving] = React.useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!channel) return;
    setSaving(true);
    const r = await apiFetch(`${base}/${channel.id}/simulate`, { method: "POST", body: form });
    setSaving(false);
    if (!r.ok) return toast(r.details?.from?.[0] ?? r.error, "error");
    toast("Simulated email received — see the Inbox");
    onClose();
  }
  return (
    <Modal open={Boolean(channel)} onClose={onClose} title="Simulate a customer email" description="Demo inboxes only. Creates the contact and conversation exactly like a real incoming email.">
      <form onSubmit={submit} className="space-y-3">
        <Field id="sim-from" label="Customer email"><Input type="email" value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} required /></Field>
        <Field id="sim-name" label="Customer name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
        <Field id="sim-subject" label="Subject"><Input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} /></Field>
        <Field id="sim-body" label="Message"><Input value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} required /></Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={saving}>Simulate email</Button>
        </div>
      </form>
    </Modal>
  );
}
