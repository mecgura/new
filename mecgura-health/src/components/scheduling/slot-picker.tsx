"use client";
import { useEffect, useState } from "react";
import { Alert, DatePicker, Field, LoadingState } from "@/components/ui";
import { apiFetch } from "@/lib/api/client";
import { cn } from "@/lib/cn";

interface SlotsResponse { tz: string; reason: string; message: string; slots: { startsAt: string; label: string }[] }

/** Date + slot grid for ONE doctor. Slots come from the server (staff view); the choice is re-validated again on save. */
export function SlotPicker({ doctorUserId, date, onDate, value, onChange, exceptId, error, minDate }: { doctorUserId: string; date: string; onDate: (d: string) => void; value: string; onChange: (iso: string) => void; exceptId?: string; error?: string; minDate?: string }) {
  const [res, setRes] = useState<SlotsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string>();

  useEffect(() => {
    if (!doctorUserId || !date) { setRes(null); return; }
    let live = true;
    setLoading(true); setErr(undefined);
    apiFetch<SlotsResponse>(`/api/appointments/slots?doctorUserId=${encodeURIComponent(doctorUserId)}&date=${date}${exceptId ? `&except=${encodeURIComponent(exceptId)}` : ""}`).then((r) => {
      if (!live) return;
      setLoading(false);
      if (r.ok) setRes(r.data); else { setRes(null); setErr(r.error.message); }
    });
    return () => { live = false; };
  }, [doctorUserId, date, exceptId]);

  return (
    <div className="space-y-3">
      <Field label="Date" required><DatePicker value={date} min={minDate} onChange={(e) => { onDate(e.target.value); onChange(""); }} /></Field>
      <div>
        <p className="type-label mb-1.5">Time{error && <span role="alert" className="type-caption ml-2 !text-danger">{error}</span>}</p>
        {!doctorUserId && <p className="type-secondary">Choose a doctor first.</p>}
        {loading && <LoadingState label="Finding free slots…" className="!py-6" />}
        {err && <Alert tone="danger">{err}</Alert>}
        {res && !loading && !res.slots.length && <Alert tone="info">{res.message || "No free slots on this date."}</Alert>}
        {res && !loading && res.slots.length > 0 && (
          <div role="radiogroup" aria-label="Available times" className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {res.slots.map((s) => (
              <button key={s.startsAt} type="button" role="radio" aria-checked={value === s.startsAt} onClick={() => onChange(s.startsAt)}
                className={cn("min-h-control rounded-md border px-2 text-sm font-semibold", value === s.startsAt ? "border-primary bg-primary text-on-brand" : "border-line-strong bg-surface hover:bg-surface-muted")}>{s.label}</button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
