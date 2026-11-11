"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ShieldAlert } from "lucide-react";
import { Button, useToast } from "@/components/ui";
import { apiFetch } from "@/lib/api/client";

const mmss = (ms: number) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
/** Shown on EVERY screen while a Super Admin is inside a clinic. Never hidden: it names the clinic, the stated reason and the time left. */
export function ViewingAsBanner({ clinicName, reason, expiresAt }: { clinicName: string; reason?: string | null; expiresAt?: string | null }) {
  const router = useRouter(); const toast = useToast(); const [busy, setBusy] = useState(false);
  const end = expiresAt ? Date.parse(expiresAt) : null; const [left, setLeft] = useState<number | null>(null);
  useEffect(() => { if (!end) return; const tick = () => setLeft(end - Date.now()); const first = setTimeout(tick, 0); const t = setInterval(tick, 1000); return () => { clearTimeout(first); clearInterval(t); }; }, [end]);
  async function exit() {
    setBusy(true);
    const res = await apiFetch("/api/platform/workspace", { method: "DELETE" });
    if (!res.ok) { toast({ tone: "danger", title: "Couldn't exit", description: res.error.message }); setBusy(false); return; }
    router.push("/platform/clinics"); router.refresh();
  }
  return (
    <div role="status" aria-label="Super Admin support access" className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-warning/40 bg-warning-soft px-3 py-2.5">
      <ShieldAlert aria-hidden className="size-5 shrink-0 text-warning" />
      <p className="type-label min-w-0 flex-1"><span className="font-bold tracking-wide">SUPER ADMIN SUPPORT ACCESS</span> <span className="font-normal text-muted">— inside <strong className="text-ink">{clinicName}</strong>. Everything you do here is recorded.{reason ? <> Reason: <em>{reason}</em>.</> : null}{left !== null ? <> <strong className="text-ink tabular-nums">{left > 0 ? `${mmss(left)} left` : "Access has expired — reload"}</strong></> : null}</span></p>
      <Button size="sm" variant="outline" onClick={exit} loading={busy}>End support access</Button>
    </div>
  );
}
