"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";

const input = "type-body min-h-control w-full rounded-md border border-line-strong bg-surface px-3";
export interface ScheduleRow { id: string; name: string; reportKey: string; reportName: string; frequency: string; format: string; filters: Record<string, string> }
/** Saves scheduled-report DEFINITIONS only. Nothing is generated or sent from here. */
export function ScheduleManager({ reports, schedules, canConfigure, notice }: { reports: { key: string; name: string }[]; schedules: ScheduleRow[]; canConfigure: boolean; notice: string }) {
  const router = useRouter(); const [pending, start] = useTransition(); const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function add(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); const f = new FormData(e.currentTarget); setMsg(null);
    const res = await fetch("/api/analytics/schedules", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: f.get("name"), reportKey: f.get("reportKey"), frequency: f.get("frequency"), format: f.get("format"), preset: f.get("preset") }) });
    const json = await res.json().catch(() => null);
    if (res.ok && json?.ok) { (e.target as HTMLFormElement).reset(); setMsg({ ok: true, text: "Saved." }); start(() => router.refresh()); } else setMsg({ ok: false, text: json?.error?.message ?? "Couldn't save the schedule." });
  }
  async function remove(id: string) {
    const res = await fetch(`/api/analytics/schedules/${id}`, { method: "DELETE" }); const json = await res.json().catch(() => null);
    if (res.ok && json?.ok) start(() => router.refresh()); else setMsg({ ok: false, text: json?.error?.message ?? "Couldn't delete." });
  }
  return (
    <div className="space-y-4">
      <p className="type-secondary rounded-md bg-surface-muted p-3">{notice}</p>
      {schedules.length === 0 ? <p className="type-secondary">No scheduled reports saved.</p> : (
        <ul className="divide-y divide-line">{schedules.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2"><span className="type-secondary"><strong>{s.name}</strong> — {s.reportName}, {s.frequency.toLowerCase()}, {s.format}{s.filters.preset ? `, ${s.filters.preset}` : ""}</span>
            {canConfigure && <Button type="button" variant="outline" size="sm" onClick={() => remove(s.id)} aria-label={`Delete scheduled report ${s.name}`}>Delete</Button>}</li>))}</ul>
      )}
      {canConfigure && (
        <form onSubmit={add} aria-label="Add scheduled report" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <label className="type-caption block lg:col-span-2">Name<input name="name" className={input} required minLength={2} maxLength={80} /></label>
          <label className="type-caption block lg:col-span-2">Report<select name="reportKey" className={input}>{reports.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}</select></label>
          <label className="type-caption block">Frequency<select name="frequency" className={input}><option value="DAILY">Daily</option><option value="WEEKLY">Weekly</option><option value="MONTHLY">Monthly</option></select></label>
          <label className="type-caption block">Format<select name="format" className={input}><option>CSV</option><option>XLSX</option><option>PDF</option></select></label>
          <label className="type-caption block">Range<select name="preset" className={input}><option value="last7">Last 7 days</option><option value="last30">Last 30 days</option><option value="lastMonth">Last month</option><option value="thisMonth">This month</option></select></label>
          <div className="flex items-end"><Button type="submit" loading={pending}>Save definition</Button></div>
          {msg && <p role={msg.ok ? "status" : "alert"} className={`type-secondary sm:col-span-2 lg:col-span-6 ${msg.ok ? "text-success" : "text-danger"}`}>{msg.text}</p>}
        </form>
      )}
    </div>
  );
}
