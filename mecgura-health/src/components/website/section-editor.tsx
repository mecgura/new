"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Alert, Button, Card, CardBody, CardHeader, Field, TextInput, Toggle, useToast } from "@/components/ui";
import { apiFetch } from "@/lib/api/client";
import { DAYS, DAY_LABELS, type Day } from "@/lib/website/content";
import { FieldsForm, type FieldDef, type Values } from "./fields";

/** Saves ONE section of the DRAFT site content. Visitors see nothing until the site is published. */
export function SectionEditor({ section, title, description, fields, initial, extra, starter }: { section: string; title: string; description?: string; fields: FieldDef[]; initial: Values; extra?: (v: Values, set: (v: Values) => void, errors: Record<string, string>) => React.ReactNode; starter?: { field: string; label: string; text: string }[] }) {
  const router = useRouter();
  const toast = useToast();
  const [value, setValue] = useState<Values>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(value) !== JSON.stringify(initial);
  const local: Record<string, string> = {};
  for (const [k, m] of Object.entries(errors)) if (k.startsWith(`${section}.`)) local[k.slice(section.length + 1)] = m;

  async function save() {
    setBusy(true);
    const res = await apiFetch("/api/website/content", { method: "PATCH", body: JSON.stringify({ section, data: value }) });
    setBusy(false);
    if (!res.ok) { setErrors(res.error.fieldErrors ?? {}); return toast({ tone: "danger", title: "Couldn't save", description: res.error.message }); }
    setErrors({}); toast({ tone: "success", title: "Draft saved", description: "Publish the website to make it visible." }); router.refresh();
  }
  return (
    <Card>
      <CardHeader title={title} description={description} />
      <CardBody className="space-y-section">
        {Object.keys(errors).length > 0 && <Alert tone="danger" title="Please fix the highlighted fields">{Object.values(errors).slice(0, 3).join(" ")}</Alert>}
        <FieldsForm fields={fields} value={value} onChange={setValue} errors={local} />
        {starter && <div className="flex flex-wrap gap-2">{starter.map((s) => <Button key={s.field} type="button" size="sm" variant="outline" onClick={() => setValue({ ...value, [s.field]: s.text })}>{s.label}</Button>)}</div>}
        {extra?.(value, setValue, local)}
        <div className="flex flex-wrap gap-2"><Button onClick={save} loading={busy} disabled={!dirty}>Save draft</Button><Button variant="outline" disabled={!dirty || busy} onClick={() => { setValue(initial); setErrors({}); }}>Cancel</Button></div>
      </CardBody>
    </Card>
  );
}

type Break = { from: string; to: string };
type Hours = Record<Day, { open: boolean; from: string; to: string; breaks: Break[] }>;

/** Opening hours editor (also the data future appointment-slot generation will read). */
export function HoursEditor({ value, onChange, errors }: { value: Hours; onChange: (h: Hours) => void; errors: Record<string, string> }) {
  const upd = (d: Day, patch: Partial<Hours[Day]>) => onChange({ ...value, [d]: { ...value[d], ...patch } });
  return (
    <fieldset className="space-y-3"><legend className="type-label mb-1">Opening hours</legend>
      {DAYS.map((d) => {
        const h = value[d];
        const err = Object.entries(errors).find(([k]) => k.startsWith(`hours.${d}`))?.[1];
        return (
          <div key={d} className="rounded-lg border border-line p-3">
            <div className="flex flex-wrap items-center gap-3">
              <span className="type-label w-24">{DAY_LABELS[d]}</span>
              <Toggle label={`${DAY_LABELS[d]} open`} checked={h.open} onChange={(open) => upd(d, { open })} />
              {h.open && <>
                <label className="flex items-center gap-1.5 text-sm">From <input type="time" aria-label={`${DAY_LABELS[d]} opens`} value={h.from} onChange={(e) => upd(d, { from: e.target.value })} className="type-form min-h-control rounded-md border border-line-strong px-2" /></label>
                <label className="flex items-center gap-1.5 text-sm">To <input type="time" aria-label={`${DAY_LABELS[d]} closes`} value={h.to} onChange={(e) => upd(d, { to: e.target.value })} className="type-form min-h-control rounded-md border border-line-strong px-2" /></label>
                {h.breaks.length < 3 && <Button type="button" size="sm" variant="ghost" onClick={() => upd(d, { breaks: [...h.breaks, { from: "13:00", to: "14:00" }] })}><Plus aria-hidden className="size-4" />Break</Button>}
              </>}
            </div>
            {h.open && h.breaks.map((b, i) => (
              <div key={i} className="mt-2 flex flex-wrap items-center gap-3 pl-0 sm:pl-28">
                <span className="text-sm text-muted">Break</span>
                <input type="time" aria-label={`${DAY_LABELS[d]} break ${i + 1} starts`} value={b.from} onChange={(e) => upd(d, { breaks: h.breaks.map((x, j) => (j === i ? { ...x, from: e.target.value } : x)) })} className="type-form min-h-control rounded-md border border-line-strong px-2" />
                <input type="time" aria-label={`${DAY_LABELS[d]} break ${i + 1} ends`} value={b.to} onChange={(e) => upd(d, { breaks: h.breaks.map((x, j) => (j === i ? { ...x, to: e.target.value } : x)) })} className="type-form min-h-control rounded-md border border-line-strong px-2" />
                <Button type="button" size="sm" variant="ghost" aria-label="Remove break" onClick={() => upd(d, { breaks: h.breaks.filter((_, j) => j !== i) })}><Trash2 aria-hidden className="size-4" /></Button>
              </div>
            ))}
            {err && <p role="alert" className="type-caption mt-1 !text-danger">{err}</p>}
          </div>
        );
      })}
    </fieldset>
  );
}

type NavItem = { key: string; label: string; visible: boolean };

/** Reorder / rename / hide menu entries. Keys are fixed, so arbitrary routes can't be added. */
export function NavigationEditor({ initial }: { initial: NavItem[] }) {
  const router = useRouter();
  const toast = useToast();
  const [items, setItems] = useState(initial);
  const [errors, setErrors] = useState<string>();
  const [busy, setBusy] = useState(false);
  const move = (i: number, d: -1 | 1) => { const n = [...items]; const j = i + d; if (j < 0 || j >= n.length) return; [n[i], n[j]] = [n[j], n[i]]; setItems(n); };
  async function save() {
    setBusy(true);
    const res = await apiFetch("/api/website/content", { method: "PATCH", body: JSON.stringify({ section: "navigation", data: items }) });
    setBusy(false);
    if (!res.ok) { setErrors(Object.values(res.error.fieldErrors ?? {})[0] ?? res.error.message); return toast({ tone: "danger", title: "Couldn't save", description: res.error.message }); }
    setErrors(undefined); toast({ tone: "success", title: "Navigation saved as draft" }); router.refresh();
  }
  const dirty = JSON.stringify(items) !== JSON.stringify(initial);
  return (
    <Card>
      <CardHeader title="Menu" description="Order, rename or hide menu entries. A page also needs content before it appears (for example, at least one published service)." />
      <CardBody className="space-y-4">
        {errors && <Alert tone="danger">{errors}</Alert>}
        <ul className="space-y-2">
          {items.map((n, i) => (
            <li key={n.key} className="flex flex-wrap items-center gap-2 rounded-lg border border-line p-2">
              <div className="flex"><Button type="button" size="sm" variant="ghost" aria-label={`Move ${n.label} up`} disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp aria-hidden className="size-4" /></Button>
                <Button type="button" size="sm" variant="ghost" aria-label={`Move ${n.label} down`} disabled={i === items.length - 1} onClick={() => move(i, 1)}><ArrowDown aria-hidden className="size-4" /></Button></div>
              <div className="min-w-40 flex-1"><Field label={`Label for “${n.key}”`}><TextInput value={n.label} maxLength={30} onChange={(e) => setItems(items.map((x) => (x.key === n.key ? { ...x, label: e.target.value } : x)))} /></Field></div>
              <Toggle label="Show" checked={n.visible} onChange={(visible) => setItems(items.map((x) => (x.key === n.key ? { ...x, visible } : x)))} />
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2"><Button onClick={save} loading={busy} disabled={!dirty}>Save draft</Button><Button variant="outline" disabled={!dirty || busy} onClick={() => setItems(initial)}>Cancel</Button></div>
      </CardBody>
    </Card>
  );
}

/** Client wrapper (a render function can't cross the server→client boundary): clinic info fields + the hours editor. */
export function ClinicSectionEditor({ fields, initial }: { fields: FieldDef[]; initial: Values }) {
  return (
    <SectionEditor section="clinic" title="Clinic information" description="Address, phone and email come from Settings → Clinic profile." fields={fields} initial={initial}
      extra={(val, set, errors) => <HoursEditor value={val.hours as Hours} onChange={(h) => set({ ...val, hours: h })} errors={errors} />} />
  );
}
