"use client";

import * as React from "react";
import Link from "next/link";
import { Copy, Plug, ShoppingBag, ShoppingCart, Trash2, Wrench, Zap } from "lucide-react";
import { Alert, Badge, Button, Card, CardBody, CardHeader, Field, Input, LoadingState, Modal, PageHeader, Switch, useToast } from "@/components/ds";
import { apiFetch } from "@/lib/client-api";
import { istFmt } from "@/components/campaigns/types";

type Provider = "shopify" | "woocommerce";
type Connection = {
  id: string;
  provider: Provider;
  name: string;
  status: "active" | "disabled";
  settings: { customerTag: string; cartTag: string; recordPurchases: boolean };
  webhookUrl: string;
  eventCount: number;
  lastEventAt: string | null;
  lastError: string;
  recent: { topic: string; externalId: string; status: string; detail: string; createdAt: string }[];
};

const STORES: Record<Provider, { name: string; topics: string[]; steps: string[] }> = {
  shopify: {
    name: "Shopify",
    topics: ["Order creation", "Checkout creation (for abandoned carts)"],
    steps: [
      "In Shopify admin open Settings → Notifications → Webhooks.",
      "Copy the signing key shown there (“Your webhooks will be signed with …”) and paste it below.",
      "Create a webhook for “Order creation”, format JSON, URL = the address MECGURA shows after connecting.",
      "Optional: add “Checkout creation” with the same URL to tag abandoned carts.",
    ],
  },
  woocommerce: {
    name: "WooCommerce",
    topics: ["Order created", "Order updated"],
    steps: [
      "Connect here first — MECGURA creates a secret for you (shown once).",
      "In WordPress open WooCommerce → Settings → Advanced → Webhooks → Add webhook.",
      "Topic “Order created”, Delivery URL = the address shown, Secret = the secret shown, API version WP REST API v3. Save.",
      "Add a second webhook for “Order updated” so orders paid later are counted too.",
    ],
  },
};

function CopyField({ label, value }: { label: string; value: string }) {
  const toast = useToast();
  return (
    <div>
      <p className="mb-1 text-caption text-app-muted">{label}</p>
      <div className="flex gap-2">
        <Input readOnly value={value} aria-label={label} className="font-mono text-caption" onFocus={(e) => e.currentTarget.select()} />
        <Button variant="secondary" aria-label={`Copy ${label}`} onClick={() => { void navigator.clipboard.writeText(value); toast("Copied"); }}><Copy aria-hidden="true" /></Button>
      </div>
    </div>
  );
}

/** Store connections (live), automation tools (live via API + webhooks), Google (configuration required). */
export function IntegrationsApp({ orgId, canManage }: { orgId: string; canManage: boolean }) {
  const toast = useToast();
  const base = `/api/organizations/${orgId}/integrations`;
  const [rows, setRows] = React.useState<Connection[] | null>(null);
  const [connecting, setConnecting] = React.useState<Provider | null>(null);
  const [created, setCreated] = React.useState<{ connection: Connection; secret?: string } | null>(null);
  const load = React.useCallback(async () => {
    const r = await apiFetch<{ connections: Connection[] }>(base);
    if (!r.ok) return toast(r.error, "error");
    setRows(r.data.connections);
  }, [base, toast]);
  React.useEffect(() => {
    const t = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(t);
  }, [load]);

  async function patch(c: Connection, body: Record<string, unknown>) {
    const r = await apiFetch(`${base}/${c.id}`, { method: "PATCH", body });
    if (!r.ok) return toast(r.error, "error");
    void load();
  }
  async function remove(c: Connection) {
    if (!window.confirm(`Disconnect ${c.name}? Remove the webhook in ${STORES[c.provider].name} too.`)) return;
    const r = await apiFetch(`${base}/${c.id}`, { method: "DELETE" });
    if (!r.ok) return toast(r.error, "error");
    void load();
  }

  return (
    <>
      <PageHeader title="Integrations" description="Connect your online store and other apps. Orders, carts and leads flow into Contacts, Deals and Automations." />

      <h2 className="mb-2 text-small font-semibold uppercase tracking-wider text-app-subtle">Online store</h2>
      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        {(["shopify", "woocommerce"] as const).map((p) => (
          <Card key={p}>
            <CardHeader
              title={<span className="flex items-center gap-2">{p === "shopify" ? <ShoppingBag className="size-4" aria-hidden="true" /> : <ShoppingCart className="size-4" aria-hidden="true" />} {STORES[p].name} <Badge tone="success">Live</Badge></span>}
              description={`Uses ${STORES[p].name}'s own signed webhooks: ${STORES[p].topics.join(", ")}.`}
              action={canManage ? <Button size="sm" onClick={() => setConnecting(p)}><Plug aria-hidden="true" /> Connect</Button> : null}
            />
            <CardBody className="space-y-3">
              <ul className="list-disc space-y-1 pl-5 text-caption text-app-muted">
                <li>New order → contact created or updated, marked customer, purchase recorded (loyalty points if Loyalty is on), tagged.</li>
                {p === "shopify" ? <li>Checkout without an order → tagged “Abandoned cart” with the cart link in {"{{contact.custom.cart_url}}"}.</li> : null}
                <li>Tags can start an automation, e.g. a thank-you or cart reminder with an approved template.</li>
                <li>Store events never mark anyone as opted in to WhatsApp marketing.</li>
              </ul>
              {!rows ? <LoadingState /> : rows.filter((c) => c.provider === p).map((c) => (
                <div key={c.id} className="space-y-2 rounded-lg border border-app-border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-small font-semibold text-app-text">{c.name}</p>
                    <div className="flex items-center gap-2">
                      <Switch label="Active" checked={c.status === "active"} disabled={!canManage} onCheckedChange={(v) => void patch(c, { status: v ? "active" : "disabled" })} />
                      {canManage ? <Button size="sm" variant="ghost" aria-label={`Disconnect ${c.name}`} onClick={() => void remove(c)}><Trash2 aria-hidden="true" /></Button> : null}
                    </div>
                  </div>
                  <CopyField label="Webhook URL" value={c.webhookUrl} />
                  <p className="text-caption text-app-muted">
                    {c.eventCount} event(s){c.lastEventAt ? ` · last ${istFmt.format(new Date(c.lastEventAt))}` : " · waiting for the first event"} · tags “{c.settings.customerTag}”{p === "shopify" ? ` / “${c.settings.cartTag}”` : ""}
                  </p>
                  {c.lastError ? <Alert tone="warning">Last problem: {c.lastError}</Alert> : null}
                  {c.recent.length ? (
                    <ul className="divide-y divide-app-border text-caption">
                      {c.recent.slice(0, 5).map((e) => (
                        <li key={e.topic + e.externalId} className="flex justify-between gap-2 py-1">
                          <span className="truncate text-app-text">{e.detail || `${e.topic} ${e.externalId}`}</span>
                          <Badge tone={e.status === "processed" ? "success" : e.status === "skipped" ? "neutral" : "warning"}>{e.status}</Badge>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ))}
            </CardBody>
          </Card>
        ))}
      </div>

      <h2 className="mb-2 text-small font-semibold uppercase tracking-wider text-app-subtle">Automation tools</h2>
      <Card className="mb-6">
        <CardHeader title={<span className="flex items-center gap-2"><Zap className="size-4" aria-hidden="true" /> Zapier, Make and n8n <Badge tone="success">Live</Badge></span>} description="Connect 5,000+ apps (Google Sheets, CRMs, forms) with MECGURA's REST API and webhooks — no special app needed." />
        <CardBody>
          <ol className="list-decimal space-y-1.5 pl-5 text-small text-app-text">
            <li><strong>Send data to MECGURA</strong> (new form lead → WhatsApp contact): create an API key in <Link href="/api" className="underline">API</Link>, then use an HTTP / Webhooks action to <code className="text-caption">POST /api/v1/contacts</code> with the header <code className="text-caption">Authorization: Bearer &lt;key&gt;</code>.</li>
            <li><strong>Start an automation from another app</strong>: use an automation with the <em>Webhook</em> trigger — its URL and secret are on the trigger step.</li>
            <li><strong>Get MECGURA events in other apps</strong> (new contact, message received, opt-out): add the Zap / scenario / workflow webhook URL in <Link href="/webhooks" className="underline">Webhooks</Link>. Every call is signed so you can verify it.</li>
          </ol>
          <p className="mt-2 text-caption text-app-muted">Bulk WhatsApp sending from these tools still follows opt-in, templates and plan limits.</p>
        </CardBody>
      </Card>

      <SheetsCard orgId={orgId} canManage={canManage} />
      <h2 className="mb-2 text-small font-semibold uppercase tracking-wider text-app-subtle">Google</h2>
      <div className="grid gap-4 lg:grid-cols-2">
        {[
          { name: "Google Business Profile", body: "Reading and replying to Google reviews and profile insights needs Google's Business Profile API access, which MECGURA has to be approved for. Until then, use Reviews → Google review link (works today)." },
          { name: "Google Ads", body: "Syncing campaigns and offline conversions needs a Google Ads developer token and OAuth app approval. Until then, use UTM links on landing pages to see which ads bring leads (works today)." },
        ].map((g) => (
          <Card key={g.name}>
            <CardHeader title={<span className="flex items-center gap-2"><Wrench className="size-4" aria-hidden="true" /> {g.name} <Badge tone="warning">Configuration required</Badge></span>} />
            <CardBody><p className="text-small text-app-muted">{g.body}</p></CardBody>
          </Card>
        ))}
      </div>

      {connecting ? <ConnectModal base={base} provider={connecting} onClose={() => setConnecting(null)} onDone={(r) => { setConnecting(null); setCreated(r); void load(); }} /> : null}
      {created ? (
        <Modal open onClose={() => setCreated(null)} title={`${STORES[created.connection.provider].name} connected`} description="Finish the setup in your store.">
          <div className="space-y-3">
            <CopyField label="Webhook URL" value={created.connection.webhookUrl} />
            {created.secret ? (
              <>
                <CopyField label="Secret (shown once)" value={created.secret} />
                <Alert tone="warning">Copy the secret now — it isn&apos;t shown again. If you lose it, disconnect and connect again.</Alert>
              </>
            ) : null}
            <ol className="list-decimal space-y-1 pl-5 text-small text-app-text">{STORES[created.connection.provider].steps.map((s) => <li key={s}>{s}</li>)}</ol>
            <div className="flex justify-end"><Button onClick={() => setCreated(null)}>Done</Button></div>
          </div>
        </Modal>
      ) : null}
    </>
  );
}

/** Google Sheets: every new lead becomes a row in the client's own sheet. */
function SheetsCard({ orgId, canManage }: { orgId: string; canManage: boolean }) {
  const url = `/api/organizations/${orgId}/integrations/sheets`;
  const [d, setD] = React.useState<{ url: string; script: string } | null>(null);
  const [value, setValue] = React.useState("");
  const [msg, setMsg] = React.useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [busy, setBusy] = React.useState("");
  React.useEffect(() => {
    let off = false;
    void apiFetch<{ url: string; script: string }>(url).then((r) => {
      if (off || !r.ok) return;
      setD(r.data);
      setValue(r.data.url);
    });
    return () => {
      off = true;
    };
  }, [url]);
  if (!d) return null;
  async function save() {
    setBusy("save");
    setMsg(null);
    const r = await apiFetch<{ url: string }>(url, { method: "PUT", body: { url: value } });
    setBusy("");
    if (!r.ok) return setMsg({ tone: "danger", text: r.details?.url?.[0] ? r.error : r.error });
    setD({ ...d!, url: r.data.url });
    setMsg({ tone: "success", text: r.data.url ? "Saved. New leads will be added to your sheet." : "Google Sheets link removed." });
  }
  async function test() {
    setBusy("test");
    setMsg(null);
    const r = await apiFetch(url, { method: "POST" });
    setBusy("");
    setMsg(r.ok ? { tone: "success", text: "Test row sent. Check your sheet." } : { tone: "danger", text: r.error });
  }
  return (
    <Card className="mb-6">
      <CardHeader title={<span className="flex items-center gap-2">Google Sheets <Badge tone={d.url ? "success" : "neutral"}>{d.url ? "Connected" : "Not connected"}</Badge></span>} description="Every new lead is added as a row in your own Google Sheet." />
      <CardBody className="space-y-3">
        <ol className="list-decimal space-y-1 pl-5 text-small text-app-muted">
          <li>Open your Google Sheet → Extensions → Apps Script. Delete what is there and paste the code below.</li>
          <li>Deploy → New deployment → type Web app → Execute as: Me → Who has access: Anyone → Deploy.</li>
          <li>Copy the Web app URL and paste it here.</li>
        </ol>
        <CopyField label="Apps Script code" value={d.script} />
        {canManage ? (
          <>
            <Field id="sheets-url" label="Web app URL">
              <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder="https://script.google.com/macros/s/…/exec" />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button onClick={save} loading={busy === "save"}>Save</Button>
              {d.url ? <Button variant="secondary" onClick={test} loading={busy === "test"}>Send a test row</Button> : null}
            </div>
          </>
        ) : null}
        {msg ? <Alert tone={msg.tone}>{msg.text}</Alert> : null}
      </CardBody>
    </Card>
  );
}

function ConnectModal({ base, provider, onClose, onDone }: { base: string; provider: Provider; onClose: () => void; onDone: (r: { connection: Connection; secret?: string }) => void }) {
  const [name, setName] = React.useState(provider === "shopify" ? "My Shopify store" : "My WooCommerce store");
  const [secret, setSecret] = React.useState("");
  const [tag, setTag] = React.useState(provider === "shopify" ? "Shopify customer" : "WooCommerce customer");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const r = await apiFetch<{ connection: Connection; secret?: string }>(base, { method: "POST", body: { provider, name, secret, settings: { customerTag: tag } } });
    setBusy(false);
    if (!r.ok) return setError(Object.values(r.details ?? {}).flat()[0] ?? r.error);
    onDone(r.data);
  }
  return (
    <Modal open onClose={onClose} title={`Connect ${STORES[provider].name}`}>
      <form onSubmit={submit} className="space-y-4">
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <ol className="list-decimal space-y-1 pl-5 text-caption text-app-muted">{STORES[provider].steps.map((s) => <li key={s}>{s}</li>)}</ol>
        <Field id="ic-name" label="Store name"><Input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></Field>
        {provider === "shopify" ? (
          <Field id="ic-secret" label="Webhook signing key" hint="From Shopify: Settings → Notifications → Webhooks.">
            <Input value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="off" />
          </Field>
        ) : null}
        <Field id="ic-tag" label="Tag customers as" hint="Use this tag as an automation trigger (e.g. thank-you message)."><Input value={tag} maxLength={40} onChange={(e) => setTag(e.target.value)} /></Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={busy}>Connect</Button>
        </div>
      </form>
    </Modal>
  );
}
