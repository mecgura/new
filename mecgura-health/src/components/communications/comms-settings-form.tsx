"use client";
import { useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { Alert, Button, Card, CardBody, CardHeader, ErrorState, Field, LoadingState, NumberInput, Select, StatusBadge, TextInput, Toggle, useToast } from "@/components/ui";
import { useApi } from "@/components/patients/use-api";
import { apiFetch } from "@/lib/api/client";
import { CHANNEL } from "./comms-labels";

interface Settings { whatsappEnabled: boolean; smsEnabled: boolean; emailEnabled: boolean; channelOrder: string[]; senderName: string | null; replyTo: string | null; defaultLanguage: string; eventToggles: Record<string, boolean>; reminderOffsets: number[]; quiet: { enabled: boolean; startMin: number; endMin: number }; fallbackRules: Record<string, string>; maxRetries: number; dailyCapPerPatient: number }
interface View { settings: Settings; providers: { channel: string; provider: string | null; configured: boolean; webhookReady: boolean; hint: string | null }[]; canConfigure: boolean; clinicName: string; clinicEmail: string | null; timezone: string; events: { key: string; label: string; description: string; category: string; defaultOn: boolean; enabled: boolean }[] }
const OFFSETS: [number, string][] = [[30, "30 minutes before"], [60, "1 hour before"], [120, "2 hours before"], [240, "4 hours before"], [720, "12 hours before"], [1440, "1 day before"], [2880, "2 days before"]];
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const toMin = (s: string) => { const [h, m] = s.split(":").map(Number); return (h || 0) * 60 + (m || 0); };
const CAT: Record<string, string> = { TRANSACTIONAL: "", SECURITY: "Security", MARKETING: "Needs opt-in" };

export function CommsSettingsForm() {
  const toast = useToast(); const { data, error, reload } = useApi<View>("/api/communications/settings"); const [f, setF] = useState<Settings | null>(null); const [busy, setBusy] = useState(false); const [errors, setErrors] = useState<Record<string, string>>({}); const [msg, setMsg] = useState<string>();
  if (error) return <ErrorState code={error.code} description={error.message} />;
  if (!data) return <LoadingState />;
  const cur = f ?? data.settings; const ro = !data.canConfigure; const set = (p: Partial<Settings>) => setF({ ...cur, ...p });
  const on = (c: string) => (c === "WHATSAPP" ? cur.whatsappEnabled : c === "SMS" ? cur.smsEnabled : cur.emailEnabled);
  const flip = (c: string, v: boolean) => set(c === "WHATSAPP" ? { whatsappEnabled: v } : c === "SMS" ? { smsEnabled: v } : { emailEnabled: v });
  const move = (i: number, d: number) => { const a = [...cur.channelOrder]; const j = i + d; if (j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j], a[i]]; set({ channelOrder: a }); };
  async function save() { setBusy(true); setErrors({}); setMsg(undefined); const s = cur; const r = await apiFetch("/api/communications/settings", { method: "PUT", body: JSON.stringify({ ...s, quietEnabled: s.quiet.enabled, quietStartMin: s.quiet.startMin, quietEndMin: s.quiet.endMin }) }); setBusy(false); if (!r.ok) { setErrors(r.error.fieldErrors ?? {}); setMsg(r.error.message); return; } setF(null); toast({ tone: "success", title: "Communication settings saved" }); await reload(); }
  return (
    <div className="space-y-section">
      {ro && <Alert tone="info">Only a clinic admin can change these settings.</Alert>}{msg && <Alert tone="danger">{msg}</Alert>}
      <Card><CardHeader title="Channels" description="Messages go to the patient on ONE channel — the first one in this order that the patient allows and that is ready. Nothing is ever sent on a channel whose provider isn't configured." />
        <ul className="divide-y divide-line">{cur.channelOrder.map((c, i) => { const p = data.providers.find((x) => x.channel === c)!; return (
          <li key={c} className="flex flex-wrap items-center justify-between gap-3 p-card">
            <div className="min-w-0"><p className="type-label">{i + 1}. {CHANNEL[c]}</p><p className="type-caption">{p.configured ? <>Provider ready ({p.provider}){p.webhookReady ? "" : " — delivery receipts are off until the provider's webhook secret is set"}</> : (p.hint ?? "Provider not configured")}</p></div>
            <div className="flex flex-wrap items-center gap-3"><StatusBadge tone={p.configured ? "success" : "warning"}>{p.configured ? "Provider ready" : "Not configured"}</StatusBadge><Toggle label={`Use ${CHANNEL[c]}`} checked={on(c)} disabled={ro} onChange={(v) => flip(c, v)} />
              <span className="flex"><Button size="sm" variant="outline" aria-label={`Move ${CHANNEL[c]} up`} disabled={ro || i === 0} onClick={() => move(i, -1)}><ArrowUp aria-hidden className="size-4" /></Button><Button size="sm" variant="outline" aria-label={`Move ${CHANNEL[c]} down`} disabled={ro || i === cur.channelOrder.length - 1} onClick={() => move(i, 1)}><ArrowDown aria-hidden className="size-4" /></Button></span></div>
          </li>); })}</ul>
        <CardBody className="border-t border-line"><p className="type-caption">Provider keys are set by the platform operator in the server environment. They are never shown here and a clinic cannot read or change them.</p></CardBody></Card>
      <Card><CardHeader title="Sender" /><CardBody className="grid gap-4 sm:grid-cols-2">
        <Field label="Name shown to patients" error={errors.senderName} hint={`Leave empty to use “${data.clinicName}”.`}><TextInput value={cur.senderName ?? ""} maxLength={80} disabled={ro} onChange={(e) => set({ senderName: e.target.value })} /></Field>
        <Field label="Reply-to email" error={errors.replyTo} hint={data.clinicEmail ? `Empty = ${data.clinicEmail}` : "Replies to automated emails go here."}><TextInput type="email" value={cur.replyTo ?? ""} disabled={ro} onChange={(e) => set({ replyTo: e.target.value })} /></Field>
        <Field label="Default language" error={errors.defaultLanguage} hint="Used when the patient hasn't chosen one."><Select value={cur.defaultLanguage} disabled={ro} onChange={(e) => set({ defaultLanguage: e.target.value })} options={[{ value: "en", label: "English" }, { value: "hi", label: "हिन्दी (Hindi)" }, { value: "pa", label: "ਪੰਜਾਬੀ (Punjabi)" }]} /></Field>
      </CardBody></Card>
      <Card><CardHeader title="Appointment reminders" description={`Times are in the clinic's time zone (${data.timezone}). A reminder is never sent twice.`} /><CardBody>
        <ul className="grid gap-2 sm:grid-cols-2">{OFFSETS.map(([m, l]) => <li key={m}><Toggle label={l} checked={cur.reminderOffsets.includes(m)} disabled={ro} onChange={(v) => set({ reminderOffsets: v ? [...cur.reminderOffsets, m].sort((a, b) => b - a) : cur.reminderOffsets.filter((x) => x !== m) })} /></li>)}</ul>{errors.reminderOffsets && <p role="alert" className="type-caption mt-2 !text-danger">{errors.reminderOffsets}</p>}</CardBody></Card>
      <Card><CardHeader title="Notifications" description="Switch each kind on or off. Patients can also switch kinds off for themselves in the portal." />
        <ul className="divide-y divide-line">{data.events.map((e) => <li key={e.key} className="flex flex-wrap items-center justify-between gap-3 p-card"><div className="min-w-0 max-w-2xl"><p className="type-label">{e.label} {CAT[e.category] && <StatusBadge tone="neutral">{CAT[e.category]}</StatusBadge>}</p><p className="type-caption">{e.description}</p></div><Toggle label={e.label} checked={cur.eventToggles[e.key] ?? e.defaultOn} disabled={ro} onChange={(v) => set({ eventToggles: { ...cur.eventToggles, [e.key]: v } })} /></li>)}</ul></Card>
      <Card><CardHeader title="Quiet hours" description="Routine messages wait until quiet hours end. Appointment changes and security alerts are never delayed." /><CardBody className="space-y-3">
        <Toggle label="Hold routine messages during quiet hours" checked={cur.quiet.enabled} disabled={ro} onChange={(v) => set({ quiet: { ...cur.quiet, enabled: v } })} />
        {cur.quiet.enabled && <div className="grid max-w-md gap-3 sm:grid-cols-2"><Field label="From" error={errors.quietStartMin}><TextInput type="time" value={hhmm(cur.quiet.startMin)} disabled={ro} onChange={(e) => set({ quiet: { ...cur.quiet, startMin: toMin(e.target.value) } })} /></Field><Field label="Until" error={errors.quietEndMin}><TextInput type="time" value={hhmm(cur.quiet.endMin)} disabled={ro} onChange={(e) => set({ quiet: { ...cur.quiet, endMin: toMin(e.target.value) } })} /></Field></div>}</CardBody></Card>
      <Card><CardHeader title="If a message fails" description="A failed message is retried for temporary problems. A fallback to another channel happens only if you switch it on here, and only if the patient allows that channel." /><CardBody className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">{(["WHATSAPP", "SMS", "EMAIL"] as const).map((c) => <Field key={c} label={`If ${CHANNEL[c]} fails, then use`}><Select aria-label={`Fallback for ${CHANNEL[c]}`} value={cur.fallbackRules[c] ?? ""} disabled={ro} placeholder="Nothing" onChange={(e) => { const r = { ...cur.fallbackRules }; if (e.target.value) r[c] = e.target.value; else delete r[c]; set({ fallbackRules: r }); }} options={(["WHATSAPP", "SMS", "EMAIL"] as const).filter((x) => x !== c).map((x) => ({ value: x, label: CHANNEL[x] }))} /></Field>)}</div>{errors.fallbackRules && <p role="alert" className="type-caption !text-danger">{errors.fallbackRules}</p>}
        <div className="grid max-w-md gap-3 sm:grid-cols-2"><Field label="Retries after a temporary failure" error={errors.maxRetries}><NumberInput value={String(cur.maxRetries)} inputMode="numeric" disabled={ro} onChange={(e) => set({ maxRetries: Number(e.target.value) })} /></Field><Field label="Max messages per patient per day" error={errors.dailyCapPerPatient} hint="Security alerts are exempt."><NumberInput value={String(cur.dailyCapPerPatient)} inputMode="numeric" disabled={ro} onChange={(e) => set({ dailyCapPerPatient: Number(e.target.value) })} /></Field></div></CardBody></Card>
      {!ro && <div className="flex justify-end"><Button onClick={save} loading={busy}>Save settings</Button></div>}
    </div>
  );
}
