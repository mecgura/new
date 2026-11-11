"use client";
import Link from "next/link";
import { useState } from "react";
import { Alert, Card, CardBody, CardHeader, ErrorState, Field, LoadingState, TextInput, Toggle, useToast } from "@/components/ui";
import { useApi } from "@/components/patients/use-api";
import { apiFetch } from "@/lib/api/client";

interface Prefs { categories: { key: string; label: string; inApp: boolean; locked: boolean }[]; channels: { note: string }; quiet: { enabled: boolean; startMin: number; endMin: number }; digestEnabled: boolean; quietNote: string }
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`; const toMin = (s: string) => { const [h, m] = s.split(":").map(Number); return (h || 0) * 60 + (m || 0); };
export function NotificationPreferences() {
  const toast = useToast(); const { data, error, setData } = useApi<Prefs>("/api/notifications/preferences"); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<string>();
  if (error) return <ErrorState code={error.code} description={error.message} />;
  if (!data) return <LoadingState />;
  async function save(body: unknown) { setBusy(true); setMsg(undefined); const r = await apiFetch<Prefs>("/api/notifications/preferences", { method: "PATCH", body: JSON.stringify(body) }); setBusy(false); if (!r.ok) { setMsg(r.error.message); return; } setData(r.data); toast({ tone: "success", title: "Saved" }); }
  return (
    <div className="space-y-section">
      <div><Link href="/notifications" className="type-caption underline">← Notifications</Link><h1 className="type-page-title mt-1">Notification settings</h1></div>
      {msg && <Alert tone="danger">{msg}</Alert>}
      <Card><CardHeader title="What do you want to hear about?" description="In-app notifications. Security notices and urgent items can't be switched off." />
        <ul className="divide-y divide-line">{data.categories.map((c) => <li key={c.key} className="flex items-center justify-between gap-3 p-card"><div><p className="type-label">{c.label}</p>{c.locked && <p className="type-caption">Always on</p>}</div><Toggle label={c.label} checked={c.inApp} disabled={busy || c.locked} onChange={(v) => save({ categories: { [c.key]: v } })} /></li>)}</ul>
        <CardBody className="border-t border-line"><p className="type-caption">{data.channels.note}</p></CardBody></Card>
      <Card><CardHeader title="Quiet hours" description={data.quietNote} /><CardBody className="space-y-3">
        <Toggle label="Hold low and normal notifications during quiet hours" checked={data.quiet.enabled} disabled={busy} onChange={(v) => save({ quietEnabled: v })} />
        {data.quiet.enabled && <div className="grid max-w-md gap-3 sm:grid-cols-2"><Field label="From"><TextInput type="time" value={hhmm(data.quiet.startMin)} onChange={(e) => setData({ ...data, quiet: { ...data.quiet, startMin: toMin(e.target.value) } })} onBlur={() => save({ quietStartMin: data.quiet.startMin, quietEndMin: data.quiet.endMin })} /></Field><Field label="Until"><TextInput type="time" value={hhmm(data.quiet.endMin)} onChange={(e) => setData({ ...data, quiet: { ...data.quiet, endMin: toMin(e.target.value) } })} onBlur={() => save({ quietStartMin: data.quiet.startMin, quietEndMin: data.quiet.endMin })} /></Field></div>}
        <p className="type-caption">Times use your clinic&apos;s time zone.</p></CardBody></Card>
      <Card><CardHeader title="Daily summary" description="A short note each day with your real numbers (appointments, follow-ups due, reports to review). Off by default." /><CardBody><Toggle label="Send me a daily summary" checked={data.digestEnabled} disabled={busy} onChange={(v) => save({ digestEnabled: v })} /></CardBody></Card>
    </div>
  );
}
