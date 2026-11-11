"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, StatusBadge, useToast } from "@/components/ui";
import { apiFetch } from "@/lib/api/client";
import { FEATURES } from "@/lib/platform/features";
import { LIMIT_LABELS, RETENTION_LABELS } from "@/lib/platform/limits";
import { TIMEZONES } from "@/lib/domain/constants";

const input = "type-form min-h-control w-full rounded-md border border-line-strong bg-surface px-3";
type Msg = { ok: boolean; text: string } | null;
const useSave = () => { const router = useRouter(); const toast = useToast(); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<Msg>(null);
  return { busy, msg, setMsg, async run(endpoint: string, method: string, body: unknown, done = "Saved") { setBusy(true); setMsg(null); const res = await apiFetch(endpoint, { method, body: JSON.stringify(body) }); setBusy(false); if (!res.ok) { setMsg({ ok: false, text: res.error.message }); return false; } setMsg({ ok: true, text: done }); toast({ tone: "success", title: done }); router.refresh(); return true; } }; };
const Status = ({ msg }: { msg: Msg }) => (msg ? <p role={msg.ok ? "status" : "alert"} className={`type-secondary ${msg.ok ? "text-success" : "text-danger"}`}>{msg.text}</p> : null);

export interface DefaultsValue { timezone: string; locale: string; currency: string; dateFormat: string; reminderOffsets: number[]; featureDefaults: Record<string, boolean> }
export function DefaultsForm({ value }: { value: DefaultsValue }) {
  const s = useSave(); const [v, setV] = useState({ ...value, reminder: value.reminderOffsets.join(", ") }); const [fd, setFd] = useState(value.featureDefaults);
  return (
    <form aria-label="Platform defaults" className="space-y-4" onSubmit={(e) => { e.preventDefault(); const offs = v.reminder.split(",").map((x) => Number(x.trim())).filter((n) => Number.isInteger(n)); void s.run("/api/platform/settings", "PUT", { timezone: v.timezone, locale: v.locale, currency: v.currency.toUpperCase(), dateFormat: v.dateFormat, reminderOffsets: offs, featureDefaults: fd }, "Defaults saved"); }}>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="type-caption block">Default timezone<select className={input} value={v.timezone} onChange={(e) => setV({ ...v, timezone: e.target.value })}>{TIMEZONES.map((t) => <option key={t}>{t}</option>)}</select></label>
        <label className="type-caption block">Default locale<input className={input} value={v.locale} onChange={(e) => setV({ ...v, locale: e.target.value })} pattern="[a-z]{2}(-[A-Z]{2})?" /></label>
        <label className="type-caption block">Default currency (3 letters)<input className={input} value={v.currency} onChange={(e) => setV({ ...v, currency: e.target.value })} maxLength={3} /></label>
        <label className="type-caption block">Date format<select className={input} value={v.dateFormat} onChange={(e) => setV({ ...v, dateFormat: e.target.value })}><option>DD/MM/YYYY</option><option>MM/DD/YYYY</option><option>YYYY-MM-DD</option></select></label>
        <label className="type-caption block sm:col-span-2">Default appointment reminder (minutes before, comma-separated, max 4)<input className={input} value={v.reminder} onChange={(e) => setV({ ...v, reminder: e.target.value })} inputMode="numeric" /></label>
      </div>
      <fieldset><legend className="type-label">Features for NEW clinics</legend><p className="type-caption mb-2">Switched-off features start off for new clinics. Existing clinics are not changed.</p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{FEATURES.map((f) => <label key={f.key} className="type-body flex items-center gap-2"><input type="checkbox" className="size-4" checked={fd[f.key] !== false} onChange={(e) => setFd({ ...fd, [f.key]: e.target.checked })} />{f.label}</label>)}</div></fieldset>
      <div className="flex items-center gap-3"><Button type="submit" loading={s.busy}>Save defaults</Button><Status msg={s.msg} /></div>
    </form>
  );
}

export function ConfigForm({ clinicId, limits, retention }: { clinicId: string; limits: Record<string, number | null | undefined>; retention: Record<string, number | null | undefined> }) {
  const s = useSave(); const [l, setL] = useState<Record<string, string>>(Object.fromEntries(Object.keys(LIMIT_LABELS).map((k) => [k, limits[k] == null ? "" : String(limits[k])]))); const [r, setR] = useState<Record<string, string>>(Object.fromEntries(Object.keys(RETENTION_LABELS).map((k) => [k, retention[k] == null ? "" : String(retention[k])])));
  const num = (m: Record<string, string>) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v.trim() === "" ? null : Number(v)]));
  return (
    <form aria-label="Limits and retention" className="space-y-4" onSubmit={(e) => { e.preventDefault(); void s.run(`/api/platform/clinics/${clinicId}/config`, "PUT", { limits: num(l), retention: num(r) }, "Configuration saved"); }}>
      <p className="type-secondary rounded-md bg-surface-muted p-3">These values are recorded for later plans and compliance work. <strong>Nothing is enforced and nothing is deleted automatically.</strong> Leave blank for “no limit”.</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Object.entries(LIMIT_LABELS).map(([k, label]) => <label key={k} className="type-caption block">{label}<input className={input} inputMode="numeric" value={l[k]} onChange={(e) => setL({ ...l, [k]: e.target.value })} /></label>)}
        {Object.entries(RETENTION_LABELS).map(([k, label]) => <label key={k} className="type-caption block">{label}<input className={input} inputMode="numeric" value={r[k]} onChange={(e) => setR({ ...r, [k]: e.target.value })} /></label>)}
      </div>
      <div className="flex items-center gap-3"><Button type="submit" loading={s.busy}>Save</Button><Status msg={s.msg} /></div>
    </form>
  );
}

export function AnnouncementForm({ clinics }: { clinics: { id: string; name: string }[] }) {
  const s = useSave(); const [aud, setAud] = useState("ALL");
  return (
    <form aria-label="New announcement" className="space-y-3" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); void s.run("/api/platform/announcements", "POST", { title: f.get("title"), body: f.get("body"), audience: aud, tenantIds: f.getAll("tenantIds"), endsAt: f.get("endsAt") ? new Date(String(f.get("endsAt"))).toISOString() : null, active: true }, "Announcement published").then((ok) => ok && (e.target as HTMLFormElement).reset()); }}>
      <label className="type-caption block">Title<input name="title" className={input} required minLength={3} maxLength={120} /></label>
      <label className="type-caption block">Message<textarea name="body" className={`${input} py-2`} rows={3} required minLength={3} maxLength={600} /></label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="type-caption block">Audience<select className={input} value={aud} onChange={(e) => setAud(e.target.value)}><option value="ALL">All clinic staff</option><option value="ADMINS">Clinic admins only</option><option value="SELECTED">Selected clinics</option></select></label>
        <label className="type-caption block">Stop showing at (optional)<input name="endsAt" type="datetime-local" className={input} /></label>
      </div>
      {aud === "SELECTED" && <fieldset><legend className="type-label">Clinics</legend><div className="mt-1 grid max-h-40 gap-1 overflow-y-auto sm:grid-cols-2">{clinics.map((c) => <label key={c.id} className="type-body flex items-center gap-2"><input type="checkbox" name="tenantIds" value={c.id} className="size-4" />{c.name}</label>)}</div></fieldset>}
      <div className="flex items-center gap-3"><Button type="submit" loading={s.busy}>Publish</Button><Status msg={s.msg} /></div>
    </form>
  );
}
export function AnnouncementToggle({ id, title, body, audience, tenants, active }: { id: string; title: string; body: string; audience: string; tenants: string[]; active: boolean }) {
  const s = useSave();
  return <span className="inline-flex items-center gap-2"><StatusBadge tone={active ? "success" : "neutral"}>{active ? "Showing" : "Hidden"}</StatusBadge><Button size="sm" variant="outline" loading={s.busy} onClick={() => void s.run("/api/platform/announcements", "POST", { id, title, body, audience, tenantIds: tenants, active: !active }, active ? "Hidden" : "Showing again")}>{active ? "Hide" : "Show"}</Button></span>;
}
