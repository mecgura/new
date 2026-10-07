"use client";
import Link from "next/link";
import { useState } from "react";
import { Alert, Button, Card, CardHeader, DataTable, ErrorState, Field, Modal, Select, StatusBadge, Textarea, TextInput, useToast } from "@/components/ui";
import { useApi } from "@/components/patients/use-api";
import { apiFetch } from "@/lib/api/client";
import { CHANNEL } from "./comms-labels";

interface Tpl { id: string; channel: string; eventType: string; name: string; language: string; subject: string | null; body: string; providerTemplateId: string | null; status: string; isDefault: boolean }
interface Builtin { eventType: string; label: string; category: string; languages: string[]; text: string; subject: string }
interface Data { canEdit: boolean; templates: Tpl[]; builtin: Builtin[]; variables: { name: string; description: string }[]; limits: Record<string, { body: number; subject: number }> }
interface Preview { problems: string[]; subject: string | null; body: string; length: number; limit: number; html: string | null; whatsappNote: string | null }
const LANG: Record<string, string> = { en: "English", hi: "Hindi", pa: "Punjabi" };
const ST: Record<string, "neutral" | "success" | "warning"> = { ACTIVE: "success", DRAFT: "warning", INACTIVE: "neutral", ARCHIVED: "neutral" };
const blank = { id: "", channel: "SMS", eventType: "APPOINTMENT_CONFIRMED", language: "en", name: "", subject: "", body: "", providerTemplateId: "" };

export function TemplateManager() {
  const toast = useToast(); const { data, error, reload } = useApi<Data>("/api/communications/templates"); const [edit, setEdit] = useState<typeof blank | null>(null);
  if (error) return <ErrorState code={error.code} description={error.message} />;
  async function status(id: string, s: string) { const r = await apiFetch(`/api/communications/templates/${id}/status`, { method: "POST", body: JSON.stringify({ status: s }) }); if (!r.ok) { toast({ tone: "danger", title: r.error.message }); return; } toast({ tone: "success", title: s === "ACTIVE" ? "Template is live" : "Template updated" }); await reload(); }
  const label = (e: string) => data?.builtin.find((b) => b.eventType === e)?.label ?? e;
  return (
    <div className="space-y-section">
      <div><Link href="/communications" className="type-caption underline">← Communications</Link><h1 className="type-page-title mt-1">Message templates</h1><p className="type-secondary">Built-in texts are used unless you activate your own. Messages never include results or diagnoses — they point patients to the secure portal.</p></div>
      <Alert tone="info" title="WhatsApp needs approved templates">WhatsApp only lets a clinic start a conversation with a template approved by Meta / your provider. Write the text here, submit it to your provider, then enter the approved template name and activate. Until then WhatsApp is not used for that notification.</Alert>
      <Card><CardHeader title="Your templates" action={data?.canEdit ? <Button onClick={() => setEdit({ ...blank })}>New template</Button> : undefined} />
        <DataTable caption="Clinic templates" loading={!data} rows={data?.templates ?? []} rowKey={(t) => t.id} empty={{ title: "You haven't written any templates.", description: "The built-in texts below are in use." }} columns={[
          { key: "n", header: "Template", cell: (t) => <span><strong>{t.name}</strong><br /><span className="type-caption">{label(t.eventType)}</span></span> },
          { key: "c", header: "Channel", cell: (t) => `${CHANNEL[t.channel]} · ${LANG[t.language]}` },
          { key: "p", header: "Provider id", cell: (t) => t.providerTemplateId ?? "—", hideOnMobile: true },
          { key: "s", header: "Status", cell: (t) => <StatusBadge tone={ST[t.status]}>{t.status.charAt(0) + t.status.slice(1).toLowerCase()}</StatusBadge> },
          { key: "a", header: "", align: "right", cell: (t) => data?.canEdit ? <div className="flex flex-wrap justify-end gap-1"><Button size="sm" variant="outline" onClick={() => setEdit({ id: t.id, channel: t.channel, eventType: t.eventType, language: t.language, name: t.name, subject: t.subject ?? "", body: t.body, providerTemplateId: t.providerTemplateId ?? "" })}>Edit</Button>{t.status !== "ACTIVE" && t.status !== "ARCHIVED" && <Button size="sm" onClick={() => status(t.id, "ACTIVE")}>Activate</Button>}{t.status === "ACTIVE" && <Button size="sm" variant="outline" onClick={() => status(t.id, "INACTIVE")}>Turn off</Button>}{t.status !== "ARCHIVED" && t.status !== "ACTIVE" && <Button size="sm" variant="outline" onClick={() => status(t.id, "ARCHIVED")}>Archive</Button>}</div> : null },
        ]} /></Card>
      <Card><CardHeader title="Built-in texts (English)" description="Used for SMS and email when you have no active template. Hindi and Punjabi exist for the main appointment, prescription, report and follow-up messages." />
        <ul className="divide-y divide-line">{data?.builtin.map((b) => <li key={b.eventType} className="flex flex-wrap items-start justify-between gap-3 p-card"><div className="min-w-0 max-w-3xl"><p className="type-label">{b.label} <span className="type-caption">· {b.languages.map((l) => LANG[l]).join(", ")}</span></p><p className="type-secondary mt-1 break-words">{b.text}</p></div>{data.canEdit && <div className="flex gap-1"><Button size="sm" variant="outline" onClick={() => setEdit({ ...blank, channel: "SMS", eventType: b.eventType, name: `${b.label} (clinic)`, body: b.text, subject: "" })}>Customise SMS</Button><Button size="sm" variant="outline" onClick={() => setEdit({ ...blank, channel: "WHATSAPP", eventType: b.eventType, name: `${b.label} (WhatsApp)`, body: b.text, subject: "" })}>WhatsApp</Button><Button size="sm" variant="outline" onClick={() => setEdit({ ...blank, channel: "EMAIL", eventType: b.eventType, name: `${b.label} (email)`, body: b.text, subject: b.subject })}>Email</Button></div>}</li>)}</ul></Card>
      {edit && data && <Editor tpl={edit} data={data} onClose={() => setEdit(null)} onSaved={async () => { setEdit(null); await reload(); }} />}
    </div>
  );
}

function Editor({ tpl, data, onClose, onSaved }: { tpl: typeof blank; data: Data; onClose: () => void; onSaved: () => Promise<void> }) {
  const toast = useToast(); const [f, setF] = useState(tpl); const [errors, setErrors] = useState<Record<string, string>>({}); const [msg, setMsg] = useState<string>(); const [busy, setBusy] = useState(false); const [pv, setPv] = useState<Preview | null>(null);
  const set = (p: Partial<typeof f>) => setF({ ...f, ...p });
  const body = () => ({ channel: f.channel, eventType: f.eventType, language: f.language, name: f.name, subject: f.channel === "EMAIL" ? f.subject : null, body: f.body, providerTemplateId: f.providerTemplateId || null });
  async function preview() { const r = await apiFetch<Preview>("/api/communications/templates/preview", { method: "POST", body: JSON.stringify(body()) }); if (!r.ok) { setMsg(r.error.message); return; } setMsg(undefined); setPv(r.data); }
  async function save() { setBusy(true); setErrors({}); setMsg(undefined); const r = await apiFetch(f.id ? `/api/communications/templates/${f.id}` : "/api/communications/templates", { method: f.id ? "PUT" : "POST", body: JSON.stringify(body()) }); setBusy(false); if (!r.ok) { setErrors(r.error.fieldErrors ?? {}); setMsg(r.error.message); return; } toast({ tone: "success", title: "Saved as draft", description: "Activate it to start using it." }); await onSaved(); }
  const lim = data.limits[f.channel]?.body ?? 0;
  return (
    <Modal open onClose={onClose} title={f.id ? "Edit template" : "New template"} footer={<><Button variant="outline" onClick={preview}>Preview</Button><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy}>Save draft</Button></>}>
      <div className="space-y-4">{msg && <Alert tone="danger">{msg}</Alert>}
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Channel" error={errors.channel}><Select value={f.channel} disabled={!!f.id} onChange={(e) => set({ channel: e.target.value })} options={Object.entries(CHANNEL).map(([value, label]) => ({ value, label }))} /></Field>
          <Field label="Notification" error={errors.eventType}><Select value={f.eventType} disabled={!!f.id} onChange={(e) => set({ eventType: e.target.value })} options={data.builtin.map((b) => ({ value: b.eventType, label: b.label }))} /></Field>
          <Field label="Language" error={errors.language}><Select value={f.language} disabled={!!f.id} onChange={(e) => set({ language: e.target.value })} options={Object.entries(LANG).map(([value, label]) => ({ value, label }))} /></Field>
        </div>
        <Field label="Name" error={errors.name}><TextInput value={f.name} maxLength={80} onChange={(e) => set({ name: e.target.value })} /></Field>
        {f.channel === "EMAIL" && <Field label="Subject" error={errors.subject}><TextInput value={f.subject} maxLength={150} onChange={(e) => set({ subject: e.target.value })} /></Field>}
        <Field label="Message text" error={errors.body} hint={`${f.body.length}/${lim} characters. Use {{variables}} below; nothing else is executed.`}><Textarea rows={6} value={f.body} onChange={(e) => set({ body: e.target.value })} /></Field>
        <div><p className="type-caption">Variables (click to add)</p><div className="mt-1 flex flex-wrap gap-1">{data.variables.map((v) => <button key={v.name} type="button" title={v.description} className="rounded-pill border border-line px-2 py-1 text-xs hover:bg-surface-muted" onClick={() => set({ body: `${f.body}{{${v.name}}}` })}>{`{{${v.name}}}`}</button>)}</div></div>
        {f.channel !== "EMAIL" && <Field label={f.channel === "WHATSAPP" ? "Approved WhatsApp template name" : "Operator (DLT) template id — if your SMS operator needs one"} error={errors.providerTemplateId} hint={f.channel === "WHATSAPP" ? "Required to activate. Exactly as approved by the provider, e.g. appointment_confirmed" : undefined}><TextInput value={f.providerTemplateId} onChange={(e) => set({ providerTemplateId: e.target.value })} /></Field>}
        {pv && <div className="space-y-2 rounded-xl border border-line p-3"><p className="type-label">Preview with sample data <span className="type-caption">(nothing is sent)</span></p>
          {pv.problems.map((p) => <Alert key={p} tone="danger">{p}</Alert>)}{pv.whatsappNote && <Alert tone="info">{pv.whatsappNote}</Alert>}
          {pv.subject && <p className="type-label">{pv.subject}</p>}<p className="type-body whitespace-pre-wrap break-words rounded-lg bg-surface-muted p-3">{pv.body}</p><p className="type-caption">{pv.length}/{pv.limit} characters</p>
          {pv.html && <iframe title="Email preview" sandbox="" srcDoc={pv.html} className="h-96 w-full rounded-lg border border-line bg-white" />}</div>}
      </div>
    </Modal>
  );
}
