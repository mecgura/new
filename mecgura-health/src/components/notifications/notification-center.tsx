"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Archive, ArchiveRestore, Check, CheckCheck, Search, Settings } from "lucide-react";
import { Alert, Badge, Button, Modal, Select, StatusBadge, TextInput, useToast } from "@/components/ui";
import { apiFetch } from "@/lib/api/client";
import { PriorityMark, actionLabel, ago, full, type Row } from "./labels";

interface Page { rows: Row[]; total: number; page: number; pageSize: number; unreadByCategory: Record<string, number> }
interface Detail extends Row { readAt: string | null; acknowledgedAt: string | null; description: string | null; delivery: { channel: string; label: string; status: string; at: string }[]; inApp: string }
const ALL_CATS: [string, string][] = [["", "All"], ["appointments", "Appointments"], ["opd", "OPD"], ["patients", "Patients"], ["lab", "Lab"], ["clinical", "Prescriptions"], ["followups", "Follow-ups"], ["billing", "Billing"], ["pharmacy", "Pharmacy"], ["security", "Security"], ["system", "System"]];
const PORTAL_CATS: [string, string][] = [["", "All"], ["appointments", "Appointments"], ["lab", "Reports"], ["clinical", "Prescriptions"], ["followups", "Follow-ups"], ["billing", "Billing"], ["security", "Security"]];
const FILTERS: [string, string][] = [["all", "All"], ["unread", "Unread"], ["ack", "Needs acknowledgement"], ["archived", "Archived"], ["expired", "Expired"]];
const CH: Record<string, string> = { WHATSAPP: "WhatsApp", SMS: "SMS", EMAIL: "Email" };
const DS: Record<string, [string, "neutral" | "info" | "success" | "danger" | "warning"]> = { QUEUED: ["Queued", "neutral"], PROCESSING: ["Sending", "info"], RETRYING: ["Retrying", "warning"], SENT: ["Sent", "info"], DELIVERED: ["Delivered", "success"], READ: ["Read", "success"], FAILED: ["Failed", "danger"], NOT_DELIVERED: ["Not delivered", "danger"] };

function useWide() { const [w, setW] = useState(true); useEffect(() => { const m = window.matchMedia("(min-width: 1024px)"); const f = () => setW(m.matches); f(); m.addEventListener("change", f); return () => m.removeEventListener("change", f); }, []); return w; }

/** The full notification centre (staff and patients). All filtering, search and state changes happen on the server. */
export function NotificationCenter({ api = "/api/notifications", portal = false, settingsHref }: { api?: string; portal?: boolean; settingsHref?: string }) {
  const toast = useToast(); const wide = useWide();
  const [f, setF] = useState({ filter: "all", category: "", priority: "", range: "", from: "", to: "", q: "" }); const [qIn, setQIn] = useState(""); const [page, setPage] = useState(1);
  const [data, setData] = useState<Page | null>(null); const [err, setErr] = useState<string | null>(null); const [loading, setLoading] = useState(true); const [sel, setSel] = useState<string | null>(null); const [tick, setTick] = useState(0);
  useEffect(() => { const t = setTimeout(() => { setF((x) => (x.q === qIn ? x : { ...x, q: qIn })); setPage(1); }, 300); return () => clearTimeout(t); }, [qIn]);
  const qs = new URLSearchParams({ ...f, page: String(page) }).toString();
  useEffect(() => { let live = true; setLoading(true); void apiFetch<Page>(`${api}?${qs}`).then((r) => { if (!live) return; setLoading(false); if (r.ok) { setData(r.data); setErr(null); } else setErr(r.error.message); }); return () => { live = false; }; }, [api, qs, tick]);
  useEffect(() => { const t = setInterval(() => { if (document.visibilityState === "visible") setTick((x) => x + 1); }, 60_000); return () => clearInterval(t); }, []); // quiet refresh each minute (polling, not push)
  const reload = () => setTick((x) => x + 1);
  const set = (p: Partial<typeof f>) => { setF({ ...f, ...p }); setPage(1); };
  async function act(path: string, method: string, body?: unknown, ok?: string) { const r = await apiFetch(`${api}${path}`, { method, body: body ? JSON.stringify(body) : undefined }); if (!r.ok) { toast({ tone: "danger", title: r.error.message }); return false; } if (ok) toast({ tone: "success", title: ok }); reload(); return true; }
  const cats = portal ? PORTAL_CATS : ALL_CATS; const pages = Math.max(1, Math.ceil((data?.total ?? 0) / (data?.pageSize ?? 20)));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="type-page-title">Notifications</h1><p className="type-secondary">Updates every minute while this page is open (not instant).</p></div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={async () => { await act("/mark-all-read", "POST", f.category ? { category: f.category } : undefined, "Marked as read"); }}><CheckCheck aria-hidden className="size-4" />Mark all read</Button>
          <Button variant="outline" onClick={() => act("/archive-read", "POST", undefined, "Archived")}><Archive aria-hidden className="size-4" />Archive read</Button>
          {settingsHref && <Link href={settingsHref} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-line px-4 type-label"><Settings aria-hidden className="size-4" />Settings</Link>}
        </div>
      </div>
      {!portal && <TodayStrip />}
      <div role="tablist" aria-label="Notification filter" className="flex flex-wrap gap-1.5">
        {FILTERS.filter(([k]) => !(portal && (k === "ack"))).map(([k, l]) => <button key={k} role="tab" aria-selected={f.filter === k} type="button" onClick={() => set({ filter: k })} className={`min-h-9 rounded-pill border px-3 type-label ${f.filter === k ? "border-primary bg-primary text-white" : "border-line hover:bg-surface-muted"}`}>{l}</button>)}
      </div>
      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1" role="group" aria-label="Category">
        {cats.map(([k, l]) => <button key={k} type="button" aria-pressed={f.category === k} onClick={() => set({ category: k })} className={`min-h-9 shrink-0 rounded-pill border px-3 type-caption font-semibold ${f.category === k ? "border-primary bg-primary-soft text-primary" : "border-line hover:bg-surface-muted"}`}>{l}</button>)}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_12rem_12rem_auto_auto]">
        <div className="relative"><Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" /><TextInput aria-label="Search notifications" type="search" placeholder={portal ? "Search notifications" : "Search title, message, patient or ID"} className="pl-9" value={qIn} onChange={(e) => setQIn(e.target.value)} /></div>
        <Select aria-label="Priority" value={f.priority} placeholder="Any priority" onChange={(e) => set({ priority: e.target.value })} options={[["LOW", "Low"], ["NORMAL", "Normal"], ["HIGH", "High"], ["URGENT", "Urgent"], ["CRITICAL", "Critical"]].map(([value, label]) => ({ value, label }))} />
        <Select aria-label="Date" value={f.range} placeholder="Any date" onChange={(e) => set({ range: e.target.value })} options={[["today", "Today"], ["yesterday", "Yesterday"], ["7d", "Last 7 days"], ["30d", "Last 30 days"], ["custom", "Custom range"]].map(([value, label]) => ({ value, label }))} />
        {f.range === "custom" && <><TextInput aria-label="From date" type="date" value={f.from} onChange={(e) => set({ from: e.target.value })} /><TextInput aria-label="To date" type="date" value={f.to} onChange={(e) => set({ to: e.target.value })} /></>}
      </div>
      {err && <Alert tone="danger">{err}</Alert>}
      <div className={`grid gap-4 ${wide ? "lg:grid-cols-[1fr_24rem]" : ""}`}>
        <section aria-label="Notifications" aria-busy={loading}>
          {!data ? <p className="type-secondary">Loading…</p> : !data.rows.length ? <div className="rounded-xl border border-dashed border-line p-8 text-center"><p className="type-card-title">Nothing here</p><p className="type-secondary mt-1">{f.q || f.category || f.priority || f.range || f.filter !== "all" ? "No notifications match these filters." : "You're all caught up."}</p></div> : (
            <ul className="space-y-2">{data.rows.map((r) => (
              <li key={r.id} className={`rounded-xl border p-3 ${sel === r.id ? "border-primary" : "border-line"} ${r.read ? "bg-surface" : "bg-primary-soft/40"}`}>
                <div className="flex items-start gap-3">
                  <span aria-hidden className={`mt-2 size-2.5 shrink-0 rounded-full ${r.read ? "border border-line-strong" : "bg-primary"}`} />
                  <button type="button" className="min-w-0 flex-1 text-left" onClick={async () => { setSel(r.id); if (!r.read) { await apiFetch(`${api}/${r.id}/read`, { method: "PATCH" }); reload(); } }}>
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5"><span className={r.read ? "type-body" : "type-label"}>{r.title}{!r.read && <span className="sr-only"> (unread)</span>}</span>{r.groupCount > 1 && <Badge tone="neutral">{r.groupCount}</Badge>}<PriorityMark priority={r.priority} compact /></span>
                    {r.body && <span className="type-secondary block break-words">{r.body}</span>}
                    <span className="type-caption block">{r.categoryLabel} · {ago(r.createdAt)}{r.ackRequired && !r.acknowledged ? " · needs acknowledgement" : ""}{r.archived ? " · archived" : ""}{r.expired ? " · expired" : ""}</span>
                  </button>
                  <div className="flex shrink-0 flex-col items-end gap-1.5 sm:flex-row">
                    {r.ackRequired && !r.acknowledged && <Button size="sm" onClick={() => act(`/${r.id}/acknowledge`, "POST", undefined, "Acknowledged")}><Check aria-hidden className="size-4" />Acknowledge</Button>}
                    {r.actionUrl && <Link href={r.actionUrl} onClick={() => { if (!r.read) void apiFetch(`${api}/${r.id}/read`, { method: "PATCH" }); }} className="inline-flex min-h-9 items-center rounded-lg border border-line px-3 type-label hover:bg-surface-muted">{actionLabel(r)}</Link>}
                    <Button size="sm" variant="ghost" aria-label={r.archived ? `Restore: ${r.title}` : `Archive: ${r.title}`} onClick={() => act(`/${r.id}/archive`, "PATCH", { archived: !r.archived })}>{r.archived ? <ArchiveRestore aria-hidden className="size-4" /> : <Archive aria-hidden className="size-4" />}</Button>
                  </div>
                </div>
              </li>))}</ul>
          )}
          {data && data.total > data.pageSize && <nav aria-label="Pages" className="mt-4 flex items-center justify-between"><Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button><span className="type-caption">Page {page} of {pages}</span><Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button></nav>}
        </section>
        {wide && <aside aria-label="Notification details" className="lg:sticky lg:top-20 lg:self-start">{sel ? <DetailPanel api={api} id={sel} portal={portal} /> : <div className="rounded-xl border border-dashed border-line p-6 text-center"><p className="type-secondary">Select a notification to see its details.</p></div>}</aside>}
      </div>
      {!wide && sel && <Modal open onClose={() => setSel(null)} title="Notification"><DetailPanel api={api} id={sel} portal={portal} bare /></Modal>}
    </div>
  );
}

export function DetailPanel({ api, id, portal, bare }: { api: string; id: string; portal: boolean; bare?: boolean }) {
  const [d, setD] = useState<Detail | null>(null); const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => { const r = await apiFetch<Detail>(`${api}/${id}`); if (r.ok) { setD(r.data); setErr(null); } else setErr(r.error.message); }, [api, id]);
  useEffect(() => { setD(null); void load(); }, [load]);
  if (err) return <Alert tone="danger">{err}</Alert>;
  if (!d) return <p className="type-secondary">Loading…</p>;
  return (
    <div className={bare ? "space-y-3" : "space-y-3 rounded-xl border border-line bg-surface p-4"}>
      <div className="flex flex-wrap items-center gap-2"><PriorityMark priority={d.priority} /><span className="type-caption">{d.categoryLabel}</span>{d.archived && <Badge tone="neutral">Archived</Badge>}</div>
      <h2 className="type-card-title break-words">{d.title}</h2>
      {d.body && <p className="type-body break-words">{d.body}</p>}
      <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1.5 text-sm"><dt className="text-muted">Received</dt><dd>{full(d.createdAt)}</dd><dt className="text-muted">In-app</dt><dd>{d.read ? `Read ${full(d.readAt)}` : "Unread"}</dd>
        {!portal && d.entityType && <><dt className="text-muted">Related to</dt><dd>{d.entityType.replace(/_/g, " ")}</dd></>}{d.ackRequired && <><dt className="text-muted">Acknowledged</dt><dd>{d.acknowledged ? full(d.acknowledgedAt) : "Not yet"}</dd></>}</dl>
      {d.description && <p className="type-caption">{d.description}</p>}
      {d.delivery.length > 0 && <div><p className="type-label">Message delivery</p><ul className="mt-1 space-y-1">{d.delivery.map((m, i) => <li key={i} className="flex items-center justify-between gap-2 type-secondary"><span>{CH[m.channel] ?? m.channel} · {m.label}</span><StatusBadge tone={DS[m.status]?.[1]}>{DS[m.status]?.[0] ?? m.status}</StatusBadge></li>)}</ul></div>}
      {d.actionUrl ? <Link href={d.actionUrl} className="inline-flex min-h-11 items-center rounded-lg bg-primary px-4 type-label text-white">{actionLabel(d)}</Link> : <p className="type-caption">There is nothing to open for this notification{portal ? "." : ", or you don't have access to the record."}</p>}
    </div>
  );
}

function TodayStrip() {
  const [d, setD] = useState<{ date: string; appointments: number | null; followUpsDue: number | null; reportsToReview: number | null } | null>(null);
  useEffect(() => { void apiFetch<typeof d>("/api/notifications/summary").then((r) => { if (r.ok) setD(r.data); }); }, []);
  if (!d || (d.appointments === null && d.followUpsDue === null && d.reportsToReview === null)) return null;
  const items: [string, number | null][] = [["Appointments today", d.appointments], ["Follow-ups due", d.followUpsDue], ["Reports to review", d.reportsToReview]];
  return <section aria-label="Today" className="grid grid-cols-3 gap-3">{items.filter(([, v]) => v !== null).map(([l, v]) => <div key={l} className="rounded-xl border border-line bg-surface p-3"><p className="type-caption">{l}</p><p className="text-xl font-semibold tabular-nums">{v}</p></div>)}</section>;
}
