"use client";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { PRESET_LABEL, RANGE_PRESETS } from "@/lib/analytics/range";
import { Button } from "@/components/ui";

const input = "type-body min-h-control w-full rounded-md border border-line-strong bg-surface px-3";
export interface Extra { name: string; label: string; options: { value: string; label: string }[] }

/** Global date range + comparison + doctor filter. It only builds a URL: the server re-validates every value and decides what the user may see. */
export function RangeFilter({ doctors, extras = [] }: { doctors?: { id: string; name: string }[]; extras?: Extra[] }) {
  const router = useRouter(); const path = usePathname(); const sp = useSearchParams(); const [pending, start] = useTransition();
  const [preset, setPreset] = useState(sp.get("preset") ?? "last30"); const [from, setFrom] = useState(sp.get("from") ?? ""); const [to, setTo] = useState(sp.get("to") ?? "");
  const [compare, setCompare] = useState(sp.get("compare") === "1" || sp.get("compare") === "true"); const [doctorId, setDoctorId] = useState(sp.get("doctorId") ?? "");
  const [extra, setExtra] = useState<Record<string, string>>(Object.fromEntries(extras.map((e) => [e.name, sp.get(e.name) ?? ""])));
  const [err, setErr] = useState<string | null>(null);
  function go(refresh = false) {
    if (preset === "custom" && (!from || !to)) { setErr("Choose both a start and an end date."); return; }
    if (preset === "custom" && from > to) { setErr("The start date is after the end date."); return; }
    setErr(null);
    const q = new URLSearchParams({ preset }); if (preset === "custom") { q.set("from", from); q.set("to", to); }
    if (compare) q.set("compare", "1"); if (doctorId) q.set("doctorId", doctorId); if (refresh) q.set("refresh", "1");
    for (const [k, v] of Object.entries(extra)) if (v) q.set(k, v);
    start(() => router.push(`${path}?${q}`));
  }
  return (
    <form onSubmit={(e) => { e.preventDefault(); go(); }} aria-label="Date range and filters" className="grid gap-3 rounded-lg border border-line bg-surface p-3 sm:grid-cols-2 lg:grid-cols-6">
      <label className="type-caption block">Date range
        <select className={input} value={preset} onChange={(e) => setPreset(e.target.value)} name="preset">{RANGE_PRESETS.map((p) => <option key={p} value={p}>{PRESET_LABEL[p]}</option>)}</select>
      </label>
      {preset === "custom" && <>
        <label className="type-caption block">From<input type="date" className={input} value={from} onChange={(e) => setFrom(e.target.value)} name="from" required /></label>
        <label className="type-caption block">To<input type="date" className={input} value={to} onChange={(e) => setTo(e.target.value)} name="to" required /></label>
      </>}
      {doctors && doctors.length > 0 && <label className="type-caption block">Doctor
        <select className={input} value={doctorId} onChange={(e) => setDoctorId(e.target.value)} name="doctorId"><option value="">All doctors</option>{doctors.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
      </label>}
      {extras.map((x) => <label key={x.name} className="type-caption block">{x.label}
        <select className={input} value={extra[x.name] ?? ""} onChange={(e) => setExtra((s) => ({ ...s, [x.name]: e.target.value }))} name={x.name}><option value="">All</option>{x.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
      </label>)}
      <label className="type-body flex min-h-control items-end gap-2 pb-2"><input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} name="compare" className="size-4" />Compare with previous period</label>
      <div className="flex items-end gap-2">
        <Button type="submit" loading={pending}>Apply</Button>
        <Button type="button" variant="outline" onClick={() => go(true)} aria-label="Refresh data now" disabled={pending}><RefreshCw aria-hidden className="size-4" /></Button>
      </div>
      {err && <p role="alert" className="type-caption text-danger sm:col-span-2 lg:col-span-6">{err}</p>}
    </form>
  );
}
