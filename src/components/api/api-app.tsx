"use client";

import * as React from "react";
import { BookOpen, BarChart3, KeyRound, MoreHorizontal, Plus, ScrollText } from "lucide-react";
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
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/client-api";
import { API_KEY_LIMITS, API_SCOPES, ROTATION_GRACE_HOURS, type ApiScope } from "@/lib/api-keys";
import { istFmt } from "@/components/campaigns/types";
import { SecretModal } from "@/components/api/secret-modal";
import { ApiDocs } from "@/components/api/api-docs";

type Key = { id: string; name: string; prefix: string; permissions: ApiScope[]; status: "active" | "expiring" | "expired" | "revoked"; lastUsedAt: string | null; lastUsedIp: string; expiresAt: string | null; createdBy: string | null; createdAt: string };
const STATUS: Record<Key["status"], { label: string; tone: BadgeTone }> = {
  active: { label: "Active", tone: "success" },
  expiring: { label: "Expiring", tone: "warning" },
  expired: { label: "Expired", tone: "neutral" },
  revoked: { label: "Revoked", tone: "danger" },
};
const TABS = [
  { id: "keys", label: "API keys", icon: KeyRound },
  { id: "docs", label: "Documentation", icon: BookOpen },
  { id: "usage", label: "Usage", icon: BarChart3 },
  { id: "logs", label: "Logs", icon: ScrollText },
] as const;

export function ApiApp({ orgId, canManage, initialTab }: { orgId: string; canManage: boolean; initialTab: string }) {
  const [tab, setTab] = React.useState<string>(TABS.some((t) => t.id === initialTab) ? initialTab : "keys");
  const base = `/api/organizations/${orgId}`;
  return (
    <>
      <PageHeader title="API" description="Connect your own systems to WhatsApp: create keys, read the docs, watch usage and check what was called." />
      <nav aria-label="API sections" className="mb-4 flex gap-1 overflow-x-auto border-b border-app-border">
        {TABS.map((t) => (
          <button key={t.id} type="button" onClick={() => setTab(t.id)} aria-current={tab === t.id ? "page" : undefined} className={cn("flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-small", tab === t.id ? "border-app-primary text-app-text" : "border-transparent text-app-muted hover:text-app-text")}>
            <t.icon className="size-4" aria-hidden="true" /> {t.label}
          </button>
        ))}
      </nav>
      {tab === "keys" ? <KeysTab base={base} canManage={canManage} /> : null}
      {tab === "docs" ? <ApiDocs /> : null}
      {tab === "usage" ? <UsageTab base={base} /> : null}
      {tab === "logs" ? <LogsTab base={base} /> : null}
    </>
  );
}

// ---------------------------------------------------------------------------

function KeysTab({ base, canManage }: { base: string; canManage: boolean }) {
  const toast = useToast();
  const [keys, setKeys] = React.useState<Key[] | null>(null);
  const [error, setError] = React.useState("");
  const [create, setCreate] = React.useState(false);
  const [edit, setEdit] = React.useState<Key | null>(null);
  const [rotate, setRotate] = React.useState<Key | null>(null);
  const [revoke, setRevoke] = React.useState<Key | null>(null);
  const [secret, setSecret] = React.useState<{ title: string; description: string; value: string } | null>(null);
  const [busy, setBusy] = React.useState(false);
  const load = React.useCallback(async () => {
    const r = await apiFetch<{ keys: Key[] }>(`${base}/api-keys`);
    if (!r.ok) return setError(r.error);
    setError("");
    setKeys(r.data.keys);
  }, [base]);
  React.useEffect(() => {
    const t = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(t);
  }, [load]);

  async function doRevoke() {
    if (!revoke) return;
    setBusy(true);
    const r = await apiFetch(`${base}/api-keys/${revoke.id}/revoke`, { method: "POST" });
    setBusy(false);
    setRevoke(null);
    if (!r.ok) return toast(r.error, "error");
    toast("Key revoked — it stops working immediately");
    void load();
  }

  if (error) return <ErrorState description={error} onRetry={load} />;
  if (!keys) return <LoadingState />;
  const active = keys.filter((k) => k.status === "active" || k.status === "expiring").length;
  return (
    <>
      <Card>
        <CardHeader
          title="API keys"
          description={`${active} of ${API_KEY_LIMITS.maxActiveKeys} active. A key is only shown once, when it is created or rotated.`}
          action={canManage ? <Button onClick={() => setCreate(true)} disabled={active >= API_KEY_LIMITS.maxActiveKeys}><Plus aria-hidden="true" /> Create key</Button> : <Badge tone="neutral">Only owners can change keys</Badge>}
        />
        {!keys.length ? (
          <EmptyState icon={KeyRound} title="No API keys yet" description="Create one to call the MECGURA API from your website, CRM or backend." />
        ) : (
          <Table caption="API keys" className="min-w-[860px]">
            <THead>
              <tr>
                <TH>Name</TH>
                <TH>Key</TH>
                <TH>Permissions</TH>
                <TH>Last used</TH>
                <TH>Status</TH>
                <TH className="text-right">
                  <span className="sr-only">Actions</span>
                </TH>
              </tr>
            </THead>
            <TBody>
              {keys.map((k) => (
                <TR key={k.id}>
                  <TD>
                    <p className="font-medium">{k.name}</p>
                    <p className="text-caption text-app-subtle">{k.createdBy ?? "—"} · {istFmt.format(new Date(k.createdAt))}</p>
                  </TD>
                  <TD className="font-mono text-small">{k.prefix}••••••••</TD>
                  <TD className="max-w-xs">
                    <div className="flex flex-wrap gap-1">
                      {k.permissions.map((p) => (
                        <Badge key={p} tone="neutral">{p}</Badge>
                      ))}
                    </div>
                  </TD>
                  <TD className="whitespace-nowrap text-small text-app-muted">{k.lastUsedAt ? <>{istFmt.format(new Date(k.lastUsedAt))}<span className="block text-caption text-app-subtle">{k.lastUsedIp || "—"}</span></> : "Never"}</TD>
                  <TD>
                    <Badge tone={STATUS[k.status].tone} dot>{STATUS[k.status].label}</Badge>
                    {k.expiresAt && k.status !== "revoked" ? <p className="text-caption text-app-subtle">{k.status === "expired" ? "Expired" : "Until"} {istFmt.format(new Date(k.expiresAt))}</p> : null}
                  </TD>
                  <TD className="text-right">
                    {canManage && k.status !== "revoked" && k.status !== "expired" ? (
                      <Dropdown label={`Actions for ${k.name}`} trigger={<span className="inline-flex size-8 items-center justify-center rounded-md border border-app-border"><MoreHorizontal className="size-4" aria-hidden="true" /></span>}>
                        {(close) => (
                          <>
                            <DropdownItem onClick={() => { close(); setEdit(k); }}>Rename / permissions</DropdownItem>
                            <DropdownItem onClick={() => { close(); setRotate(k); }}>Rotate secret</DropdownItem>
                            <DropdownSeparator />
                            <DropdownItem tone="danger" onClick={() => { close(); setRevoke(k); }}>Revoke</DropdownItem>
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

      {create ? <CreateModal base={base} onClose={() => setCreate(false)} onCreated={(s) => { setCreate(false); setSecret({ title: "Your new API key", description: "Use it as “Authorization: Bearer <key>” from your server. Never put it in a website or app.", value: s }); void load(); }} /> : null}
      {edit ? <EditModal base={base} k={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); void load(); toast("Saved"); }} /> : null}
      {rotate ? <RotateModal base={base} k={rotate} onClose={() => setRotate(null)} onRotated={(s) => { setRotate(null); setSecret({ title: "Rotated key", description: `Replaces “${rotate.name}”. Switch your systems to this secret.`, value: s }); void load(); }} /> : null}
      {secret ? <SecretModal title={secret.title} description={secret.description} secret={secret.value} onClose={() => setSecret(null)} /> : null}
      <ConfirmationDialog open={!!revoke} onClose={() => setRevoke(null)} onConfirm={doRevoke} loading={busy} title={`Revoke “${revoke?.name ?? ""}”?`} description="Anything still using this key will start getting 401 errors right away. This can't be undone." confirmLabel="Revoke key" />
    </>
  );
}

function ScopePicker({ value, onChange }: { value: ApiScope[]; onChange: (v: ApiScope[]) => void }) {
  return (
    <fieldset>
      <legend className="mb-2 text-small font-medium text-app-text">Permissions</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {(Object.keys(API_SCOPES) as ApiScope[]).map((s) => (
          <Checkbox key={s} label={<span className="font-mono text-small">{s}</span>} description={API_SCOPES[s]} checked={value.includes(s)} onChange={(e) => onChange(e.target.checked ? [...value, s] : value.filter((x) => x !== s))} />
        ))}
      </div>
      <p className="mt-2 text-caption text-app-muted">Give a key only what it needs. A leaked read-only key can&apos;t send messages.</p>
    </fieldset>
  );
}

function CreateModal({ base, onClose, onCreated }: { base: string; onClose: () => void; onCreated: (secret: string) => void }) {
  const [name, setName] = React.useState("");
  const [scopes, setScopes] = React.useState<ApiScope[]>(["contacts:read", "numbers:read"]);
  const [expires, setExpires] = React.useState("");
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const r = await apiFetch<{ secret: string }>(`${base}/api-keys`, { method: "POST", body: { name, permissions: scopes, expiresInDays: expires ? Number(expires) : null } });
    setBusy(false);
    if (!r.ok) return setError(Object.values(r.details ?? {})[0]?.[0] ?? r.error);
    onCreated(r.data.secret);
  }
  return (
    <Modal open onClose={onClose} title="Create an API key" size="lg">
      <form onSubmit={submit} className="space-y-4">
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <Field id="ak-name" label="Name" hint="Where it will be used, e.g. “Website contact form”.">
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
        </Field>
        <ScopePicker value={scopes} onChange={setScopes} />
        <Field id="ak-exp" label="Expires">
          <Select value={expires} onChange={(e) => setExpires(e.target.value)}>
            <option value="">Never</option>
            <option value="30">In 30 days</option>
            <option value="90">In 90 days</option>
            <option value="365">In 1 year</option>
          </Select>
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={busy} disabled={!name.trim() || !scopes.length}>Create key</Button>
        </div>
      </form>
    </Modal>
  );
}

function EditModal({ base, k, onClose, onSaved }: { base: string; k: Key; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = React.useState(k.name);
  const [scopes, setScopes] = React.useState<ApiScope[]>(k.permissions);
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const r = await apiFetch(`${base}/api-keys/${k.id}`, { method: "PATCH", body: { name, permissions: scopes } });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    onSaved();
  }
  return (
    <Modal open onClose={onClose} title={`Edit “${k.name}”`} description="Permission changes apply to the very next request." size="lg">
      <form onSubmit={submit} className="space-y-4">
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <Field id="ak-ename" label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
        </Field>
        <ScopePicker value={scopes} onChange={setScopes} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={busy} disabled={!name.trim() || !scopes.length}>Save</Button>
        </div>
      </form>
    </Modal>
  );
}

function RotateModal({ base, k, onClose, onRotated }: { base: string; k: Key; onClose: () => void; onRotated: (secret: string) => void }) {
  const [grace, setGrace] = React.useState("0");
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const r = await apiFetch<{ secret: string }>(`${base}/api-keys/${k.id}/rotate`, { method: "POST", body: { graceHours: Number(grace) } });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    onRotated(r.data.secret);
  }
  return (
    <Modal open onClose={onClose} title={`Rotate “${k.name}”`} description="Creates a new secret with the same name and permissions.">
      <form onSubmit={submit} className="space-y-4">
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <Field id="ak-grace" label="Keep the old secret working for" hint="A short overlap lets you deploy the new secret without downtime.">
          <Select value={grace} onChange={(e) => setGrace(e.target.value)}>
            {ROTATION_GRACE_HOURS.map((h) => (
              <option key={h} value={h}>{h === 0 ? "Nothing — revoke it now" : h === 1 ? "1 hour" : `${h} hours`}</option>
            ))}
          </Select>
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={busy}>Rotate</Button>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------

type Usage = { days: { date: string; total: number; errors: number; limited: number }[]; totals: { requests: number; errors: number; rateLimited: number; avgMs: number }; keys: { id: string; name: string; prefix: string; total: number; errors: number }[]; limits: { perMinute: number; logRetentionDays: number } };

function UsageTab({ base }: { base: string }) {
  const [days, setDays] = React.useState("14");
  const [data, setData] = React.useState<Usage | null>(null);
  const [error, setError] = React.useState("");
  const load = React.useCallback(async () => {
    const r = await apiFetch<Usage>(`${base}/api-usage?days=${days}`);
    if (!r.ok) return setError(r.error);
    setError("");
    setData(r.data);
  }, [base, days]);
  React.useEffect(() => {
    const t = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(t);
  }, [load]);
  if (error) return <ErrorState description={error} onRetry={load} />;
  if (!data) return <LoadingState />;
  const max = Math.max(1, ...data.days.map((d) => d.total));
  const tiles = [
    { label: "Requests", value: data.totals.requests },
    { label: "Errors (4xx/5xx)", value: data.totals.errors },
    { label: "Rate limited (429)", value: data.totals.rateLimited },
    { label: "Average time", value: `${data.totals.avgMs} ms` },
  ];
  return (
    <div className="space-y-4">
      <section aria-label="Totals" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {tiles.map((t) => (
          <Card key={t.label} className="p-5">
            <p className="text-small text-app-muted">{t.label}</p>
            <p className="mt-1 text-h2 tabular-nums text-app-text">{t.value}</p>
          </Card>
        ))}
      </section>
      <Card>
        <CardHeader title="Requests per day" description={`Each key may make ${data.limits.perMinute} requests per minute. Logs are kept ${data.limits.logRetentionDays} days.`} action={<Select aria-label="Period" value={days} onChange={(e) => setDays(e.target.value)} className="h-9 w-36 text-small"><option value="7">Last 7 days</option><option value="14">Last 14 days</option><option value="30">Last 30 days</option></Select>} />
        <CardBody>
          {data.totals.requests === 0 ? (
            <EmptyState icon={BarChart3} title="No API requests in this period" className="py-8" />
          ) : (
            <ul className="flex h-40 items-end gap-1" aria-label="Requests per day">
              {data.days.map((d) => (
                <li key={d.date} className="flex h-full flex-1 flex-col justify-end" title={`${d.date}: ${d.total} request(s), ${d.errors} error(s)`}>
                  <div className="w-full rounded-t bg-app-primary/80" style={{ height: `${(d.total / max) * 100}%`, minHeight: d.total ? 2 : 0 }}>
                    {d.errors ? <div className="w-full rounded-t bg-red-400" style={{ height: `${(d.errors / d.total) * 100}%` }} /> : null}
                  </div>
                  <span className="sr-only">{d.date}: {d.total}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-caption text-app-subtle">Red = errors. {data.days[0]?.date} → {data.days.at(-1)?.date} (IST)</p>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="By key" />
        {!data.keys.length ? (
          <EmptyState icon={KeyRound} title="No keys" className="py-6" />
        ) : (
          <Table caption="Requests by key" className="min-w-[520px]">
            <THead>
              <tr>
                <TH>Key</TH>
                <TH className="text-right">Requests</TH>
                <TH className="text-right">Errors</TH>
              </tr>
            </THead>
            <TBody>
              {data.keys.map((k) => (
                <TR key={k.id}>
                  <TD>{k.name} <span className="font-mono text-caption text-app-subtle">{k.prefix}</span></TD>
                  <TD className="text-right tabular-nums">{k.total}</TD>
                  <TD className="text-right tabular-nums">{k.errors}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------

type Log = { id: string; method: string; path: string; status: number; durationMs: number; ip: string; userAgent: string; errorCode: string; key: { name: string; prefix: string } | null; createdAt: string };

function LogsTab({ base }: { base: string }) {
  const [f, setF] = React.useState({ keyId: "", status: "", method: "", q: "" });
  const [page, setPage] = React.useState(1);
  const [keys, setKeys] = React.useState<Key[]>([]);
  const [data, setData] = React.useState<{ logs: Log[]; total: number } | null>(null);
  const [error, setError] = React.useState("");
  const qs = new URLSearchParams({ ...f, page: String(page), pageSize: "25" }).toString();
  React.useEffect(() => {
    void apiFetch<{ keys: Key[] }>(`${base}/api-keys`).then((r) => r.ok && setKeys(r.data.keys));
  }, [base]);
  const load = React.useCallback(async () => {
    const r = await apiFetch<{ logs: Log[]; total: number }>(`${base}/api-logs?${qs}`);
    if (!r.ok) return setError(r.error);
    setError("");
    setData(r.data);
  }, [base, qs]);
  React.useEffect(() => {
    const t = window.setTimeout(() => void load(), 150);
    return () => window.clearTimeout(t);
  }, [load]);
  const set = (p: Partial<typeof f>) => {
    setF((x) => ({ ...x, ...p }));
    setPage(1);
  };
  return (
    <Card>
      <CardHeader title="Request log" description="Method, path, status and timing only — request bodies, query strings and keys are never stored. IPs are shortened to their network." />
      <div className="flex flex-wrap gap-2 border-b border-app-border p-3">
        <Select aria-label="Key" value={f.keyId} onChange={(e) => set({ keyId: e.target.value })} className="h-9 w-48 text-small">
          <option value="">All keys</option>
          {keys.map((k) => (
            <option key={k.id} value={k.id}>{k.name} ({k.prefix})</option>
          ))}
        </Select>
        <Select aria-label="Status" value={f.status} onChange={(e) => set({ status: e.target.value })} className="h-9 w-36 text-small">
          <option value="">Any status</option>
          <option value="2xx">2xx success</option>
          <option value="4xx">4xx client error</option>
          <option value="5xx">5xx server error</option>
          <option value="429">429 rate limited</option>
        </Select>
        <Select aria-label="Method" value={f.method} onChange={(e) => set({ method: e.target.value })} className="h-9 w-32 text-small">
          <option value="">Any method</option>
          {["GET", "POST", "PATCH", "DELETE"].map((m) => (
            <option key={m}>{m}</option>
          ))}
        </Select>
        <Input aria-label="Path contains" placeholder="Path contains…" value={f.q} onChange={(e) => set({ q: e.target.value })} className="h-9 w-48 text-small" />
      </div>
      {error ? (
        <ErrorState description={error} onRetry={load} />
      ) : !data ? (
        <LoadingState />
      ) : !data.logs.length ? (
        <EmptyState icon={ScrollText} title="No requests logged" description="Calls made with your API keys appear here." />
      ) : (
        <>
          <Table caption="API request log" className="min-w-[820px]">
            <THead>
              <tr>
                <TH>Time</TH>
                <TH>Request</TH>
                <TH>Status</TH>
                <TH>Key</TH>
                <TH>Network</TH>
                <TH className="text-right">Time</TH>
              </tr>
            </THead>
            <TBody>
              {data.logs.map((l) => (
                <TR key={l.id}>
                  <TD className="whitespace-nowrap text-small text-app-muted">{istFmt.format(new Date(l.createdAt))}</TD>
                  <TD className="font-mono text-small">
                    <span className="mr-2 text-app-subtle">{l.method}</span>
                    {l.path}
                    <p className="font-sans text-caption text-app-subtle">{l.id}</p>
                  </TD>
                  <TD>
                    <Badge tone={l.status < 300 ? "success" : l.status < 500 ? "warning" : "danger"} dot>{l.status}</Badge>
                    {l.errorCode ? <p className="text-caption text-app-subtle">{l.errorCode}</p> : null}
                  </TD>
                  <TD className="text-small">{l.key ? <>{l.key.name}<span className="block font-mono text-caption text-app-subtle">{l.key.prefix}</span></> : "—"}</TD>
                  <TD className="text-small text-app-muted">{l.ip || "—"}</TD>
                  <TD className="text-right text-small tabular-nums">{l.durationMs} ms</TD>
                </TR>
              ))}
            </TBody>
          </Table>
          <Pagination page={page} pageSize={25} total={data.total} onPageChange={setPage} />
        </>
      )}
    </Card>
  );
}
