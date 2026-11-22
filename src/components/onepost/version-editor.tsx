"use client";

import * as React from "react";
import { Plus, Trash2 } from "lucide-react";
import { Alert, Button, Field, Input, Modal, Select, Textarea } from "@/components/ds";
import { apiFetch } from "@/lib/client-api";
import { CHANNEL_LABELS, FIELD_SPECS, type Channel, type FieldSpec } from "@/lib/onepost";
import type { PostDetail } from "@/services/onepost/posts";

type Values = Record<string, unknown>;
type Pair = Record<string, string>;

/** Turns stored content into editable form values (tags become one line of text). */
function toForm(channel: Channel, content: unknown): Values {
  const c = (content ?? {}) as Values;
  const out: Values = {};
  for (const f of FIELD_SPECS[channel]) {
    const v = c[f.key];
    if (f.kind === "tags") out[f.key] = Array.isArray(v) ? (v as string[]).map((t) => `#${t}`).join(" ") : "";
    else if (f.kind === "pairs") out[f.key] = Array.isArray(v) ? (v as Pair[]).map((p) => ({ ...p })) : [];
    else out[f.key] = typeof v === "string" ? v : "";
  }
  return out;
}

function fromForm(channel: Channel, values: Values): Values {
  const out: Values = {};
  for (const f of FIELD_SPECS[channel]) {
    const v = values[f.key];
    out[f.key] = f.kind === "tags" ? String(v ?? "").split(/[\s,]+/).filter(Boolean) : v;
  }
  return out;
}

function PairsEditor({ spec, id, value, onChange, error }: { spec: Extract<FieldSpec, { kind: "pairs" }>; id: string; value: Pair[]; onChange: (v: Pair[]) => void; error?: string }) {
  const blank = Object.fromEntries(spec.fields.map((f) => [f.key, ""])) as Pair;
  return (
    <div className="space-y-3">
      {value.map((row, i) => (
        <div key={i} className="space-y-2 rounded-[var(--radius-control)] border border-app-border p-3">
          {spec.fields.map((f) => (
            <Field key={f.key} id={`${id}-${i}-${f.key}`} label={`${f.label} ${i + 1}`}>
              {f.textarea ? (
                <Textarea rows={3} value={row[f.key] ?? ""} onChange={(e) => onChange(value.map((r, j) => (j === i ? { ...r, [f.key]: e.target.value } : r)))} />
              ) : (
                <Input value={row[f.key] ?? ""} onChange={(e) => onChange(value.map((r, j) => (j === i ? { ...r, [f.key]: e.target.value } : r)))} />
              )}
            </Field>
          ))}
          <Button variant="ghost" size="sm" onClick={() => onChange(value.filter((_, j) => j !== i))}>
            <Trash2 aria-hidden="true" /> Remove
          </Button>
        </div>
      ))}
      {value.length < spec.maxItems ? (
        <Button variant="secondary" size="sm" onClick={() => onChange([...value, { ...blank }])}>
          <Plus aria-hidden="true" /> Add
        </Button>
      ) : null}
      {error ? <p role="alert" className="text-caption text-red-300">{error}</p> : null}
    </div>
  );
}

/** Edit one channel's version. Saves through the API, which validates every field again. */
export function VersionEditor({ open, onClose, orgId, post, channel, content, onSaved }: { open: boolean; onClose: () => void; orgId: string; post: PostDetail; channel: Channel; content: unknown; onSaved: (p: PostDetail) => void }) {
  const [values, setValues] = React.useState<Values>(() => toForm(channel, content));
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [error, setError] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  async function save() {
    setSaving(true);
    setError("");
    setErrors({});
    const r = await apiFetch<{ post: PostDetail }>(`/api/organizations/${orgId}/onepost/posts/${post.id}/versions/${channel}`, { method: "PUT", body: { content: fromForm(channel, values) } });
    setSaving(false);
    if (!r.ok) {
      setError(r.details ? "Please fix the highlighted fields." : r.error);
      setErrors(Object.fromEntries(Object.entries(r.details ?? {}).map(([k, v]) => [k.split(".")[0], v[0] ?? ""])));
      return;
    }
    onSaved(r.data.post);
    onClose();
  }

  const wasApproved = post.status === "approved" || post.status === "in_review";
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={`Edit ${CHANNEL_LABELS[channel]}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} loading={saving}>
            Save changes
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {wasApproved ? <Alert tone="warning">This post is {post.status === "approved" ? "approved" : "in review"}. Saving a change sends it back to draft so it can be approved again.</Alert> : null}
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {FIELD_SPECS[channel].map((f) => {
          const id = `ve-${channel}-${f.key}`;
          if (f.kind === "pairs") {
            return (
              <div key={f.key}>
                <p className="mb-2 text-small font-medium text-app-text">{f.label}</p>
                <PairsEditor spec={f} id={id} value={(values[f.key] as Pair[]) ?? []} onChange={(v) => setValues({ ...values, [f.key]: v })} error={errors[f.key]} />
              </div>
            );
          }
          if (f.kind === "select") {
            return (
              <Field key={f.key} id={id} label={f.label} error={errors[f.key]}>
                <Select value={String(values[f.key] ?? "")} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}>
                  {f.options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </Field>
            );
          }
          if (f.kind === "textarea") {
            return (
              <Field key={f.key} id={id} label={f.label} hint={f.hint ?? `${String(values[f.key] ?? "").length}/${f.max}`} error={errors[f.key]}>
                <Textarea rows={f.rows ?? 5} maxLength={f.max} value={String(values[f.key] ?? "")} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} />
              </Field>
            );
          }
          return (
            <Field key={f.key} id={id} label={f.label} hint={f.hint} error={errors[f.key]}>
              <Input maxLength={f.kind === "text" ? f.max : undefined} value={String(values[f.key] ?? "")} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} />
            </Field>
          );
        })}
      </div>
    </Modal>
  );
}
