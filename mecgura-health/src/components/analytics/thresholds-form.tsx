"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";

interface Meta { label: string; min: number; max: number; unit: string }
const input = "type-body min-h-control w-full rounded-md border border-line-strong bg-surface px-3";
export function ThresholdsForm({ thresholds, defaults, meta }: { thresholds: Record<string, number>; defaults: Record<string, number>; meta: Record<string, Meta> }) {
  const router = useRouter(); const [vals, setVals] = useState<Record<string, string>>(Object.fromEntries(Object.entries(thresholds).map(([k, v]) => [k, String(v)])));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null); const [pending, start] = useTransition();
  async function save(e: React.FormEvent) {
    e.preventDefault(); setMsg(null);
    const body: Record<string, number> = {}; for (const [k, v] of Object.entries(vals)) { const n = Number(v); if (!Number.isInteger(n)) { setMsg({ ok: false, text: `${meta[k].label} must be a whole number.` }); return; } body[k] = n; }
    const res = await fetch("/api/analytics/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => null);
    if (res.ok && json?.ok) { setMsg({ ok: true, text: "Thresholds saved." }); start(() => router.refresh()); } else setMsg({ ok: false, text: json?.error?.message ?? "Couldn't save. Check the values and try again." });
  }
  return (
    <form onSubmit={save} aria-label="Insight thresholds" className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Object.keys(meta).map((k) => (
          <label key={k} className="type-caption block">{meta[k].label}{meta[k].unit ? ` (${meta[k].unit})` : ""}
            <input className={input} inputMode="numeric" value={vals[k] ?? ""} onChange={(e) => setVals((s) => ({ ...s, [k]: e.target.value }))} aria-describedby={`${k}-hint`} />
            <span id={`${k}-hint`} className="type-caption">Allowed {meta[k].min}–{meta[k].max} · default {defaults[k]}</span>
          </label>
        ))}
      </div>
      <div className="flex items-center gap-3"><Button type="submit" loading={pending}>Save thresholds</Button>{msg && <p role={msg.ok ? "status" : "alert"} className={`type-secondary ${msg.ok ? "text-success" : "text-danger"}`}>{msg.text}</p>}</div>
    </form>
  );
}
