"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Alert, Badge, Button, ButtonLink, Card, CardBody, CardHeader, DataTable, ErrorState, Field, LoadingState, Modal, NumberInput, Pagination, SearchInput, Select, StatusBadge, TextInput, Textarea, useToast } from "@/components/ui";
import { useApi } from "@/components/patients/use-api";
import { apiFetch } from "@/lib/api/client";
import { bpToInput } from "@/lib/billing/money";
import { allocateFefo } from "@/lib/pharmacy/stock";
import type { DispensingDetail, DispensingRow, getPrescriptionForDispensing } from "@/lib/services/pharmacy-dispensing";
import { DISPENSING_LABEL, DISPENSING_TONE, dayLabel, stamp, useMoney, usePharmacy } from "./pharmacy-ui";

interface QueueRow { id: string; number: string | null; patientId: string; patientName: string; patientCode: string; doctorName: string | null; finalizedAt: string | null; itemCount: number; status: string }
interface QueuePage { rows: QueueRow[]; total: number; page: number; pageSize: number; capped: boolean }
const pageCount = (d?: { total: number; pageSize: number } | null) => Math.max(1, Math.ceil((d?.total ?? 0) / (d?.pageSize ?? 20)));

/** Prescriptions waiting for the pharmacy, and the history of what was dispensed. */
export function DispensingHome() {
  const sp = useSearchParams(); const [view, setView] = useState(sp.get("view") === "history" ? "history" : "queue");
  return (
    <div className="space-y-section">
      <div className="flex gap-2" role="group" aria-label="Dispensing view">{[["queue", "Prescriptions"], ["history", "Dispensed"]].map(([k, l]) => <Button key={k} size="sm" variant={view === k ? "primary" : "outline"} aria-pressed={view === k} onClick={() => setView(k)}>{l}</Button>)}</div>
      {view === "queue" ? <Queue /> : <History />}
    </div>
  );
}
function Queue() {
  const [status, setStatus] = useState("PENDING"); const [q, setQ] = useState(""); const [dq, setDq] = useState(""); const [page, setPage] = useState(1);
  useEffect(() => { const t = setTimeout(() => { setDq(q); setPage(1); }, 300); return () => clearTimeout(t); }, [q]);
  const { data, error, loading, reload } = useApi<QueuePage>(`/api/pharmacy/queue?${new URLSearchParams({ q: dq, status, page: String(page) })}`);
  return (
    <Card><CardHeader title="Prescriptions to dispense" description="Only finalized prescriptions appear here. The pharmacy can't change what the doctor prescribed." />
      <div className="grid gap-3 border-b border-line p-card sm:grid-cols-[1fr_14rem]"><SearchInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by patient name, patient ID or prescription number" aria-label="Search prescriptions" /><Select aria-label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} options={[{ value: "PENDING", label: "Pending" }, { value: "PARTIALLY_DISPENSED", label: "Partly dispensed" }, { value: "DISPENSED", label: "Dispensed" }, { value: "all", label: "All" }]} /></div>
      {error ? <ErrorState description={error.message} action={<Button onClick={reload}>Try again</Button>} /> : <DataTable caption="Prescriptions" loading={loading && !data} rows={data?.rows ?? []} rowKey={(r) => r.id} empty={{ title: "No prescriptions waiting.", description: "Finalized prescriptions from consultations appear here." }} columns={[
        { key: "n", header: "Prescription", cell: (r) => <span className="tabular-nums">{r.number ?? "—"}</span> }, { key: "p", header: "Patient", cell: (r) => <span className="type-label">{r.patientName} <span className="type-caption">{r.patientCode}</span></span> }, { key: "d", header: "Doctor", cell: (r) => r.doctorName ?? "—", hideOnMobile: true },
        { key: "f", header: "Date", cell: (r) => dayLabel(r.finalizedAt), hideOnMobile: true }, { key: "i", header: "Medicines", align: "right", cell: (r) => r.itemCount }, { key: "s", header: "Status", cell: (r) => <StatusBadge tone={DISPENSING_TONE[r.status]}>{DISPENSING_LABEL[r.status]}</StatusBadge> },
        { key: "a", header: "", align: "right", cell: (r) => <ButtonLink size="sm" variant={r.status === "DISPENSED" ? "outline" : "primary"} href={`/pharmacy/dispensing/${r.id}`}>{r.status === "DISPENSED" ? "View" : "Dispense"}</ButtonLink> },
      ]} />}
      {data?.capped && <p className="px-card type-caption">Showing the most recent 300 prescriptions. Use search to find older ones.</p>}
      <div className="px-card pb-card"><Pagination page={data?.page ?? 1} pageCount={pageCount(data)} onPageChange={setPage} /></div>
    </Card>
  );
}
interface HPage { rows: DispensingRow[]; total: number; page: number; pageSize: number }
function History() {
  const money = useMoney(); const [q, setQ] = useState(""); const [dq, setDq] = useState(""); const [status, setStatus] = useState(""); const [page, setPage] = useState(1);
  useEffect(() => { const t = setTimeout(() => { setDq(q); setPage(1); }, 300); return () => clearTimeout(t); }, [q]);
  const { data, error, loading, reload } = useApi<HPage>(`/api/pharmacy/dispensings?${new URLSearchParams({ q: dq, status, page: String(page) })}`);
  return (
    <Card><CardHeader title="Dispensed" description="Every dispensing, newest first." />
      <div className="grid gap-3 border-b border-line p-card sm:grid-cols-[1fr_14rem]"><SearchInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by dispensing number, patient name or ID" aria-label="Search dispensings" /><Select aria-label="Status" value={status} placeholder="All statuses" onChange={(e) => { setStatus(e.target.value); setPage(1); }} options={["PARTIALLY_DISPENSED", "DISPENSED", "CANCELLED"].map((v) => ({ value: v, label: DISPENSING_LABEL[v] }))} /></div>
      {error ? <ErrorState description={error.message} action={<Button onClick={reload}>Try again</Button>} /> : <DataTable caption="Dispensings" loading={loading && !data} rows={data?.rows ?? []} rowKey={(r) => r.id} empty={{ title: "No dispensing records." }} columns={[
        { key: "n", header: "Dispensing", cell: (r) => <Link href={`/pharmacy/dispensed/${r.id}`} className="type-label tabular-nums">{r.dispensingNumber}</Link> }, { key: "p", header: "Patient", cell: (r) => <span>{r.patientName} <span className="type-caption">{r.patientCode}</span></span> }, { key: "rx", header: "Prescription", cell: (r) => r.prescriptionNumber ?? "—", hideOnMobile: true },
        { key: "d", header: "When", cell: (r) => stamp(r.dispensedAt), hideOnMobile: true }, { key: "t", header: "Total", align: "right", cell: (r) => <span className="tabular-nums">{money(r.totalMinor)}</span> }, { key: "s", header: "Status", cell: (r) => <StatusBadge tone={DISPENSING_TONE[r.status]}>{DISPENSING_LABEL[r.status]}</StatusBadge> },
      ]} />}
      <div className="px-card pb-card"><Pagination page={data?.page ?? 1} pageCount={pageCount(data)} onPageChange={setPage} /></div>
    </Card>
  );
}

/* ------------------------------------------------------ the dispensing screen ------------------------------------------------------ */
type Rx = Awaited<ReturnType<typeof getPrescriptionForDispensing>>;
type RxLine = Rx["lines"][number];
interface Sel { medicineId: string; qty: string; manual: boolean; alloc: Record<string, string>; reason: string; notes: string; skip: boolean }
const freq = (l: RxLine) => [l.dose, l.frequency, l.foodTiming?.replace(/_/g, " ").toLowerCase(), l.durationDays ? `${l.durationDays} days` : null].filter(Boolean).join(" · ");

export function DispenseScreen({ id }: { id: string }) {
  const router = useRouter(); const toast = useToast(); const money = useMoney();
  const { data: rx, error, loading, reload } = useApi<Rx>(`/api/pharmacy/prescriptions/${id}`);
  const [sel, setSel] = useState<Record<string, Sel>>({}); const [key] = useState(() => `dsp-${crypto.randomUUID()}`); const [notes, setNotes] = useState(""); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<string>(); const [review, setReview] = useState(false);
  useEffect(() => {
    if (!rx) return;
    const t = setTimeout(() => setSel((cur) => {
      const next: Record<string, Sel> = {};
      for (const l of rx.lines) {
        const prev = cur[l.prescriptionItemId]; if (prev) { next[l.prescriptionItemId] = prev; continue; }
        const med = l.medicines.length === 1 ? l.medicines[0] : l.medicines.find((m) => m.available > 0);
        const want = l.remainingUnits ?? l.prescribedUnits;
        const q = med ? Math.min(want || med.available, med.available) : 0;
        next[l.prescriptionItemId] = { medicineId: med?.id ?? "", qty: q > 0 ? String(q) : "", manual: false, alloc: {}, reason: "", notes: "", skip: !med || med.available <= 0 || (l.remainingUnits === 0) };
      }
      return next;
    }), 0);
    return () => clearTimeout(t);
  }, [rx]);
  if (loading && !rx) return <LoadingState />;
  if (error || !rx) return <ErrorState code={error?.code} description={error?.message} action={<Button onClick={reload}>Try again</Button>} />;
  const today = new Date().toISOString().slice(0, 10);
  const set = (lid: string, patch: Partial<Sel>) => setSel((s) => ({ ...s, [lid]: { ...s[lid], ...patch } }));
  const active = rx.lines.filter((l) => sel[l.prescriptionItemId] && !sel[l.prescriptionItemId].skip && Number(sel[l.prescriptionItemId].qty) > 0);
  const estimate = active.reduce((a, l) => { const s = sel[l.prescriptionItemId]; const m = l.medicines.find((x) => x.id === s.medicineId); if (!m) return a; const q = Number(s.qty); const auto = allocateFefo(m.batches.map((b) => ({ ...b, status: "ACTIVE" })), q, today); const lines = s.manual ? Object.entries(s.alloc).map(([bid, v]) => ({ batchId: bid, quantity: Number(v) || 0 })) : auto.allocations; return a + lines.reduce((x, al) => x + al.quantity * (m.batches.find((b) => b.id === al.batchId)?.sellingPriceMinor ?? m.sellingPriceMinor), 0); }, 0);
  const partial = active.some((l) => { const s = sel[l.prescriptionItemId]; return l.prescribedUnits > 0 && (l.dispensedUnits + Number(s.qty)) < l.prescribedUnits; }) || rx.lines.some((l) => sel[l.prescriptionItemId]?.skip && (l.remainingUnits ?? 1) > 0);
  async function submit() {
    setBusy(true); setMsg(undefined);
    const items = active.map((l) => { const s = sel[l.prescriptionItemId]; return { prescriptionItemId: l.prescriptionItemId, medicineId: s.medicineId, quantity: s.qty, notes: s.notes || undefined, allocations: s.manual ? Object.entries(s.alloc).filter(([, v]) => Number(v) > 0).map(([batchId, v]) => ({ batchId, quantity: v, overrideReason: s.reason || undefined })) : undefined }; });
    const r = await apiFetch<{ id: string }>(`/api/pharmacy/prescriptions/${id}/dispense`, { method: "POST", body: JSON.stringify({ idempotencyKey: key, items, notes }) });
    setBusy(false);
    if (!r.ok) { setMsg(r.error.message); setReview(false); void reload(); return; }
    toast({ tone: "success", title: "Dispensed — pharmacy bill created" }); router.push(`/pharmacy/dispensed/${r.data.id}`);
  }
  const fully = rx.overallStatus === "DISPENSED";
  return (
    <div className="space-y-section">
      <div className="flex flex-wrap items-center justify-between gap-2"><Link href="/pharmacy/dispensing" className="type-label">← Prescriptions</Link><StatusBadge tone={DISPENSING_TONE[rx.overallStatus]}>{DISPENSING_LABEL[rx.overallStatus]}</StatusBadge></div>
      <Card><CardHeader title={<>Prescription <span className="tabular-nums">{rx.number ?? ""}</span></>} description={`${rx.patient?.name ?? "—"} · ${rx.patient?.code ?? ""} · Dr ${rx.doctorName ?? "—"} · ${dayLabel(rx.finalizedAt)}`} />
        <CardBody className="space-y-2"><Alert tone="info">The doctor&apos;s prescription is read-only here. If it is wrong or a medicine is unavailable, contact the doctor — a correction must come from the doctor as a new version. Nothing is substituted automatically.</Alert>{rx.status !== "FINALIZED" && <Alert tone="danger">This prescription is not finalized, so it can&apos;t be dispensed.</Alert>}{msg && <Alert tone="danger">{msg}</Alert>}</CardBody></Card>
      <ul className="space-y-3" aria-label="Prescribed medicines">{rx.lines.map((l) => {
        const s = sel[l.prescriptionItemId]; if (!s) return null; const med = l.medicines.find((m) => m.id === s.medicineId); const remaining = l.remainingUnits;
        return (
          <li key={l.prescriptionItemId}><Card><CardBody className="space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><p className="type-card-title break-words">{l.name} <span className="type-caption">{l.strength}</span></p><p className="type-secondary">{freq(l) || "—"}</p>{l.instructions && <p className="type-caption break-words">Doctor&apos;s instructions: {l.instructions}</p>}</div>
              <div className="text-right"><p className="type-caption">Prescribed</p><p className="type-label tabular-nums">{l.prescribedUnits || "not stated"}</p><p className="type-caption tabular-nums">Dispensed {l.dispensedUnits}{remaining != null ? ` · remaining ${remaining}` : ""}</p></div></div>
            {!l.medicines.length ? <Alert tone="warning" title="Prescribed medicine unavailable">No medicine in the clinic&apos;s inventory matches this prescription line exactly. Contact the doctor if it can&apos;t be supplied.</Alert> : (
              <div className="space-y-3">
                {l.medicines.length > 1 && <Field label="Inventory medicine"><Select value={s.medicineId} onChange={(e) => set(l.prescriptionItemId, { medicineId: e.target.value, alloc: {}, manual: false })} options={l.medicines.map((m) => ({ value: m.id, label: `${m.name} · ${m.available} available` }))} /></Field>}
                {med && med.available <= 0 && <Alert tone="warning" title="Medicine unavailable">{med.expiredOrBlockedUnits > 0 ? `${med.expiredOrBlockedUnits} units are expired or blocked and can't be dispensed.` : "No stock."}</Alert>}
                {med && med.available > 0 && remaining !== 0 && (
                  <>
                    <div className="grid gap-3 sm:grid-cols-[10rem_1fr] sm:items-end">
                      <Field label={`Dispense now (${med.unit})`} hint={`${med.available} available`}><NumberInput value={s.qty} inputMode="numeric" disabled={s.skip} onChange={(e) => set(l.prescriptionItemId, { qty: e.target.value, skip: false })} /></Field>
                      <label className="type-label flex min-h-control items-center gap-2"><input type="checkbox" checked={s.skip} onChange={(e) => set(l.prescriptionItemId, { skip: e.target.checked })} />Don&apos;t dispense this medicine now</label>
                    </div>
                    {!s.skip && <BatchPicker med={med} s={s} today={today} onChange={(p) => set(l.prescriptionItemId, p)} />}
                    {!s.skip && l.prescribedUnits === 0 && <Field label="Note (the doctor didn't state a quantity)" required><TextInput value={s.notes} maxLength={200} onChange={(e) => set(l.prescriptionItemId, { notes: e.target.value })} /></Field>}
                    {!s.skip && Number(s.qty) > 0 && <p className="type-secondary tabular-nums">Price {money(med.batches[0]?.sellingPriceMinor ?? med.sellingPriceMinor)} per {med.unit}{med.taxRateBp ? ` + ${bpToInput(med.taxRateBp)}% tax` : ""}</p>}
                  </>
                )}
                {remaining === 0 && <Badge tone="success">Fully dispensed</Badge>}
              </div>
            )}
          </CardBody></Card></li>
        );
      })}</ul>
      {!fully && (
        <Card><CardBody className="space-y-3"><Field label="Dispensing note (optional)"><Textarea rows={2} value={notes} maxLength={300} onChange={(e) => setNotes(e.target.value)} /></Field>
          <div className="flex flex-wrap items-center justify-between gap-3"><p className="type-secondary tabular-nums">{active.length} medicine{active.length === 1 ? "" : "s"} · about {money(estimate)} before tax. {partial && active.length > 0 ? "This will be a partial dispense." : ""}</p>
            <div className="flex gap-2"><ButtonLink variant="outline" href="/pharmacy/dispensing">Cancel</ButtonLink><Button disabled={!active.length || rx.status !== "FINALIZED"} onClick={() => setReview(true)}>{partial && active.length ? "Review partial dispense" : "Review and dispense"}</Button></div></div></CardBody></Card>
      )}
      {review && (
        <Modal open onClose={() => setReview(false)} title={partial ? "Confirm partial dispense" : "Confirm dispense"} description="Stock is deducted and the pharmacy bill is created together. Check the patient and quantities." footer={<><Button variant="outline" onClick={() => setReview(false)}>Back</Button><Button onClick={submit} loading={busy}>{partial ? "Partial dispense" : "Dispense"}</Button></>}>
          <div className="space-y-2"><p className="type-label">{rx.patient?.name} · {rx.patient?.code}</p><ul className="divide-y divide-line">{active.map((l) => { const s = sel[l.prescriptionItemId]; const m = l.medicines.find((x) => x.id === s.medicineId); return <li key={l.prescriptionItemId} className="flex justify-between gap-3 py-2"><span className="type-label min-w-0 break-words">{m?.name ?? l.name}</span><span className="type-label tabular-nums">× {s.qty}</span></li>; })}</ul><p className="type-secondary tabular-nums">About {money(estimate)} before tax. The server calculates the final bill.</p></div>
        </Modal>
      )}
    </div>
  );
}
function BatchPicker({ med, s, today, onChange }: { med: RxLine["medicines"][number]; s: Sel; today: string; onChange: (p: Partial<Sel>) => void }) {
  const qty = Number(s.qty) || 0; const auto = allocateFefo(med.batches.map((b) => ({ ...b, status: "ACTIVE" })), qty, today);
  const manualTotal = Object.values(s.alloc).reduce((a, v) => a + (Number(v) || 0), 0);
  return (
    <div className="space-y-2 rounded-md border border-line p-3">
      <div className="flex flex-wrap items-center justify-between gap-2"><p className="type-label">Batches (first expiry, first out)</p><label className="type-label flex items-center gap-2"><input type="checkbox" checked={s.manual} onChange={(e) => onChange({ manual: e.target.checked, alloc: e.target.checked ? Object.fromEntries(auto.allocations.map((a) => [a.batchId, String(a.quantity)])) : {} })} />Choose batches myself</label></div>
      <ul className="divide-y divide-line">{med.batches.map((b) => { const a = auto.allocations.find((x) => x.batchId === b.id); return (
        <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 py-2"><span className="type-secondary">Batch <strong>{b.batchNumber}</strong> · expiry {dayLabel(b.expiryDate)} · {b.quantityAvailable} in stock</span>
          {s.manual ? <span className="w-28"><NumberInput aria-label={`Quantity from batch ${b.batchNumber}`} inputMode="numeric" value={s.alloc[b.id] ?? ""} onChange={(e) => onChange({ alloc: { ...s.alloc, [b.id]: e.target.value } })} /></span> : a ? <Badge tone="info">Suggested: {a.quantity}</Badge> : null}</li>); })}</ul>
      {s.manual && <><p className={`type-caption tabular-nums ${manualTotal === qty ? "" : "!text-danger"}`}>Selected {manualTotal} of {qty}</p><Field label="Reason for not using the first-expiry batch" hint="Required when you pick different batches than suggested"><TextInput value={s.reason} maxLength={200} onChange={(e) => onChange({ reason: e.target.value })} /></Field></>}
    </div>
  );
}

/* ----------------------------------------------------- dispensed record ----------------------------------------------------- */
export function DispensedView({ id }: { id: string }) {
  const { perms } = usePharmacy(); const money = useMoney(); const toast = useToast(); const router = useRouter();
  const { data: d, error, loading, reload } = useApi<DispensingDetail>(`/api/pharmacy/dispensings/${id}`);
  const [cancel, setCancel] = useState(false); const [reason, setReason] = useState(""); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<string>(); const [ret, setRet] = useState<DispensingDetail["items"][number] | null>(null);
  if (loading && !d) return <LoadingState />;
  if (error || !d) return <ErrorState code={error?.code} description={error?.message} action={<Button onClick={reload}>Try again</Button>} />;
  async function doCancel() { setBusy(true); setMsg(undefined); const r = await apiFetch(`/api/pharmacy/dispensings/${id}/cancel`, { method: "POST", body: JSON.stringify({ reason }) }); setBusy(false); if (!r.ok) { setMsg(r.error.message); return; } toast({ tone: "success", title: "Dispensing cancelled — stock restored" }); setCancel(false); await reload(); router.refresh(); }
  const cancelled = d.status === "CANCELLED";
  return (
    <div className="space-y-section">
      <div className="flex flex-wrap items-center justify-between gap-2"><Link href="/pharmacy/dispensing?view=history" className="type-label">← Dispensed</Link><StatusBadge tone={DISPENSING_TONE[d.status]}>{DISPENSING_LABEL[d.status]}</StatusBadge></div>
      <Card><CardHeader title={<span className="tabular-nums">{d.dispensingNumber}</span>} description={`${d.patientName} · ${d.patientCode} · ${stamp(d.dispensedAt)} · by ${d.dispensedBy ?? "—"}`}
        action={<div className="flex flex-wrap gap-2">{!cancelled && <ButtonLink size="sm" variant="outline" href={`/pharmacy/docs/bill/${d.id}`}>Pharmacy bill</ButtonLink>}{!cancelled && <ButtonLink size="sm" variant="outline" href={`/pharmacy/docs/slip/${d.id}`}>Dispensing slip</ButtonLink>}{!cancelled && d.status === "PARTIALLY_DISPENSED" && perms.dispense && <ButtonLink size="sm" href={`/pharmacy/dispensing/${d.prescriptionId}`}>Dispense the rest</ButtonLink>}{!cancelled && perms.returnApprove && <Button size="sm" variant="danger" onClick={() => setCancel(true)}>Cancel dispensing</Button>}</div>} />
        <CardBody className="space-y-3">
          {msg && <Alert tone="danger">{msg}</Alert>}{cancelled && <Alert tone="warning" title="Cancelled">{d.cancelReason}</Alert>}
          <p className="type-secondary">Prescription {d.prescriptionNumber ?? "—"}{d.invoice ? <> · Bill <strong className="tabular-nums">{d.invoice.invoiceNumber}</strong> ({d.invoice.status.replace(/_/g, " ").toLowerCase()}{d.invoice.collectedMinor ? `, ${money(d.invoice.collectedMinor)} collected` : ""}). Payment is collected in Billing.</> : null}</p>
          <DataTable caption="Dispensed medicines" rows={d.items} rowKey={(i) => i.id} columns={[
            { key: "m", header: "Medicine", cell: (i) => <span className="type-label">{i.medicineName}</span> }, { key: "b", header: "Batch / expiry", cell: (i) => `${i.batchNumber} · ${dayLabel(i.expiry)}` }, { key: "p", header: "Prescribed", align: "right", cell: (i) => i.prescribedQuantity || "—", hideOnMobile: true },
            { key: "q", header: "Dispensed", align: "right", cell: (i) => <span className="tabular-nums">{i.dispensedQuantity}{i.returnedQuantity ? ` (${i.returnedQuantity} returned)` : ""}</span> }, { key: "u", header: "Price", align: "right", cell: (i) => money(i.unitPriceMinor), hideOnMobile: true }, { key: "t", header: "Total", align: "right", cell: (i) => <span className="tabular-nums">{money(i.totalMinor)}</span> },
            { key: "a", header: "", align: "right", cell: (i) => (!cancelled && perms.returnRequest && i.status === "DISPENSED" ? <Button size="sm" variant="outline" onClick={() => setRet(i)}>Request return</Button> : null) },
          ]} />
          <div className="ml-auto w-fit rounded-lg border border-line p-3"><p className="type-caption">Total (incl. tax)</p><p className="type-card-title tabular-nums">{money(d.totalMinor)}</p></div>
          {d.items.some((i) => i.batchOverrideReason) && <p className="type-caption">Batch override: {d.items.filter((i) => i.batchOverrideReason).map((i) => `${i.batchNumber} — ${i.batchOverrideReason}`).join("; ")}</p>}
        </CardBody></Card>
      {cancel && <Modal open onClose={() => setCancel(false)} title="Cancel this dispensing?" description="The stock goes back (REVERSAL ledger entries) and the unpaid bill is cancelled. If money was collected, refund it in Billing first." footer={<><Button variant="outline" onClick={() => setCancel(false)}>Keep</Button><Button variant="danger" onClick={doCancel} loading={busy}>Cancel dispensing</Button></>}><Field label="Reason" required><TextInput value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} /></Field></Modal>}
      {ret && <ReturnRequestModal item={ret} onClose={() => setRet(null)} onDone={async () => { setRet(null); await reload(); }} />}
    </div>
  );
}
export function ReturnRequestModal({ item, onClose, onDone }: { item: { id: string; medicineName: string; dispensedQuantity: number; returnedQuantity: number }; onClose: () => void; onDone: () => Promise<void> }) {
  const toast = useToast(); const [quantity, setQuantity] = useState("1"); const [reason, setReason] = useState(""); const [errors, setErrors] = useState<Record<string, string>>({}); const [msg, setMsg] = useState<string>(); const [busy, setBusy] = useState(false);
  async function go() { setBusy(true); setErrors({}); setMsg(undefined); const r = await apiFetch("/api/pharmacy/returns", { method: "POST", body: JSON.stringify({ type: "PATIENT_RETURN", dispensingItemId: item.id, quantity, reason }) }); setBusy(false); if (!r.ok) { setErrors(r.error.fieldErrors ?? {}); setMsg(r.error.message); return; } toast({ tone: "success", title: "Return requested" }); await onDone(); }
  return (
    <Modal open onClose={onClose} title="Request a medicine return" description={`${item.medicineName} · ${item.dispensedQuantity - item.returnedQuantity} units can still be returned. Returned medicine only goes back into stock after a manager approves and restocks it.`} footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={go} loading={busy}>Request return</Button></>}>
      <div className="space-y-3">{msg && <Alert tone="danger">{msg}</Alert>}<Field label="Quantity" required error={errors.quantity}><NumberInput value={quantity} inputMode="numeric" onChange={(e) => setQuantity(e.target.value)} /></Field><Field label="Reason" required error={errors.reason}><TextInput value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} /></Field></div>
    </Modal>
  );
}
