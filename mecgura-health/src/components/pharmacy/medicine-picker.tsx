"use client";
import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { Button, Field, StatusBadge, TextInput } from "@/components/ui";
import { apiFetch } from "@/lib/api/client";
import type { MedicineRow } from "@/lib/services/pharmacy-master";
import { STOCK_LABEL, STOCK_TONE } from "./pharmacy-ui";

/** Debounced server-side medicine search (never loads the whole master into the browser). */
export function MedicinePicker({ value, onPick, label = "Medicine", error, required, initial }: { value: MedicineRow | null; onPick: (m: MedicineRow | null) => void; label?: string; error?: string; required?: boolean; initial?: string }) {
  const [q, setQ] = useState(initial ?? ""); const [rows, setRows] = useState<MedicineRow[] | null>(null);
  useEffect(() => {
    if (value || q.trim().length < 2) { setRows(null); return; }
    const t = setTimeout(async () => { const r = await apiFetch<{ rows: MedicineRow[] }>(`/api/pharmacy/medicines/pick?q=${encodeURIComponent(q.trim())}`); if (r.ok) setRows(r.data.rows); }, 250);
    return () => clearTimeout(t);
  }, [q, value]);
  if (value) return <Field label={label} required={required} error={error}><div className="flex items-center justify-between gap-2 rounded-md border border-line p-2"><span className="type-label min-w-0 break-words">{value.displayName} <span className="type-caption">{value.medicineCode}</span></span><Button size="sm" variant="ghost" aria-label={`Choose a different ${label.toLowerCase()}`} onClick={() => onPick(null)}><X aria-hidden className="size-4" /></Button></div></Field>;
  return (
    <div className="space-y-2">
      <Field label={label} required={required} error={error} hint="Search by name, code, strength, manufacturer or barcode (at least 2 characters)"><TextInput value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" /></Field>
      {rows && (rows.length ? <ul className="max-h-48 divide-y divide-line overflow-y-auto rounded-md border border-line" aria-label="Medicine results">{rows.map((m) => <li key={m.id}><button type="button" className="flex w-full flex-wrap items-center justify-between gap-2 p-2 text-left hover:bg-surface-muted" onClick={() => onPick(m)}><span><span className="type-label">{m.displayName}</span> <span className="type-caption">{m.medicineCode}{m.manufacturer ? ` · ${m.manufacturer}` : ""}</span></span><StatusBadge tone={STOCK_TONE[m.stockStatus]}>{STOCK_LABEL[m.stockStatus]} · {m.availableQuantity}</StatusBadge></button></li>)}</ul> : <p className="type-secondary">No medicines found.</p>)}
    </div>
  );
}
