"use client";
import { useState } from "react";
import { Pencil, Plus } from "lucide-react";
import { Alert, Button, Card, CardBody, CardHeader, Checkbox, EmptyState, ErrorState, Field, LoadingState, Modal, Select, Textarea, TextInput, useToast } from "@/components/ui";
import { apiFetch } from "@/lib/api/client";
import { useApi } from "./use-api";

export interface FieldDef { name: string; label: string; type: "text" | "textarea" | "select" | "checkbox"; options?: { value: string; label: string }[]; required?: boolean; hint?: string; maxLength?: number }
type Item = Record<string, unknown> & { id: string };
export interface RecordConfig {
  kind: string; title: string; description: string; addLabel: string; empty: string; modalTitle: string;
  fields: FieldDef[]; defaults: Record<string, unknown>; editable: boolean;
  render: (i: Item) => { title: string; sub?: string; badges?: React.ReactNode; body?: string; meta?: string };
}

/**
 * One reusable section for allergies, medicines, history, family history and notes. It only STORES what staff type; it
 * never suggests, checks or infers anything. Write controls appear only when the server says this user may write.
 */
export function RecordSection({ patientId, cfg, readOnly }: { patientId: string; cfg: RecordConfig; readOnly?: boolean }) {
  const toast = useToast();
  const { data, error, loading, reload } = useApi<{ items: Item[]; canWrite: boolean | string[] }>(`/api/patients/${patientId}/records/${cfg.kind}`);
  const [editing, setEditing] = useState<Item | "new" | null>(null);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string>();
  const [busy, setBusy] = useState(false);

  const writableKinds = Array.isArray(data?.canWrite) ? data.canWrite : null;
  const canWrite = !readOnly && (Array.isArray(data?.canWrite) ? data.canWrite.length > 0 : !!data?.canWrite);
  const fields = cfg.fields.map((f) => (cfg.kind === "notes" && f.name === "kind" && writableKinds ? { ...f, options: f.options?.filter((o) => writableKinds.includes(o.value)) } : f));

  function open(item: Item | "new") {
    setErrors({}); setMsg(undefined);
    const base = item === "new" ? { ...cfg.defaults, ...(cfg.kind === "notes" && writableKinds ? { kind: writableKinds[0] } : {}) } : Object.fromEntries(cfg.fields.map((f) => [f.name, item[f.name] ?? cfg.defaults[f.name] ?? ""]));
    setValues(base); setEditing(item);
  }
  async function save() {
    setBusy(true); setErrors({}); setMsg(undefined);
    const isNew = editing === "new";
    const r = await apiFetch(isNew ? `/api/patients/${patientId}/records/${cfg.kind}` : `/api/patients/${patientId}/records/${cfg.kind}/${(editing as Item).id}`, { method: isNew ? "POST" : "PATCH", body: JSON.stringify(values) });
    setBusy(false);
    if (!r.ok) { setErrors(r.error.fieldErrors ?? {}); setMsg(r.error.fieldErrors ? "Please check the highlighted fields." : r.error.message); return; }
    toast({ tone: "success", title: isNew ? "Saved" : "Updated" }); setEditing(null); await reload();
  }

  return (
    <Card>
      <CardHeader title={cfg.title} description={cfg.description} action={canWrite ? <Button size="sm" onClick={() => open("new")}><Plus aria-hidden className="size-4" />{cfg.addLabel}</Button> : undefined} />
      {loading && !data ? <LoadingState /> : error ? <ErrorState code={error.code} description={error.message} action={<Button onClick={reload}>Try again</Button>} /> : !data?.items.length ? (
        <EmptyState title={cfg.empty} description={canWrite ? "Add the first entry using the button above." : undefined} />
      ) : (
        <ul className="divide-y divide-line">
          {data.items.map((i) => {
            const r = cfg.render(i);
            return (
              <li key={i.id} className="flex flex-wrap items-start justify-between gap-3 p-card">
                <div className="min-w-0 flex-1 basis-60">
                  <p className="type-label">{r.title}</p>
                  {r.sub && <p className="type-secondary">{r.sub}</p>}
                  {r.body && <p className="type-body mt-1 whitespace-pre-wrap break-words">{r.body}</p>}
                  {r.meta && <p className="type-caption mt-1">{r.meta}</p>}
                </div>
                <div className="flex items-center gap-2">{r.badges}{canWrite && cfg.editable && <Button size="sm" variant="ghost" onClick={() => open(i)} aria-label={`Edit ${r.title}`}><Pencil aria-hidden className="size-4" />Edit</Button>}</div>
              </li>
            );
          })}
        </ul>
      )}
      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing === "new" ? cfg.modalTitle : `Edit entry`}
        description="Enter only what the patient or clinician has stated. Nothing is inferred by the system."
        footer={<><Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button><Button onClick={save} loading={busy}>Save</Button></>}>
        <div className="space-y-4">
          {msg && <Alert tone="danger">{msg}</Alert>}
          {fields.map((f) => (
            f.type === "checkbox"
              ? <Checkbox key={f.name} label={f.label} checked={!!values[f.name]} onChange={(e) => setValues({ ...values, [f.name]: e.target.checked })} />
              : <Field key={f.name} label={f.label} required={f.required} hint={f.hint} error={errors[f.name]}>
                  {f.type === "select" ? <Select value={String(values[f.name] ?? "")} onChange={(e) => setValues({ ...values, [f.name]: e.target.value })} placeholder={f.required ? "Choose…" : "Not specified"} options={f.options ?? []} />
                    : f.type === "textarea" ? <Textarea value={String(values[f.name] ?? "")} onChange={(e) => setValues({ ...values, [f.name]: e.target.value })} rows={3} maxLength={f.maxLength} />
                    : <TextInput value={String(values[f.name] ?? "")} onChange={(e) => setValues({ ...values, [f.name]: e.target.value })} maxLength={f.maxLength} autoComplete="off" />}
                </Field>
          ))}
        </div>
      </Modal>
      <CardBody className="border-t border-line"><p className="type-caption">Recorded entries are kept for the patient file. Changes are logged.</p></CardBody>
    </Card>
  );
}
