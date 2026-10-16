"use client";
import { useState } from "react";
import { Plus } from "lucide-react";
import { Alert, Badge, Button, Card, CardBody, CardHeader, ErrorState, Field, LoadingState, NumberInput, Textarea, TextInput, Toggle, useToast } from "@/components/ui";
import { useApi } from "@/components/patients/use-api";
import { apiFetch } from "@/lib/api/client";

interface Settings { nearExpiryDays: number; allowOverDispense: boolean; allowPatientReturns: boolean; returnWindowDays: number; billFooter: string | null }
interface Item { id: string; kind: string; name: string; active: boolean }
interface Config { dosageForms: Item[]; categories: Item[]; units: Item[] }
export function PharmacySettingsForm() {
  const toast = useToast(); const s = useApi<Settings>("/api/pharmacy/settings"); const cfg = useApi<Config>("/api/pharmacy/config");
  const [f, setF] = useState<Settings | null>(null); const [busy, setBusy] = useState(false); const [errors, setErrors] = useState<Record<string, string>>({}); const [msg, setMsg] = useState<string>();
  const cur = f ?? s.data;
  if (s.error) return <ErrorState code={s.error.code} description={s.error.message} />;
  if (!cur) return <LoadingState />;
  async function save() {
    setBusy(true); setErrors({}); setMsg(undefined);
    const r = await apiFetch("/api/pharmacy/settings", { method: "PUT", body: JSON.stringify(cur) }); setBusy(false);
    if (!r.ok) { setErrors(r.error.fieldErrors ?? {}); setMsg(r.error.message); return; } toast({ tone: "success", title: "Pharmacy settings saved" }); setF(null); await s.reload();
  }
  return (
    <div className="space-y-section">
      <Card><CardHeader title="Stock and dispensing rules" description="Clinic policy. Changes are audited." />
        <CardBody className="space-y-4">{msg && <Alert tone="danger">{msg}</Alert>}
          <Field label="Near-expiry window (days)" error={errors.nearExpiryDays} hint="Batches expiring within this many days are flagged as near expiry (e.g. 30, 60 or 90)."><div className="max-w-40"><NumberInput value={String(cur.nearExpiryDays)} inputMode="numeric" onChange={(e) => setF({ ...cur, nearExpiryDays: Number(e.target.value) })} /></div></Field>
          <Toggle label="Allow dispensing more than the prescribed quantity" checked={cur.allowOverDispense} onChange={(v) => setF({ ...cur, allowOverDispense: v })} />
          <Toggle label="Accept medicines returned by patients" checked={cur.allowPatientReturns} onChange={(v) => setF({ ...cur, allowPatientReturns: v })} />
          {cur.allowPatientReturns && <Field label="Return window (days after dispensing)" error={errors.returnWindowDays}><div className="max-w-40"><NumberInput value={String(cur.returnWindowDays)} inputMode="numeric" onChange={(e) => setF({ ...cur, returnWindowDays: Number(e.target.value) })} /></div></Field>}
          <Field label="Pharmacy bill footer" error={errors.billFooter}><Textarea rows={2} value={cur.billFooter ?? ""} maxLength={300} onChange={(e) => setF({ ...cur, billFooter: e.target.value })} /></Field>
          <div className="flex justify-end"><Button onClick={save} loading={busy}>Save settings</Button></div>
        </CardBody></Card>
      {cfg.data && <><ListEditor title="Dosage forms" kind="DOSAGE_FORM" items={cfg.data.dosageForms} reload={cfg.reload} /><ListEditor title="Medicine categories" kind="CATEGORY" items={cfg.data.categories} reload={cfg.reload} /><ListEditor title="Units" kind="UNIT" items={cfg.data.units} reload={cfg.reload} /></>}
    </div>
  );
}
function ListEditor({ title, kind, items, reload }: { title: string; kind: string; items: Item[]; reload: () => Promise<void> }) {
  const toast = useToast(); const [name, setName] = useState(""); const [err, setErr] = useState<string>();
  async function add() { setErr(undefined); const r = await apiFetch("/api/pharmacy/config", { method: "POST", body: JSON.stringify({ kind, name }) }); if (!r.ok) { setErr(r.error.fieldErrors?.name ?? r.error.message); return; } setName(""); toast({ tone: "success", title: "Added" }); await reload(); }
  async function toggle(i: Item) { const r = await apiFetch(`/api/pharmacy/config/${i.id}`, { method: "PUT", body: JSON.stringify({ kind, name: i.name, active: !i.active }) }); if (!r.ok) toast({ tone: "danger", title: r.error.message }); await reload(); }
  return (
    <Card><CardHeader title={title} description="Starter values you can rename, extend or switch off." />
      <CardBody className="space-y-3"><ul className="flex flex-wrap gap-2">{items.map((i) => <li key={i.id}><button type="button" onClick={() => toggle(i)} aria-pressed={i.active} className="rounded-full" title={i.active ? "Click to switch off" : "Click to switch on"}><Badge tone={i.active ? "primary" : "neutral"}>{i.name}{i.active ? "" : " (off)"}</Badge></button></li>)}</ul>
        <div className="flex max-w-md items-end gap-2"><div className="flex-1"><Field label={`Add to ${title.toLowerCase()}`} error={err}><TextInput value={name} maxLength={60} onChange={(e) => setName(e.target.value)} /></Field></div><Button variant="outline" onClick={add} disabled={!name.trim()}><Plus aria-hidden className="size-4" />Add</Button></div></CardBody></Card>
  );
}
