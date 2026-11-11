"use client";
import { Alert, Badge, Button, LoadingState } from "@/components/ui";
import { cn } from "@/lib/cn";
import { usePolling } from "./use-poll";

interface Status { token: string; status: string; message: string; active: boolean; emergency: boolean; doctorName: string; room: string | null; clinicName: string; date: string; patientsAhead: number | null; estimatedWaitMinutes: number | null; nowServing: string | null }

/** Patient-facing token page. No name, phone or medical detail — just the token and where it stands. */
export function TokenStatus({ token }: { token: string }) {
  const { data, error, loading, refresh } = usePolling<Status>(`/api/public/token/${token}`, { intervalMs: 10000 });
  if (loading && !data) return <LoadingState label="Checking your token…" />;
  if (error && !data) return <Alert tone="danger" title={error.code === "NOT_FOUND" ? "Token not found" : "Couldn't load your token"}>{error.code === "NOT_FOUND" ? "Check the link you were given, or ask the reception." : error.message}</Alert>;
  if (!data) return null;
  const hot = data.status === "CALLED";
  return (
    <div className="mx-auto max-w-md space-y-4" aria-live="polite">
      <div className={cn("rounded-card border-2 p-6 text-center", hot ? "border-success bg-success-soft" : data.emergency ? "border-emergency bg-danger-soft" : "border-line bg-surface")}>
        <p className="text-sm text-muted">{data.clinicName} · {data.date}</p>
        <p className="mt-1 text-sm font-semibold uppercase tracking-wide text-muted">Your token</p>
        <p className="text-7xl font-extrabold tabular-nums" aria-label={`Token ${data.token}`}>{data.token}</p>
        <p className="mt-2 text-lg font-semibold">{data.message}</p>
        {data.emergency && <Badge tone="emergency" className="mt-2">Priority</Badge>}
      </div>
      <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-2 rounded-card border border-line p-4 text-sm">
        <dt className="text-muted">Doctor</dt><dd>{data.doctorName}{data.room ? ` · ${data.room}` : ""}</dd>
        {data.nowServing && <><dt className="text-muted">Now serving</dt><dd className="font-semibold tabular-nums">{data.nowServing}</dd></>}
        {data.patientsAhead != null && <><dt className="text-muted">People ahead</dt><dd>{data.patientsAhead}</dd></>}
        {data.estimatedWaitMinutes != null && <><dt className="text-muted">Estimated wait</dt><dd>About {data.estimatedWaitMinutes} min <span className="text-muted">(an estimate, not a promise)</span></dd></>}
      </dl>
      {error && <Alert tone="warning">We couldn&apos;t refresh just now. What you see may be out of date.</Alert>}
      <Button variant="outline" className="w-full" onClick={refresh}>Refresh</Button>
      <p className="text-center text-xs text-muted">This page updates every few seconds. Please stay within the clinic.</p>
    </div>
  );
}
