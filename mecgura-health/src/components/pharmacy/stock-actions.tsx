"use client";
import { useState } from "react";
import { Alert, Button, Field, Modal, NumberInput, Select, TextInput, Textarea, useToast } from "@/components/ui";
import { apiFetch } from "@/lib/api/client";
import { moneyToMinor } from "@/lib/billing/money";
import { MedicinePicker } from "./medicine-picker";
import type { MedicineRow } from "@/lib/services/pharmacy-master";
import { REASON_LABEL } from "./pharmacy-ui";

export interface BatchLite { id: string; medicineName?: string; batchNumber: string; quantityAvailable: number; expiryDate: string; status: string }
function useSubmit(url: string, onDone: () => Promise<void> | void, ok: string) {
  const toast = useToast(); const [busy, setBusy] = useState(false); const [errors, setErrors] = useState<Record<string, string>>({}); const [msg, setMsg] = useState<string>();
  async function send(body: Record<string, unknown>) {
    setBusy(true); setErrors({}); setMsg(undefined);
    const r = await apiFetch(url, { method: "POST", body: JSON.stringify(body) }); setBusy(false);
    if (!r.ok) { setErrors(r.error.fieldErrors ?? {}); setMsg(r.error.message); return; }
    toast({ tone: "success", title: ok }); await onDone();
  }
  return { busy, errors, msg, send };
}

/** Adjustment (in / out), damage, or expired write-off for ONE batch. Stock only ever changes through a ledger row on the server. */
export function BatchActionModal({ kind, batch, onClose, onDone }: { kind: "adjust" | "damage" | "expire"; batch: BatchLite; onClose: () => void; onDone: () => Promise<void> | void }) {
  const url = kind === "adjust" ? "/api/pharmacy/stock/adjust" : kind === "damage" ? "/api/pharmacy/stock/damage" : "/api/pharmacy/stock/expire";
  const s = useSubmit(url, onDone, kind === "adjust" ? "Stock adjusted" : kind === "damage" ? "Damage recorded" : "Expired stock written off");
  const [f, setF] = useState({ direction: "OUT", quantity: kind === "expire" ? String(batch.quantityAvailable) : "", reason: kind === "adjust" ? "PHYSICAL_COUNT_CORRECTION" : "", notes: "" });
  const title = kind === "adjust" ? "Stock adjustment" : kind === "damage" ? "Record damaged stock" : "Write off expired stock";
  return (
    <Modal open onClose={onClose} title={title} description={`${batch.medicineName ?? "Batch"} · batch ${batch.batchNumber} · ${batch.quantityAvailable} in stock`} footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button variant={kind === "adjust" ? "primary" : "danger"} loading={s.busy} onClick={() => s.send(kind === "adjust" ? { batchId: batch.id, direction: f.direction, quantity: f.quantity, reason: f.reason, notes: f.notes } : { batchId: batch.id, quantity: f.quantity, reason: f.reason || (kind === "expire" ? "Expired stock disposed" : ""), notes: f.notes })}>{kind === "adjust" ? "Save adjustment" : kind === "damage" ? "Record damage" : "Write off"}</Button></>}>
      <div className="space-y-3">
        {s.msg && <Alert tone="danger">{s.msg}</Alert>}
        {kind === "expire" && <Alert tone="info">The batch stays in history. The remaining units are moved out with an EXPIRY ledger entry.</Alert>}
        {kind === "adjust" && <Field label="Direction" error={s.errors.direction}><Select value={f.direction} onChange={(e) => setF({ ...f, direction: e.target.value })} options={[{ value: "OUT", label: "Remove stock (out)" }, { value: "IN", label: "Add stock (in)" }]} /></Field>}
        <Field label="Quantity" required error={s.errors.quantity}><NumberInput value={f.quantity} inputMode="numeric" onChange={(e) => setF({ ...f, quantity: e.target.value })} /></Field>
        {kind === "adjust" ? <Field label="Reason" required error={s.errors.reason}><Select value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} options={Object.entries(REASON_LABEL).map(([value, label]) => ({ value, label }))} /></Field> : kind === "damage" ? <Field label="Reason" required error={s.errors.reason}><TextInput value={f.reason} maxLength={200} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="e.g. Broken in storage" /></Field> : null}
        <Field label={kind === "adjust" ? "Notes" : "Notes (optional)"} required={kind === "adjust"} error={s.errors.notes}><Textarea rows={2} value={f.notes} maxLength={300} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}
export function BlockModal({ batch, onClose, onDone }: { batch: BatchLite; onClose: () => void; onDone: () => Promise<void> | void }) {
  const blocked = batch.status === "BLOCKED"; const s = useSubmit(`/api/pharmacy/batches/${batch.id}/block`, onDone, blocked ? "Batch unblocked" : "Batch blocked"); const [reason, setReason] = useState("");
  return (
    <Modal open onClose={onClose} title={blocked ? "Unblock batch" : "Block batch"} description={`${batch.medicineName ?? "Batch"} · batch ${batch.batchNumber}`} footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button variant={blocked ? "primary" : "danger"} loading={s.busy} onClick={() => s.send({ block: !blocked, reason })}>{blocked ? "Unblock" : "Block"}</Button></>}>
      <div className="space-y-3">{s.msg && <Alert tone="danger">{s.msg}</Alert>}{!blocked && <Alert tone="info">A blocked batch can&apos;t be dispensed. Its stock is kept and can be unblocked later.</Alert>}{!blocked && <Field label="Reason" required error={s.errors.reason}><TextInput value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Recall notice" /></Field>}</div>
    </Modal>
  );
}
export function OpeningStockModal({ onClose, onDone, medicine }: { onClose: () => void; onDone: () => Promise<void> | void; medicine?: MedicineRow | null }) {
  const s = useSubmit("/api/pharmacy/stock/opening", onDone, "Opening stock added"); const [med, setMed] = useState<MedicineRow | null>(medicine ?? null);
  const [f, setF] = useState({ batchNumber: "", expiryDate: "", manufacturingDate: "", quantity: "", purchase: "", selling: "", notes: "" });
  const [local, setLocal] = useState<Record<string, string>>({});
  function go() {
    const pp = moneyToMinor(f.purchase); const sp = moneyToMinor(f.selling); const bad: Record<string, string> = {};
    if (!med) bad.medicineId = "Choose the medicine."; if (pp == null) bad.purchasePriceMinor = "Enter a price like 12.50."; if (sp == null) bad.sellingPriceMinor = "Enter a price like 12.50.";
    setLocal(bad); if (Object.keys(bad).length) return;
    void s.send({ medicineId: med!.id, batchNumber: f.batchNumber, expiryDate: f.expiryDate, manufacturingDate: f.manufacturingDate, quantity: f.quantity, purchasePriceMinor: pp, sellingPriceMinor: sp, notes: f.notes });
  }
  const e = { ...s.errors, ...local }; const set = (k: string) => (ev: { target: { value: string } }) => setF({ ...f, [k]: ev.target.value });
  return (
    <Modal open onClose={onClose} title="Add opening stock" description="Stock you already hold when you start using the system. Creates an OPENING ledger entry." footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={go} loading={s.busy}>Add opening stock</Button></>}>
      <div className="space-y-3">
        {s.msg && <Alert tone="danger">{s.msg}</Alert>}
        <MedicinePicker value={med} onPick={setMed} required error={e.medicineId} />
        <div className="grid gap-3 sm:grid-cols-2"><Field label="Batch number" required error={e.batchNumber}><TextInput value={f.batchNumber} maxLength={40} onChange={set("batchNumber")} /></Field><Field label="Quantity" required error={e.quantity}><NumberInput value={f.quantity} inputMode="numeric" onChange={set("quantity")} /></Field></div>
        <div className="grid gap-3 sm:grid-cols-2"><Field label="Expiry date" required error={e.expiryDate}><TextInput type="date" value={f.expiryDate} onChange={set("expiryDate")} /></Field><Field label="Manufacturing date" error={e.manufacturingDate}><TextInput type="date" value={f.manufacturingDate} onChange={set("manufacturingDate")} /></Field></div>
        <div className="grid gap-3 sm:grid-cols-2"><Field label="Purchase price (per unit)" required error={e.purchasePriceMinor}><TextInput value={f.purchase} inputMode="decimal" onChange={set("purchase")} /></Field><Field label="Selling price (per unit)" required error={e.sellingPriceMinor}><TextInput value={f.selling} inputMode="decimal" onChange={set("selling")} /></Field></div>
        <Field label="Notes" error={e.notes}><Textarea rows={2} value={f.notes} maxLength={300} onChange={set("notes")} /></Field>
      </div>
    </Modal>
  );
}
