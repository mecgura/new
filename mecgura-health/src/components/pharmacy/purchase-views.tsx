"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Alert, Button, ButtonLink, Card, CardBody, CardHeader, ConfirmDialog, DataTable, ErrorState, Field, LoadingState, Modal, NumberInput, Pagination, SearchInput, Select, StatusBadge, TextInput, Textarea, useToast } from "@/components/ui";
import { useApi } from "@/components/patients/use-api";
import { apiFetch } from "@/lib/api/client";
import { bpToInput, minorToInput, moneyToMinor, percentToBp } from "@/lib/billing/money";
import { computePurchase } from "@/lib/pharmacy/stock";
import type { MedicineRow } from "@/lib/services/pharmacy-master";
import type { PurchaseDetail } from "@/lib/services/pharmacy-inventory";
import { MedicinePicker } from "./medicine-picker";
import { PURCHASE_LABEL, PURCHASE_TONE, dayLabel, stamp, useMoney, usePharmacy } from "./pharmacy-ui";

interface PRow { id: string; purchaseNumber: string; supplierInvoiceNumber: string | null; supplierName: string; supplierCode: string; purchaseDate: string; totalMinor: number; status: string }
interface PPage { rows: PRow[]; total: number; page: number; pageSize: number }
interface SupplierRow { id: string; supplierCode: string; supplierName: string }

export function PurchaseList() {
  const { perms } = usePharmacy(); const money = useMoney(); const [status, setStatus] = useState(""); const [q, setQ] = useState(""); const [dq, setDq] = useState(""); const [page, setPage] = useState(1);
  useEffect(() => { const t = setTimeout(() => { setDq(q); setPage(1); }, 300); return () => clearTimeout(t); }, [q]);
  const { data, error, loading, reload } = useApi<PPage>(`/api/pharmacy/purchases?${new URLSearchParams({ q: dq, status, page: String(page) })}`);
  return (
    <Card><CardHeader title="Purchases" description="Draft → Received (stock added) → Completed. A received purchase can't be cancelled; return stock to the supplier instead." action={perms.purchase ? <ButtonLink size="sm" href="/pharmacy/purchases/new"><Plus aria-hidden className="size-4" />New purchase</ButtonLink> : undefined} />
      <div className="grid gap-3 border-b border-line p-card sm:grid-cols-[1fr_12rem]"><SearchInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by purchase number, supplier or supplier invoice" aria-label="Search purchases" /><Select aria-label="Status" value={status} placeholder="All statuses" onChange={(e) => { setStatus(e.target.value); setPage(1); }} options={Object.entries(PURCHASE_LABEL).map(([value, label]) => ({ value, label }))} /></div>
      {error ? <ErrorState description={error.message} action={<Button onClick={reload}>Try again</Button>} /> : <DataTable caption="Purchases" loading={loading && !data} rows={data?.rows ?? []} rowKey={(r) => r.id} empty={{ title: "No purchases." }} columns={[
        { key: "n", header: "Purchase", cell: (r) => <Link href={`/pharmacy/purchases/${r.id}`} className="type-label tabular-nums">{r.purchaseNumber}</Link> }, { key: "s", header: "Supplier", cell: (r) => r.supplierName }, { key: "i", header: "Supplier invoice", cell: (r) => r.supplierInvoiceNumber ?? "—", hideOnMobile: true },
        { key: "d", header: "Date", cell: (r) => dayLabel(r.purchaseDate) }, { key: "t", header: "Total", align: "right", cell: (r) => <span className="tabular-nums">{money(r.totalMinor)}</span> }, { key: "st", header: "Status", cell: (r) => <StatusBadge tone={PURCHASE_TONE[r.status]}>{PURCHASE_LABEL[r.status]}</StatusBadge> },
      ]} />}
      <div className="px-card pb-card"><Pagination page={data?.page ?? 1} pageCount={Math.max(1, Math.ceil((data?.total ?? 0) / (data?.pageSize ?? 20)))} onPageChange={setPage} /></div>
    </Card>
  );
}

interface Line { key: number; med: MedicineRow | null; batchNumber: string; expiryDate: string; manufacturingDate: string; quantity: string; free: string; price: string; selling: string; tax: string; discount: string }
const blank = (key: number, med: MedicineRow | null = null): Line => ({ key, med, batchNumber: "", expiryDate: "", manufacturingDate: "", quantity: "", free: "0", price: med ? minorToInput(med.purchasePriceMinor) : "", selling: med ? minorToInput(med.sellingPriceMinor) : "", tax: med ? bpToInput(med.taxRateBp) : "0", discount: "0" });
export function PurchaseEditor({ id }: { id?: string }) {
  const router = useRouter(); const toast = useToast(); const sp = useSearchParams(); const money = useMoney(); const keyRef = useRef(1);
  const existing = useApi<PurchaseDetail>(id ? `/api/pharmacy/purchases/${id}` : null); const suppliers = useApi<{ rows: SupplierRow[] }>("/api/pharmacy/suppliers?q=");
  const [supplierId, setSupplierId] = useState(""); const [invoice, setInvoice] = useState(""); const [date, setDate] = useState(""); const [notes, setNotes] = useState(""); const [lines, setLines] = useState<Line[]>([blank(0)]);
  const [busy, setBusy] = useState(false); const [errors, setErrors] = useState<Record<string, string>>({}); const [msg, setMsg] = useState<string>(); const [loaded, setLoaded] = useState(!id);
  useEffect(() => {
    const m = sp.get("medicineId"); if (!m || id) return;
    apiFetch<{ medicine: MedicineRow }>(`/api/pharmacy/medicines/${m}`).then((r) => { if (r.ok) setLines([blank(0, r.data.medicine)]); });
  }, [sp, id]);
  useEffect(() => {
    const p = existing.data; if (!p || loaded) return;
    const n = (x: PurchaseDetail) => x.items.map((i, k) => ({ key: k, med: { id: i.medicineId, displayName: i.medicineName, medicineCode: i.medicineCode } as unknown as MedicineRow, batchNumber: i.batchNumber, expiryDate: i.expiryDate, manufacturingDate: i.manufacturingDate ?? "", quantity: String(i.quantity), free: String(i.freeQuantity), price: minorToInput(i.unitPurchasePriceMinor), selling: minorToInput(i.sellingPriceMinor), tax: bpToInput(i.taxRateBp), discount: minorToInput(i.discountMinor) }));
    keyRef.current = p.items.length + 1;
    const t = setTimeout(() => { setSupplierId(p.supplier.id); setInvoice(p.supplierInvoiceNumber ?? ""); setDate(p.purchaseDate); setNotes(p.notes ?? ""); setLines(n(p)); setLoaded(true); }, 0);
    return () => clearTimeout(t);
  }, [existing.data, loaded]);
  const set = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const parsed = lines.map((l) => ({ q: Number(l.quantity) || 0, p: moneyToMinor(l.price) ?? 0, t: percentToBp(l.tax || "0") ?? 0, d: moneyToMinor(l.discount || "0") ?? 0 }));
  let totals = { subtotalMinor: 0, discountMinor: 0, taxMinor: 0, totalMinor: 0 };
  try { totals = computePurchase(parsed.map((x) => ({ quantity: x.q, unitPurchasePriceMinor: x.p, taxRateBp: x.t, discountMinor: x.d }))); } catch { /* shown by the server */ }
  async function save() {
    setBusy(true); setErrors({}); setMsg(undefined);
    const items = lines.map((l) => ({ medicineId: l.med?.id ?? "", batchNumber: l.batchNumber, expiryDate: l.expiryDate, manufacturingDate: l.manufacturingDate, quantity: l.quantity, freeQuantity: l.free || "0", unitPurchasePriceMinor: moneyToMinor(l.price), sellingPriceMinor: moneyToMinor(l.selling), taxRateBp: percentToBp(l.tax || "0"), discountMinor: moneyToMinor(l.discount || "0") }));
    const r = await apiFetch<{ id: string }>(id ? `/api/pharmacy/purchases/${id}` : "/api/pharmacy/purchases", { method: id ? "PUT" : "POST", body: JSON.stringify({ supplierId, supplierInvoiceNumber: invoice, purchaseDate: date, notes, items }) });
    setBusy(false);
    if (!r.ok) { setErrors(r.error.fieldErrors ?? {}); setMsg(r.error.message); return; }
    toast({ tone: "success", title: "Draft saved" }); router.push(`/pharmacy/purchases/${id ?? r.data.id}`);
  }
  if (id && !loaded) return existing.error ? <ErrorState code={existing.error.code} description={existing.error.message} /> : <LoadingState />;
  if (id && existing.data && existing.data.status !== "DRAFT") return <Alert tone="warning">Only a draft purchase can be edited. <Link href={`/pharmacy/purchases/${id}`}>Back to the purchase</Link></Alert>;
  const e = (k: string) => errors[k];
  return (
    <div className="space-y-section">
      <Card><CardHeader title={id ? "Edit draft purchase" : "New purchase"} description="Batch number and expiry come from the supplier's pack. Stock is added only when you receive the purchase." />
        <CardBody className="space-y-4">
          {msg && <Alert tone="danger">{msg}</Alert>}
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Supplier" required error={e("supplierId")}><Select value={supplierId} placeholder="Choose supplier" onChange={(ev) => setSupplierId(ev.target.value)} options={(suppliers.data?.rows ?? []).map((s) => ({ value: s.id, label: `${s.supplierName} (${s.supplierCode})` }))} /></Field>
            <Field label="Supplier invoice number" error={e("supplierInvoiceNumber")}><TextInput value={invoice} maxLength={40} onChange={(ev) => setInvoice(ev.target.value)} /></Field>
            <Field label="Purchase date" error={e("purchaseDate")}><TextInput type="date" value={date} onChange={(ev) => setDate(ev.target.value)} /></Field>
          </div>
          <ul className="space-y-3">{lines.map((l, n) => (
            <li key={l.key} className="space-y-3 rounded-lg border border-line p-3">
              <div className="flex items-start justify-between gap-2"><div className="min-w-0 flex-1"><MedicinePicker value={l.med} label={`Medicine ${n + 1}`} required error={e(`items.${n}.medicineId`)} onPick={(m) => set(l.key, m ? { med: m, price: minorToInput(m.purchasePriceMinor), selling: minorToInput(m.sellingPriceMinor), tax: bpToInput(m.taxRateBp) } : { med: null })} /></div>{lines.length > 1 && <Button size="sm" variant="ghost" aria-label={`Remove item ${n + 1}`} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}><Trash2 aria-hidden className="size-4" /></Button>}</div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Field label="Batch number" required error={e(`items.${n}.batchNumber`)}><TextInput value={l.batchNumber} maxLength={40} onChange={(ev) => set(l.key, { batchNumber: ev.target.value })} /></Field>
                <Field label="Expiry date" required error={e(`items.${n}.expiryDate`)}><TextInput type="date" value={l.expiryDate} onChange={(ev) => set(l.key, { expiryDate: ev.target.value })} /></Field>
                <Field label="Manufacturing date" error={e(`items.${n}.manufacturingDate`)}><TextInput type="date" value={l.manufacturingDate} onChange={(ev) => set(l.key, { manufacturingDate: ev.target.value })} /></Field>
                <Field label="Quantity" required error={e(`items.${n}.quantity`)}><NumberInput value={l.quantity} inputMode="numeric" onChange={(ev) => set(l.key, { quantity: ev.target.value })} /></Field>
                <Field label="Free quantity" error={e(`items.${n}.freeQuantity`)}><NumberInput value={l.free} inputMode="numeric" onChange={(ev) => set(l.key, { free: ev.target.value })} /></Field>
                <Field label="Purchase price (per unit)" required error={e(`items.${n}.unitPurchasePriceMinor`)}><TextInput value={l.price} inputMode="decimal" onChange={(ev) => set(l.key, { price: ev.target.value })} /></Field>
                <Field label="Selling price (per unit)" required error={e(`items.${n}.sellingPriceMinor`)}><TextInput value={l.selling} inputMode="decimal" onChange={(ev) => set(l.key, { selling: ev.target.value })} /></Field>
                <Field label="Tax (%)" error={e(`items.${n}.taxRateBp`)}><TextInput value={l.tax} inputMode="decimal" onChange={(ev) => set(l.key, { tax: ev.target.value })} /></Field>
                <Field label="Discount (amount)" error={e(`items.${n}.discountMinor`)}><TextInput value={l.discount} inputMode="decimal" onChange={(ev) => set(l.key, { discount: ev.target.value })} /></Field>
              </div>
            </li>))}</ul>
          <Button variant="outline" size="sm" onClick={() => setLines((ls) => [...ls, blank(keyRef.current++)])}><Plus aria-hidden className="size-4" />Add another medicine</Button>
          <Field label="Notes" error={e("notes")}><Textarea rows={2} value={notes} maxLength={300} onChange={(ev) => setNotes(ev.target.value)} /></Field>
          <div className="ml-auto w-full max-w-sm space-y-1 rounded-lg border border-line p-3"><div className="type-secondary flex justify-between"><span>Subtotal</span><span className="tabular-nums">{money(totals.subtotalMinor)}</span></div><div className="type-secondary flex justify-between"><span>Discount</span><span className="tabular-nums">−{money(totals.discountMinor)}</span></div><div className="type-secondary flex justify-between"><span>Tax</span><span className="tabular-nums">{money(totals.taxMinor)}</span></div><div className="type-card-title flex justify-between"><span>Grand total</span><span className="tabular-nums">{money(totals.totalMinor)}</span></div><p className="type-caption">Shown for guidance. The server calculates the final amounts.</p></div>
          <div className="flex flex-wrap justify-end gap-2"><ButtonLink variant="outline" href={id ? `/pharmacy/purchases/${id}` : "/pharmacy/purchases"}>Cancel</ButtonLink><Button onClick={save} loading={busy}>Save draft</Button></div>
        </CardBody></Card>
    </div>
  );
}

export function PurchaseView({ id }: { id: string }) {
  const { perms } = usePharmacy(); const money = useMoney(); const toast = useToast(); const router = useRouter();
  const { data: p, error, loading, reload } = useApi<PurchaseDetail>(`/api/pharmacy/purchases/${id}`);
  const [busy, setBusy] = useState<string | null>(null); const [msg, setMsg] = useState<string>(); const [confirm, setConfirm] = useState(false); const [cancel, setCancel] = useState(false); const [reason, setReason] = useState("");
  async function act(kind: "receive" | "complete" | "cancel", body?: unknown) {
    setBusy(kind); setMsg(undefined);
    const r = await apiFetch(`/api/pharmacy/purchases/${id}/${kind}`, { method: "POST", body: body ? JSON.stringify(body) : undefined }); setBusy(null);
    if (!r.ok) { setMsg(r.error.message); return false; }
    toast({ tone: "success", title: kind === "receive" ? "Purchase received — stock added" : kind === "complete" ? "Purchase completed" : "Purchase cancelled" }); await reload(); return true;
  }
  if (loading && !p) return <LoadingState />;
  if (error || !p) return <ErrorState code={error?.code} description={error?.message} action={<Button onClick={reload}>Try again</Button>} />;
  return (
    <div className="space-y-section">
      <div className="flex flex-wrap items-center justify-between gap-2"><Link href="/pharmacy/purchases" className="type-label">← Purchases</Link><StatusBadge tone={PURCHASE_TONE[p.status]}>{PURCHASE_LABEL[p.status]}</StatusBadge></div>
      {msg && <Alert tone="danger">{msg}</Alert>}
      <Card><CardHeader title={<span className="tabular-nums">{p.purchaseNumber}</span>} description={`${p.supplier.supplierName} (${p.supplier.supplierCode}) · ${dayLabel(p.purchaseDate)}${p.supplierInvoiceNumber ? ` · supplier invoice ${p.supplierInvoiceNumber}` : ""}`}
        action={<div className="flex flex-wrap gap-2">
          {p.status === "DRAFT" && perms.purchase && <ButtonLink size="sm" variant="outline" href={`/pharmacy/purchases/${p.id}/edit`}>Edit</ButtonLink>}
          {p.status === "DRAFT" && perms.receive && <Button size="sm" onClick={() => setConfirm(true)} loading={busy === "receive"}>Receive purchase</Button>}
          {p.status === "RECEIVED" && perms.purchase && <Button size="sm" onClick={() => act("complete")} loading={busy === "complete"}>Mark completed</Button>}
          {p.status === "DRAFT" && perms.purchase && <Button size="sm" variant="danger" onClick={() => setCancel(true)}>Cancel</Button>}
          {(p.status === "RECEIVED" || p.status === "COMPLETED") && <ButtonLink size="sm" variant="outline" href={`/pharmacy/docs/purchase/${p.id}`}>Purchase invoice</ButtonLink>}
        </div>} />
        <CardBody className="space-y-3">
          {p.cancelReason && <Alert tone="warning" title="Cancelled">{p.cancelReason}</Alert>}
          <DataTable caption="Purchase items" rows={p.items} rowKey={(i) => i.id} columns={[
            { key: "m", header: "Medicine", cell: (i) => <><Link href={`/pharmacy/medicines/${i.medicineId}`} className="type-label">{i.medicineName}</Link> <span className="type-caption">{i.medicineCode}</span></> }, { key: "b", header: "Batch", cell: (i) => i.batchId ? <Link href={`/pharmacy/stock/${i.batchId}`}>{i.batchNumber}</Link> : i.batchNumber },
            { key: "e", header: "Expiry", cell: (i) => dayLabel(i.expiryDate) }, { key: "q", header: "Qty + free", align: "right", cell: (i) => `${i.quantity} + ${i.freeQuantity}` }, { key: "r", header: "Rate", align: "right", cell: (i) => money(i.unitPurchasePriceMinor), hideOnMobile: true },
            { key: "t", header: "Tax", align: "right", cell: (i) => (i.taxRateBp ? `${bpToInput(i.taxRateBp)}%` : "—"), hideOnMobile: true }, { key: "l", header: "Total", align: "right", cell: (i) => <span className="tabular-nums">{money(i.lineTotalMinor)}</span> },
          ]} />
          <div className="ml-auto w-full max-w-sm space-y-1 rounded-lg border border-line p-3"><div className="type-secondary flex justify-between"><span>Subtotal</span><span className="tabular-nums">{money(p.subtotalMinor)}</span></div>{p.discountMinor > 0 && <div className="type-secondary flex justify-between"><span>Discount</span><span className="tabular-nums">−{money(p.discountMinor)}</span></div>}<div className="type-secondary flex justify-between"><span>Tax</span><span className="tabular-nums">{money(p.taxMinor)}</span></div><div className="type-card-title flex justify-between"><span>Grand total</span><span className="tabular-nums">{money(p.totalMinor)}</span></div></div>
          <p className="type-caption">Created by {p.createdBy ?? "—"} · {stamp(p.createdAt)}{p.receivedAt ? ` · received by ${p.receivedBy ?? "—"} ${stamp(p.receivedAt)}` : ""}</p>
          {p.notes && <p className="type-secondary">{p.notes}</p>}
        </CardBody></Card>
      <ConfirmDialog open={confirm} onCancel={() => setConfirm(false)} tone="primary" title="Receive this purchase?" description="The batches and quantities are added to stock now (including free units) and recorded in the stock ledger. This can't be undone — a mistake is fixed with an adjustment or a return." confirmLabel="Receive into stock" loading={busy === "receive"} onConfirm={async () => { await act("receive"); setConfirm(false); }} />
      {cancel && <Modal open onClose={() => setCancel(false)} title="Cancel draft purchase" footer={<><Button variant="outline" onClick={() => setCancel(false)}>Keep</Button><Button variant="danger" loading={busy === "cancel"} onClick={async () => { if (await act("cancel", { reason })) { setCancel(false); router.refresh(); } }}>Cancel purchase</Button></>}><Field label="Reason" required><TextInput value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} /></Field></Modal>}
    </div>
  );
}
