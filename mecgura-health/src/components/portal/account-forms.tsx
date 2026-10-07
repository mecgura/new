"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Bell } from "lucide-react";
import { Alert, Button, Field, PasswordInput, Toggle, useToast } from "@/components/ui";
import { apiFetch } from "@/lib/api/client";
import { dayLabel } from "./portal-labels";

/* ------------------------------ communication preferences ------------------------------ */
interface Prefs { categories: { appointments: boolean; followUps: boolean; billing: boolean; reports: boolean; general: boolean }; channels: { email: string; sms: string; whatsapp: string; phone: string }; configured: { email: boolean; sms: boolean; whatsapp: boolean }; note: string }
const CATS: [keyof Prefs["categories"], string, string][] = [["appointments", "Appointments", "Confirmed, changed or cancelled"], ["followUps", "Follow-up reminders", "When a check-up is due"], ["billing", "Bills and payments", "New bills and payments received"], ["reports", "Lab reports", "When a report is ready"], ["general", "Other clinic updates", "Prescriptions and general messages"]];
const CH: [keyof Prefs["channels"], string][] = [["email", "Email"], ["sms", "SMS"], ["whatsapp", "WhatsApp"], ["phone", "Phone call"]];
export function PreferencesForm({ initial }: { initial: Prefs }) {
  const toast = useToast(); const [p, setP] = useState(initial); const [busy, setBusy] = useState(false);
  async function save(next: Prefs) { setP(next); setBusy(true); const r = await apiFetch<Prefs>("/api/patient/preferences", { method: "PUT", body: JSON.stringify({ categories: next.categories, channels: Object.fromEntries(Object.entries(next.channels).filter(([, v]) => v !== "UNKNOWN")) }) }); setBusy(false); if (!r.ok) { toast({ tone: "danger", title: r.error.message }); return; } setP(r.data); toast({ tone: "success", title: "Saved" }); }
  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-line bg-surface">
        <div className="border-b border-line px-4 py-3"><h2 className="type-card-title">What should appear in your notifications?</h2><p className="type-caption">These show up in the bell inside this portal.</p></div>
        <ul className="divide-y divide-line">{CATS.map(([k, l, d]) => <li key={k} className="flex items-center justify-between gap-3 px-4 py-3"><div><p className="type-label">{l}</p><p className="type-caption">{d}</p></div><Toggle label={l} checked={p.categories[k]} disabled={busy} onChange={(v) => save({ ...p, categories: { ...p.categories, [k]: v } })} /></li>)}</ul>
      </section>
      <section className="rounded-2xl border border-line bg-surface">
        <div className="border-b border-line px-4 py-3"><h2 className="type-card-title">How may the clinic contact you?</h2></div>
        <Alert tone="info" className="m-4">{p.note}</Alert>
        <ul className="divide-y divide-line"><li className="flex items-center justify-between gap-3 px-4 py-3"><span className="type-label inline-flex items-center gap-2"><Bell aria-hidden className="size-4" />In this portal</span><span className="type-caption">Always on</span></li>
          {CH.map(([k, l]) => <li key={k} className="flex items-center justify-between gap-3 px-4 py-3"><div><p className="type-label">{l}</p><p className="type-caption">{(k === "email" || k === "sms" || k === "whatsapp") && !p.configured[k] ? "Not in use yet — your choice is saved" : "Your choice"}</p></div><Toggle label={`Allow ${l}`} checked={p.channels[k] === "ALLOWED"} disabled={busy} onChange={(v) => save({ ...p, channels: { ...p.channels, [k]: v ? "ALLOWED" : "NOT_ALLOWED" } })} /></li>)}</ul>
      </section>
    </div>
  );
}

/* ------------------------------ consent ------------------------------ */
interface Consents { version: string; privacyNotice: string | null; consents: { type: string; title: string; text: string; granted: boolean; status: string; version: string | null; at: string | null }[]; history: { type: string; status: string; version: string; at: string }[] }
export function ConsentsView({ initial, clinicName }: { initial: Consents; clinicName: string }) {
  const toast = useToast(); const [c, setC] = useState(initial); const [busy, setBusy] = useState<string | null>(null);
  async function set(type: string, granted: boolean) { setBusy(type); const r = await apiFetch<Consents>("/api/patient/consents", { method: "POST", body: JSON.stringify({ type, granted }) }); setBusy(null); if (!r.ok) { toast({ tone: "danger", title: r.error.message }); return; } setC(r.data); toast({ tone: "success", title: granted ? "Consent recorded" : "Consent withdrawn" }); }
  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-line bg-surface p-4"><h2 className="type-card-title">How {clinicName} uses your information</h2><p className="type-body mt-2 whitespace-pre-line">{c.privacyNotice ?? "The clinic keeps your health records so it can look after you. Only you and the clinic staff who treat or support you can see them. They are not shown to other patients or sold. Medical records are kept by the clinic as the law requires, even if you close your portal account."}</p><p className="type-caption mt-2">Notice version {c.version}</p></section>
      <section className="rounded-2xl border border-line bg-surface"><div className="border-b border-line px-4 py-3"><h2 className="type-card-title">Your consents</h2></div>
        <ul className="divide-y divide-line">{c.consents.map((x) => <li key={x.type} className="space-y-2 px-4 py-3"><div className="flex items-center justify-between gap-3"><div><p className="type-label">{x.title}</p><p className="type-secondary">{x.text}</p></div><Toggle label={x.title} checked={x.granted} disabled={busy === x.type} onChange={(v) => set(x.type, v)} /></div><p className="type-caption">{x.status === "NOT_RECORDED" ? "Not recorded yet" : `${x.granted ? "Given" : "Withdrawn"} on ${dayLabel(x.at)} (notice ${x.version})`}</p></li>)}</ul></section>
      <p className="type-caption">Changes are recorded with the date and notice version. No device or location data is collected.</p>
    </div>
  );
}

/* ------------------------------ security ------------------------------ */
interface Sec { loginMethod: string; loginWith: string; lastLoginAt: string | null; passwordChangedAt: string | null; otpAvailable: boolean; sessionNote: string }
export function SecurityForms({ info }: { info: Sec }) {
  const router = useRouter(); const toast = useToast(); const [f, setF] = useState({ current: "", next: "", confirm: "" }); const [errors, setErrors] = useState<Record<string, string>>({}); const [msg, setMsg] = useState<string>(); const [busy, setBusy] = useState(false); const [out, setOut] = useState(false);
  async function change() { setBusy(true); setErrors({}); setMsg(undefined); const r = await apiFetch("/api/patient/security/password", { method: "POST", body: JSON.stringify(f) }); setBusy(false); if (!r.ok) { setErrors(r.error.fieldErrors ?? {}); setMsg(r.error.message); return; } toast({ tone: "success", title: "Password changed — please sign in again" }); router.replace("/portal/login?reason=expired"); router.refresh(); }
  async function everywhere() { setOut(true); const r = await apiFetch("/api/patient/security/logout-all", { method: "POST" }); setOut(false); if (!r.ok) { toast({ tone: "danger", title: r.error.message }); return; } router.replace("/portal/login?reason=expired"); router.refresh(); }
  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-line bg-surface"><div className="border-b border-line px-4 py-3"><h2 className="type-card-title">How you sign in</h2></div>
        <dl className="divide-y divide-line"><div className="flex justify-between gap-2 px-4 py-3"><dt className="type-secondary">Method</dt><dd className="type-label">{info.loginMethod} with your {info.loginWith}</dd></div><div className="flex justify-between gap-2 px-4 py-3"><dt className="type-secondary">Last sign-in</dt><dd className="type-label">{info.lastLoginAt ? new Date(info.lastLoginAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"}</dd></div><div className="flex justify-between gap-2 px-4 py-3"><dt className="type-secondary">Password changed</dt><dd className="type-label">{info.passwordChangedAt ? dayLabel(info.passwordChangedAt) : "—"}</dd></div></dl>
        <p className="type-caption px-4 pb-3">{info.sessionNote} {info.otpAvailable ? "" : "One-time-code sign-in isn't available at this clinic."}</p></section>
      <section className="rounded-2xl border border-line bg-surface p-4"><h2 className="type-card-title">Change password</h2>
        <div className="mt-3 space-y-3">{msg && <Alert tone="danger">{msg}</Alert>}
          <Field label="Current password" error={errors.current}><PasswordInput autoComplete="current-password" value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} /></Field>
          <Field label="New password" error={errors.next} hint="At least 10 characters, with a letter and a number"><PasswordInput autoComplete="new-password" value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} /></Field>
          <Field label="Repeat the new password" error={errors.confirm}><PasswordInput autoComplete="new-password" value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} /></Field>
          <Button onClick={change} loading={busy}>Change password</Button></div></section>
      <section className="rounded-2xl border border-line bg-surface p-4"><h2 className="type-card-title">Sign out everywhere</h2><p className="type-secondary mt-1">Ends this sign-in and every other phone or computer where you are signed in.</p><Button className="mt-3" variant="outline" onClick={everywhere} loading={out}>Sign out of all devices</Button></section>
      <p className="type-caption">Lost your password? Ask the clinic for a new access code. <Link href="/portal/help">Contact the clinic</Link></p>
    </div>
  );
}

/* ------------------------------ notifications ------------------------------ */
interface Notif { unread: number; items: { id: string; title: string; body: string | null; read: boolean; createdAt: string; href: string | null }[] }
export function NotificationsList({ initial }: { initial: Notif }) {
  const router = useRouter(); const [n, setN] = useState(initial); const [busy, setBusy] = useState(false);
  async function markAll() { setBusy(true); await apiFetch("/api/patient/notifications/read", { method: "POST", body: JSON.stringify({}) }); setBusy(false); setN({ unread: 0, items: n.items.map((i) => ({ ...i, read: true })) }); router.refresh(); }
  async function open(id: string, href: string | null) { await apiFetch("/api/patient/notifications/read", { method: "POST", body: JSON.stringify({ id }) }); if (href) router.push(href); else { setN({ ...n, unread: Math.max(0, n.unread - 1), items: n.items.map((i) => (i.id === id ? { ...i, read: true } : i)) }); router.refresh(); } }
  return (
    <div>
      <div className="mb-3 flex items-center justify-between"><p className="type-secondary" aria-live="polite">{n.unread ? `${n.unread} unread` : "You're all caught up"}</p>{n.unread > 0 && <Button size="sm" variant="outline" onClick={markAll} loading={busy}>Mark all as read</Button>}</div>
      {!n.items.length ? <div className="rounded-2xl border border-line bg-surface p-8 text-center"><p className="type-card-title">No notifications yet</p><p className="type-secondary mt-1">Updates about your appointments, reports and bills appear here.</p></div> : (
        <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">{n.items.map((i) => <li key={i.id}><button type="button" onClick={() => open(i.id, i.href)} className="flex min-h-14 w-full items-start gap-3 px-4 py-3 text-left hover:bg-surface-muted"><span aria-hidden className={`mt-2 size-2.5 shrink-0 rounded-full ${i.read ? "bg-transparent" : "bg-primary"}`} /><span className="min-w-0 flex-1"><span className={`block break-words ${i.read ? "type-body" : "type-label"}`}>{i.title}{!i.read && <span className="sr-only"> (unread)</span>}</span>{i.body && <span className="type-secondary block break-words">{i.body}</span>}<span className="type-caption block">{new Date(i.createdAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span></span></button></li>)}</ul>
      )}
    </div>
  );
}
