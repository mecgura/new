"use client";

import * as React from "react";
import { MoreHorizontal, Plus, RotateCcw, Send, Webhook } from "lucide-react";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  ConfirmationDialog,
  Dropdown,
  DropdownItem,
  DropdownSeparator,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingState,
  Modal,
  PageHeader,
  Pagination,
  Select,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  useToast,
  type BadgeTone,
} from "@/components/ds";
import { apiFetch } from "@/lib/client-api";
import { WEBHOOK_EVENTS, WEBHOOK_EVENT_LIST, WEBHOOK_LIMITS, type WebhookEvent } from "@/lib/webhook-events";
import { EVENT_SAMPLE, VERIFY_NODE, VERIFY_PYTHON } from "@/lib/webhook-docs";
import { istFmt } from "@/components/campaigns/types";
import { SecretModal } from "@/components/api/secret-modal";
import { CodeBlock } from "@/components/api/code-block";

type Endpoint = { id: string; url: string; description: string; events: WebhookEvent[]; status: "active" | "disabled"; disabledReason: string; secretHint: string; consecutiveFailures: number; lastSuccessAt: string | null; lastFailureAt: string | null };
type Delivery = { id: string; eventId: string; event: string; status: "pending" | "delivered" | "failed"; attempts: number; nextAttemptAt: string | null; responseStatus: number | null; durationMs: number | null; error: string; createdAt: string; canRedeliver: boolean };
const DELIVERY_TONE: Record<Delivery["status"], BadgeTone> = { delivered: "success", pending: "warning", failed: "danger" };

export function WebhooksApp({ orgId, canManage }: { orgId: string; canManage: boolean }) {
  const toast = useToast();
  const base = `/api/organizations/${orgId}/webhooks`;
  const [list, setList] = React.useState<Endpoint[] | null>(null);
  const [error, setError] = React.useState("");
  const [selected, setSelected] = React.useState("");
  const [form, setForm] = React.useState<Endpoint | "new" | null>(null);
  const [del, setDel] = React.useState<Endpoint | null>(null);
  const [secret, setSecret] = React.useState<{ title: string; description: string; value: string } | null>(null);
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    const r = await apiFetch<{ endpoints: Endpoint[] }>(base);
    if (!r.ok) return setError(r.error);
    setError("");
    setList(r.data.endpoints);
    setSelected((s) => (r.data.endpoints.some((e) => e.id === s) ? s : (r.data.endpoints[0]?.id ?? "")));
  }, [base]);
  React.useEffect(() => {
    const t = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(t);
  }, [load]);

  async function toggle(e: Endpoint) {
    const r = await apiFetch(`${base}/${e.id}`, { method: "PATCH", body: { status: e.status === "active" ? "disabled" : "active" } });
    if (!r.ok) return toast(r.error, "error");
    toast(e.status === "active" ? "Endpoint disabled" : "Endpoint enabled");
    void load();
  }
  async function rotate(e: Endpoint) {
    const r = await apiFetch<{ secret: string }>(`${base}/${e.id}/rotate-secret`, { method: "POST" });
    if (!r.ok) return toast(r.error, "error");
    setSecret({ title: "New signing secret", description: "The old secret stopped working. Update your receiver.", value: r.data.secret });
    void load();
  }
  async function remove() {
    if (!del) return;
    setBusy(true);
    const r = await apiFetch(`${base}/${del.id}`, { method: "DELETE" });
    setBusy(false);
    setDel(null);
    if (!r.ok) return toast(r.error, "error");
    toast("Endpoint deleted");
    void load();
  }

  if (error) return <ErrorState description={error} onRetry={load} />;
  if (!list) return <LoadingState />;
  const current = list.find((e) => e.id === selected) ?? null;

  return (
    <>
      <PageHeader title="Webhooks" description="MECGURA calls your server when something happens — a message arrives, a campaign ends, a form is submitted." actions={canManage ? <Button onClick={() => setForm("new")} disabled={list.length >= WEBHOOK_LIMITS.maxEndpoints}><Plus aria-hidden="true" /> Add endpoint</Button> : null} />
      <Card>
        <CardHeader title="Endpoints" description={`${list.length} of ${WEBHOOK_LIMITS.maxEndpoints}. HTTPS only; private and internal addresses are refused.`} />
        {!list.length ? (
          <EmptyState icon={Webhook} title="No endpoints yet" description="Add the URL of your server and choose the events it should receive." action={canManage ? <Button onClick={() => setForm("new")}><Plus aria-hidden="true" /> Add endpoint</Button> : undefined} />
        ) : (
          <Table caption="Webhook endpoints" className="min-w-[820px]">
            <THead>
              <tr>
                <TH>Endpoint</TH>
                <TH>Events</TH>
                <TH>Status</TH>
                <TH>Last success</TH>
                <TH className="text-right"><span className="sr-only">Actions</span></TH>
              </tr>
            </THead>
            <TBody>
              {list.map((e) => (
                <TR key={e.id} className={e.id === selected ? "bg-app-hover/40" : undefined}>
                  <TD className="max-w-xs">
                    <button type="button" onClick={() => setSelected(e.id)} className="block max-w-full truncate text-left font-mono text-small text-app-text hover:underline">{e.url}</button>
                    {e.description ? <p className="truncate text-caption text-app-subtle">{e.description}</p> : null}
                    <p className="font-mono text-caption text-app-subtle">{e.secretHint}</p>
                  </TD>
                  <TD className="text-small text-app-muted">{e.events.length === WEBHOOK_EVENT_LIST.length ? "All events" : `${e.events.length} event(s)`}</TD>
                  <TD>
                    <Badge tone={e.status === "active" ? "success" : "danger"} dot>{e.status === "active" ? "Active" : "Disabled"}</Badge>
                    {e.status === "disabled" && e.disabledReason ? <p className="max-w-[14rem] text-caption text-app-subtle">{e.disabledReason}</p> : null}
                    {e.consecutiveFailures > 0 && e.status === "active" ? <p className="text-caption text-amber-300">{e.consecutiveFailures} failed in a row</p> : null}
                  </TD>
                  <TD className="whitespace-nowrap text-small text-app-muted">{e.lastSuccessAt ? istFmt.format(new Date(e.lastSuccessAt)) : "—"}</TD>
                  <TD className="text-right">
                    {canManage ? (
                      <Dropdown label={`Actions for ${e.url}`} trigger={<span className="inline-flex size-8 items-center justify-center rounded-md border border-app-border"><MoreHorizontal className="size-4" aria-hidden="true" /></span>}>
                        {(close) => (
                          <>
                            <DropdownItem onClick={() => { close(); setForm(e); }}>Edit</DropdownItem>
                            <DropdownItem onClick={() => { close(); void toggle(e); }}>{e.status === "active" ? "Disable" : "Enable"}</DropdownItem>
                            <DropdownItem onClick={() => { close(); void rotate(e); }}>Roll signing secret</DropdownItem>
                            <DropdownSeparator />
                            <DropdownItem tone="danger" onClick={() => { close(); setDel(e); }}>Delete</DropdownItem>
                          </>
                        )}
                      </Dropdown>
                    ) : null}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      {current ? <Deliveries key={current.id} base={base} endpoint={current} canManage={canManage} onChanged={load} /> : null}

      <Card className="mt-4">
        <CardHeader title="Receiving events" description="Each delivery is a signed POST. Verify the signature, answer 2xx quickly, and treat the event id as an idempotency key." />
        <CardBody className="grid gap-4 xl:grid-cols-2">
          <CodeBlock label="Payload" code={EVENT_SAMPLE} />
          <CodeBlock label="Verify (Node.js)" code={VERIFY_NODE} />
          <CodeBlock label="Verify (Python)" code={VERIFY_PYTHON} />
          <div className="space-y-2 text-small text-app-muted">
            <p><strong className="text-app-text">Headers:</strong> <code className="font-mono">X-Mecgura-Event</code>, <code className="font-mono">X-Mecgura-Event-Id</code>, <code className="font-mono">X-Mecgura-Delivery</code>, <code className="font-mono">X-Mecgura-Signature</code>.</p>
            <p><strong className="text-app-text">Retries:</strong> any non-2xx answer or timeout (10 s) is retried after 1 min, 5 min, 30 min, 2 h and 6 h. A <code className="font-mono">410</code> stops immediately. Redirects aren&apos;t followed. After {WEBHOOK_LIMITS.disableAfterFailures} failed deliveries in a row the endpoint is switched off and your owners are notified.</p>
            <p><strong className="text-app-text">Privacy:</strong> a delivered event&apos;s payload is deleted from MECGURA right away; failed ones are kept {WEBHOOK_LIMITS.failedPayloadRetentionDays} days so you can re-send them. Response bodies are never stored. Outbound message events never repeat the message text.</p>
          </div>
        </CardBody>
      </Card>

      {form ? (
        <EndpointModal
          base={base}
          endpoint={form === "new" ? null : form}
          onClose={() => setForm(null)}
          onSaved={(s) => {
            setForm(null);
            if (s) setSecret({ title: "Your signing secret", description: "Use it to verify the X-Mecgura-Signature header on every delivery.", value: s });
            else toast("Saved");
            void load();
          }}
        />
      ) : null}
      {secret ? <SecretModal title={secret.title} description={secret.description} secret={secret.value} onClose={() => setSecret(null)} /> : null}
      <ConfirmationDialog open={!!del} onClose={() => setDel(null)} onConfirm={remove} loading={busy} title="Delete this endpoint?" description={`${del?.url ?? ""} will stop receiving events and its delivery history is removed.`} confirmLabel="Delete endpoint" />
    </>
  );
}

function EndpointModal({ base, endpoint, onClose, onSaved }: { base: string; endpoint: Endpoint | null; onClose: () => void; onSaved: (secret?: string) => void }) {
  const [url, setUrl] = React.useState(endpoint?.url ?? "https://");
  const [description, setDescription] = React.useState(endpoint?.description ?? "");
  const [events, setEvents] = React.useState<WebhookEvent[]>(endpoint?.events ?? ["message.received"]);
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const r = endpoint
      ? await apiFetch(`${base}/${endpoint.id}`, { method: "PATCH", body: { url, description, events } })
      : await apiFetch<{ secret: string }>(base, { method: "POST", body: { url, description, events } });
    setBusy(false);
    if (!r.ok) return setError(r.details?.url?.[0] ?? Object.values(r.details ?? {})[0]?.[0] ?? r.error);
    onSaved(endpoint ? undefined : (r.data as { secret: string }).secret);
  }
  const all = events.length === WEBHOOK_EVENT_LIST.length;
  return (
    <Modal open onClose={onClose} title={endpoint ? "Edit endpoint" : "Add a webhook endpoint"} size="lg">
      <form onSubmit={submit} className="space-y-4">
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <Field id="wh-url" label="Endpoint URL" hint="Must be https:// and publicly reachable.">
          <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/mecgura" maxLength={2000} />
        </Field>
        <Field id="wh-desc" label="Description (optional)">
          <Input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} />
        </Field>
        <fieldset>
          <legend className="mb-2 flex w-full items-center justify-between text-small font-medium text-app-text">
            Events
            <button type="button" className="text-caption text-app-primary underline" onClick={() => setEvents(all ? [] : [...WEBHOOK_EVENT_LIST])}>{all ? "Clear all" : "Select all"}</button>
          </legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {WEBHOOK_EVENT_LIST.map((ev) => (
              <Checkbox key={ev} label={<span className="font-mono text-small">{ev}</span>} description={WEBHOOK_EVENTS[ev]} checked={events.includes(ev)} onChange={(e) => setEvents(e.target.checked ? [...events, ev] : events.filter((x) => x !== ev))} />
            ))}
          </div>
        </fieldset>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={busy} disabled={!url.trim() || !events.length}>{endpoint ? "Save" : "Add endpoint"}</Button>
        </div>
      </form>
    </Modal>
  );
}

function Deliveries({ base, endpoint, canManage, onChanged }: { base: string; endpoint: Endpoint; canManage: boolean; onChanged: () => void }) {
  const toast = useToast();
  const [status, setStatus] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [data, setData] = React.useState<{ deliveries: Delivery[]; total: number } | null>(null);
  const [error, setError] = React.useState("");
  const [testing, setTesting] = React.useState(false);
  const load = React.useCallback(async () => {
    const r = await apiFetch<{ deliveries: Delivery[]; total: number }>(`${base}/${endpoint.id}/deliveries?status=${status}&page=${page}&pageSize=15`);
    if (!r.ok) return setError(r.error);
    setError("");
    setData(r.data);
  }, [base, endpoint.id, status, page]);
  React.useEffect(() => {
    const t = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(t);
  }, [load]);

  async function test() {
    setTesting(true);
    const r = await apiFetch<{ delivery: Delivery }>(`${base}/${endpoint.id}/test`, { method: "POST" });
    setTesting(false);
    if (!r.ok) return toast(r.error, "error");
    toast(r.data.delivery.status === "delivered" ? `Test delivered (HTTP ${r.data.delivery.responseStatus})` : `Test failed: ${r.data.delivery.error}`, r.data.delivery.status === "delivered" ? "success" : "error");
    void load();
  }
  async function resend(d: Delivery) {
    const r = await apiFetch<{ delivery: Delivery }>(`${base}/${endpoint.id}/deliveries/${d.id}/redeliver`, { method: "POST" });
    if (!r.ok) return toast(r.error, "error");
    toast(r.data.delivery.status === "delivered" ? "Delivered" : `Still failing: ${r.data.delivery.error}`, r.data.delivery.status === "delivered" ? "success" : "error");
    void load();
    onChanged();
  }
  return (
    <Card className="mt-4">
      <CardHeader
        title="Deliveries"
        description={<span className="font-mono text-caption">{endpoint.url}</span>}
        action={
          <div className="flex items-center gap-2">
            <Select aria-label="Delivery status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="h-9 w-36 text-small">
              <option value="">All</option>
              <option value="delivered">Delivered</option>
              <option value="pending">Retrying</option>
              <option value="failed">Failed</option>
            </Select>
            {canManage ? (
              <Button variant="secondary" size="sm" onClick={test} loading={testing}>
                <Send aria-hidden="true" /> Send test
              </Button>
            ) : null}
          </div>
        }
      />
      {error ? (
        <ErrorState description={error} onRetry={load} />
      ) : !data ? (
        <LoadingState />
      ) : !data.deliveries.length ? (
        <EmptyState icon={Webhook} title="No deliveries yet" description="Send a test, or wait for the first event." className="py-8" />
      ) : (
        <>
          <Table caption="Webhook deliveries" className="min-w-[780px]">
            <THead>
              <tr>
                <TH>Event</TH>
                <TH>Status</TH>
                <TH className="text-right">Attempts</TH>
                <TH>Response</TH>
                <TH>When</TH>
                <TH className="text-right"><span className="sr-only">Actions</span></TH>
              </tr>
            </THead>
            <TBody>
              {data.deliveries.map((d) => (
                <TR key={d.id}>
                  <TD className="font-mono text-small">{d.event}<p className="font-sans text-caption text-app-subtle">{d.eventId}</p></TD>
                  <TD>
                    <Badge tone={DELIVERY_TONE[d.status]} dot>{d.status === "pending" ? "Retrying" : d.status === "delivered" ? "Delivered" : "Failed"}</Badge>
                    {d.status === "pending" && d.nextAttemptAt ? <p className="text-caption text-app-subtle">next {istFmt.format(new Date(d.nextAttemptAt))}</p> : null}
                  </TD>
                  <TD className="text-right tabular-nums">{d.attempts}</TD>
                  <TD className="text-small text-app-muted">{d.responseStatus ? `HTTP ${d.responseStatus}` : "—"}{d.durationMs !== null ? ` · ${d.durationMs} ms` : ""}{d.error ? <p className="max-w-xs text-caption text-red-300">{d.error}</p> : null}</TD>
                  <TD className="whitespace-nowrap text-small text-app-muted">{istFmt.format(new Date(d.createdAt))}</TD>
                  <TD className="text-right">
                    {canManage && d.canRedeliver ? (
                      <Button size="sm" variant="secondary" onClick={() => void resend(d)}>
                        <RotateCcw aria-hidden="true" /> Re-send
                      </Button>
                    ) : null}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
          <Pagination page={page} pageSize={15} total={data.total} onPageChange={setPage} />
        </>
      )}
    </Card>
  );
}
