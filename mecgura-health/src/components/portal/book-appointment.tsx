"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { Alert, Button, ButtonLink, Field, LoadingState, Select, Textarea, TextInput, useToast } from "@/components/ui";
import { apiFetch } from "@/lib/api/client";
import { dayLabel } from "./portal-labels";

interface Options { enabled: boolean; message: string | null; clinic: { name: string; phone: string | null; email: string | null; address: string | null }; tz: string; doctors: { doctor: string; name: string; specialization: string | null; advanceDays: number }[]; services: { id: string; title: string }[] }
interface SlotRes { tz: string; reason: string; message: string; slots: { startsAt: string; label: string }[] }
const today = () => new Date().toISOString().slice(0, 10);
const plusDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

/** Doctor → date → real slots from the clinic's schedule → confirm. Nothing here invents availability; the server re-validates the slot. */
export function BookAppointment({ options }: { options: Options }) {
  const router = useRouter(); const toast = useToast();
  const [doctor, setDoctor] = useState(options.doctors.length === 1 ? options.doctors[0].doctor : ""); const [date, setDate] = useState(""); const [slots, setSlots] = useState<SlotRes | null>(null); const [loading, setLoading] = useState(false);
  const [slot, setSlot] = useState(""); const [service, setService] = useState(""); const [reason, setReason] = useState(""); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string>(); const [done, setDone] = useState<{ id: string; status: string } | null>(null);
  useEffect(() => {
    if (!doctor || !date) return;
    let live = true; const t = setTimeout(async () => { setLoading(true); setSlot(""); setErr(undefined); const r = await apiFetch<SlotRes>(`/api/patient/booking/slots?doctor=${encodeURIComponent(doctor)}&date=${date}`); if (!live) return; setLoading(false); if (r.ok) setSlots(r.data); else { setSlots(null); setErr(r.error.message); } }, 0);
    return () => { live = false; clearTimeout(t); };
  }, [doctor, date]);
  if (!options.enabled) return <Alert tone="info" title="Online booking isn't available">{options.message}{options.clinic.phone && <> Call <a href={`tel:${options.clinic.phone}`}>{options.clinic.phone}</a>.</>}</Alert>;
  if (!options.doctors.length) return <Alert tone="info" title="No doctors are open for online booking right now">Please call the clinic{options.clinic.phone ? <> on <a href={`tel:${options.clinic.phone}`}>{options.clinic.phone}</a></> : null} to book.</Alert>;
  const dr = options.doctors.find((d) => d.doctor === doctor);
  async function confirm() {
    setBusy(true); setErr(undefined);
    const r = await apiFetch<{ id: string; status: string }>("/api/patient/appointments", { method: "POST", body: JSON.stringify({ doctor, startsAt: slot, serviceId: service || undefined, reason: reason || undefined }) });
    setBusy(false);
    if (!r.ok) { setErr(r.error.message); const s = await apiFetch<SlotRes>(`/api/patient/booking/slots?doctor=${encodeURIComponent(doctor)}&date=${date}`); if (s.ok) setSlots(s.data); setSlot(""); return; }
    toast({ tone: "success", title: r.data.status === "CONFIRMED" ? "Appointment confirmed" : "Request sent" }); setDone(r.data); router.refresh();
  }
  if (done) return (
    <div className="space-y-4 rounded-2xl border border-line bg-surface p-6 text-center">
      <CheckCircle2 aria-hidden className="mx-auto size-12 text-success" />
      <h2 className="type-page-title">{done.status === "CONFIRMED" ? "You're booked" : "Request received"}</h2>
      <p className="type-secondary">{done.status === "CONFIRMED" ? "Your appointment is confirmed." : "The clinic will confirm your appointment shortly."} Reference <strong className="tabular-nums">{done.id}</strong></p>
      <div className="flex flex-wrap justify-center gap-2"><ButtonLink href={`/portal/appointments/${done.id}`}>View appointment</ButtonLink><ButtonLink href="/portal/dashboard" variant="outline">Home</ButtonLink></div>
    </div>
  );
  return (
    <div className="space-y-5 rounded-2xl border border-line bg-surface p-4 sm:p-6">
      {err && <Alert tone="danger">{err}</Alert>}
      <Field label="Doctor" required><Select value={doctor} placeholder="Choose a doctor" onChange={(e) => { setDoctor(e.target.value); setSlots(null); setSlot(""); }} options={options.doctors.map((d) => ({ value: d.doctor, label: `${d.name}${d.specialization ? ` — ${d.specialization}` : ""}` }))} /></Field>
      {options.services.length > 0 && <Field label="Service (optional)"><Select value={service} placeholder="Not sure / general visit" onChange={(e) => setService(e.target.value)} options={options.services.map((s) => ({ value: s.id, label: s.title }))} /></Field>}
      <Field label="Date" required hint={dr ? `You can book up to ${dr.advanceDays} days ahead.` : undefined}><TextInput type="date" value={date} min={today()} max={plusDays(dr?.advanceDays ?? 30)} onChange={(e) => setDate(e.target.value)} disabled={!doctor} /></Field>
      {doctor && date && (
        <fieldset>
          <legend className="type-label mb-2">Available times on {dayLabel(date)}</legend>
          {loading ? <LoadingState label="Checking the doctor's schedule…" /> : !slots ? null : !slots.slots.length ? <Alert tone="info">{slots.message || "No times are available on this day. Try another date."}</Alert> : (
            <div role="radiogroup" aria-label="Available times" className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {slots.slots.map((s) => <button key={s.startsAt} type="button" role="radio" aria-checked={slot === s.startsAt} onClick={() => setSlot(s.startsAt)} className={`type-label min-h-12 rounded-lg border px-2 ${slot === s.startsAt ? "border-primary bg-primary text-on-brand" : "border-line-strong bg-surface hover:bg-surface-muted"}`}>{s.label}</button>)}
            </div>
          )}
        </fieldset>
      )}
      {slot && (
        <>
          <Field label="Reason for the visit (optional)" hint="A few words help the doctor prepare. Don't include sensitive details."><Textarea rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          <div className="rounded-lg bg-surface-muted p-3"><p className="type-label">{dr?.name} · {dayLabel(date)} · {slots?.slots.find((s) => s.startsAt === slot)?.label}</p><p className="type-caption">at {options.clinic.name}</p></div>
          <Button size="lg" className="w-full" onClick={confirm} loading={busy}>Confirm appointment</Button>
        </>
      )}
      <p className="type-caption"><Link href="/portal/appointments">Cancel</Link></p>
    </div>
  );
}
