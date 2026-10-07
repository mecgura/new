"use client";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import { Alert, Button, Card, CardBody, CardHeader, DatePicker, Field, Modal, NumberInput, Select, TextInput, Textarea, useToast } from "@/components/ui";
import type { PatientCard } from "@/components/scheduling/patient-picker";
import { apiFetch } from "@/lib/api/client";
import { bpToInput, formatMoney, minorToInput, moneyToMinor, percentToBp } from "@/lib/billing/money";
import type { ServiceView } from "@/lib/services/billing-master";
import { SERVICE_TYPE_LABEL } from "./billing-ui";

interface Line { key: number; serviceId: string; description: string; price: string; qty: string; dtype: "NONE" | "PERCENT" | "FIXED"; dvalue: string }
export interface EditorInitial { id: string; patient: { id: string; name: string; code: string }; items: { serviceId: string | null; description: string; unitPriceMinor: number; quantity: number; discountType: string | null; discountValue: number | null }[]; discountType: string | null; discountValue: number | null; discountReason: string | null; dueDate: string | null; invoiceDate: string; notes: string | null; links: { consultationId: string | null; appointmentId: string | null } }
interface Preview { currency: string; subtotalMinor: number; discountMinor: number; taxMinor: number; totalMinor: number; taxMode: string; lines: { description: string; quantity: number; unitPriceMinor: number; lineSubtotalMinor: number; discountMinor: number; invoiceDiscountMinor: number; taxMinor: number; taxRateBp: number; taxName: string | null; lineTotalMinor: number }[] }

let seq = 1;
const blank = (): Line => ({ key: seq++, serviceId: "", description: "", price: "", qty: "1", dtype: "NONE", dvalue: "" });

/** Create or edit a DRAFT invoice. Prices come from the service list; every total shown is calculated by the server (preview endpoint). */
export function InvoiceEditor({ services, initial, presetPatient, canDiscount, discountHint, currency }: { services: ServiceView[]; initial?: EditorInitial; presetPatient?: { id: string; name: string; code: string }; canDiscount: boolean; discountHint: string | null; currency: string }) {
  const router = useRouter(); const toast = useToast();
  const [patient, setPatient] = useState<{ id: string; name: string; code: string } | null>(initial?.patient ?? presetPatient ?? null);
  const [q, setQ] = useState(""); const [results, setResults] = useState<PatientCard[] | null>(null);
  const [lines, setLines] = useState<Line[]>(() => initial?.items.length ? initial.items.map((i) => ({ key: seq++, serviceId: i.serviceId ?? "", description: i.serviceId ? "" : i.description, price: i.serviceId ? "" : minorToInput(i.unitPriceMinor), qty: String(i.quantity), dtype: (i.discountType as "PERCENT" | "FIXED") ?? "NONE", dvalue: i.discountType === "PERCENT" ? bpToInput(i.discountValue ?? 0) : i.discountType === "FIXED" ? minorToInput(i.discountValue ?? 0) : "" })) : [blank()]);
  const [inv, setInv] = useState({ dtype: ((initial?.discountType as "PERCENT" | "FIXED" | null) ?? "NONE") as "NONE" | "PERCENT" | "FIXED", dvalue: initial?.discountType === "PERCENT" ? bpToInput(initial.discountValue ?? 0) : initial?.discountType === "FIXED" ? minorToInput(initial.discountValue ?? 0) : "", reason: initial?.discountReason ?? "", dueDate: initial?.dueDate ?? "", notes: initial?.notes ?? "" });
  const [preview, setPreview] = useState<Preview | null>(null); const [error, setError] = useState<string>(); const [fieldErr, setFieldErr] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<"save" | "issue" | null>(null); const [review, setReview] = useState(false);
  const byId = useMemo(() => new Map(services.map((s) => [s.id, s])), [services]);

  useEffect(() => {
    if (patient || q.trim().length < 3) { setResults(null); return; }
    const t = setTimeout(async () => { const r = await apiFetch<PatientCard[]>(`/api/patients/search?q=${encodeURIComponent(q.trim())}`); if (r.ok) setResults(r.data); }, 300);
    return () => clearTimeout(t);
  }, [q, patient]);

  const discountOf = (type: string, v: string) => { if (type === "NONE" || !v.trim()) return null; const val = type === "PERCENT" ? percentToBp(v) : moneyToMinor(v); return val == null ? undefined : { type, value: val }; };
  function payload() {
    const items = [];
    for (const l of lines) {
      if (!l.serviceId && !l.description.trim() && !l.price.trim()) continue;
      const d = discountOf(l.dtype, l.dvalue); if (d === undefined) return "Enter valid discount values.";
      const qty = Number(l.qty); if (!Number.isInteger(qty)) return "Quantity must be a whole number.";
      if (l.serviceId) items.push({ serviceId: l.serviceId, quantity: qty, discount: d });
      else { const p = moneyToMinor(l.price); if (p == null) return "Enter a valid price for the custom item."; items.push({ description: l.description, unitPriceMinor: p, quantity: qty, discount: d }); }
    }
    if (!items.length) return null;
    const idisc = discountOf(inv.dtype, inv.dvalue); if (idisc === undefined) return "Enter a valid invoice discount.";
    return { patientId: patient?.id ?? "pending", items, discount: idisc, discountReason: inv.reason || undefined, dueDate: inv.dueDate || undefined, notes: inv.notes || undefined, consultationId: initial?.links.consultationId ?? undefined, appointmentId: initial?.links.appointmentId ?? undefined };
  }
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const p = payload();
      if (p === null) { setPreview(null); setError(undefined); return; }
      if (typeof p === "string") { setError(p); return; }
      const r = await apiFetch<Preview>("/api/billing/invoices/preview", { method: "POST", body: JSON.stringify(p) });
      if (r.ok) { setPreview(r.data); setError(undefined); setFieldErr({}); } else { setPreview(null); setError(r.error.message); setFieldErr(r.error.fieldErrors ?? {}); }
    }, 350);
    return () => { if (timer.current) clearTimeout(timer.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, inv, patient]);

  async function save(issue: boolean) {
    const p = payload();
    if (!patient) { setError("Choose the patient."); return; }
    if (p === null || typeof p === "string") { setError(p ?? "Add at least one item."); return; }
    setBusy(issue ? "issue" : "save"); setError(undefined);
    const r = initial ? await apiFetch<{ id: string }>(`/api/billing/invoices/${initial.id}`, { method: "PUT", body: JSON.stringify({ ...p, patientId: patient.id }) }) : await apiFetch<{ id: string }>("/api/billing/invoices", { method: "POST", body: JSON.stringify(p) });
    if (!r.ok) { setBusy(null); setError(r.error.message); setFieldErr(r.error.fieldErrors ?? {}); setReview(false); return; }
    const id = initial?.id ?? r.data.id;
    if (issue) { const i = await apiFetch(`/api/billing/invoices/${id}/issue`, { method: "POST" }); if (!i.ok) { setBusy(null); setError(i.error.message); setReview(false); router.push(`/billing/invoices/${id}`); return; } }
    toast({ tone: "success", title: issue ? "Invoice issued" : "Draft saved" });
    router.push(`/billing/invoices/${id}`); router.refresh();
  }
  const setLine = (key: number, patch: Partial<Line>) => setLines(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const m = (x: number) => formatMoney(x, preview?.currency ?? currency);
  const sorted = [...services].sort((a, b) => a.type.localeCompare(b.type) || a.serviceName.localeCompare(b.serviceName));

  return (
    <div className="grid gap-section lg:grid-cols-[1fr_22rem]">
      <div className="space-y-section">
        {error && <Alert tone="danger">{error}</Alert>}
        <Card><CardHeader title="Patient" />
          <CardBody>{patient ? <div className="flex items-center justify-between rounded-md border border-line p-2"><span className="type-label">{patient.name} · <span className="tabular-nums">{patient.code}</span></span>{!initial && !presetPatient && <Button size="sm" variant="ghost" aria-label="Choose a different patient" onClick={() => setPatient(null)}><X aria-hidden className="size-4" /></Button>}</div> : (
            <div className="space-y-2"><Field label="Search patient" required error={fieldErr.patientId} hint="Name, patient ID or mobile (3+ characters)"><TextInput value={q} onChange={(e) => setQ(e.target.value)} /></Field>
              {results && (results.length ? <ul className="max-h-44 divide-y divide-line overflow-y-auto rounded-md border border-line">{results.map((p) => <li key={p.id}><button type="button" className="w-full p-2 text-left hover:bg-surface-muted" onClick={() => setPatient({ id: p.id, name: p.name, code: p.code })}><span className="type-label">{p.name}</span> <span className="type-caption">{p.code} · {p.phoneMasked}</span></button></li>)}</ul> : <p className="type-secondary">No matching patient.</p>)}</div>)}</CardBody></Card>
        <Card><CardHeader title="Items" description="Choose services from the price list. Prices can't be edited on a listed service." action={<Button size="sm" variant="outline" onClick={() => setLines([...lines, blank()])}><Plus aria-hidden className="size-4" />Add item</Button>} />
          <CardBody className="space-y-3">
            {lines.map((l, n) => {
              const svc = l.serviceId ? byId.get(l.serviceId) : null;
              return (
                <fieldset key={l.key} className="space-y-2 rounded-md border border-line p-3"><legend className="type-caption px-1">Item {n + 1}</legend>
                  <div className="grid gap-2 sm:grid-cols-[1fr_6rem_8rem]">
                    <Field label="Service" error={fieldErr[`items.${n}.serviceId`] ?? fieldErr[`items.${n}.description`]}><Select value={l.serviceId} onChange={(e) => setLine(l.key, { serviceId: e.target.value })} placeholder="Custom item" options={sorted.map((s) => ({ value: s.id, label: `${s.serviceName} (${SERVICE_TYPE_LABEL[s.type]}) — ${formatMoney(s.priceMinor, currency)}` }))} /></Field>
                    <Field label="Qty" error={fieldErr[`items.${n}.quantity`]}><NumberInput value={l.qty} inputMode="numeric" min={1} onChange={(e) => setLine(l.key, { qty: e.target.value })} /></Field>
                    <Field label="Price">{svc ? <p className="type-label min-h-control content-center tabular-nums">{formatMoney(svc.priceMinor, currency)}{svc.taxRateBp ? <span className="type-caption"> +{bpToInput(svc.taxRateBp)}% tax</span> : null}</p> : <TextInput value={l.price} inputMode="decimal" placeholder="0.00" onChange={(e) => setLine(l.key, { price: e.target.value })} aria-label={`Price for item ${n + 1}`} />}</Field>
                  </div>
                  {!svc && <Field label="Description" required error={fieldErr[`items.${n}.description`]}><TextInput value={l.description} maxLength={160} onChange={(e) => setLine(l.key, { description: e.target.value })} /></Field>}
                  <div className="flex flex-wrap items-end gap-2">
                    {canDiscount && (svc ? svc.discountEligible : true) && <><Field label="Item discount"><Select value={l.dtype} onChange={(e) => setLine(l.key, { dtype: e.target.value as Line["dtype"] })} options={[{ value: "NONE", label: "None" }, { value: "PERCENT", label: "Percent (%)" }, { value: "FIXED", label: `Amount (${currency})` }]} /></Field>{l.dtype !== "NONE" && <Field label="Value" error={fieldErr[`items.${n}.discount`]}><TextInput value={l.dvalue} inputMode="decimal" onChange={(e) => setLine(l.key, { dvalue: e.target.value })} /></Field>}</>}
                    {lines.length > 1 && <Button size="sm" variant="ghost" onClick={() => setLines(lines.filter((x) => x.key !== l.key))}><Trash2 aria-hidden className="size-4" />Remove</Button>}
                  </div>
                </fieldset>
              );
            })}
          </CardBody></Card>
        {canDiscount && <Card><CardHeader title="Invoice discount" description={discountHint ?? "Optional. Limits are set by the clinic admin."} />
          <CardBody className="grid gap-3 sm:grid-cols-3"><Field label="Type"><Select value={inv.dtype} onChange={(e) => setInv({ ...inv, dtype: e.target.value as "NONE" })} options={[{ value: "NONE", label: "None" }, { value: "PERCENT", label: "Percent (%)" }, { value: "FIXED", label: `Amount (${currency})` }]} /></Field>
            {inv.dtype !== "NONE" && <><Field label="Value" error={fieldErr.discount}><TextInput value={inv.dvalue} inputMode="decimal" onChange={(e) => setInv({ ...inv, dvalue: e.target.value })} /></Field><Field label="Reason" required error={fieldErr.discountReason}><TextInput value={inv.reason} maxLength={200} onChange={(e) => setInv({ ...inv, reason: e.target.value })} /></Field></>}</CardBody></Card>}
        <Card><CardBody className="grid gap-3 sm:grid-cols-2"><Field label="Due date (optional)" hint="Defaults to the clinic's payment terms."><DatePicker value={inv.dueDate} onChange={(e) => setInv({ ...inv, dueDate: e.target.value })} /></Field><Field label="Notes (shown on the invoice)"><Textarea rows={2} value={inv.notes} maxLength={500} onChange={(e) => setInv({ ...inv, notes: e.target.value })} /></Field></CardBody></Card>
      </div>

      <aside className="lg:sticky lg:top-4 lg:self-start" aria-label="Invoice summary">
        <Card><CardHeader title="Summary" description="Calculated by the server." />
          <CardBody className="space-y-2">
            {!preview ? <p className="type-secondary">Add an item to see the total.</p> : (
              <dl className="space-y-1.5 type-secondary tabular-nums">
                <div className="flex justify-between"><dt>Subtotal</dt><dd>{m(preview.subtotalMinor)}</dd></div>
                {preview.discountMinor > 0 && <div className="flex justify-between"><dt>Discount</dt><dd>− {m(preview.discountMinor)}</dd></div>}
                <div className="flex justify-between"><dt>{preview.taxMode === "INCLUSIVE" ? "Tax (included)" : "Tax"}</dt><dd>{m(preview.taxMinor)}</dd></div>
                <div className="flex justify-between border-t border-line pt-2 type-card-title"><dt>Total</dt><dd>{m(preview.totalMinor)}</dd></div>
              </dl>)}
            <div className="flex flex-col gap-2 pt-2">
              <Button variant="outline" loading={busy === "save"} disabled={!patient || !preview} onClick={() => save(false)}>Save draft</Button>
              <Button loading={busy === "issue"} disabled={!patient || !preview} onClick={() => setReview(true)}>Review &amp; issue</Button>
            </div>
          </CardBody></Card>
      </aside>

      <Modal open={review} onClose={() => setReview(false)} title="Issue this invoice?" description="After it is issued the items, prices, discount and tax are frozen. Changes need a cancellation or refund."
        footer={<><Button variant="outline" onClick={() => setReview(false)}>Back</Button><Button loading={busy === "issue"} onClick={() => save(true)}>Issue invoice</Button></>}>
        {preview && patient && <div className="space-y-2"><p className="type-label">{patient.name} · {patient.code}</p>
          <ul className="divide-y divide-line">{preview.lines.map((l, n) => <li key={n} className="flex justify-between gap-2 py-1.5 type-secondary"><span>{l.description} × {l.quantity}{l.taxRateBp ? ` (${l.taxName ?? "Tax"} ${bpToInput(l.taxRateBp)}%)` : ""}</span><span className="tabular-nums">{m(l.lineTotalMinor)}</span></li>)}</ul>
          <p className="type-card-title flex justify-between"><span>Total</span><span className="tabular-nums">{m(preview.totalMinor)}</span></p></div>}
      </Modal>
    </div>
  );
}
