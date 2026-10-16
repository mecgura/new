"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Bell } from "lucide-react";
import { apiFetch } from "@/lib/api/client";
import { PriorityMark, ago, actionLabel, type Row } from "./labels";

/**
 * Header bell. The count refreshes every 30 s and when the tab regains focus (polling — there is no push channel, so this is NOT real-time).
 * Opening the list never marks anything read; opening an item does (on the server).
 */
export function NotificationBell({ api = "/api/notifications", allHref = "/notifications", portal = false }: { api?: string; allHref?: string; portal?: boolean }) {
  const router = useRouter(); const [open, setOpen] = useState(false); const [count, setCount] = useState<{ unread: number; urgent: number } | null>(null); const [rows, setRows] = useState<Row[] | null>(null); const [err, setErr] = useState(false);
  const box = useRef<HTMLDivElement>(null); const btn = useRef<HTMLButtonElement>(null);
  const refresh = useCallback(async () => { const r = await apiFetch<{ unread: number; urgent: number }>(`${api}/unread-count`); if (r.ok) setCount(r.data); }, [api]);
  useEffect(() => { void refresh(); const t = setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 30_000); const f = () => void refresh(); window.addEventListener("focus", f); return () => { clearInterval(t); window.removeEventListener("focus", f); }; }, [refresh]);
  const load = useCallback(async () => { const r = await apiFetch<{ rows: Row[] }>(`${api}?pageSize=8&filter=all`); if (r.ok) { setRows(r.data.rows); setErr(false); } else setErr(true); }, [api]);
  useEffect(() => { if (!open) return; void load(); const out = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false); }; const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); btn.current?.focus(); } }; document.addEventListener("mousedown", out); document.addEventListener("keydown", esc); return () => { document.removeEventListener("mousedown", out); document.removeEventListener("keydown", esc); }; }, [open, load]);
  const n = count?.unread ?? 0; const badge = n > 99 ? "99+" : String(n);
  async function openItem(r: Row) { setOpen(false); if (!r.read) await apiFetch(`${api}/${r.id}/read`, { method: "PATCH" }); void refresh(); router.push(r.actionUrl ?? allHref); }
  async function markAll() { await apiFetch(`${api}/mark-all-read`, { method: "POST" }); await Promise.all([load(), refresh()]); }
  return (
    <div className="relative">
      <button ref={btn} type="button" aria-haspopup="dialog" aria-expanded={open} aria-controls="notif-panel" aria-label={n ? `Notifications, ${n} unread${count?.urgent ? `, ${count.urgent} urgent` : ""}` : "Notifications, none unread"} onClick={() => setOpen((o) => !o)} className="relative flex size-control items-center justify-center rounded-lg text-muted hover:bg-surface-muted hover:text-foreground">
        <Bell aria-hidden className="size-5" />
        {n > 0 && <span aria-hidden className={`absolute right-1 top-1 min-w-4.5 rounded-pill px-1 text-center text-[10px] font-bold leading-[18px] text-white ${count?.urgent ? "bg-danger" : "bg-primary"}`}>{badge}</span>}
      </button>
      {open && (
        <div ref={box} id="notif-panel" role="dialog" aria-label="Notifications" className="fixed inset-x-2 top-[calc(var(--size-header,3.5rem)+0.25rem)] z-50 max-h-[75dvh] overflow-hidden rounded-xl border border-line bg-surface shadow-lg sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-96">
          <div className="flex items-center justify-between border-b border-line px-4 py-3"><h2 className="type-card-title">Notifications</h2>{n > 0 && <button type="button" onClick={markAll} className="type-label text-primary underline">Mark all read</button>}</div>
          <div className="max-h-[55dvh] overflow-y-auto">
            {err ? <p className="type-secondary p-4">Couldn&apos;t load notifications. Try again in a moment.</p> : !rows ? <p className="type-secondary p-4">Loading…</p> : !rows.length ? <p className="type-secondary p-4">You&apos;re all caught up.</p> : (
              <ul className="divide-y divide-line">{rows.map((r) => (
                <li key={r.id}>
                  <button type="button" onClick={() => openItem(r)} className={`block min-h-11 w-full px-4 py-3 text-left hover:bg-surface-muted ${r.read ? "" : "bg-primary-soft/40"}`}>
                    <span className="flex items-start gap-2">
                      <span aria-hidden className={`mt-1.5 size-2 shrink-0 rounded-full ${r.read ? "bg-transparent" : "bg-primary"}`} />
                      <span className="min-w-0 flex-1"><span className="flex items-center justify-between gap-2"><span className={`truncate ${r.read ? "type-body" : "type-label"}`}>{r.title}{!r.read && <span className="sr-only"> (unread)</span>}</span><span className="type-caption shrink-0">{ago(r.createdAt)}</span></span>
                        {r.body && <span className="type-secondary line-clamp-2 block">{r.body}</span>}
                        <span className="mt-1 flex items-center gap-2"><PriorityMark priority={r.priority} compact /><span className="type-caption">{r.categoryLabel}</span>{r.ackRequired && !r.acknowledged && <span className="type-caption font-semibold">Needs acknowledgement</span>}{r.actionUrl && <span className="type-caption ml-auto text-primary">{actionLabel(r)} →</span>}</span></span>
                    </span>
                  </button>
                </li>))}</ul>
            )}
          </div>
          <div className="border-t border-line px-4 py-2.5 text-center"><Link href={allHref} onClick={() => setOpen(false)} className="type-label text-primary underline">View all{portal ? "" : " notifications"}</Link></div>
        </div>
      )}
    </div>
  );
}
