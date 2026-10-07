"use client";
import { useCallback, useEffect, useState } from "react";
import { CalendarOff, Copy, Plus, Trash2 } from "lucide-react";
import { Alert, Button, Card, CardBody, CardHeader, Checkbox, EmptyState, Field, LoadingState, NumberInput, Select, TextInput, TimePicker, DatePicker, Toggle, useToast, ConfirmDialog, Badge } from "@/components/ui";
import { apiFetch } from "@/lib/api/client";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const ORDER = [1, 2, 3, 4, 5, 6, 0];
interface Win { weekday: number; start: string; end: string }
interface Sched { doctorUserId: string; doctorName: string; configured: boolean; slotMinutes: number; bufferMinutes: number; maxPerDay: number | null; onlineBooking: boolean; advanceDays: number; minNoticeMinutes: number; roomLabel: string | null; windows: Win[]; editable: boolean }
interface Block { id: string; doctorUserId: string | null; kind: string; reason: string | null; startDate: string; startTime: string; endDate: string; endTime: string; editable: boolean }
interface OpdSet { tokenFormat: "NUMERIC" | "PREFIXED"; tokenPad: number; prefixes: Record<string, string>; voiceAnnouncement: boolean; showNextOnDisplay: boolean; onlineTokens: boolean; bookingMode: "AUTO_CONFIRM" | "REQUIRES_CONFIRMATION"; displayEnabled: boolean; displayPath: string | null }
const QUEUES: [string, string][] = [["GENERAL", "General OPD"], ["FOLLOW_UP", "Follow-up"], ["EMERGENCY", "Emergency"], ["PROCEDURE", "Procedure"], ["ONLINE_APPOINTMENT", "Booked online"], ["WALK_IN", "Walk-in"]];
const KINDS: [string, string][] = [["HOLIDAY", "Holiday"], ["LEAVE", "Leave"], ["MEETING", "Meeting"], ["EMERGENCY", "Emergency"], ["CLOSURE", "Clinic closure"], ["OTHER", "Other"]];

export function SchedulingSettings({ canManage, doctors, today, siteOrigin }: { canManage: boolean; doctors: { id: string; name: string }[]; today: string; siteOrigin: string | null }) {
  return (
    <div className="space-y-section">
      <SchedulesCard />
      <BlocksCard canManage={canManage} doctors={doctors} today={today} />
      <OpdSettingsCard canManage={canManage} siteOrigin={siteOrigin} />
    </div>
  );
}

function SchedulesCard() {
  const [list, setList] = useState<Sched[] | null>(null);
  const [err, setErr] = useState<string>();
  const load = useCallback(async () => { const r = await apiFetch<Sched[]>("/api/schedule"); if (r.ok) setList(r.data); else setErr(r.error.message); }, []);
  useEffect(() => { void load(); }, [load]);
  return (
    <Card>
      <CardHeader title="Doctor availability" description="Weekly working sessions, slot length and online booking for each doctor. A gap between two sessions is a break." />
      <CardBody className="space-y-6">
        {err && <Alert tone="danger">{err}</Alert>}
        {!list && !err && <LoadingState />}
        {list && !list.length && <EmptyState title="No doctors yet" description="Add a doctor under Team first." />}
        {list?.map((s) => <ScheduleEditor key={s.doctorUserId} s={s} onSaved={load} />)}
      </CardBody>
    </Card>
  );
}

function ScheduleEditor({ s, onSaved }: { s: Sched; onSaved: () => void }) {
  const toast = useToast();
  const [v, setV] = useState({ slotMinutes: String(s.slotMinutes), bufferMinutes: String(s.bufferMinutes), maxPerDay: s.maxPerDay ? String(s.maxPerDay) : "", onlineBooking: s.onlineBooking, advanceDays: String(s.advanceDays), minNoticeMinutes: String(s.minNoticeMinutes), roomLabel: s.roomLabel ?? "" });
  const [windows, setWindows] = useState<Win[]>(s.windows);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string>();
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: e.target.value });
  const upd = (i: number, p: Partial<Win>) => setWindows(windows.map((w, j) => (j === i ? { ...w, ...p } : w)));

  async function save() {
    setBusy(true); setErrors({}); setMsg(undefined);
    const r = await apiFetch(`/api/schedule/${s.doctorUserId}`, { method: "PUT", body: JSON.stringify({ ...v, maxPerDay: v.maxPerDay || undefined, roomLabel: v.roomLabel || undefined, windows }) });
    setBusy(false);
    if (!r.ok) { setErrors(r.error.fieldErrors ?? {}); setMsg(r.error.message); return; }
    toast({ tone: "success", title: `Saved ${s.doctorName}'s schedule` }); onSaved();
  }
  return (
    <section aria-label={`Schedule for ${s.doctorName}`} className="space-y-4 rounded-md border border-line p-card">
      <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="type-card-title">{s.doctorName}</h3>{!s.configured && <Badge tone="warning">Not set up yet</Badge>}</div>
      {msg && <Alert tone="danger">{msg}</Alert>}
      <fieldset disabled={!s.editable} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Slot length (minutes)" error={errors.slotMinutes}><NumberInput value={v.slotMinutes} onChange={set("slotMinutes")} min={5} step={5} /></Field>
          <Field label="Buffer between patients (min)" error={errors.bufferMinutes}><NumberInput value={v.bufferMinutes} onChange={set("bufferMinutes")} min={0} step={5} /></Field>
          <Field label="Max appointments per day" hint="Leave empty for no limit" error={errors.maxPerDay}><NumberInput value={v.maxPerDay} onChange={set("maxPerDay")} min={1} /></Field>
          <Field label="Room label" hint="Shown on the waiting-room screen" error={errors.roomLabel}><TextInput value={v.roomLabel} onChange={set("roomLabel")} maxLength={40} /></Field>
          <Field label="Book up to (days ahead)" error={errors.advanceDays}><NumberInput value={v.advanceDays} onChange={set("advanceDays")} min={1} max={365} /></Field>
          <Field label="Minimum notice (minutes)" hint="For online booking" error={errors.minNoticeMinutes}><NumberInput value={v.minNoticeMinutes} onChange={set("minNoticeMinutes")} min={0} /></Field>
        </div>
        <Toggle label="Accept online bookings from the clinic website" checked={v.onlineBooking} onChange={(b) => setV({ ...v, onlineBooking: b })} />
        <div className="space-y-3">
          <p className="type-label">Weekly sessions</p>
          {errors.windows && <p role="alert" className="type-caption !text-danger">{errors.windows}</p>}
          {ORDER.map((day) => {
            const mine = windows.map((w, i) => ({ w, i })).filter((x) => x.w.weekday === day);
            return (
              <div key={day} className="grid items-start gap-2 sm:grid-cols-[7rem_1fr]">
                <p className="type-label pt-2">{DAYS[day]}</p>
                <div className="space-y-2">
                  {!mine.length && <p className="type-secondary pt-2">Closed</p>}
                  {mine.map(({ w, i }) => (
                    <div key={i} className="flex flex-wrap items-end gap-2">
                      <Field label="From" error={errors[`windows.${i}.start`]}><TimePicker value={w.start} onChange={(e) => upd(i, { start: e.target.value })} /></Field>
                      <Field label="To" error={errors[`windows.${i}.end`]}><TimePicker value={w.end} onChange={(e) => upd(i, { end: e.target.value })} /></Field>
                      {s.editable && <Button variant="ghost" size="sm" onClick={() => setWindows(windows.filter((_, j) => j !== i))} aria-label={`Remove ${DAYS[day]} session`}><Trash2 aria-hidden className="size-4" /></Button>}
                    </div>
                  ))}
                  {s.editable && mine.length < 4 && <Button variant="ghost" size="sm" onClick={() => setWindows([...windows, { weekday: day, start: mine.length ? mine[mine.length - 1].w.end : "09:00", end: mine.length ? "20:00" : "13:00" }])}><Plus aria-hidden className="size-4" />Add session</Button>}
                </div>
              </div>
            );
          })}
        </div>
      </fieldset>
      {s.editable ? <Button onClick={save} loading={busy}>Save schedule</Button> : <p className="type-caption">You can view this schedule but not change it.</p>}
    </section>
  );
}

function BlocksCard({ canManage, doctors, today }: { canManage: boolean; doctors: { id: string; name: string }[]; today: string }) {
  const toast = useToast();
  const [list, setList] = useState<Block[] | null>(null);
  const [v, setV] = useState({ doctorUserId: canManage ? "" : (doctors[0]?.id ?? ""), startDate: today, startTime: "00:00", endDate: today, endTime: "23:59", kind: "LEAVE", reason: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [del, setDel] = useState<Block | null>(null);
  const load = useCallback(async () => { const r = await apiFetch<Block[]>("/api/schedule/blocks"); if (r.ok) setList(r.data); }, []);
  useEffect(() => { void load(); }, [load]);
  const name = (id: string | null) => (id ? (doctors.find((d) => d.id === id)?.name ?? "Doctor") : "Whole clinic");

  async function add() {
    setBusy(true); setErrors({}); setMsg(undefined);
    const r = await apiFetch<{ existingAppointments: number }>("/api/schedule/blocks", { method: "POST", body: JSON.stringify({ ...v, doctorUserId: v.doctorUserId || null, reason: v.reason || undefined }) });
    setBusy(false);
    if (!r.ok) { setErrors(r.error.fieldErrors ?? {}); setMsg(r.error.message); return; }
    toast({ tone: r.data.existingAppointments ? "warning" : "success", title: "Time blocked", description: r.data.existingAppointments ? `${r.data.existingAppointments} existing appointment(s) fall in this period. They were not cancelled — review them in the calendar.` : undefined });
    setV({ ...v, reason: "" }); void load();
  }
  return (
    <Card>
      <CardHeader title="Holidays, leave & blocked time" description="Patients can't book these times. Existing appointments are never cancelled automatically." />
      <CardBody className="space-y-5">
        {(canManage || doctors.length > 0) && (
          <div className="space-y-3 rounded-md border border-line p-card">
            {msg && <Alert tone="danger">{msg}</Alert>}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Applies to"><Select value={v.doctorUserId} onChange={(e) => setV({ ...v, doctorUserId: e.target.value })} placeholder={canManage ? "Whole clinic" : undefined} options={doctors.map((d) => ({ value: d.id, label: d.name }))} /></Field>
              <Field label="Type"><Select value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value })} options={KINDS.map(([value, label]) => ({ value, label }))} /></Field>
              <Field label="Reason (optional)"><TextInput value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} maxLength={200} /></Field>
              <Field label="Start date" error={errors.startDate}><DatePicker value={v.startDate} onChange={(e) => setV({ ...v, startDate: e.target.value, endDate: e.target.value > v.endDate ? e.target.value : v.endDate })} /></Field>
              <Field label="Start time"><TimePicker value={v.startTime} onChange={(e) => setV({ ...v, startTime: e.target.value })} /></Field>
              <span className="hidden lg:block" />
              <Field label="End date" error={errors.endDate}><DatePicker value={v.endDate} onChange={(e) => setV({ ...v, endDate: e.target.value })} min={v.startDate} /></Field>
              <Field label="End time"><TimePicker value={v.endTime} onChange={(e) => setV({ ...v, endTime: e.target.value })} /></Field>
            </div>
            <Button onClick={add} loading={busy}><CalendarOff aria-hidden className="size-4" />Block this time</Button>
          </div>
        )}
        {!list ? <LoadingState /> : !list.length ? <EmptyState title="Nothing blocked" description="Upcoming holidays and leave will show here." /> : (
          <ul className="divide-y divide-line rounded-md border border-line">
            {list.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                <div className="min-w-0"><p className="type-label">{name(b.doctorUserId)} · {KINDS.find((k) => k[0] === b.kind)?.[1]}</p><p className="type-caption">{b.startDate} {b.startTime} → {b.endDate} {b.endTime}{b.reason ? ` · ${b.reason}` : ""}</p></div>
                {b.editable && <Button variant="ghost" size="sm" onClick={() => setDel(b)} aria-label="Remove blocked time"><Trash2 aria-hidden className="size-4" /></Button>}
              </li>
            ))}
          </ul>
        )}
      </CardBody>
      <ConfirmDialog open={!!del} onCancel={() => setDel(null)} title="Remove this blocked time?" description="Patients will be able to book these times again." confirmLabel="Remove"
        onConfirm={async () => { if (!del) return; const r = await apiFetch(`/api/schedule/blocks/${del.id}`, { method: "DELETE" }); setDel(null); if (r.ok) { toast({ tone: "success", title: "Removed" }); void load(); } else toast({ tone: "danger", title: r.error.message }); }} />
    </Card>
  );
}

function OpdSettingsCard({ canManage, siteOrigin }: { canManage: boolean; siteOrigin: string | null }) {
  const toast = useToast();
  const [s, setS] = useState<OpdSet | null>(null);
  const [msg, setMsg] = useState<string>();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { const r = await apiFetch<OpdSet>("/api/opd/settings"); if (r.ok) setS(r.data); else setMsg(r.error.message); }, []);
  useEffect(() => { void load(); }, [load]);
  if (!s) return <Card><CardBody>{msg ? <Alert tone="danger">{msg}</Alert> : <LoadingState />}</CardBody></Card>;
  const url = s.displayPath && siteOrigin ? `${siteOrigin}${s.displayPath}` : null;

  async function save(extra: { rotateDisplayKey?: boolean } = {}) {
    if (!s) return;
    setBusy(true); setErrors({}); setMsg(undefined);
    const r = await apiFetch("/api/opd/settings", { method: "PUT", body: JSON.stringify({ tokenFormat: s.tokenFormat, tokenPad: s.tokenPad, prefixes: s.prefixes, voiceAnnouncement: s.voiceAnnouncement, showNextOnDisplay: s.showNextOnDisplay, onlineTokens: s.onlineTokens, bookingMode: s.bookingMode, displayEnabled: s.displayEnabled, ...extra }) });
    setBusy(false);
    if (!r.ok) { setErrors(r.error.fieldErrors ?? {}); setMsg(r.error.message); return; }
    toast({ tone: "success", title: "OPD settings saved" }); void load();
  }
  const example = s.tokenFormat === "PREFIXED" ? `${s.prefixes.GENERAL || "A"}-${String(7).padStart(s.tokenPad, "0")}` : String(7).padStart(s.tokenPad, "0");
  return (
    <Card>
      <CardHeader title="OPD, tokens & waiting-room screen" description="How tokens look, how online bookings are handled, and the public queue display." />
      <CardBody className="space-y-5">
        {msg && <Alert tone="danger">{msg}</Alert>}
        <fieldset disabled={!canManage} className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Token style" hint={`Example: ${example}`}><Select value={s.tokenFormat} onChange={(e) => setS({ ...s, tokenFormat: e.target.value as OpdSet["tokenFormat"] })} options={[{ value: "NUMERIC", label: "Numbers only (07)" }, { value: "PREFIXED", label: "Letter + number (A-07)" }]} /></Field>
            <Field label="Digits" error={errors.tokenPad}><NumberInput value={s.tokenPad} onChange={(e) => setS({ ...s, tokenPad: Number(e.target.value) || 1 })} min={1} max={4} /></Field>
          </div>
          {s.tokenFormat === "PREFIXED" && (
            <div className="grid gap-3 sm:grid-cols-3">{QUEUES.map(([k, label]) => <Field key={k} label={`${label} prefix`} error={errors[`prefixes.${k}`]}><TextInput value={s.prefixes[k] ?? ""} maxLength={3} onChange={(e) => setS({ ...s, prefixes: { ...s.prefixes, [k]: e.target.value.toUpperCase() } })} /></Field>)}</div>
          )}
          <Field label="When someone books online"><Select value={s.bookingMode} onChange={(e) => setS({ ...s, bookingMode: e.target.value as OpdSet["bookingMode"] })} options={[{ value: "AUTO_CONFIRM", label: "Confirm the appointment automatically" }, { value: "REQUIRES_CONFIRMATION", label: "Reception must confirm each booking" }]} /></Field>
          <div className="space-y-3">
            <Toggle label="Show “next” tokens on the waiting-room screen" checked={s.showNextOnDisplay} onChange={(b) => setS({ ...s, showNextOnDisplay: b })} />
            <Toggle label="Voice announcement on the waiting-room screen (browser speech)" checked={s.voiceAnnouncement} onChange={(b) => setS({ ...s, voiceAnnouncement: b })} />
            <Toggle label="Waiting-room screen enabled" checked={s.displayEnabled} onChange={(b) => setS({ ...s, displayEnabled: b })} />
          </div>
        </fieldset>
        {s.displayEnabled && s.displayPath && canManage && (
          <div className="space-y-2 rounded-md border border-line bg-surface-muted p-3">
            <p className="type-label">Waiting-room screen address</p>
            <p className="type-secondary">Open this on the TV or monitor. Anyone with this link can see the queue (tokens only, never names), so keep it inside the clinic.</p>
            <div className="flex flex-wrap items-center gap-2"><code className="min-w-0 flex-1 break-all rounded bg-surface p-2 text-sm">{url ?? s.displayPath}</code>
              {url && <Button variant="outline" size="sm" onClick={() => navigator.clipboard?.writeText(url).then(() => toast({ tone: "success", title: "Link copied" }))}><Copy aria-hidden className="size-4" />Copy</Button>}</div>
            {!url && <p className="type-caption">Your clinic website address isn&apos;t set up yet, so the full link can&apos;t be shown. Path: {s.displayPath}</p>}
            <div className="flex flex-wrap items-center gap-2"><Button variant="outline" size="sm" onClick={() => save({ rotateDisplayKey: true })}>Create a new link</Button><span className="type-caption">The old link stops working.</span></div>
          </div>
        )}
        <Checkbox label="Give online bookings a token when booked" description="Off by default: tokens are normally issued when the patient arrives and is checked in." checked={s.onlineTokens} disabled onChange={() => {}} />
        {canManage ? <Button onClick={() => save()} loading={busy}>Save OPD settings</Button> : <p className="type-caption">Only clinic admins can change these settings.</p>}
      </CardBody>
    </Card>
  );
}
