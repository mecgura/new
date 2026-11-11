"use client";
import { useEffect, useState } from "react";
import { CalendarCheck, CheckCircle2 } from "lucide-react";
import { Alert, Button, Checkbox, EmailInput, Field, LoadingState, PhoneInput, Select, TextInput } from "@/components/ui";
import { apiFetch } from "@/lib/api/client";
import { cn } from "@/lib/cn";

interface Options { tz: string; clinicName?: string; bookingMode: "AUTO_CONFIRM" | "REQUIRES_CONFIRMATION"; doctors: { slug: string; name: string; specialization: string | null; advanceDays: number }[]; services: { slug: string; title: string }[] }
interface SlotsRes { tz: string; reason: string; message: string; slots: { startsAt: string; label: string }[] }
interface Done { appointmentId: string; status: "CONFIRMED" | "REQUESTED"; doctorName: string; clinicName: string; startsAt: string; tz: string }

const ymdIn = (tz: string, d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

/**
 * Public online booking. Everything shown (doctors, free slots) comes from the server for THIS clinic's host; the browser
 * never names a clinic, patient or status. The server re-validates the slot when the form is submitted.
 */
export function BookingFlow({ initialDoctor, disabled }: { initialDoctor?: string; disabled?: boolean }) {
  const [opts, setOpts] = useState<Options | null>(null);
  const [loadErr, setLoadErr] = useState<string>();
  const [doctor, setDoctor] = useState(initialDoctor ?? "");
  const [service, setService] = useState("");
  const [date, setDate] = useState("");
  const [slots, setSlots] = useState<SlotsRes | null>(null);
  const [slotsBusy, setSlotsBusy] = useState(false);
  const [startsAt, setStartsAt] = useState("");
  const [v, setV] = useState({ name: "", phone: "", email: "", reason: "", consent: false, website_url: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Done | null>(null);
  const [now] = useState(() => Date.now());

  useEffect(() => {
    if (disabled) return;
    apiFetch<Options>("/api/public/booking/options").then((r) => {
      if (!r.ok) { setLoadErr(r.error.message); return; }
      setOpts(r.data);
      setDate(ymdIn(r.data.tz));
      if (!initialDoctor || !r.data.doctors.some((d) => d.slug === initialDoctor)) setDoctor(r.data.doctors.length === 1 ? r.data.doctors[0].slug : "");
    });
  }, [disabled, initialDoctor]);

  useEffect(() => {
    if (!doctor || !date) { setSlots(null); return; }
    let live = true;
    setSlotsBusy(true); setStartsAt("");
    apiFetch<SlotsRes>(`/api/public/booking/slots?doctor=${encodeURIComponent(doctor)}&date=${date}`).then((r) => {
      if (!live) return;
      setSlotsBusy(false);
      setSlots(r.ok ? r.data : { tz: "", reason: "ERROR", message: r.error.message, slots: [] });
    });
    return () => { live = false; };
  }, [doctor, date]);

  if (disabled) return <Alert tone="info" title="Booking form hidden in preview">Visitors will see the booking form here once online booking is on.</Alert>;
  if (loadErr) return <Alert tone="danger" title="Online booking isn't available right now">{loadErr} Please call the clinic to book.</Alert>;
  if (!opts) return <LoadingState label="Loading booking…" />;
  if (!opts.doctors.length) return (
    <div role="status" className="rounded-card border border-info/30 bg-info-soft p-5">
      <h2 className="text-lg font-semibold">Online booking isn&apos;t available yet</h2>
      <p className="mt-1 text-muted">This clinic hasn&apos;t switched on online appointments. Please contact the clinic directly to arrange a visit.</p>
    </div>
  );

  if (done) {
    const when = new Intl.DateTimeFormat("en-IN", { timeZone: done.tz, weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(done.startsAt));
    return (
      <div role="status" className="space-y-3 rounded-card border border-success/30 bg-success-soft p-5">
        <h2 className="flex items-center gap-2 text-xl font-semibold"><CheckCircle2 aria-hidden className="size-6 text-success" />{done.status === "CONFIRMED" ? "Your appointment is booked" : "Request received"}</h2>
        <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1.5 text-sm">
          <dt className="text-muted">Booking ID</dt><dd className="font-mono font-semibold">{done.appointmentId}</dd>
          <dt className="text-muted">Doctor</dt><dd>{done.doctorName}</dd>
          <dt className="text-muted">When</dt><dd>{when}</dd>
          <dt className="text-muted">Clinic</dt><dd>{done.clinicName}</dd>
        </dl>
        <p>{done.status === "CONFIRMED" ? "Please arrive a few minutes early and give your booking ID at the reception." : "The clinic will confirm your appointment. This is not confirmed until the clinic tells you."}</p>
        <p className="text-sm text-muted">To change or cancel, please call the clinic. In an emergency, contact your local emergency services.</p>
      </div>
    );
  }

  const today = ymdIn(opts.tz);
  const doc = opts.doctors.find((d) => d.slug === doctor);
  const maxDate = doc ? ymdIn(opts.tz, new Date(now + doc.advanceDays * 86_400_000)) : undefined;
  const quick = Array.from({ length: 7 }, (_, i) => ymdIn(opts.tz, new Date(now + i * 86_400_000)));
  const dayLabel = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErrors({}); setMsg(undefined);
    const r = await apiFetch<Done>("/api/public/booking", { method: "POST", body: JSON.stringify({ doctor, service: service || undefined, startsAt, ...v, email: v.email || undefined, reason: v.reason || undefined }) });
    setBusy(false);
    if (!r.ok) {
      setErrors(r.error.fieldErrors ?? {}); setMsg(r.error.fieldErrors ? "Please check the highlighted fields." : r.error.message);
      if (r.error.code === "CONFLICT") { setStartsAt(""); const s = await apiFetch<SlotsRes>(`/api/public/booking/slots?doctor=${encodeURIComponent(doctor)}&date=${date}`); if (s.ok) setSlots(s.data); }
      return;
    }
    setDone(r.data);
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-8">
      <p className="type-caption">Already a patient of this clinic? <a href="/portal/login" className="font-medium underline">Sign in to your patient portal</a> to book, see reports and bills.</p>
      {msg && <Alert tone="danger" title="Couldn't complete the booking">{msg}</Alert>}
      <section aria-labelledby="bk-1" className="space-y-3">
        <h2 id="bk-1" className="text-lg font-semibold">1. Choose a doctor</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Doctor" required error={errors.doctor}><Select value={doctor} onChange={(e) => setDoctor(e.target.value)} placeholder="Select a doctor" options={opts.doctors.map((d) => ({ value: d.slug, label: d.specialization ? `${d.name} — ${d.specialization}` : d.name }))} /></Field>
          {opts.services.length > 0 && <Field label="Service (optional)" error={errors.service}><Select value={service} onChange={(e) => setService(e.target.value)} placeholder="Not sure / general" options={opts.services.map((s) => ({ value: s.slug, label: s.title }))} /></Field>}
        </div>
      </section>

      {doctor && (
        <section aria-labelledby="bk-2" className="space-y-3">
          <h2 id="bk-2" className="text-lg font-semibold">2. Pick a date and time</h2>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Quick dates">
            {quick.map((d) => <button key={d} type="button" aria-pressed={date === d} onClick={() => setDate(d)} className={cn("min-h-control rounded-md border px-3 text-sm font-semibold", date === d ? "border-primary bg-primary text-on-brand" : "border-line-strong bg-surface hover:bg-surface-muted")}>{d === today ? "Today" : dayLabel(d)}</button>)}
          </div>
          <Field label="Or choose another date"><TextInput type="date" value={date} min={today} max={maxDate} onChange={(e) => setDate(e.target.value)} /></Field>
          <div aria-live="polite">
            {slotsBusy && <LoadingState label="Finding available times…" className="!py-6" />}
            {!slotsBusy && slots && !slots.slots.length && <Alert tone="info">{slots.message || "No times available on this date. Please try another day."}</Alert>}
            {!slotsBusy && slots && slots.slots.length > 0 && (
              <div role="radiogroup" aria-label="Available times" className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                {slots.slots.map((s) => <button key={s.startsAt} type="button" role="radio" aria-checked={startsAt === s.startsAt} onClick={() => setStartsAt(s.startsAt)} className={cn("min-h-control rounded-md border px-2 text-sm font-semibold", startsAt === s.startsAt ? "border-primary bg-primary text-on-brand" : "border-line-strong bg-surface hover:bg-surface-muted")}>{s.label}</button>)}
              </div>
            )}
            {errors.startsAt && <p role="alert" className="type-caption mt-1 !text-danger">{errors.startsAt}</p>}
          </div>
        </section>
      )}

      {startsAt && (
        <section aria-labelledby="bk-3" className="space-y-4">
          <h2 id="bk-3" className="text-lg font-semibold">3. Your details</h2>
          <Field label="Full name" required error={errors.name}><TextInput value={v.name} onChange={set("name")} autoComplete="name" maxLength={100} /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Mobile number" required error={errors.phone}><PhoneInput value={v.phone} onChange={set("phone")} /></Field>
            <Field label="Email (optional)" error={errors.email}><EmailInput value={v.email} onChange={set("email")} /></Field>
          </div>
          <Field label="Reason for visit (optional)" error={errors.reason} hint="A few words only. Please don't share detailed medical information."><TextInput value={v.reason} onChange={set("reason")} maxLength={300} /></Field>
          <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden"><label>Leave this empty<input tabIndex={-1} autoComplete="off" value={v.website_url} onChange={set("website_url")} /></label></div>
          <div>
            <Checkbox label="I confirm these details are correct and agree that the clinic may contact me about this appointment." checked={v.consent} onChange={(e) => setV({ ...v, consent: e.target.checked })} />
            {errors.consent && <p role="alert" className="type-caption mt-1 !text-danger">{errors.consent}</p>}
          </div>
          <Button type="submit" size="lg" loading={busy}><CalendarCheck aria-hidden className="size-5" />{opts.bookingMode === "AUTO_CONFIRM" ? "Book appointment" : "Request appointment"}</Button>
          {opts.bookingMode === "REQUIRES_CONFIRMATION" && <p className="type-caption">The clinic confirms each request. You will hear from them.</p>}
          <p className="type-caption">This form is not for emergencies. In an emergency, contact your local emergency services.</p>
        </section>
      )}
    </form>
  );
}
