"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, Button, Field, Modal, Select, StatusBadge, TextInput, Textarea, useToast } from "@/components/ui";
import { SensitiveAction } from "@/components/platform/sensitive-action";
import { apiFetch } from "@/lib/api/client";
import { ROLES } from "@/lib/permissions";

type Errs = { message?: string; fields: Record<string, string> };
const none: Errs = { fields: {} };
function useCall() {
  const router = useRouter(); const toast = useToast(); const [busy, setBusy] = useState<string | null>(null); const [err, setErr] = useState<Errs>(none);
  async function call<T = unknown>(key: string, path: string, method: string, body: unknown, ok?: string): Promise<T | null> {
    setBusy(key); setErr(none); const r = await apiFetch<T>(path, { method, body: body === undefined ? undefined : JSON.stringify(body) }); setBusy(null);
    if (!r.ok) { setErr({ message: r.error.fieldErrors ? undefined : r.error.message, fields: r.error.fieldErrors ?? {} }); return null; }
    if (ok) toast({ tone: "success", title: ok }); router.refresh(); return r.data;
  }
  return { busy, err, call, router, toast };
}
const formObj = (e: React.FormEvent<HTMLFormElement>) => { e.preventDefault(); const o: Record<string, string> = {}; new FormData(e.currentTarget).forEach((v, k) => { o[k] = String(v); }); return o; };

/* ------------------------------------------------------------------------ API keys ------------------------------------------------------------------------ */
export interface KeyRow { id: string; name: string; prefix: string; scopes: string[]; status: string; expiresAt: string | null; lastUsedAt: string | null; lastUsedIp: string | null; allowedIps: string[] }
export function ApiKeysManager({ keys, scopes }: { keys: KeyRow[]; scopes: { key: string; label: string }[] }) {
  const { busy, err, call } = useCall(); const [created, setCreated] = useState<string | null>(null); const [open, setOpen] = useState(false);
  return (
    <div className="space-y-4">
      <div className="flex justify-between gap-3"><p className="type-secondary">Keys let another system read data over the API. Only a hash is stored — the full key is shown once.</p><Button onClick={() => { setOpen(true); setCreated(null); }}>New API key</Button></div>
      <div className="relative overflow-x-auto"><table className="w-full text-left"><caption className="sr-only">API keys</caption>
        <thead><tr className="type-caption border-b border-line bg-surface-muted"><th scope="col" className="p-3">Name</th><th scope="col" className="p-3">Key</th><th scope="col" className="p-3">Scopes</th><th scope="col" className="p-3">Status</th><th scope="col" className="p-3">Last used</th><th scope="col" className="p-3"><span className="sr-only">Actions</span></th></tr></thead>
        <tbody>{keys.map((k) => <tr key={k.id} className="border-b border-line last:border-0"><th scope="row" className="p-3 text-left">{k.name}{k.expiresAt && <span className="type-caption block">expires {k.expiresAt.slice(0, 10)}</span>}</th><td className="p-3 font-mono">{k.prefix}…</td><td className="p-3">{k.scopes.join(", ")}{k.allowedIps.length > 0 && <span className="type-caption block">IPs: {k.allowedIps.join(", ")}</span>}</td><td className="p-3"><StatusBadge tone={k.status === "ACTIVE" ? "success" : "neutral"}>{k.status.toLowerCase()}</StatusBadge></td><td className="p-3">{k.lastUsedAt ? `${k.lastUsedAt.slice(0, 16).replace("T", " ")} UTC` : "never"}</td>
          <td className="p-3">{k.status === "ACTIVE" && <div className="flex gap-2"><SensitiveAction label="Rotate" title="Rotate API key" target={k.name} impact="Creates a new key with the same access and revokes this one at once." endpoint={`/api/security/api-keys/${k.id}`} body={{ action: "rotate" }} tone="primary" successMessage="New key created — see the list" /><SensitiveAction label="Revoke" title="Revoke API key" target={k.name} impact="The key stops working immediately." endpoint={`/api/security/api-keys/${k.id}`} body={{ action: "revoke" }} /></div>}</td></tr>)}</tbody></table>
        {!keys.length && <p className="type-secondary p-6 text-center">No API keys yet.</p>}</div>
      <Modal open={open} onClose={() => setOpen(false)} title="New API key" description="Give it the least access it needs.">
        {created ? <div className="space-y-3"><Alert tone="warning" title="Copy it now">This is the only time the full key is shown.</Alert><p className="break-all rounded-md bg-surface-muted p-3 font-mono" aria-label="New API key">{created}</p><div className="flex justify-end"><Button onClick={() => setOpen(false)}>I saved it</Button></div></div>
          : <form onSubmit={async (e) => { const o = formObj(e); const sc = scopes.filter((s) => o[`s_${s.key}`] === "on").map((s) => s.key); const d = await call<{ key: string }>("new", "/api/security/api-keys", "POST", { name: o.name, scopes: sc, expiresInDays: o.days ? Number(o.days) : null, allowedIps: o.ips.split(/[\s,]+/).filter(Boolean), password: o.password, mfaCode: o.mfaCode }); if (d) setCreated(d.key); }} className="space-y-3" aria-label="New API key">
            {err.message && <Alert tone="danger">{err.message}</Alert>}
            <Field label="Name" required error={err.fields.name}><TextInput name="name" /></Field>
            <fieldset><legend className="type-label">Access</legend>{scopes.map((s) => <label key={s.key} className="flex items-center gap-2"><input type="checkbox" name={`s_${s.key}`} /> {s.label} <span className="type-caption">({s.key})</span></label>)}</fieldset>
            <Field label="Expires after (days)" hint="Blank = no expiry (not recommended)."><TextInput name="days" inputMode="numeric" defaultValue="90" /></Field>
            <Field label="Allowed IP addresses" hint="Optional. Separate with spaces or commas."><TextInput name="ips" /></Field>
            <Field label="Your password" required error={err.fields.password}><TextInput name="password" type="password" autoComplete="current-password" /></Field>
            <Field label="Authenticator code (if two-factor is on)" error={err.fields.mfaCode}><TextInput name="mfaCode" inputMode="numeric" /></Field>
            <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" loading={busy === "new"}>Create key</Button></div>
          </form>}
      </Modal>
    </div>
  );
}

/* ------------------------------------------------------------------ security policy (MFA / retention) ------------------------------------------------------------------ */
export function PolicyEditor({ scope, mfaRoles, retentionDays, lockedRoles }: { scope: "platform" | "clinic"; mfaRoles: string[]; retentionDays?: number | null; lockedRoles?: string[] }) {
  const { busy, err, call } = useCall(); const roles = ROLES.filter((r) => r !== "PATIENT" && (scope === "platform" || r !== "SUPER_ADMIN"));
  return (
    <form onSubmit={async (e) => { const o = formObj(e); const sel = roles.filter((r) => o[`r_${r}`] === "on"); await call("pol", "/api/security/policy", "PUT", scope === "platform" ? { mfaRequiredRoles: sel, auditRetentionDays: o.ret ? Number(o.ret) : null, password: o.password, mfaCode: o.mfaCode } : { mfaRequiredRoles: sel, password: o.password, mfaCode: o.mfaCode }, "Security settings saved"); }} className="max-w-2xl space-y-4" aria-label="Security policy">
      {err.message && <Alert tone="danger">{err.message}</Alert>}
      <fieldset><legend className="type-label">Roles that must use two-factor authentication</legend><p className="type-caption mb-2">Until they set it up they can only reach their security page.{scope === "clinic" && lockedRoles?.length ? ` Platform already requires: ${lockedRoles.join(", ")}.` : ""}</p>
        <div className="grid gap-1 sm:grid-cols-2">{roles.map((r) => <label key={r} className="flex items-center gap-2"><input type="checkbox" name={`r_${r}`} defaultChecked={mfaRoles.includes(r) || !!lockedRoles?.includes(r)} disabled={!!lockedRoles?.includes(r)} /> {r.replace(/_/g, " ").toLowerCase()}</label>)}</div></fieldset>
      {scope === "platform" && <Field label="Audit retention (days)" hint="Blank = keep forever (default). Minimum 365. Nothing is purged automatically; a Super Admin must run a purge." error={err.fields.auditRetentionDays}><TextInput name="ret" inputMode="numeric" defaultValue={retentionDays ?? ""} /></Field>}
      <Field label="Your password" required error={err.fields.password}><TextInput name="password" type="password" autoComplete="current-password" /></Field>
      <Field label="Authenticator code (if two-factor is on)" error={err.fields.mfaCode}><TextInput name="mfaCode" inputMode="numeric" /></Field>
      <Button type="submit" loading={busy === "pol"}>Save</Button>
    </form>
  );
}

/* ------------------------------------------------------------------------- incidents ------------------------------------------------------------------------- */
export function IncidentCreate() {
  const { busy, err, call, router } = useCall(); const [open, setOpen] = useState(false);
  return (<>
    <Button onClick={() => setOpen(true)}>Open incident</Button>
    <Modal open={open} onClose={() => setOpen(false)} title="Open a security incident">
      <form onSubmit={async (e) => { const o = formObj(e); const d = await call<{ id: string }>("inc", "/api/platform/security/incidents", "POST", o, "Incident opened"); if (d) { setOpen(false); router.push(`/platform/security/incidents/${d.id}`); } }} className="space-y-3" aria-label="Open incident">
        {err.message && <Alert tone="danger">{err.message}</Alert>}
        <Field label="Title" required error={err.fields.title}><TextInput name="title" /></Field>
        <Field label="What happened" required error={err.fields.description}><Textarea name="description" rows={4} /></Field>
        <div className="grid gap-3 sm:grid-cols-2"><Field label="Severity"><Select name="severity" defaultValue="MEDIUM" options={["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"].map((v) => ({ value: v, label: v.toLowerCase() }))} /></Field><Field label="Category"><Select name="category" defaultValue="ACCESS" options={["AUTH", "ACCESS", "API", "WEBHOOK", "PROVIDER", "EXPORT", "SUPPORT", "API_KEY", "CONFIG", "PRIVACY", "INTEGRITY"].map((v) => ({ value: v, label: v.toLowerCase().replace("_", " ") }))} /></Field></div>
        <Field label="Affected resource (optional)"><TextInput name="affectedResource" /></Field>
        <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" loading={busy === "inc"}>Open incident</Button></div>
      </form></Modal></>);
}
export function IncidentUpdate({ id, status, nextStatuses }: { id: string; status: string; nextStatuses: string[] }) {
  const { busy, err, call } = useCall();
  return (
    <form onSubmit={async (e) => { const o = formObj(e); await call("upd", `/api/platform/security/incidents/${id}`, "POST", { status: o.status || undefined, note: o.note || undefined, actionsTaken: o.actionsTaken || undefined, resolution: o.resolution || undefined }, "Incident updated"); (e.target as HTMLFormElement).reset(); }} className="space-y-3" aria-label="Update incident">
      {err.message && <Alert tone="danger">{err.message}</Alert>}
      <Field label={`Move from ${status.toLowerCase()} to`}><Select name="status" placeholder="Keep as is" options={nextStatuses.map((v) => ({ value: v, label: v.toLowerCase() }))} /></Field>
      <Field label="Note for the timeline"><Textarea name="note" rows={2} /></Field>
      <Field label="Actions taken"><Textarea name="actionsTaken" rows={2} /></Field>
      <Field label="Resolution (required to resolve)" error={err.fields.resolution}><Textarea name="resolution" rows={2} /></Field>
      <Button type="submit" loading={busy === "upd"}>Save update</Button>
    </form>
  );
}

/* ---------------------------------------------------------------------- audit integrity ---------------------------------------------------------------------- */
interface Verification { ok: boolean; rowsChecked: number; unsigned: number; tampered: { id: string; action: string }[]; seals: { id: string; status: string; reason?: string; count: number }[] }
export function AuditTools({ retentionDays }: { retentionDays: number | null }) {
  const { busy, err, call } = useCall(); const [res, setRes] = useState<Verification | null>(null); const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="space-y-4">
      {err.message && <Alert tone="danger">{err.message}</Alert>}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" loading={busy === "seal"} onClick={async () => { const d = await call<{ sealed: boolean; count?: number; reason?: string }>("seal", "/api/platform/security/audit", "POST", { action: "seal" }); if (d) setMsg(d.sealed ? `Sealed ${d.count} records.` : `Nothing to seal (${d.reason}).`); }}>Seal new records</Button>
        <Button loading={busy === "verify"} onClick={async () => { const d = await call<Verification>("verify", "/api/platform/security/audit", "POST", { action: "verify" }); if (d) setRes(d); }}>Verify integrity now</Button>
        {retentionDays && <SensitiveAction label="Purge expired records" title="Purge audit records" target={`Older than ${retentionDays} days`} impact="Permanently deletes sealed audit records past retention, except those under a legal hold. A signed purge record is kept." endpoint="/api/platform/security/audit" body={{ action: "purge" }} fields={[{ name: "reason", label: "Reason", kind: "textarea", required: true }]} />}
      </div>
      {msg && <p role="status" className="type-secondary">{msg}</p>}
      {res && <div role="status" aria-live="polite"><Alert tone={res.ok ? "success" : "danger"} title={res.ok ? "No tampering found" : "Integrity problem found"}>Checked {res.rowsChecked} recent record(s); {res.unsigned} older record(s) pre-date signing. {res.tampered.length} altered; {res.seals.filter((s) => s.status === "BROKEN").length} broken seal(s); {res.seals.filter((s) => s.status === "OK").length} seal(s) verified.</Alert>
        {res.tampered.length > 0 && <ul className="mt-2 list-disc pl-5">{res.tampered.map((t) => <li key={t.id}>{t.action} — {t.id}</li>)}</ul>}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------------ legal holds ------------------------------------------------------------------------ */
export interface HoldRow { id: string; scopeType: string; scopeId: string | null; tenantId: string | null; reason: string; placedAt: string; releasedAt: string | null }
export function HoldsManager({ holds, platform, tenantOptions }: { holds: HoldRow[]; platform: boolean; tenantOptions?: { value: string; label: string }[] }) {
  const { busy, err, call } = useCall(); const [open, setOpen] = useState(false);
  return (
    <div className="space-y-4">
      <div className="flex justify-between gap-3"><p className="type-secondary">A legal hold freezes purging and anonymising of everything in its scope until released.</p><Button onClick={() => setOpen(true)}>Place hold</Button></div>
      <ul className="space-y-2">{holds.map((h) => <li key={h.id} className="rounded-md border border-line p-3"><div className="flex flex-wrap items-center justify-between gap-2"><span><StatusBadge tone={h.releasedAt ? "neutral" : "warning"}>{h.releasedAt ? "released" : "active"}</StatusBadge> <strong>{h.scopeType.toLowerCase()}</strong>{h.scopeId ? ` · ${h.scopeId}` : ""}</span>
        {!h.releasedAt && <ReleaseHold id={h.id} />}</div><p className="type-secondary mt-1">{h.reason}</p><p className="type-caption">Placed {h.placedAt.slice(0, 10)}</p></li>)}</ul>
      {!holds.length && <p className="type-secondary">No legal holds.</p>}
      <Modal open={open} onClose={() => setOpen(false)} title="Place a legal hold">
        <form onSubmit={async (e) => { const o = formObj(e); const d = await call("hold", "/api/privacy/holds", "POST", { scopeType: o.scopeType, scopeId: o.scopeId || undefined, tenantId: o.tenantId || undefined, reason: o.reason }, "Hold placed"); if (d) setOpen(false); }} className="space-y-3" aria-label="Place legal hold">
          {err.message && <Alert tone="danger">{err.message}</Alert>}
          <Field label="Covers"><Select name="scopeType" defaultValue={platform ? "TENANT" : "PATIENT"} options={platform ? [{ value: "TENANT", label: "A whole clinic" }, { value: "AUDIT", label: "Audit records" }, { value: "PATIENT", label: "One patient" }] : [{ value: "PATIENT", label: "One patient" }]} /></Field>
          {platform && <Field label="Clinic"><Select name="tenantId" placeholder="(platform-wide audit hold)" options={tenantOptions ?? []} /></Field>}
          <Field label="Patient ID (for a patient hold)" error={err.fields.scopeId}><TextInput name="scopeId" /></Field>
          <Field label="Reason" required error={err.fields.reason}><Textarea name="reason" rows={3} /></Field>
          <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" loading={busy === "hold"}>Place hold</Button></div>
        </form></Modal>
    </div>
  );
}
function ReleaseHold({ id }: { id: string }) {
  const { busy, err, call } = useCall(); const [open, setOpen] = useState(false);
  return (<><Button size="sm" variant="outline" onClick={() => setOpen(true)}>Release</Button>
    <Modal open={open} onClose={() => setOpen(false)} title="Release legal hold"><form onSubmit={async (e) => { const o = formObj(e); const d = await call("rel", `/api/privacy/holds/${id}`, "POST", { note: o.note }, "Hold released"); if (d) setOpen(false); }} className="space-y-3" aria-label="Release hold">{err.message && <Alert tone="danger">{err.message}</Alert>}<Field label="Why is it being released?" required error={err.fields.reason}><Textarea name="note" rows={3} /></Field><div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" loading={busy === "rel"}>Release</Button></div></form></Modal></>);
}

/* ------------------------------------------------------------------ data-rights board (clinic) ------------------------------------------------------------------ */
export interface RightsRow { id: string; requestNumber: string; label: string; kind: string; reason: string; status: string; overdue: boolean; dueAt: string | null; outcome: string | null; patient: { code: string; name: string } | null }
export function RightsBoard({ rows }: { rows: RightsRow[] }) {
  const { busy, err, call } = useCall(); const [sel, setSel] = useState<RightsRow | null>(null); const [bundle, setBundle] = useState<unknown>(null);
  const outcomes = [["FULFILLED", "Fulfilled"], ["PARTIALLY_FULFILLED", "Partly fulfilled"], ["RETENTION_EXCEPTION", "Cannot delete: legal retention"], ["LEGAL_HOLD", "Legal hold applies"], ["NOT_APPLICABLE", "Not applicable"]];
  return (
    <div>
      <div className="relative overflow-x-auto"><table className="w-full text-left"><caption className="sr-only">Data-rights requests</caption>
        <thead><tr className="type-caption border-b border-line bg-surface-muted"><th scope="col" className="p-3">Request</th><th scope="col" className="p-3">Patient</th><th scope="col" className="p-3">Type</th><th scope="col" className="p-3">Due</th><th scope="col" className="p-3">Status</th><th scope="col" className="p-3"><span className="sr-only">Open</span></th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.id} className="border-b border-line last:border-0"><th scope="row" className="p-3 text-left">{r.requestNumber}</th><td className="p-3">{r.patient ? `${r.patient.name} (${r.patient.code})` : "—"}</td><td className="p-3">{r.label}</td><td className="p-3">{r.dueAt?.slice(0, 10) ?? "—"} {r.overdue && <StatusBadge tone="danger">overdue</StatusBadge>}</td><td className="p-3"><StatusBadge tone={["PENDING", "UNDER_REVIEW"].includes(r.status) ? "warning" : "neutral"}>{r.outcome ? r.outcome.toLowerCase().replace(/_/g, " ") : r.status.toLowerCase()}</StatusBadge></td><td className="p-3">{["PENDING", "UNDER_REVIEW"].includes(r.status) && <Button size="sm" variant="outline" onClick={() => { setSel(r); setBundle(null); }}>Handle</Button>}</td></tr>)}</tbody></table>
        {!rows.length && <p className="type-secondary p-6 text-center">No data-rights requests.</p>}</div>
      <Modal open={!!sel} onClose={() => setSel(null)} title={sel ? `${sel.requestNumber} — ${sel.label}` : ""} description={sel?.reason}>
        {sel && (bundle ? <div className="space-y-3"><Alert tone="success" title="Done">The export below is for you to hand to the patient securely. It is not stored.</Alert><a className="type-label inline-flex min-h-control items-center rounded-md border border-line-strong px-4" download={`${sel.requestNumber}.json`} href={`data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(bundle, null, 2))}`}>Download JSON export</a><div className="flex justify-end"><Button onClick={() => setSel(null)}>Close</Button></div></div>
          : <form onSubmit={async (e) => { const o = formObj(e); const d = await call<{ export: unknown }>("res", `/api/privacy/requests/${sel.id}`, "POST", o, "Request closed"); if (d) { if (d.export) setBundle(d.export); else setSel(null); } }} className="space-y-3" aria-label="Close request">
            {err.message && <Alert tone="danger">{err.message}</Alert>}
            {sel.kind === "ERASURE" && <Alert tone="info">Medical records are not deleted automatically. Choose “cannot delete: legal retention” and state the reason, or “partly fulfilled” to stop non-clinical communication.</Alert>}
            <Field label="Outcome" required error={err.fields.outcome}><Select name="outcome" placeholder="Choose" options={outcomes.map(([value, label]) => ({ value, label }))} /></Field>
            <Field label="Decision note (the patient sees this)" required error={err.fields.note}><Textarea name="note" rows={3} /></Field>
            <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setSel(null)}>Cancel</Button><Button type="submit" loading={busy === "res"}>Close request</Button></div>
          </form>)}
      </Modal>
    </div>
  );
}

/* ---------------------------------------------------------------- data rights card (patient portal) ---------------------------------------------------------------- */
export function DataRightsCard({ kinds }: { kinds: { value: string; label: string }[] }) {
  const { busy, err, call } = useCall(); const [done, setDone] = useState<string | null>(null);
  return (
    <form onSubmit={async (e) => { const o = formObj(e); const d = await call<{ requestNumber: string }>("dr", "/api/patient/privacy-requests", "POST", o); if (d) setDone(d.requestNumber); }} className="space-y-3 rounded-lg border border-line p-card" aria-label="Your data rights">
      <h2 className="type-section-title">Your data rights</h2><p className="type-secondary">Ask the clinic to show you, give you a copy of, restrict or review how it uses your information. Medical records must be kept for the period the law requires, so a deletion request may be answered with the reason it can&apos;t be done.</p>
      {done && <Alert tone="success" title="Request sent">Your reference is {done}. The clinic will answer within 30 days.</Alert>}
      {err.message && <Alert tone="danger">{err.message}</Alert>}
      <Field label="What do you need?" required error={err.fields.kind}><Select name="kind" placeholder="Choose" options={kinds} /></Field>
      <Field label="Details" required error={err.fields.reason}><Textarea name="reason" rows={3} maxLength={500} /></Field>
      <Button type="submit" loading={busy === "dr"}>Send request</Button>
    </form>
  );
}
