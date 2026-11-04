"use client";

import * as React from "react";
import Link from "next/link";
import { CheckCircle2, Copy, MessageSquareWarning, MousePointerClick, Plus, Send, Star, Trash2 } from "lucide-react";
import { Alert, Badge, Button, Card, CardBody, CardHeader, Checkbox, EmptyState, Field, FilterBar, Input, LoadingState, Modal, PageHeader, SearchBar, Select, StatCard, Tabs, Textarea, useToast } from "@/components/ds";
import { apiFetch } from "@/lib/client-api";

type Stats = {
  sent: number;
  failed: number;
  openRate: number | null;
  responseRate: number | null;
  average: number | null;
  distribution: { star: number; count: number }[];
  googleClickRate: number | null;
  openIssues: number;
  weeks: { weekEnding: string; average: number | null; count: number }[];
  locations: { name: string; sent: number; rated: number; average: number | null; unhappy: number }[];
};
type Req = { id: string; link: string; location: string; status: string; channel: string; error: string; rating: number | null; comment: string; escalated: boolean; resolvedAt: string | null; resolvedNote: string; sentAt: string; googleClickedAt: string | null; contact: { id: string; name: string; phone: string } };
type Settings = { locations: { name: string; reviewUrl: string }[]; message: string; templateId: string; lowRating: number; cooldownDays: number };
type Tpl = { id: string; name: string; language: string; body: string };
type SendResult = { contactId: string; name: string; status: "sent" | "failed" | "link" | "skipped"; reason?: string; link?: string };

const dateFmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
const stars = (n: number) => "★".repeat(n) + "☆".repeat(5 - n);

/** Reviews & reputation: ask for feedback on WhatsApp, catch unhappy customers early, track ratings. */
export function ReviewsApp({ orgId, canSend, canManage, initialTab }: { orgId: string; canSend: boolean; canManage: boolean; initialTab: string }) {
  const base = `/api/organizations/${orgId}/reviews`;
  const [tab, setTab] = React.useState(initialTab);
  const [stats, setStats] = React.useState<Stats | null>(null);
  const [settings, setSettings] = React.useState<Settings | null>(null);
  const [sending, setSending] = React.useState(false);
  const [tick, setTick] = React.useState(0);
  const refresh = () => setTick((t) => t + 1);

  React.useEffect(() => {
    const t = window.setTimeout(async () => {
      const [s, c] = await Promise.all([apiFetch<Stats>(base), apiFetch<{ settings: Settings }>(`${base}/settings`)]);
      if (s.ok) setStats(s.data);
      if (c.ok) setSettings(c.data.settings);
    }, 0);
    return () => clearTimeout(t);
  }, [base, tick]);

  const noGoogle = settings && !settings.locations.some((l) => l.reviewUrl);
  return (
    <>
      <PageHeader
        title="Reviews"
        description="Ask customers how it went on WhatsApp. Unhappy ones reach you privately first; everyone is invited to review you on Google."
        actions={canSend ? <Button onClick={() => setSending(true)}><Send className="size-4" aria-hidden="true" /> Ask for feedback</Button> : null}
      />
      {noGoogle ? (
        <Alert tone="warning" className="mb-4" title="Add your Google review link">
          Customers can rate you, but there&apos;s no Google link to send them to yet.{canManage ? <Button size="sm" variant="secondary" className="ml-2" onClick={() => setTab("settings")}>Add it in Settings</Button> : " Ask your owner to add it."}
        </Alert>
      ) : null}
      <Tabs label="Reviews sections" value={tab} onValueChange={setTab} className="mb-4" items={[{ id: "overview", label: "Overview" }, { id: "requests", label: "Requests" }, { id: "feedback", label: `Unhappy feedback${stats?.openIssues ? ` (${stats.openIssues})` : ""}` }, ...(canManage ? [{ id: "settings", label: "Settings" }] : [])]} />
      {tab === "overview" ? <Overview stats={stats} /> : null}
      {tab === "requests" ? <Requests base={base} tick={tick} locations={settings?.locations.map((l) => l.name) ?? []} /> : null}
      {tab === "feedback" ? <Feedback base={base} canManage={canManage} tick={tick} onChanged={refresh} /> : null}
      {tab === "settings" && canManage ? <SettingsTab base={base} onSaved={refresh} /> : null}
      {sending && settings ? <SendDialog orgId={orgId} base={base} locations={settings.locations.map((l) => l.name)} onClose={() => setSending(false)} onDone={refresh} /> : null}
    </>
  );
}

function Overview({ stats }: { stats: Stats | null }) {
  if (!stats) return <LoadingState />;
  if (!stats.sent) return <Card><EmptyState icon={Star} title="No feedback requests yet" description="Tap “Ask for feedback”, pick customers who visited recently, and their ratings will show here." /></Card>;
  const max = Math.max(1, ...stats.distribution.map((d) => d.count));
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Average rating" value={stats.average === null ? null : `${stats.average} ★`} icon={Star} hint="Last 8 weeks" />
        <StatCard label="Replied" value={stats.responseRate === null ? null : `${stats.responseRate}%`} icon={CheckCircle2} hint={`${stats.sent} asked · ${stats.openRate ?? 0}% opened`} />
        <StatCard label="Went to Google" value={stats.googleClickRate === null ? null : `${stats.googleClickRate}%`} icon={MousePointerClick} hint="Of those who rated" />
        <StatCard label="Open issues" value={String(stats.openIssues)} icon={MessageSquareWarning} hint="Unhappy, not yet resolved" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Ratings" />
          <CardBody className="space-y-2">
            {stats.distribution.map((d) => (
              <div key={d.star} className="flex items-center gap-3 text-small">
                <span className="w-10 text-app-muted">{d.star} ★</span>
                <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-app-elevated"><span className="block h-full rounded-full bg-amber-400" style={{ width: `${(d.count / max) * 100}%` }} /></span>
                <span className="w-8 text-right text-app-text">{d.count}</span>
              </div>
            ))}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Weekly average" description="Each bar is a week; empty weeks had no ratings." />
          <CardBody>
            <div className="flex h-36 items-end gap-2" role="img" aria-label={`Weekly average rating: ${stats.weeks.map((w) => `${w.weekEnding} ${w.average ?? "none"}`).join(", ")}`}>
              {stats.weeks.map((w) => (
                <div key={w.weekEnding} className="flex flex-1 flex-col items-center gap-1">
                  <span className="text-caption text-app-muted">{w.average ?? ""}</span>
                  <span className="w-full rounded-t bg-app-primary/70" style={{ height: `${((w.average ?? 0) / 5) * 100}px` }} />
                  <span className="text-[10px] text-app-subtle">{dateFmt.format(new Date(w.weekEnding))}</span>
                </div>
              ))}
            </div>
          </CardBody>
        </Card>
      </div>
      {stats.locations.length > 1 ? (
        <Card>
          <CardHeader title="By location" />
          <CardBody className="overflow-x-auto p-0">
            <table className="w-full text-small">
              <thead className="text-left text-caption text-app-muted"><tr className="border-b border-app-border"><th className="px-4 py-2 font-medium">Location</th><th className="px-4 py-2 font-medium">Asked</th><th className="px-4 py-2 font-medium">Rated</th><th className="px-4 py-2 font-medium">Average</th><th className="px-4 py-2 font-medium">Unhappy</th></tr></thead>
              <tbody>{stats.locations.map((l) => <tr key={l.name} className="border-b border-app-border last:border-0"><td className="px-4 py-2 text-app-text">{l.name}</td><td className="px-4 py-2">{l.sent}</td><td className="px-4 py-2">{l.rated}</td><td className="px-4 py-2">{l.average ?? "—"}</td><td className="px-4 py-2">{l.unhappy}</td></tr>)}</tbody>
            </table>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}

const STATUS: Record<string, { label: string; tone: "neutral" | "info" | "success" | "danger" }> = { sent: { label: "Sent", tone: "neutral" }, opened: { label: "Opened", tone: "info" }, rated: { label: "Rated", tone: "success" }, failed: { label: "Not sent", tone: "danger" } };

function useCopy() {
  const toast = useToast();
  return async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast("Link copied.");
    } catch {
      toast("Couldn't copy. Select the link and copy it.", "error");
    }
  };
}

function Requests({ base, tick, locations }: { base: string; tick: number; locations: string[] }) {
  const [filter, setFilter] = React.useState("all");
  const [location, setLocation] = React.useState("");
  const [rows, setRows] = React.useState<Req[] | null>(null);
  const copy = useCopy();
  React.useEffect(() => {
    const t = window.setTimeout(async () => {
      const r = await apiFetch<{ requests: Req[] }>(`${base}/requests?filter=${filter}${location ? `&location=${encodeURIComponent(location)}` : ""}`);
      if (r.ok) setRows(r.data.requests);
    }, 0);
    return () => clearTimeout(t);
  }, [base, filter, location, tick]);
  return (
    <Card>
      <CardBody className="space-y-3">
        <FilterBar>
          <Select aria-label="Show" value={filter} onChange={(e) => setFilter(e.target.value)} className="w-full sm:w-48">
            <option value="all">All requests</option>
            <option value="rated">Rated</option>
            <option value="unhappy">Unhappy</option>
            <option value="failed">Not sent</option>
          </Select>
          {locations.length > 1 ? (
            <Select aria-label="Location" value={location} onChange={(e) => setLocation(e.target.value)} className="w-full sm:w-48">
              <option value="">All locations</option>
              {locations.map((l) => <option key={l} value={l}>{l}</option>)}
            </Select>
          ) : null}
        </FilterBar>
        {!rows ? <LoadingState /> : !rows.length ? <EmptyState icon={Send} title="Nothing here" description="Requests you send show here with their status and rating." /> : (
          <ul className="divide-y divide-app-border">
            {rows.map((r) => (
              <li key={r.id} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <Link href={`/contacts/${r.contact.id}`} className="text-small font-semibold text-app-text hover:text-app-primary">{r.contact.name || r.contact.phone}</Link>
                  <p className="text-caption text-app-subtle">{dateFmt.format(new Date(r.sentAt))}{r.location ? ` · ${r.location}` : ""}{r.channel ? ` · via ${r.channel === "session" ? "chat" : r.channel}` : ""}{r.googleClickedAt ? " · opened Google" : ""}</p>
                  {r.rating ? <p className="text-small"><span className="text-amber-400">{stars(r.rating)}</span>{r.comment ? <span className="text-app-muted"> “{r.comment}”</span> : null}</p> : null}
                  {r.status === "failed" && r.error ? <p className="text-caption text-red-300">{r.error}</p> : null}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge tone={STATUS[r.status]?.tone ?? "neutral"}>{STATUS[r.status]?.label ?? r.status}</Badge>
                  {!r.rating ? <Button size="sm" variant="ghost" onClick={() => void copy(r.link)} aria-label="Copy link"><Copy className="size-4" /></Button> : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

function Feedback({ base, canManage, tick, onChanged }: { base: string; canManage: boolean; tick: number; onChanged: () => void }) {
  const toast = useToast();
  const [rows, setRows] = React.useState<Req[] | null>(null);
  const [resolving, setResolving] = React.useState<Req | null>(null);
  const [note, setNote] = React.useState("");
  React.useEffect(() => {
    const t = window.setTimeout(async () => {
      const r = await apiFetch<{ requests: Req[] }>(`${base}/requests?filter=unhappy`);
      if (r.ok) setRows(r.data.requests);
    }, 0);
    return () => clearTimeout(t);
  }, [base, tick]);
  async function resolve() {
    if (!resolving) return;
    const r = await apiFetch(`${base}/requests/${resolving.id}/resolve`, { method: "POST", body: { note } });
    if (!r.ok) return toast(r.error, "error");
    toast("Marked resolved.");
    setResolving(null);
    setNote("");
    onChanged();
  }
  if (!rows) return <LoadingState />;
  if (!rows.length) return <Card><EmptyState icon={CheckCircle2} title="No unhappy feedback" description="Low ratings land here (and alert owners and managers) so you can call the customer and fix it." /></Card>;
  return (
    <div className="space-y-3">
      {rows.map((r) => (
        <Card key={r.id}>
          <CardBody className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-small font-semibold text-app-text">{r.contact.name || r.contact.phone} <span className="font-normal text-amber-400">{stars(r.rating ?? 0)}</span></p>
              <p className="text-caption text-app-subtle">{r.contact.phone} · {dateFmt.format(new Date(r.sentAt))}{r.location ? ` · ${r.location}` : ""}</p>
              <p className="mt-1 text-small text-app-text">{r.comment || <span className="text-app-muted">No comment</span>}</p>
              {r.resolvedAt ? <p className="mt-1 text-caption text-green-300">Resolved: {r.resolvedNote}</p> : null}
            </div>
            <div className="flex shrink-0 gap-2">
              <Link href={`/contacts/${r.contact.id}`}><Button size="sm" variant="secondary">Open contact</Button></Link>
              {canManage && !r.resolvedAt ? <Button size="sm" onClick={() => setResolving(r)}>Mark resolved</Button> : null}
            </div>
          </CardBody>
        </Card>
      ))}
      {resolving ? (
        <Modal open onClose={() => setResolving(null)} title="What was done?" size="sm" footer={<><Button variant="secondary" onClick={() => setResolving(null)}>Cancel</Button><Button onClick={() => void resolve()} disabled={note.trim().length < 3}>Mark resolved</Button></>}>
          <Field id="res-note" label="Note"><Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={500} placeholder="Called her, re-did the service free" /></Field>
        </Modal>
      ) : null}
    </div>
  );
}

function SendDialog({ orgId, base, locations, onClose, onDone }: { orgId: string; base: string; locations: string[]; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [q, setQ] = React.useState("");
  const [list, setList] = React.useState<{ id: string; name: string; phone: string }[]>([]);
  const [picked, setPicked] = React.useState<Map<string, string>>(new Map());
  const [location, setLocation] = React.useState(locations[0] ?? "");
  const [linkOnly, setLinkOnly] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [results, setResults] = React.useState<SendResult[] | null>(null);
  const copy = useCopy();
  React.useEffect(() => {
    const t = window.setTimeout(async () => {
      const r = await apiFetch<{ items: { id: string; name: string; phone: string }[] }>(`/api/organizations/${orgId}/contacts?pageSize=50${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ""}`);
      if (r.ok) setList(r.data.items);
    }, 250);
    return () => clearTimeout(t);
  }, [orgId, q]);
  const toggle = (id: string, name: string) => setPicked((m) => { const n = new Map(m); if (n.has(id)) n.delete(id); else n.set(id, name); return n; });
  async function send() {
    setBusy(true);
    const r = await apiFetch<{ results: SendResult[] }>(`${base}/requests`, { method: "POST", body: { contactIds: [...picked.keys()], location, linkOnly } });
    setBusy(false);
    if (!r.ok) return toast(r.error, "error");
    setResults(r.data.results);
    onDone();
  }
  if (results) {
    const sent = results.filter((r) => r.status === "sent").length;
    return (
      <Modal open onClose={onClose} title="Done" description={`${sent} sent on WhatsApp · ${results.filter((r) => r.status === "link").length} links made · ${results.filter((r) => r.status === "failed").length} not sent · ${results.filter((r) => r.status === "skipped").length} skipped`} footer={<Button onClick={onClose}>Close</Button>}>
        <ul className="divide-y divide-app-border">
          {results.map((r) => (
            <li key={r.contactId} className="flex items-center justify-between gap-2 py-2 text-small">
              <span className="min-w-0"><span className="block text-app-text">{r.name}</span>{r.reason ? <span className="block text-caption text-app-muted">{r.reason}</span> : null}</span>
              <span className="flex shrink-0 items-center gap-2">
                <Badge tone={r.status === "sent" ? "success" : r.status === "failed" ? "danger" : "neutral"}>{r.status === "link" ? "Link ready" : r.status === "sent" ? "Sent" : r.status === "failed" ? "Not sent" : "Skipped"}</Badge>
                {r.link && r.status !== "sent" ? <Button size="sm" variant="ghost" onClick={() => void copy(r.link!)} aria-label={`Copy link for ${r.name}`}><Copy className="size-4" /></Button> : null}
              </span>
            </li>
          ))}
        </ul>
      </Modal>
    );
  }
  return (
    <Modal open onClose={onClose} size="lg" title="Ask for feedback" description="Pick customers who visited or bought recently. Anyone asked in the cooldown period is skipped." footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={() => void send()} loading={busy} disabled={!picked.size}>{linkOnly ? `Make ${picked.size} link${picked.size === 1 ? "" : "s"}` : `Send to ${picked.size}`}</Button></>}>
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <SearchBar label="Search contacts" placeholder="Name or phone" value={q} onChange={(e) => setQ(e.target.value)} />
          {locations.length > 1 ? (
            <Select aria-label="Location" value={location} onChange={(e) => setLocation(e.target.value)}>
              {locations.map((l) => <option key={l} value={l}>{l}</option>)}
            </Select>
          ) : null}
        </div>
        {picked.size ? <p className="text-caption text-app-muted">Selected: {[...picked.values()].slice(0, 6).join(", ")}{picked.size > 6 ? ` +${picked.size - 6} more` : ""}</p> : null}
        <ul className="max-h-72 divide-y divide-app-border overflow-y-auto rounded-[var(--radius-control)] border border-app-border">
          {list.map((c) => (
            <li key={c.id} className="px-3 py-2"><Checkbox checked={picked.has(c.id)} onChange={() => toggle(c.id, c.name || c.phone)} label={c.name || c.phone} description={c.name ? c.phone : undefined} /></li>
          ))}
          {!list.length ? <li className="px-3 py-6 text-center text-small text-app-muted">No contacts found.</li> : null}
        </ul>
        <Checkbox checked={linkOnly} onChange={(e) => setLinkOnly(e.target.checked)} label="Only make the links" description="Nothing is sent. Copy each link and send it yourself (from your phone, SMS or in person)." />
      </div>
    </Modal>
  );
}

function SettingsTab({ base, onSaved }: { base: string; onSaved: () => void }) {
  const toast = useToast();
  const [s, setS] = React.useState<Settings | null>(null);
  const [tpls, setTpls] = React.useState<Tpl[]>([]);
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    const t = window.setTimeout(async () => {
      const r = await apiFetch<{ settings: Settings; templates: Tpl[] }>(`${base}/settings`);
      if (r.ok) {
        setS(r.data.settings);
        setTpls(r.data.templates);
      }
    }, 0);
    return () => clearTimeout(t);
  }, [base]);
  if (!s) return <LoadingState />;
  async function save() {
    setBusy(true);
    const r = await apiFetch(`${base}/settings`, { method: "PUT", body: s });
    setBusy(false);
    if (!r.ok) return toast(r.error, "error");
    toast("Review settings saved.");
    onSaved();
  }
  const setLoc = (i: number, p: Partial<Settings["locations"][number]>) => setS((x) => x && { ...x, locations: x.locations.map((l, j) => (j === i ? { ...l, ...p } : l)) });
  return (
    <Card>
      <CardHeader title="Review settings" action={<Button size="sm" onClick={() => void save()} loading={busy}>Save</Button>} />
      <CardBody className="space-y-5">
        <div>
          <p className="mb-1 text-small font-medium text-app-text">Locations and Google review links</p>
          <p className="mb-2 text-caption text-app-subtle">In Google Business Profile: Home → “Ask for reviews” → copy the link (starts with https://g.page/r/…).</p>
          <div className="space-y-2">
            {s.locations.map((l, i) => (
              <div key={i} className="grid gap-2 sm:grid-cols-[12rem_1fr_auto]">
                <Input aria-label="Location name" value={l.name} onChange={(e) => setLoc(i, { name: e.target.value })} maxLength={60} />
                <Input aria-label="Google review link" value={l.reviewUrl} onChange={(e) => setLoc(i, { reviewUrl: e.target.value })} placeholder="https://g.page/r/..." />
                <Button size="sm" variant="ghost" disabled={s.locations.length < 2} onClick={() => setS((x) => x && { ...x, locations: x.locations.filter((_, j) => j !== i) })} aria-label="Remove location"><Trash2 className="size-4" /></Button>
              </div>
            ))}
            {s.locations.length < 20 ? <Button size="sm" variant="secondary" onClick={() => setS((x) => x && { ...x, locations: [...x.locations, { name: `Branch ${x.locations.length + 1}`, reviewUrl: "" }] })}><Plus className="size-4" aria-hidden="true" /> Add location</Button> : null}
          </div>
        </div>
        <Field id="rv-msg" label="WhatsApp message" hint="{name} = first name, {link} = their feedback link. Used when they messaged you in the last 24 hours.">
          <Textarea value={s.message} onChange={(e) => setS((x) => x && { ...x, message: e.target.value })} rows={3} maxLength={800} />
        </Field>
        <Field id="rv-tpl" label="Template for everyone else" hint="An approved template with {{1}} = first name and {{2}} = link (or a URL button ending in {{1}}). Without one, those customers get a link to send by hand.">
          <Select value={s.templateId} onChange={(e) => setS((x) => x && { ...x, templateId: e.target.value })}>
            <option value="">No template</option>
            {tpls.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.language})</option>)}
          </Select>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="rv-low" label="Alert me for ratings at or below">
            <Select value={String(s.lowRating)} onChange={(e) => setS((x) => x && { ...x, lowRating: Number(e.target.value) })}>
              {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n} ★</option>)}
            </Select>
          </Field>
          <Field id="rv-cool" label="Don't ask the same customer again within (days)">
            <Input type="number" min={0} max={365} value={s.cooldownDays} onChange={(e) => setS((x) => x && { ...x, cooldownDays: Number(e.target.value) })} />
          </Field>
        </div>
        <Alert tone="info">Google&apos;s rules: every customer must be able to review you publicly, not only happy ones. MECGURA shows the Google button to everyone after they rate, and only uses low ratings to alert you privately.</Alert>
      </CardBody>
    </Card>
  );
}
