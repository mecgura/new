"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { Button, Card, EmptyState, ErrorState, Field, LoadingState, Select } from "@/components/ui";
import { apiFetch } from "@/lib/api/client";
import { cn } from "@/lib/cn";
import { addDays, weekdayOf } from "@/lib/scheduling/time";
import { AppointmentDetailModal, NewAppointmentModal, type DoctorOpt, type Perms, type ServiceOpt } from "./appointment-dialogs";
import { AppointmentStatusBadge, STATUS_LABEL, STATUS_TONE, TYPE_LABEL } from "./labels";

type View = "day" | "week" | "month";
interface Appt { id: string; status: string; type: string; time: string; date: string; doctor: DoctorOpt; patientLabel: string; tokenLabel: string | null; serviceTitle: string | null }

const mondayOf = (d: string) => addDays(d, -((weekdayOf(d) + 6) % 7));
// Hand-rolled (not Intl): server and browser ICU data format "en-IN" dates differently, which breaks hydration.
const WD = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MO = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
type DayStyle = { weekday?: "long" | "short"; day?: "numeric"; month?: "long" | "short"; year?: "numeric" };
function fmtDay(d: string, o: DayStyle): string {
  const [y, m, dd] = d.split("-").map(Number);
  const wd = WD[weekdayOf(d)];
  const parts = [o.weekday && (o.weekday === "long" ? wd : wd.slice(0, 3)), o.day && String(dd), o.month && (o.month === "long" ? MO[m - 1] : MO[m - 1].slice(0, 3)), o.year && String(y)].filter(Boolean);
  return parts.join(" ");
}
const DOT: Record<string, string> = { success: "bg-success", warning: "bg-warning", danger: "bg-danger", info: "bg-info", primary: "bg-primary", neutral: "bg-muted", emergency: "bg-emergency" };

function rangeFor(view: View, anchor: string): { from: string; to: string } {
  if (view === "day") return { from: anchor, to: anchor };
  if (view === "week") { const m = mondayOf(anchor); return { from: m, to: addDays(m, 6) }; }
  const first = `${anchor.slice(0, 7)}-01`; const m = mondayOf(first); return { from: m, to: addDays(m, 41) };
}

export function AppointmentsCalendar({ today, doctors, services, perms, defaultDoctor, doctorLocked }: { today: string; doctors: DoctorOpt[]; services: ServiceOpt[]; perms: Perms; defaultDoctor?: string; doctorLocked?: boolean }) {
  const [view, setView] = useState<View>("day");
  const [anchor, setAnchor] = useState(today);
  const [doctor, setDoctor] = useState(defaultDoctor ?? "");
  const [type, setType] = useState("");
  const [status, setStatus] = useState("");
  const [items, setItems] = useState<Appt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [selected, setSelected] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [narrow, setNarrow] = useState(false);

  useEffect(() => { const mq = window.matchMedia("(max-width: 767px)"); const f = () => setNarrow(mq.matches); f(); mq.addEventListener("change", f); return () => mq.removeEventListener("change", f); }, []);
  const range = useMemo(() => rangeFor(view, anchor), [view, anchor]);

  const load = useCallback(async () => {
    setLoading(true); setError(undefined);
    const qs = new URLSearchParams({ from: range.from, to: range.to, ...(doctor ? { doctorUserId: doctor } : {}), ...(type ? { type } : {}), ...(status ? { status } : {}) });
    const r = await apiFetch<{ appointments: Appt[] }>(`/api/appointments?${qs}`);
    setLoading(false);
    if (!r.ok) { setError(r.error.message); return; }
    setItems(r.data.appointments);
  }, [range, doctor, type, status]);
  useEffect(() => { void load(); }, [load]);

  const byDay = useMemo(() => { const m = new Map<string, Appt[]>(); for (const a of items) m.set(a.date, [...(m.get(a.date) ?? []), a]); return m; }, [items]);
  const step = (dir: 1 | -1) => setAnchor(view === "day" ? addDays(anchor, dir) : view === "week" ? addDays(anchor, 7 * dir) : (() => { const d = new Date(`${anchor.slice(0, 7)}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + dir); return d.toISOString().slice(0, 10); })());
  const title = view === "day" ? fmtDay(anchor, { weekday: "long", day: "numeric", month: "long", year: "numeric" }) : view === "week" ? `${fmtDay(range.from, { day: "numeric", month: "short" })} – ${fmtDay(range.to, { day: "numeric", month: "short", year: "numeric" })}` : fmtDay(anchor, { month: "long", year: "numeric" });

  const Chip = ({ a }: { a: Appt }) => (
    <button type="button" onClick={() => setSelected(a.id)} className="flex w-full min-h-control items-center gap-2 rounded-md border border-line bg-surface px-2.5 py-1.5 text-left hover:bg-surface-muted">
      <span aria-hidden className={cn("size-2.5 shrink-0 rounded-full", DOT[STATUS_TONE[a.status] ?? "neutral"])} />
      <span className="type-label shrink-0">{a.time}</span>
      <span className="min-w-0 flex-1 truncate text-sm">{a.patientLabel}{!doctor && <span className="text-muted"> · {a.doctor.name.split(" ").slice(-1)[0]}</span>}</span>
      {a.tokenLabel && <span className="type-caption shrink-0 rounded bg-primary-soft px-1.5 text-primary">#{a.tokenLabel}</span>}
      <span className="sr-only">{STATUS_LABEL[a.status]}</span>
    </button>
  );

  return (
    <div className="space-y-section">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h1 className="type-page-title">Appointments</h1><p className="type-secondary mt-1">Calendar for your clinic. Names are shortened for privacy; open an appointment for details.</p></div>
        {perms.canCreate && <Button onClick={() => setNewOpen(true)} disabled={!doctors.length}><Plus aria-hidden className="size-4" />New appointment</Button>}
      </div>

      <Card className="space-y-3 p-card">
        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label="Calendar view" className="inline-flex overflow-hidden rounded-md border border-line-strong">
            {(["day", "week", "month"] as const).map((v) => <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)} className={cn("min-h-control px-4 text-sm font-semibold capitalize", view === v ? "bg-primary text-on-brand" : "bg-surface hover:bg-surface-muted")}>{v}</button>)}
          </div>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" onClick={() => step(-1)} aria-label={`Previous ${view}`}><ChevronLeft aria-hidden className="size-4" /></Button>
            <Button variant="outline" size="sm" onClick={() => setAnchor(today)}>Today</Button>
            <Button variant="outline" size="sm" onClick={() => step(1)} aria-label={`Next ${view}`}><ChevronRight aria-hidden className="size-4" /></Button>
          </div>
          <h2 className="type-section min-w-0 flex-1 basis-48" aria-live="polite">{title}</h2>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {!doctorLocked && <Field label="Doctor"><Select value={doctor} onChange={(e) => setDoctor(e.target.value)} placeholder="All doctors" options={doctors.map((d) => ({ value: d.id, label: d.name }))} /></Field>}
          <Field label="Type"><Select value={type} onChange={(e) => setType(e.target.value)} placeholder="All types" options={Object.entries(TYPE_LABEL).map(([v, l]) => ({ value: v, label: l }))} /></Field>
          <Field label="Status"><Select value={status} onChange={(e) => setStatus(e.target.value)} placeholder="All statuses" options={Object.entries(STATUS_LABEL).map(([v, l]) => ({ value: v, label: l }))} /></Field>
        </div>
      </Card>

      <Card className="p-card">
        {loading && !items.length ? <LoadingState label="Loading appointments…" /> : error ? <ErrorState title="Couldn't load appointments" description={error} action={<Button onClick={load}>Try again</Button>} /> : (
          <div aria-busy={loading}>
            {view === "day" && (items.length ? <ul className="space-y-2">{items.map((a) => <li key={a.id}><DayRow a={a} onOpen={() => setSelected(a.id)} showDoctor={!doctor} /></li>)}</ul>
              : <EmptyState title="No appointments on this day" description="Try another date or clear the filters." action={perms.canCreate && doctors.length ? <Button onClick={() => setNewOpen(true)}>Book one</Button> : undefined} />)}
            {view === "week" && (
              <div className={cn("grid gap-3", narrow ? "grid-cols-1" : "grid-cols-7")}>
                {Array.from({ length: 7 }, (_, i) => addDays(range.from, i)).map((d) => (
                  <section key={d} aria-label={fmtDay(d, { weekday: "long", day: "numeric", month: "long" })} className={cn("min-w-0 rounded-md border p-2", d === today ? "border-primary" : "border-line")}>
                    <button type="button" onClick={() => { setAnchor(d); setView("day"); }} className="type-label mb-2 block w-full text-left hover:underline">{fmtDay(d, { weekday: "short", day: "numeric", month: "short" })}<span className="type-caption ml-1">({byDay.get(d)?.length ?? 0})</span></button>
                    <ul className="space-y-1.5">{(byDay.get(d) ?? []).map((a) => <li key={a.id}><Chip a={a} /></li>)}</ul>
                    {!byDay.get(d)?.length && <p className="type-caption">—</p>}
                  </section>
                ))}
              </div>
            )}
            {view === "month" && (
              <div>
                <div aria-hidden className="mb-1 hidden grid-cols-7 gap-1 text-center text-xs font-semibold text-muted md:grid">{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <div key={d}>{d}</div>)}</div>
                <div className="grid grid-cols-1 gap-1 md:grid-cols-7">
                  {Array.from({ length: 42 }, (_, i) => addDays(range.from, i)).filter((d) => !narrow || d.slice(0, 7) === anchor.slice(0, 7)).map((d) => {
                    const list = byDay.get(d) ?? []; const other = d.slice(0, 7) !== anchor.slice(0, 7);
                    return (
                      <button key={d} type="button" onClick={() => { setAnchor(d); setView("day"); }} aria-label={`${fmtDay(d, { weekday: "long", day: "numeric", month: "long" })}: ${list.length} appointment${list.length === 1 ? "" : "s"}`}
                        className={cn("flex min-h-16 flex-col gap-1 rounded-md border p-1.5 text-left hover:bg-surface-muted md:min-h-24", d === today ? "border-primary" : "border-line", other && "opacity-50")}>
                        <span className="type-label">{narrow ? fmtDay(d, { weekday: "short", day: "numeric" }) : Number(d.slice(8))}</span>
                        {list.length > 0 && <span className="flex flex-wrap items-center gap-1"><span className="type-caption rounded bg-primary-soft px-1.5 text-primary">{list.length} appt{list.length === 1 ? "" : "s"}</span>
                          {list.slice(0, 4).map((a) => <span key={a.id} aria-hidden className={cn("size-2 rounded-full", DOT[STATUS_TONE[a.status] ?? "neutral"])} />)}</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </Card>

      <NewAppointmentModal open={newOpen} onClose={() => setNewOpen(false)} doctors={doctors} services={services} defaultDoctor={doctor || defaultDoctor} today={today} onDone={load} />
      <AppointmentDetailModal id={selected} onClose={() => setSelected(null)} perms={perms} today={today} doctors={doctors} onChanged={load} />
    </div>
  );
}

function DayRow({ a, onOpen, showDoctor }: { a: Appt; onOpen: () => void; showDoctor: boolean }) {
  return (
    <button type="button" onClick={onOpen} className="flex min-h-control w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-line bg-surface p-3 text-left hover:bg-surface-muted">
      <span className="type-card-title w-14 shrink-0">{a.time}</span>
      <span className="min-w-0 flex-1 basis-40"><span className="type-label block truncate">{a.patientLabel}</span><span className="type-caption block truncate">{showDoctor ? `${a.doctor.name} · ` : ""}{TYPE_LABEL[a.type] ?? a.type}{a.serviceTitle ? ` · ${a.serviceTitle}` : ""}</span></span>
      {a.tokenLabel && <span className="type-label rounded-pill bg-primary-soft px-2.5 py-0.5 text-primary">Token {a.tokenLabel}</span>}
      <AppointmentStatusBadge status={a.status} />
    </button>
  );
}
