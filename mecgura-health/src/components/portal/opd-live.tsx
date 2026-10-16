"use client";
import { useCallback, useEffect, useState } from "react";
import { RefreshCw, WifiOff } from "lucide-react";
import { Alert, Button } from "@/components/ui";
import { apiFetch } from "@/lib/api/client";
import { OPD_STATUS } from "./portal-labels";
import { StatusBadge } from "@/components/ui";

interface Item { token: string; status: string; message: string; active: boolean; emergency: boolean; doctorName: string; room: string | null; patientsAhead: number | null; estimatedWaitMinutes: number | null; nowServing: string | null }
interface Data { updatedAt: string; date: string; clinicName: string; items: Item[] }
const POLL_MS = 15_000;
/** The queue has no push channel, so this page POLLS every 15 seconds (and says so). It shows the patient's own token only. */
export function OpdLive({ initial }: { initial: Data }) {
  const [data, setData] = useState(initial); const [failed, setFailed] = useState(false); const [loading, setLoading] = useState(false); const [now, setNow] = useState(() => Date.now());
  const refresh = useCallback(async () => { setLoading(true); const r = await apiFetch<Data>("/api/patient/opd"); setLoading(false); if (r.ok) { setData(r.data); setFailed(false); } else setFailed(true); }, []);
  useEffect(() => { const t = setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, POLL_MS); const c = setInterval(() => setNow(Date.now()), 5000); return () => { clearInterval(t); clearInterval(c); }; }, [refresh]);
  const age = Math.max(0, Math.round((now - Date.parse(data.updatedAt)) / 1000)); const stale = failed || age > POLL_MS / 1000 * 3;
  return (
    <div className="space-y-4">
      {stale && <Alert tone="warning" title={failed ? "Can't reach the clinic right now" : "This may be out of date"}><span className="inline-flex items-center gap-1"><WifiOff aria-hidden className="size-4" />Last updated {age < 60 ? `${age} seconds` : `${Math.round(age / 60)} min`} ago.</span></Alert>}
      {!data.items.length ? (
        <div className="rounded-2xl border border-line bg-surface p-8 text-center"><p className="type-card-title">You don&apos;t have a token today</p><p className="type-secondary mt-1">When you check in at {data.clinicName}, your token appears here.</p></div>
      ) : data.items.map((i) => (
        <article key={i.token} aria-label={`Token ${i.token}`} className="rounded-2xl border border-line bg-surface p-5">
          <p className="type-caption">Your token</p>
          <div className="mt-1 flex flex-wrap items-center justify-between gap-2"><p className="text-5xl font-bold tabular-nums">{i.token}</p><StatusBadge tone={OPD_STATUS[i.status]?.[1] ?? "neutral"}>{OPD_STATUS[i.status]?.[0] ?? i.status}</StatusBadge></div>
          <p className="type-body mt-3">{i.message}</p>
          <dl className="mt-4 grid grid-cols-2 gap-3">
            <div><dt className="type-caption">Doctor</dt><dd className="type-label">{i.doctorName}{i.room ? ` · ${i.room}` : ""}</dd></div>
            <div><dt className="type-caption">Now serving</dt><dd className="type-label tabular-nums">{i.nowServing ?? "—"}</dd></div>
            {i.patientsAhead != null && <div><dt className="type-caption">Ahead of you</dt><dd className="type-label tabular-nums">{i.patientsAhead}</dd></div>}
            {i.estimatedWaitMinutes != null && i.estimatedWaitMinutes > 0 && <div><dt className="type-caption">Approximate wait</dt><dd className="type-label">about {i.estimatedWaitMinutes} min</dd></div>}
          </dl>
          {i.active ? <p className="type-caption mt-3">Estimates change as the queue moves.</p> : <p className="type-caption mt-3">This visit is finished.</p>}
        </article>
      ))}
      <div className="flex items-center justify-between gap-3"><p className="type-caption" aria-live="polite">Checked {age < 5 ? "just now" : `${age} seconds ago`} · refreshes every {POLL_MS / 1000} seconds</p><Button variant="outline" size="sm" onClick={refresh} loading={loading}><RefreshCw aria-hidden className="size-4" />Refresh</Button></div>
    </div>
  );
}
