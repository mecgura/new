"use client";

import * as React from "react";
import { Check, ExternalLink, Pause, PanelRight, Play, X } from "lucide-react";
import { Alert, Button, Card, CardBody, EmptyState, Field, Input, LoadingState, PageHeader, Switch, Tabs, Textarea, useToast } from "@/components/ds";
import { apiFetch } from "@/lib/client-api";
import { AdPreview, PhaseBadge, Sparkline } from "@/components/sponsored/ad-card";
import type { SponsoredAdDto } from "@/services/sponsored/sponsored";

type Data = { ads: SponsoredAdDto[]; counts: Record<string, number>; enabled: boolean };
const TABS = ["pending", "active", "paused", "rejected", "ended", "draft", "all"] as const;
const dateOnly = (iso: string | null) => (iso ? iso.slice(0, 10) : "");

/** Admin → Sponsored: review clients' ads, set views and dates, and switch the website panel on or off. */
export function SponsoredAdmin() {
  const toast = useToast();
  const [tab, setTab] = React.useState<(typeof TABS)[number]>("pending");
  const [data, setData] = React.useState<Data | null>(null);
  const [open, setOpen] = React.useState<string | null>(null);
  const [note, setNote] = React.useState("");
  const [cap, setCap] = React.useState("");
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  const [daily, setDaily] = React.useState<{ impressions: number }[]>([]);
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    const r = await apiFetch<Data>(`/api/admin/sponsored${tab === "all" ? "" : `?status=${tab}`}`);
    if (!r.ok) return toast(r.error, "error");
    setData(r.data);
  }, [tab, toast]);
  React.useEffect(() => {
    const t = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(t);
  }, [load]);

  const ad = data?.ads.find((a) => a.id === open) ?? null;
  function select(a: SponsoredAdDto) {
    setOpen(a.id);
    setNote("");
    setCap(a.maxImpressions ? String(a.maxImpressions) : "");
    setFrom(dateOnly(a.startsAt));
    setTo(dateOnly(a.endsAt));
    setDaily([]);
    void apiFetch<{ daily: { impressions: number }[] }>(`/api/admin/sponsored/${a.id}`).then((r) => r.ok && setDaily(r.data.daily));
  }

  async function decide(action: "approve" | "reject" | "pause" | "resume" | "end" | "save") {
    if (!ad) return;
    setBusy(true);
    const r = await apiFetch(`/api/admin/sponsored/${ad.id}`, { method: "POST", body: { action, note, maxImpressions: Number(cap) || 0, startsAt: from, endsAt: to } });
    setBusy(false);
    if (!r.ok) return toast(Object.values((r as { details?: Record<string, string[]> }).details ?? {})[0]?.[0] ?? r.error, "error");
    toast(action === "save" ? "Dates and cap saved" : action === "approve" ? "Approved: it's live on the website" : action === "reject" ? "Sent back to the client with your reason" : "Updated");
    setNote("");
    void load();
  }

  async function toggle(enabled: boolean) {
    const r = await apiFetch("/api/admin/sponsored/settings", { method: "PUT", body: { enabled } });
    if (!r.ok) return toast(r.error, "error");
    toast(enabled ? "Sponsored panel is ON" : "Sponsored panel is OFF everywhere");
    void load();
  }

  return (
    <>
      <PageHeader
        title="Sponsored"
        description="Clients' ads shown in the Sponsored panel on mecgura.tech/blog. Nothing goes live without your approval."
        actions={data ? <Switch label="Show the panel on the website" checked={data.enabled} onCheckedChange={(v) => void toggle(v)} /> : undefined}
      />
      <Tabs label="Ad status" items={TABS.map((t) => ({ id: t, label: `${t === "all" ? "All" : t[0].toUpperCase() + t.slice(1)}${t !== "all" && data?.counts[t] ? ` ${data.counts[t]}` : ""}` }))} value={tab} onValueChange={(v) => { setTab(v as (typeof TABS)[number]); setOpen(null); }} className="mb-4" />
      {!data ? (
        <LoadingState />
      ) : !data.ads.length ? (
        <Card><EmptyState icon={PanelRight} title="Nothing here" description="Turn on “Sponsored placement” for a client in Admin → Clients → Services, and they can send ads for review." /></Card>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
          <ul className="space-y-3">
            {data.ads.map((a) => (
              <li key={a.id}>
                <button type="button" onClick={() => select(a)} className={`w-full rounded-xl border p-4 text-left transition hover:bg-app-hover ${open === a.id ? "border-app-primary bg-app-hover" : "border-app-border"}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-app-text">{a.headline}</span>
                    <PhaseBadge phase={a.phase} />
                  </div>
                  <p className="mt-0.5 text-small text-app-muted">{a.advertiser} · {a.name}</p>
                  <p className="mt-1 text-caption text-app-subtle tabular-nums">{a.impressions.toLocaleString("en-IN")} views · {a.clicks} clicks · CTR {a.ctr}%{a.maxImpressions ? ` · cap ${a.maxImpressions.toLocaleString("en-IN")}` : ""}</p>
                </button>
              </li>
            ))}
          </ul>
          <aside className="lg:sticky lg:top-4 lg:self-start">
            {!ad ? (
              <Card><CardBody className="text-small text-app-muted">Pick an ad to review it.</CardBody></Card>
            ) : (
              <Card>
                <CardBody className="space-y-4">
                  <AdPreview headline={ad.headline} body={ad.body} ctaLabel={ad.ctaLabel} advertiser={ad.advertiser ?? ""} imageUrl={ad.imageUrl} />
                  <p className="flex items-center gap-1.5 break-all text-small">
                    <ExternalLink className="size-4 shrink-0" aria-hidden="true" />
                    <a className="text-app-primary hover:underline" href={ad.linkType === "whatsapp" ? `https://wa.me/${ad.link}` : ad.link} target="_blank" rel="noopener noreferrer nofollow">{ad.linkType === "whatsapp" ? `WhatsApp +${ad.link}` : ad.link}</a>
                  </p>
                  <Alert tone="info">Check: honest claim, no adult / gambling / misleading offers, the link opens a real business page.</Alert>
                  {daily.length && ad.impressions ? <div><p className="mb-1 text-caption text-app-subtle">Views, last 14 days</p><Sparkline values={daily.map((d) => d.impressions)} label="Views, last 14 days" /></div> : null}
                  <div className="grid grid-cols-2 gap-3">
                    <Field id="sa-s" label="Start"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
                    <Field id="sa-e" label="End"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
                  </div>
                  <Field id="sa-cap" label="View cap (0 = no cap)" hint="Ends automatically after this many views, so you can sell a fixed package."><Input inputMode="numeric" value={cap} onChange={(e) => setCap(e.target.value.replace(/\D/g, "").slice(0, 8))} /></Field>
                  <Field id="sa-note" label="Note to client (needed to reject)"><Textarea rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
                  <div className="flex flex-wrap gap-2">
                    {["pending", "paused", "ended"].includes(ad.status) ? <Button disabled={busy} onClick={() => void decide("approve")}><Check aria-hidden="true" /> Approve</Button> : null}
                    {ad.status !== "draft" ? <Button variant="secondary" disabled={busy} onClick={() => void decide("reject")}><X aria-hidden="true" /> Reject</Button> : null}
                    {ad.status === "active" ? <Button variant="secondary" disabled={busy} onClick={() => void decide("pause")}><Pause aria-hidden="true" /> Pause</Button> : null}
                    {ad.status === "paused" ? <Button variant="secondary" disabled={busy} onClick={() => void decide("resume")}><Play aria-hidden="true" /> Resume</Button> : null}
                    {ad.status === "active" ? <Button variant="ghost" disabled={busy} onClick={() => void decide("end")}>End</Button> : null}
                  </div>
                  {["active", "paused", "pending"].includes(ad.status) ? <Button variant="ghost" disabled={busy} onClick={() => void decide("save")}>Save dates &amp; cap only</Button> : null}
                </CardBody>
              </Card>
            )}
          </aside>
        </div>
      )}
    </>
  );
}
