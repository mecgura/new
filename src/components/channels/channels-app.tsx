"use client";

import * as React from "react";
import { Mail, Trash2 } from "lucide-react";
import { Alert, Badge, Button, Card, CardBody, CardHeader, ConfirmationDialog, EmptyState, ErrorState, Field, Input, LoadingState, Modal, PageHeader, Select, useToast } from "@/components/ds";
import { apiFetch } from "@/lib/client-api";
import { siteConfig } from "@/config/site";

type Channel = { id: string; kind: string; name: string; address: string; status: "demo" | "active" | "disabled"; inboundPath: string; conversations: number; publicKey?: string; settings: Record<string, string> };

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
        description="Email and website chat that land in the same team inbox as WhatsApp."
        actions={canManage ? <Button onClick={() => setOpen(true)}>Add an inbox</Button> : null}
      />
      {emailSending !== "ready" ? (
        <Alert tone="info" className="mb-4" title="Email sending is in demo mode">
          Replies are stored but not sent until MECGURA connects an email provider and your sender domain is verified. You can set everything up and try it now with simulated customer emails.
        </Alert>
      ) : null}
      {channels.length === 0 ? (
        <Card>
          <EmptyState icon={Mail} title="No extra inboxes yet" description="Add an email address or a website chat widget to answer customers next to WhatsApp chats." />
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
                      {c.kind === "webchat" ? "Website chat" : c.kind === "email" ? `Email · ${c.address}` : `${c.kind === "messenger" ? "Messenger" : "Instagram"} · ${c.address}`} · {c.conversations} conversation{c.conversations === 1 ? "" : "s"}
                    </p>
                    {c.kind === "webchat" && c.publicKey ? (
                      <div className="mt-2">
                        <p className="text-caption text-app-muted">Paste this before &lt;/body&gt; on your website:</p>
                        <code className="mt-1 block break-all rounded bg-app-hover p-2 text-caption">{`<script src="${siteConfig.url}/widget.js" data-key="${c.publicKey}" async></script>`}</code>
                      </div>
                    ) : null}
                    {c.inboundPath ? (
                      <p className="mt-2 break-all text-caption text-app-muted">
                        Incoming mail URL (keep secret): <code className="rounded bg-app-hover px-1">{siteConfig.url}{c.inboundPath}</code>
                      </p>
                    ) : null}
                  </div>
                  {canManage ? (
                    <div className="flex flex-wrap gap-2">
                      {c.kind === "email" && c.status === "demo" ? (
                        <Button size="sm" variant="secondary" onClick={() => setSimulating(c)}>
                          Simulate customer email
                        </Button>
                      ) : null}
                      {c.kind === "email" && c.status !== "active" ? (
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
            <li>Email: add the address customers write to. Start in demo mode to try the inbox.</li>
            <li>Forward incoming mail to the secret URL above (any inbound-mail provider or forwarder can post JSON with from, subject and text).</li>
            <li>Verify your sending domain with the email provider, then press “Go live”. Replies are sent from your address.</li>
          </ol>
          <p className="mt-3 text-small text-app-muted">
            Messenger and Instagram: in your Meta app add the <strong>Page</strong> / <strong>Instagram</strong> webhook with callback <code className="rounded bg-app-hover px-1">{siteConfig.url}/api/webhooks/meta</code> and subscribe to <strong>messages</strong>. Replies are allowed for 24 hours after the customer writes. Accounts outside your own Meta app need Meta&apos;s app review and Business Verification first.
          </p>
          <p className="mt-3 text-small text-app-muted">Website chat works right away: paste the snippet on your site and visitors can message you. Email is plain text for now. WhatsApp campaigns and templates stay WhatsApp-only.</p>
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
  const [kind, setKind] = React.useState<"email" | "webchat" | "messenger" | "instagram">("email");
  const [token, setToken] = React.useState("");
  const [name, setName] = React.useState("");
  const [address, setAddress] = React.useState("");
  const [err, setErr] = React.useState<Record<string, string[]>>({});
  const [saving, setSaving] = React.useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const r = await apiFetch(base, { method: "POST", body: { kind, name, ...(kind === "email" || kind === "messenger" || kind === "instagram" ? { address } : {}), ...(kind === "messenger" || kind === "instagram" ? { accessToken: token } : {}) } });
    setSaving(false);
    if (!r.ok) return setErr(r.details ?? { name: [r.error] });
    toast(kind === "email" ? "Inbox added in demo mode" : kind === "webchat" ? "Website chat created" : "Connected");
    setToken("");
    setName("");
    setAddress("");
    setErr({});
    onDone();
  }
  return (
    <Modal open={open} onClose={onClose} title="Add an inbox" description="Pick where customers will reach you. The team answers from the shared inbox.">
      <form onSubmit={submit} className="space-y-3">
        <Field id="ch-kind" label="Type">
          <Select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            <option value="email">Email address</option>
            <option value="webchat">Website chat widget</option>
            <option value="messenger">Facebook Messenger</option>
            <option value="instagram">Instagram DMs</option>
          </Select>
        </Field>
        <Field id="ch-name" label="Name" error={err.name?.[0]}>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === "email" ? "Support" : "Website chat"} required />
        </Field>
        {kind === "email" ? (
          <Field id="ch-address" label="Email address" error={err.address?.[0]}>
            <Input type="email" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="support@yourbusiness.com" required />
          </Field>
        ) : null}
        {kind === "messenger" || kind === "instagram" ? (
          <>
            <Field id="ch-address" label={kind === "messenger" ? "Facebook Page ID" : "Instagram account ID"} error={err.address?.[0]}>
              <Input value={address} onChange={(e) => setAddress(e.target.value)} inputMode="numeric" required />
            </Field>
            <Field id="ch-token" label="Page access token" error={err.accessToken?.[0]} hint="Stored encrypted and never shown again. Needs the messaging permissions; accounts that aren't part of your Meta app need Meta's app review first.">
              <Input type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} required />
            </Field>
          </>
        ) : null}
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
