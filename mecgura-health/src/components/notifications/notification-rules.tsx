"use client";
import { useState } from "react";
import { Alert, Button, Card, CardBody, CardHeader, DataTable, ErrorState, Field, LoadingState, Modal, NumberInput, Select, StatusBadge, Toggle, useToast } from "@/components/ui";
import { useApi } from "@/components/patients/use-api";
import { apiFetch } from "@/lib/api/client";
import { PRIORITY } from "./labels";

interface Rule { type: string; label: string; description: string; category: string; for: string; hasExternal: boolean; default: { enabled: boolean; priority: string; audience: string[]; ackRequired: boolean }; enabled: boolean; inApp: boolean; roles: string[]; priority: string | null; ackRequired: boolean | null; escalateAfterMin: number | null; externalChannels: string[] | null; customised: boolean }
interface Data { rules: Rule[]; settings: { retentionEnabled: boolean; archiveReadAfterDays: number; expireAfterDays: number; lowStockCheck: boolean } }
const ROLES: [string, string][] = [["CLINIC_ADMIN", "Clinic admin"], ["DOCTOR", "All doctors"], ["RECEPTIONIST", "Reception"], ["COMPOUNDER", "Compounder"], ["NURSE", "Nurse"], ["LAB_STAFF", "Lab staff"], ["ACCOUNTANT", "Accountant"], ["PHARMACY_MANAGER", "Pharmacy manager"], ["PHARMACY_STAFF", "Pharmacy staff"], ["@doctor", "The patient's doctor"], ["@assignee", "The person assigned"]];
const CHANNELS: [string, string][] = [["WHATSAPP", "WhatsApp"], ["SMS", "SMS"], ["EMAIL", "Email"]];
const who = (a: string[]) => a.map((x) => ROLES.find(([k]) => k === x)?.[1] ?? (x === "@patient" ? "The patient" : x === "@self" ? "The person concerned" : x === "SUPER_ADMIN" ? "Super admin" : x)).join(", ");

export function NotificationRules() {
  const toast = useToast(); const { data, error, reload } = useApi<Data>("/api/notifications/rules"); const [edit, setEdit] = useState<Rule | null>(null); const [ret, setRet] = useState<Data["settings"] | null>(null); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<string>();
  if (error) return <ErrorState code={error.code} description={error.message} />;
  if (!data) return <LoadingState />;
  const s = ret ?? data.settings;
  async function saveSettings() { setBusy(true); setMsg(undefined); const r = await apiFetch("/api/notifications/settings", { method: "PUT", body: JSON.stringify(s) }); setBusy(false); if (!r.ok) { setMsg(r.error.fieldErrors?.expireAfterDays ?? r.error.message); return; } setRet(null); toast({ tone: "success", title: "Saved" }); await reload(); }
  return (
    <div className="space-y-section">
      <Alert tone="info" title="How this works">Each row is one kind of notification. The built-in audience and priority apply until you change them. Staff notifications are in-app; for patients, the channels you allow here are the ones the Phase 11 engine may use (it still checks the patient&apos;s consent and your channel settings).</Alert>
      <Card><CardHeader title="Notification rules" description="Who is told, how important it is, whether it needs acknowledging." />
        <DataTable caption="Notification rules" rows={data.rules} rowKey={(r) => r.type} empty={{ title: "No rules" }} columns={[
          { key: "n", header: "Notification", cell: (r) => <span><strong>{r.label}</strong><br /><span className="type-caption">{r.description}</span></span> },
          { key: "w", header: "Goes to", cell: (r) => who(r.roles.length ? r.roles : r.default.audience), hideOnMobile: true },
          { key: "p", header: "Priority", cell: (r) => PRIORITY[r.priority ?? r.default.priority]?.label ?? "Normal" },
          { key: "s", header: "State", cell: (r) => <StatusBadge tone={r.enabled ? "success" : "neutral"}>{r.enabled ? (r.customised ? "On · customised" : "On") : "Off"}</StatusBadge> },
          { key: "a", header: "", align: "right", cell: (r) => <Button size="sm" variant="outline" onClick={() => setEdit(r)}>Edit<span className="sr-only"> {r.label}</span></Button> },
        ]} /></Card>
      <Card><CardHeader title="Keeping notifications" description="Off by default. Nothing is ever deleted; security, critical and unacknowledged notifications are never archived automatically." /><CardBody className="space-y-4">
        {msg && <Alert tone="danger">{msg}</Alert>}
        <Toggle label="Archive old read notifications automatically" checked={s.retentionEnabled} onChange={(v) => setRet({ ...s, retentionEnabled: v })} />
        {s.retentionEnabled && <div className="grid max-w-lg gap-3 sm:grid-cols-2"><Field label="Archive after (days, once read)"><NumberInput value={String(s.archiveReadAfterDays)} inputMode="numeric" onChange={(e) => setRet({ ...s, archiveReadAfterDays: Number(e.target.value) })} /></Field><Field label="Mark archived ones as expired after (days)"><NumberInput value={String(s.expireAfterDays)} inputMode="numeric" onChange={(e) => setRet({ ...s, expireAfterDays: Number(e.target.value) })} /></Field></div>}
        <Toggle label="Check pharmacy stock and expiry every day and notify the pharmacy team" checked={s.lowStockCheck} onChange={(v) => setRet({ ...s, lowStockCheck: v })} />
        <div><Button onClick={saveSettings} loading={busy}>Save</Button></div></CardBody></Card>
      {edit && <RuleEditor rule={edit} onClose={() => setEdit(null)} onSaved={async () => { setEdit(null); await reload(); }} />}
    </div>
  );
}
function RuleEditor({ rule, onClose, onSaved }: { rule: Rule; onClose: () => void; onSaved: () => Promise<void> }) {
  const toast = useToast(); const [f, setF] = useState(rule); const [busy, setBusy] = useState(false); const [errors, setErrors] = useState<Record<string, string>>({}); const [msg, setMsg] = useState<string>();
  const locked = rule.category === "SECURITY" || rule.default.priority === "CRITICAL"; const roles = f.roles.length ? f.roles : rule.default.audience; const staff = rule.for === "STAFF";
  const ack = f.ackRequired ?? rule.default.ackRequired;
  async function save() { setBusy(true); setErrors({}); setMsg(undefined); const r = await apiFetch("/api/notifications/rules", { method: "PUT", body: JSON.stringify({ type: f.type, enabled: f.enabled, inApp: f.inApp, roles: f.roles.length ? f.roles : undefined, priority: f.priority, ackRequired: f.ackRequired, escalateAfterMin: ack ? f.escalateAfterMin : null, externalChannels: rule.hasExternal ? f.externalChannels : undefined }) }); setBusy(false); if (!r.ok) { setErrors(r.error.fieldErrors ?? {}); setMsg(r.error.message); return; } toast({ tone: "success", title: "Rule saved" }); await onSaved(); }
  async function reset() { const r = await apiFetch(`/api/notifications/rules?type=${f.type}`, { method: "DELETE" }); if (!r.ok) { toast({ tone: "danger", title: r.error.message }); return; } toast({ tone: "success", title: "Back to the built-in settings" }); await onSaved(); }
  return (
    <Modal open onClose={onClose} title={rule.label} description={rule.description} footer={<>{rule.customised && <Button variant="outline" onClick={reset}>Reset to default</Button>}<Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy}>Save</Button></>}>
      <div className="space-y-4">{msg && <Alert tone="danger">{msg}</Alert>}{locked && <Alert tone="info">Security and critical notifications can&apos;t be switched off or lowered.</Alert>}
        <Toggle label="This notification is on" checked={f.enabled} disabled={locked} onChange={(v) => setF({ ...f, enabled: v })} />
        <Toggle label="Show in the notification centre" checked={f.inApp} disabled={locked} onChange={(v) => setF({ ...f, inApp: v })} />
        {staff && <fieldset><legend className="type-label">Who is told</legend><p className="type-caption">Leave everything unticked to use the built-in audience ({who(rule.default.audience)}).</p><div className="mt-2 grid gap-1.5 sm:grid-cols-2">{ROLES.map(([k, l]) => <Toggle key={k} label={l} checked={f.roles.includes(k)} onChange={(v) => setF({ ...f, roles: v ? [...f.roles, k] : f.roles.filter((x) => x !== k) })} />)}</div>{f.roles.length === 0 && <p className="type-caption mt-1">Using: {who(roles)}</p>}</fieldset>}
        <Field label="Priority" error={errors.priority} hint="Critical is reserved for security and system incidents."><Select value={f.priority ?? ""} placeholder={`Built-in (${PRIORITY[rule.default.priority]?.label})`} disabled={locked} onChange={(e) => setF({ ...f, priority: e.target.value || null })} options={["LOW", "NORMAL", "HIGH", "URGENT"].map((v) => ({ value: v, label: PRIORITY[v].label }))} /></Field>
        {staff && <Toggle label="Must be acknowledged" checked={ack} onChange={(v) => setF({ ...f, ackRequired: v })} />}
        {staff && ack && <Field label="Tell the clinic admin if not acknowledged within (minutes)" error={errors.escalateAfterMin} hint="Leave empty for no escalation. The admin is told once, never repeatedly."><div className="max-w-40"><NumberInput value={f.escalateAfterMin == null ? "" : String(f.escalateAfterMin)} inputMode="numeric" onChange={(e) => setF({ ...f, escalateAfterMin: e.target.value === "" ? null : Number(e.target.value) })} /></div></Field>}
        {rule.hasExternal && <fieldset><legend className="type-label">WhatsApp / SMS / email to the patient</legend><p className="type-caption">Only channels ticked here may be used for this message. Unticking all stops patient messages for it. Untouched = whatever your communication settings allow.</p><div className="mt-2 flex flex-wrap gap-4"><Toggle label="Restrict channels" checked={f.externalChannels !== null} onChange={(v) => setF({ ...f, externalChannels: v ? ["WHATSAPP", "SMS", "EMAIL"] : null })} />{f.externalChannels !== null && CHANNELS.map(([k, l]) => <Toggle key={k} label={l} checked={f.externalChannels!.includes(k)} onChange={(v) => setF({ ...f, externalChannels: v ? [...f.externalChannels!, k] : f.externalChannels!.filter((x) => x !== k) })} />)}</div></fieldset>}
      </div>
    </Modal>
  );
}
