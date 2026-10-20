"use client";

import * as React from "react";
import { Megaphone, Pause, Play, RefreshCw, Trash2 } from "lucide-react";
import { Alert, Badge, Button, Card, CardBody, CardHeader, ConfirmationDialog, EmptyState, ErrorState, Field, Input, LoadingState, Modal, PageHeader, Select, Textarea, useToast } from "@/components/ds";
import { apiFetch } from "@/lib/client-api";
import { formatINR } from "@/lib/catalog";

type Ad = {
  id: string;
  name: string;
  status: "draft" | "paused" | "active" | "failed" | "archived";
  dailyBudget: number;
  spend: number;
  impressions: number;
  clicks: number;
  chats: number;
  costPerChat: number | null;
  lastError: string;
  syncedAt: string | null;
};
type Overview = {
  connection: { adAccountId: string; adAccountName: string; pageId: string; pageName: string; currency: string; tokenLast4: string } | null;
  numbers: { id: string; displayName: string; phoneNumber: string }[];
  campaigns: Ad[];
};

const TONE = { draft: "neutral", paused: "warning", active: "success", failed: "danger", archived: "neutral" } as const;

export function AdsApp({ orgId, canManage, canConnect }: { orgId: string; canManage: boolean; canConnect: boolean }) {
  const base = `/api/organizations/${orgId}/ads-manager`;
  const toast = useToast();
  const [data, setData] = React.useState<Overview | null>(null);
  const [error, setError] = React.useState("");
  const [creating, setCreating] = React.useState(false);
  const [starting, setStarting] = React.useState<Ad | null>(null);
  const [busy, setBusy] = React.useState("");

  const load = React.useCallback(async () => {
    const r = await apiFetch<Overview>(base);
    if (!r.ok) return setError(r.error);
    setError("");
    setData(r.data);
  }, [base]);
  React.useEffect(() => {
    const id = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(id);
  }, [load]);

  async function act(ad: Ad, action: "activate" | "pause" | "archive") {
    setBusy(ad.id + action);
    const r = await apiFetch(`${base}/campaigns/${ad.id}/status`, { method: "POST", body: { action, ...(action === "activate" ? { confirmBudget: true } : {}) } });
    setBusy("");
    setStarting(null);
    if (!r.ok) return toast(r.error, "error");
    toast(action === "activate" ? "Ad started. Meta may review it before it delivers." : action === "pause" ? "Ad paused" : "Ad archived");
    void load();
  }
  async function refresh(ad: Ad) {
    setBusy(ad.id + "sync");
    const r = await apiFetch(`${base}/campaigns/${ad.id}/sync`, { method: "POST", body: {} });
    setBusy("");
    if (!r.ok) return toast(r.error, "error");
    void load();
  }
  async function disconnect() {
    const r = await apiFetch(`${base}/connection`, { method: "DELETE" });
    if (!r.ok) return toast(r.error, "error");
    void load();
  }

  if (error) return <ErrorState description={error} onRetry={load} />;
  if (!data) return <LoadingState />;
  return (
    <>
      <PageHeader
        title="Ads Manager"
        description="Create click-to-WhatsApp ads. Customers who tap the ad land in your inbox, with the ad they came from recorded."
        actions={canManage && data.connection ? <Button onClick={() => setCreating(true)} disabled={!data.numbers.length}>Create ad</Button> : null}
      />
      <Alert tone="info" className="mb-4" title="How it works">
        Ads are created <strong>paused</strong> on your Meta ad account. You review the budget and start them yourself. Meta reviews every ad before it delivers, and Meta charges the ad spend to the payment method on the ad account.
      </Alert>

      {!data.connection ? (
        canConnect ? <ConnectCard base={base} onDone={load} /> : <Alert tone="warning">The ad account isn&apos;t connected yet. Ask the workspace owner or MECGURA to connect it.</Alert>
      ) : (
        <Card className="mb-4">
          <CardBody>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-small text-app-muted">
                Ad account <strong className="text-app-text">{data.connection.adAccountName || data.connection.adAccountId}</strong> · Page <strong className="text-app-text">{data.connection.pageName || data.connection.pageId}</strong> · token …{data.connection.tokenLast4}
              </p>
              {canConnect ? <Button size="sm" variant="ghost" onClick={disconnect}>Disconnect</Button> : null}
            </div>
            {!data.numbers.length ? <p className="mt-2 text-small text-app-muted">Connect a live WhatsApp number first. Demo numbers can&apos;t receive ad clicks.</p> : null}
          </CardBody>
        </Card>
      )}

      {data.connection ? (
        data.campaigns.length === 0 ? (
          <Card>
            <EmptyState icon={Megaphone} title="No ads yet" description="Create your first click-to-WhatsApp ad. It starts paused." />
          </Card>
        ) : (
          <div className="space-y-3">
            {data.campaigns.map((a) => (
              <Card key={a.id}>
                <CardBody>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 font-semibold text-app-text">
                        {a.name} <Badge tone={TONE[a.status]}>{a.status}</Badge>
                      </p>
                      <p className="mt-1 text-small text-app-muted">
                        {formatINR(a.dailyBudget)} / day · spent {formatINR(a.spend)} · {a.impressions.toLocaleString("en-IN")} views · {a.clicks.toLocaleString("en-IN")} clicks · <strong className="text-app-text">{a.chats} chats</strong>
                        {a.costPerChat !== null ? ` · ${formatINR(a.costPerChat)} per chat` : ""}
                      </p>
                      {a.lastError ? <p className="mt-1 text-small text-red-400">{a.lastError}</p> : null}
                    </div>
                    {canManage ? (
                      <div className="flex flex-wrap gap-2">
                        {a.status === "paused" ? (
                          <Button size="sm" onClick={() => setStarting(a)}>
                            <Play aria-hidden="true" /> Start
                          </Button>
                        ) : null}
                        {a.status === "active" ? (
                          <Button size="sm" variant="secondary" loading={busy === a.id + "pause"} onClick={() => act(a, "pause")}>
                            <Pause aria-hidden="true" /> Pause
                          </Button>
                        ) : null}
                        {a.status === "paused" || a.status === "active" ? (
                          <Button size="sm" variant="secondary" loading={busy === a.id + "sync"} onClick={() => refresh(a)}>
                            <RefreshCw aria-hidden="true" /> Refresh results
                          </Button>
                        ) : null}
                        {a.status !== "active" ? (
                          <Button size="sm" variant="ghost" aria-label={`Archive ${a.name}`} onClick={() => act(a, "archive")}>
                            <Trash2 aria-hidden="true" />
                          </Button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </CardBody>
              </Card>
            ))}
          </div>
        )
      ) : null}

      <CreateModal open={creating} onClose={() => setCreating(false)} base={base} numbers={data.numbers} onDone={() => { setCreating(false); void load(); }} />
      <ConfirmationDialog
        open={Boolean(starting)}
        onClose={() => setStarting(null)}
        onConfirm={() => (starting ? act(starting, "activate") : undefined)}
        loading={Boolean(busy)}
        title="Start this ad?"
        description={starting ? `“${starting.name}” will spend up to ${formatINR(starting.dailyBudget)} every day from your Meta ad account until you pause it.` : ""}
        confirmLabel="Start ad"
      />
    </>
  );
}

function ConnectCard({ base, onDone }: { base: string; onDone: () => void }) {
  const toast = useToast();
  const [f, setF] = React.useState({ adAccountId: "", pageId: "", accessToken: "" });
  const [err, setErr] = React.useState<Record<string, string[]>>({});
  const [saving, setSaving] = React.useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const r = await apiFetch(`${base}/connection`, { method: "PUT", body: f });
    setSaving(false);
    if (!r.ok) {
      setErr(r.details ?? {});
      return toast(r.error, "error");
    }
    setF({ adAccountId: "", pageId: "", accessToken: "" });
    onDone();
  }
  return (
    <Card className="mb-4">
      <CardHeader title="Connect the ad account" description="Needed once per workspace." />
      <CardBody>
        <ol className="mb-4 list-decimal space-y-1.5 pl-5 text-small text-app-muted">
          <li>The client gives your business <strong>partner access</strong> to their ad account and Facebook Page (Meta Business Settings → Partners).</li>
          <li>You create a <strong>system user</strong> in your business, give it those two assets, and generate a token with <code className="rounded bg-app-hover px-1">ads_management</code>, <code className="rounded bg-app-hover px-1">ads_read</code> and <code className="rounded bg-app-hover px-1">pages_read_engagement</code>.</li>
          <li>Paste the ad account ID (numbers only), the Page ID and the token below. The token is checked with Meta, stored encrypted and never shown again.</li>
        </ol>
        <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2" autoComplete="off">
          <Field id="ad-acct" label="Ad account ID" error={err.adAccountId?.[0]}>
            <Input inputMode="numeric" value={f.adAccountId} onChange={(e) => setF({ ...f, adAccountId: e.target.value })} required />
          </Field>
          <Field id="ad-page" label="Facebook Page ID" error={err.pageId?.[0]}>
            <Input inputMode="numeric" value={f.pageId} onChange={(e) => setF({ ...f, pageId: e.target.value })} required />
          </Field>
          <div className="sm:col-span-2">
            <Field id="ad-token" label="Access token" error={err.accessToken?.[0]}>
              <Input type="password" autoComplete="new-password" spellCheck={false} value={f.accessToken} onChange={(e) => setF({ ...f, accessToken: e.target.value })} required />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Button type="submit" loading={saving}>Verify and connect</Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

function CreateModal({ open, onClose, base, numbers, onDone }: { open: boolean; onClose: () => void; base: string; numbers: Overview["numbers"]; onDone: () => void }) {
  const toast = useToast();
  const empty = { name: "", whatsappAccountId: "", dailyBudgetRupees: "500", message: "", headline: "", ageMin: "18", ageMax: "55", gender: "all" };
  const [f, setF] = React.useState(empty);
  const [hash, setHash] = React.useState("");
  const [uploading, setUploading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [err, setErr] = React.useState<Record<string, string[]>>({});
  const [places, setPlaces] = React.useState<Place[]>([]);
  const set = (k: keyof typeof empty) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF((x) => ({ ...x, [k]: e.target.value }));

  async function pick(file: File | null) {
    if (!file) return;
    setUploading(true);
    const fd = new FormData();
    fd.set("file", file);
    try {
      const res = await fetch(`${base}/image`, { method: "POST", body: fd });
      const d = (await res.json().catch(() => ({}))) as { hash?: string; error?: string };
      if (!res.ok || !d.hash) toast(d.error ?? "Image upload failed", "error");
      else setHash(d.hash);
    } catch {
      toast("Network error. The image was not uploaded.", "error");
    } finally {
      setUploading(false);
    }
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const body = { name: f.name, whatsappAccountId: f.whatsappAccountId || numbers[0]?.id, dailyBudgetRupees: Number(f.dailyBudgetRupees), message: f.message, headline: f.headline, imageHash: hash, ageMin: Number(f.ageMin), ageMax: Number(f.ageMax), gender: f.gender, locations: places.map(({ key, name, type, radiusKm }) => ({ key, name, type, ...(type === "city" ? { radiusKm: radiusKm ?? 25 } : {}) })) };
    const r = await apiFetch(`${base}/campaigns`, { method: "POST", body });
    setSaving(false);
    if (!r.ok) {
      setErr(r.details ?? {});
      return toast(r.error, "error");
    }
    toast("Ad created (paused)");
    setF(empty);
    setHash("");
    setPlaces([]);
    setErr({});
    onDone();
  }
  return (
    <Modal open={open} onClose={onClose} title="Create a click-to-WhatsApp ad" description="Created paused. You start it after checking the budget." size="lg">
      <form onSubmit={submit} className="space-y-3">
        <Field id="ad-name" label="Ad name" error={err.name?.[0]}>
          <Input value={f.name} onChange={set("name")} placeholder="Diwali offer" required />
        </Field>
        <Field id="ad-num" label="WhatsApp number customers will message" error={err.whatsappAccountId?.[0]}>
          <Select value={f.whatsappAccountId || numbers[0]?.id || ""} onChange={set("whatsappAccountId")}>
            {numbers.map((n) => (
              <option key={n.id} value={n.id}>{n.displayName} ({n.phoneNumber})</option>
            ))}
          </Select>
        </Field>
        <Field id="ad-img" label="Picture (JPG or PNG, up to 4 MB)" error={err.imageHash?.[0]} hint={hash ? "Uploaded to your ad account." : uploading ? "Uploading…" : undefined}>
          <Input type="file" accept="image/jpeg,image/png" onChange={(e) => void pick(e.target.files?.[0] ?? null)} className="py-1.5" />
        </Field>
        <Field id="ad-msg" label="Ad text" error={err.message?.[0]}>
          <Textarea rows={3} value={f.message} onChange={set("message")} maxLength={500} required />
        </Field>
        <Field id="ad-head" label="Headline (optional)" error={err.headline?.[0]}>
          <Input value={f.headline} onChange={set("headline")} maxLength={40} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-4">
          <Field id="ad-budget" label="Daily budget (₹)" error={err.dailyBudgetRupees?.[0]}>
            <Input inputMode="numeric" value={f.dailyBudgetRupees} onChange={set("dailyBudgetRupees")} />
          </Field>
          <Field id="ad-amin" label="Age from">
            <Input inputMode="numeric" value={f.ageMin} onChange={set("ageMin")} />
          </Field>
          <Field id="ad-amax" label="Age to" error={err.ageMin?.[0]}>
            <Input inputMode="numeric" value={f.ageMax} onChange={set("ageMax")} />
          </Field>
          <Field id="ad-gender" label="Who">
            <Select value={f.gender} onChange={set("gender")}>
              <option value="all">Everyone</option>
              <option value="female">Women</option>
              <option value="male">Men</option>
            </Select>
          </Field>
        </div>
        <PlacePicker base={base} value={places} onChange={setPlaces} error={err.locations?.[0]} />
        <p className="text-caption text-app-subtle">The daily budget is charged by Meta, between ₹100 and ₹10,000.</p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={saving} disabled={!hash || !numbers.length}>Create ad</Button>
        </div>
      </form>
    </Modal>
  );
}

type Place = { key: string; name: string; type: "region" | "city"; region?: string; radiusKm?: number };
const RADII = [17, 25, 40, 60, 80];

/** Where the ad shows: all of India, or chosen states and cities (with a radius around each city). */
function PlacePicker({ base, value, onChange, error }: { base: string; value: Place[]; onChange: (v: Place[]) => void; error?: string }) {
  const [mode, setMode] = React.useState<"india" | "places">(value.length ? "places" : "india");
  const [q, setQ] = React.useState("");
  const [results, setResults] = React.useState<Place[]>([]);
  const [searching, setSearching] = React.useState(false);
  const [msg, setMsg] = React.useState("");

  React.useEffect(() => {
    if (mode !== "places" || q.trim().length < 2) return;
    const t = window.setTimeout(() => {
      setSearching(true);
      void apiFetch<{ locations: Place[] }>(`${base}/locations?${new URLSearchParams({ q: q.trim() })}`).then((r) => {
        setSearching(false);
        if (!r.ok) return setMsg(r.error);
        setMsg(r.data.locations.length ? "" : "No match. Try another spelling.");
        setResults(r.data.locations);
      });
    }, 350);
    return () => window.clearTimeout(t);
  }, [q, mode, base]);

  const add = (p: Place) => {
    if (!value.some((v) => v.key === p.key)) onChange([...value, p.type === "city" ? { ...p, radiusKm: 25 } : p]);
    setQ("");
    setResults([]);
  };

  return (
    <fieldset className="space-y-2 rounded-[var(--radius-control)] border border-app-border p-3">
      <legend className="px-1 text-small font-medium text-app-text">Where to show the ad</legend>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Where to show the ad">
        {([["india", "All of India"], ["places", "Choose states or cities"]] as const).map(([m, label]) => (
          <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => { setMode(m); if (m === "india") onChange([]); }} className={`rounded-full border px-3 py-1 text-small font-semibold ${mode === m ? "border-app-primary bg-app-primary-soft text-app-text" : "border-app-border text-app-muted"}`}>
            {label}
          </button>
        ))}
      </div>
      {mode === "places" ? (
        <>
          <Input value={q} onChange={(e) => { setQ(e.target.value); if (e.target.value.trim().length < 2) setResults([]); }} placeholder="Type a state or city, e.g. Punjab, Ludhiana, Shimla" aria-label="Search state or city" />
          {searching ? <p className="text-caption text-app-subtle">Searching…</p> : msg ? <p className="text-caption text-app-subtle">{msg}</p> : null}
          {results.length ? (
            <ul className="max-h-44 overflow-y-auto rounded-[var(--radius-control)] border border-app-border">
              {results.map((r) => (
                <li key={r.key}>
                  <button type="button" onClick={() => add(r)} className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-small hover:bg-app-hover">
                    <span className="text-app-text">{r.name}{r.region && r.type === "city" ? `, ${r.region}` : ""}</span>
                    <span className="text-caption text-app-subtle">{r.type === "city" ? "City" : "State"}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {value.length ? (
            <ul className="flex flex-wrap gap-2">
              {value.map((p) => (
                <li key={p.key} className="flex items-center gap-2 rounded-full border border-app-border bg-app-hover py-1 pl-3 pr-1 text-small text-app-text">
                  {p.name}
                  {p.type === "city" ? (
                    <select aria-label={`Radius around ${p.name}`} value={p.radiusKm ?? 25} onChange={(e) => onChange(value.map((v) => (v.key === p.key ? { ...v, radiusKm: Number(e.target.value) } : v)))} className="rounded-full border border-app-border bg-app-bg px-2 py-0.5 text-caption">
                      {RADII.map((r) => <option key={r} value={r}>+{r} km</option>)}
                    </select>
                  ) : <span className="text-caption text-app-subtle">whole state</span>}
                  <button type="button" aria-label={`Remove ${p.name}`} onClick={() => onChange(value.filter((v) => v.key !== p.key))} className="rounded-full px-2 text-app-muted hover:text-app-text">×</button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-caption text-app-subtle">Nothing chosen yet: the ad would show across India.</p>
          )}
        </>
      ) : (
        <p className="text-caption text-app-subtle">The ad shows anywhere in India.</p>
      )}
      {error ? <p className="text-caption text-red-300">{error}</p> : null}
    </fieldset>
  );
}
