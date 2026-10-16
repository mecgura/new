"use client";
import { useEffect, useState } from "react";
import { Globe } from "lucide-react";
import { Alert, Field, SearchInput } from "@/components/ui";
import { apiFetch } from "@/lib/api/client";

interface Hit { name: string; genericName?: string | null; brandName?: string | null; strength?: string | null; form?: string | null }
interface Result { enabled: boolean; source: string | null; attribution: string | null; items: Hit[] }

/** Optional helper above the Add-medicine form: look a medicine up online and pre-fill the name, strength and form. Prices and stock stay yours to enter. */
export function OnlineMedicineSearch({ onPick }: { onPick: (h: Hit) => void }) {
  const [q, setQ] = useState(""); const [res, setRes] = useState<Result | null>(null); const [msg, setMsg] = useState<string>(); const [busy, setBusy] = useState(false); const [enabled, setEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    if (q.trim().length < 2) { setRes(null); setMsg(undefined); return; }
    const t = setTimeout(async () => {
      setBusy(true); const r = await apiFetch<Result>(`/api/pharmacy/medicines/online?q=${encodeURIComponent(q.trim())}`); setBusy(false);
      if (r.ok) { setEnabled(r.data.enabled); setRes(r.data); setMsg(undefined); } else { setRes(null); setMsg(r.error.message); }
    }, 450);
    return () => clearTimeout(t);
  }, [q]);
  if (enabled === false) return null; // the owner hasn't switched online search on
  return (
    <div className="rounded-lg border border-line bg-white/50 p-3">
      <Field label="Search online (optional)" hint="Type a medicine name to pre-fill the form. Prices and stock are yours to enter.">
        <SearchInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. paracetamol, amoxicillin" aria-label="Search medicines online" />
      </Field>
      {msg && <div className="mt-2"><Alert tone="warning">{msg}</Alert></div>}
      {busy && <p className="type-caption mt-2" role="status">Searching…</p>}
      {res && !busy && (
        res.items.length ? (
          <ul aria-label="Online results" className="mt-2 max-h-48 divide-y divide-line overflow-auto rounded-md border border-line bg-white/70">
            {res.items.map((h) => (
              <li key={h.name}><button type="button" onClick={() => { onPick(h); setQ(""); setRes(null); }} className="type-body flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left hover:bg-primary-soft focus:bg-primary-soft focus:outline-none">
                <span className="font-semibold">{h.brandName ?? h.genericName}{h.strength ? ` · ${h.strength}` : ""}</span>
                <span className="type-caption">{[h.brandName ? h.genericName : null, h.form].filter(Boolean).join(" · ") || h.name}</span>
              </button></li>
            ))}
          </ul>
        ) : <p className="type-caption mt-2">No match online. Many Indian brand names aren&apos;t listed; type the medicine in yourself.</p>
      )}
      {res?.attribution && <p className="type-caption mt-2 flex items-center gap-1"><Globe aria-hidden className="size-3.5" />{res.attribution}. Suggestions only; check strength and form before saving.</p>}
    </div>
  );
}
