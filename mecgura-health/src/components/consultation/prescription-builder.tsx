"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Download, Pencil, Plus, Printer, Search, Trash2 } from "lucide-react";
import { Alert, Badge, Button, Card, CardBody, CardHeader, Checkbox, EmptyState, Field, Modal, NumberInput, Select, StatusBadge, TextInput, Textarea, useToast } from "@/components/ui";
import { apiFetch } from "@/lib/api/client";
import type { CView, RxItem } from "./types";

const FOOD = [{ value: "BEFORE_FOOD", label: "Before food" }, { value: "AFTER_FOOD", label: "After food" }, { value: "WITH_FOOD", label: "With food" }, { value: "ANYTIME", label: "Any time" }];
const EMPTY: RxItem = { name: "", dose: "", frequency: "", morning: false, afternoon: false, evening: false, night: false };
interface Hit { id?: string; name: string; genericName?: string | null; brandName?: string | null; strength?: string | null; form?: string | null }

export function PrescriptionBuilder({ c, readOnly, reload, onSaving }: { c: CView; readOnly: boolean; reload: () => Promise<void>; onSaving: (s: "saving" | "saved" | "error") => void }) {
  const toast = useToast();
  const rx = c.prescription;
  const locked = readOnly || rx?.status === "FINALIZED";
  const [items, setItems] = useState<RxItem[]>((rx?.items as unknown as RxItem[]) ?? []);
  const [edit, setEdit] = useState<{ index: number; item: RxItem } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [amend, setAmend] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string>();
  const dirty = useRef(false);
  const itemsRef = useRef<RxItem[]>(items);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { setItems((rx?.items as unknown as RxItem[]) ?? []); dirty.current = false; }, [rx?.status, rx?.currentVersion, rx?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save(next: RxItem[]) {
    onSaving("saving");
    const r = await apiFetch(`/api/consultations/${c.id}/prescription`, { method: "PUT", body: JSON.stringify({ items: next }) });
    if (!r.ok) { onSaving("error"); setMsg(r.error.fieldErrors ? "Some medicines are incomplete. Open them to fix." : r.error.message); return false; }
    setMsg(undefined); dirty.current = false; onSaving("saved"); return true;
  }
  function change(next: RxItem[]) {
    setItems(next); itemsRef.current = next; dirty.current = true; onSaving("saving");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(next), 900);
  }
  // leaving the tab must never lose a pending edit: save it right away instead of dropping the timer
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); if (dirty.current) void save(itemsRef.current); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function act(action: "review" | "edit" | "amend") {
    setBusy(true); setMsg(undefined);
    if (dirty.current && !(await save(items))) { setBusy(false); return; }
    const r = await apiFetch(`/api/consultations/${c.id}/prescription/action`, { method: "POST", body: JSON.stringify({ action, reason: reason || undefined }) });
    setBusy(false);
    if (!r.ok) { setMsg(r.error.fieldErrors ? Object.values(r.error.fieldErrors).join(" ") : r.error.message); return; }
    setAmend(false); setReason(""); toast({ tone: "success", title: action === "amend" ? "Prescription reopened for amendment" : "Prescription updated" }); await reload();
  }
  async function print(version: number) {
    await apiFetch(`/api/consultations/${c.id}/prescription/print`, { method: "POST", body: JSON.stringify({ version }) });
    window.open(`/consultations/${c.id}/prescription?version=${version}`, "_blank", "noopener");
  }

  const move = (i: number, d: number) => { const n = [...items]; [n[i], n[i + d]] = [n[i + d], n[i]]; change(n); };
  const timing = (i: RxItem) => [i.morning && "Morning", i.afternoon && "Afternoon", i.evening && "Evening", i.night && "Night"].filter(Boolean).join(" + ");

  return (
    <Card>
      <CardHeader title="Prescription" description="You choose every medicine, dose and duration. Nothing is suggested or changed for you."
        action={<div className="flex flex-wrap items-center gap-2">{rx ? <StatusBadge tone={rx.status === "FINALIZED" ? "success" : rx.status === "REVIEW" ? "info" : "warning"}>{rx.status === "FINALIZED" ? `Finalized · ${rx.number} · v${rx.currentVersion}` : rx.status === "REVIEW" ? "In review" : "Draft"}</StatusBadge> : <Badge>Not started</Badge>}</div>} />
      <CardBody className="space-y-4">
        {msg && <Alert tone="danger">{msg}</Alert>}
        {rx?.status === "DRAFT" && rx.currentVersion > 0 && <Alert tone="warning" title="Amending a finalized prescription">Version {rx.currentVersion} stays on record. Finalizing creates version {rx.currentVersion + 1}{rx.amendReason ? ` (reason: ${rx.amendReason})` : ""}.</Alert>}
        {!items.length ? <EmptyState title="No medicines added" description={locked ? undefined : "Add a medicine to start the prescription."} /> : (
          <ol className="space-y-2">
            {items.map((i, n) => (
              <li key={n} className="rounded-md border border-line p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1 basis-56"><p className="type-label"><span className="text-muted">{n + 1}.</span> {i.name} {i.strength}{i.genericName ? <span className="type-caption"> · {i.genericName}</span> : null}</p>
                    <p className="type-secondary">{[i.dose, i.route, i.frequency, timing(i), FOOD.find((f) => f.value === i.foodTiming)?.label, i.durationDays ? `${i.durationDays} days` : null, i.quantity ? `qty ${i.quantity} ${i.quantityUnit ?? ""}` : null].filter(Boolean).join(" · ")}</p>
                    {i.instructions && <p className="type-body">{i.instructions}</p>}</div>
                  {!locked && <div className="flex gap-1">
                    <Button size="sm" variant="ghost" disabled={n === 0} onClick={() => move(n, -1)} aria-label={`Move ${i.name} up`}><ArrowUp aria-hidden className="size-4" /></Button>
                    <Button size="sm" variant="ghost" disabled={n === items.length - 1} onClick={() => move(n, 1)} aria-label={`Move ${i.name} down`}><ArrowDown aria-hidden className="size-4" /></Button>
                    <Button size="sm" variant="ghost" onClick={() => { setErrors({}); setEdit({ index: n, item: i }); }} aria-label={`Edit ${i.name}`}><Pencil aria-hidden className="size-4" /></Button>
                    <Button size="sm" variant="ghost" onClick={() => change(items.filter((_, k) => k !== n))} aria-label={`Remove ${i.name}`}><Trash2 aria-hidden className="size-4" /></Button>
                  </div>}
                </div>
              </li>
            ))}
          </ol>
        )}
        <div className="flex flex-wrap gap-2">
          {!locked && <Button onClick={() => { setErrors({}); setEdit({ index: -1, item: { ...EMPTY } }); }}><Plus aria-hidden className="size-4" />Add medicine</Button>}
          {!locked && rx?.status === "DRAFT" && items.length > 0 && c.can.owner && <Button variant="outline" onClick={() => act("review")} loading={busy}>Mark as reviewed</Button>}
          {!locked && rx?.status === "REVIEW" && <Button variant="outline" onClick={() => act("edit")} loading={busy}>Back to editing</Button>}
          {rx?.status === "FINALIZED" && c.can.amend !== undefined && c.can.owner && <Button variant="outline" onClick={() => setAmend(true)}>Amend prescription</Button>}
          {rx && rx.currentVersion > 0 && c.can.print && <><Button variant="outline" onClick={() => print(rx.currentVersion)}><Printer aria-hidden className="size-4" />Print</Button><a className="type-button inline-flex min-h-control items-center gap-2 rounded-md border border-line-strong px-4 !text-ink no-underline hover:bg-surface-muted" href={`/api/consultations/${c.id}/prescription/document?version=${rx.currentVersion}`}><Download aria-hidden className="size-4" />Download</a></>}
        </div>
        {rx && rx.versions.length > 0 && (
          <details className="rounded-md border border-line p-3"><summary className="type-label cursor-pointer">Version history ({rx.versions.length})</summary>
            <ul className="mt-2 space-y-1 text-sm">{rx.versions.map((v) => <li key={v.version} className="flex flex-wrap items-center justify-between gap-2"><span>v{v.version} · {v.createdAt.slice(0, 16).replace("T", " ")} UTC{v.reason ? ` · ${v.reason}` : ""} <span className="type-caption">ref {v.hash}</span></span>{c.can.print && <Button size="sm" variant="ghost" onClick={() => print(v.version)}>Print</Button>}</li>)}</ul></details>
        )}
      </CardBody>

      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit && edit.index >= 0 ? "Edit medicine" : "Add medicine"} description="Required: medicine name, dose and frequency."
        footer={<><Button variant="outline" onClick={() => setEdit(null)}>Cancel</Button><Button onClick={async () => { if (!edit) return; const it = edit.item; const e: Record<string, string> = {}; if (!it.name?.trim() || it.name.trim().length < 2) e.name = "Enter the medicine name."; if (!it.dose?.trim()) e.dose = "Enter the dose."; if (!it.frequency?.trim()) e.frequency = "Enter the frequency."; if (it.startDate && it.endDate && it.endDate < it.startDate) e.endDate = "End date is before the start date."; setErrors(e); if (Object.keys(e).length) return; const next = [...items]; if (edit.index >= 0) next[edit.index] = it; else next.push(it); setEdit(null); change(next); }}>Save medicine</Button></>}>
        {edit && <MedicineForm item={edit.item} errors={errors} onChange={(item) => setEdit({ ...edit, item })} />}
      </Modal>
      <Modal open={amend} onClose={() => setAmend(false)} title="Amend this prescription?" description="The finalized version stays on record. Your changes become a new version once you finalize again."
        footer={<><Button variant="outline" onClick={() => setAmend(false)} autoFocus>Cancel</Button><Button onClick={() => act("amend")} loading={busy} disabled={reason.trim().length < 3}>Start amendment</Button></>}>
        <Field label="Reason for the amendment" required><TextInput value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} /></Field>
      </Modal>
    </Card>
  );
}

function MedicineForm({ item, errors, onChange }: { item: RxItem; errors: Record<string, string>; onChange: (i: RxItem) => void }) {
  const [q, setQ] = useState("");
  const [state, setState] = useState<{ loading: boolean; configured: boolean | null; items: Hit[]; error?: string }>({ loading: false, configured: null, items: [] });
  const set = (k: keyof RxItem, v: unknown) => onChange({ ...item, [k]: v });
  useEffect(() => {
    if (q.trim().length < 2) { setState((s) => ({ ...s, items: [], loading: false })); return; }
    const t = setTimeout(async () => {
      setState((s) => ({ ...s, loading: true, error: undefined }));
      const r = await apiFetch<{ configured: boolean; items: Hit[] }>(`/api/medicines/search?q=${encodeURIComponent(q.trim())}`);
      setState(r.ok ? { loading: false, configured: r.data.configured, items: r.data.items } : { loading: false, configured: null, items: [], error: r.error.message });
    }, 300);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <div className="space-y-4">
      <div className="space-y-2 rounded-md border border-line p-3">
        <Field label="Search the clinic's medicine list" hint="Optional. You can always type the medicine yourself below."><div className="relative"><Search aria-hidden className="pointer-events-none absolute left-3 top-3.5 size-4 text-muted" /><TextInput className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" /></div></Field>
        <div aria-live="polite">
          {state.loading && <p className="type-caption">Searching…</p>}
          {state.error && <Alert tone="warning">{state.error}</Alert>}
          {state.configured === false && q.trim().length >= 2 && <p className="type-secondary">No medicine database configured. Type the medicine below.</p>}
          {state.configured && !state.loading && !state.items.length && q.trim().length >= 2 && <p className="type-secondary">No match in the clinic&apos;s list. Type the medicine below.</p>}
          {state.items.length > 0 && <ul className="divide-y divide-line rounded-md border border-line">{state.items.map((h, i) => <li key={i}><button type="button" className="flex min-h-control w-full flex-col items-start px-3 py-1.5 text-left hover:bg-surface-muted" onClick={() => { onChange({ ...item, name: h.name, genericName: h.genericName ?? "", brandName: h.brandName ?? "", strength: h.strength ?? "", medicineRefId: h.id }); setQ(""); }}><span className="type-label">{h.name} {h.strength}</span><span className="type-caption">{[h.genericName, h.brandName, h.form].filter(Boolean).join(" · ")}</span></button></li>)}</ul>}
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Medicine name" required error={errors.name}><TextInput value={item.name} onChange={(e) => set("name", e.target.value)} maxLength={150} /></Field>
        <Field label="Strength"><TextInput value={item.strength ?? ""} onChange={(e) => set("strength", e.target.value)} maxLength={60} /></Field>
        <Field label="Generic name"><TextInput value={item.genericName ?? ""} onChange={(e) => set("genericName", e.target.value)} maxLength={150} /></Field>
        <Field label="Brand name"><TextInput value={item.brandName ?? ""} onChange={(e) => set("brandName", e.target.value)} maxLength={150} /></Field>
        <Field label="Dose" required error={errors.dose}><TextInput value={item.dose ?? ""} onChange={(e) => set("dose", e.target.value)} maxLength={80} /></Field>
        <Field label="Route"><TextInput value={item.route ?? ""} onChange={(e) => set("route", e.target.value)} maxLength={40} /></Field>
        <Field label="Frequency" required error={errors.frequency}><TextInput value={item.frequency ?? ""} onChange={(e) => set("frequency", e.target.value)} maxLength={80} /></Field>
        <Field label="Food"><Select value={item.foodTiming ?? ""} onChange={(e) => set("foodTiming", e.target.value)} placeholder="Not specified" options={FOOD} /></Field>
      </div>
      <fieldset className="flex flex-wrap gap-x-5 gap-y-2"><legend className="type-label mb-1">Timing</legend>
        {(["morning", "afternoon", "evening", "night"] as const).map((k) => <Checkbox key={k} label={k[0].toUpperCase() + k.slice(1)} checked={!!item[k]} onChange={(e) => set(k, e.target.checked)} />)}
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Duration (days)"><NumberInput value={item.durationDays ?? ""} onChange={(e) => set("durationDays", e.target.value)} min={1} /></Field>
        <Field label="Quantity"><NumberInput value={item.quantity ?? ""} onChange={(e) => set("quantity", e.target.value)} min={0} /></Field>
        <Field label="Unit"><TextInput value={item.quantityUnit ?? ""} onChange={(e) => set("quantityUnit", e.target.value)} maxLength={30} /></Field>
        <Field label="Start date"><TextInput type="date" value={item.startDate ?? ""} onChange={(e) => set("startDate", e.target.value)} /></Field>
        <Field label="End date" error={errors.endDate}><TextInput type="date" value={item.endDate ?? ""} onChange={(e) => set("endDate", e.target.value)} /></Field>
      </div>
      <Field label="Special instructions"><Textarea value={item.instructions ?? ""} onChange={(e) => set("instructions", e.target.value)} rows={2} maxLength={500} /></Field>
    </div>
  );
}
