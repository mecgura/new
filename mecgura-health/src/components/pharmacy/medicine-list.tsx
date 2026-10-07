"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { Alert, Button, Card, CardHeader, DataTable, ErrorState, Field, Modal, NumberInput, Pagination, SearchInput, Select, StatusBadge, TextInput, Textarea, Toggle, useToast } from "@/components/ui";
import { apiFetch } from "@/lib/api/client";
import { bpToInput, minorToInput, moneyToMinor, percentToBp } from "@/lib/billing/money";
import { useApi } from "@/components/patients/use-api";
import type { MedicineRow } from "@/lib/services/pharmacy-master";
import { STOCK_LABEL, STOCK_TONE, useMoney, usePharmacy } from "./pharmacy-ui";

interface Config { dosageForms: { name: string; active: boolean }[]; categories: { name: string; active: boolean }[]; units: { name: string; active: boolean }[] }
interface Page { rows: MedicineRow[]; total: number; page: number; pageSize: number }

export function MedicineList() {
  const sp = useSearchParams(); const router = useRouter(); const { perms } = usePharmacy(); const money = useMoney();
  const [q, setQ] = useState(""); const [dq, setDq] = useState(""); const [status, setStatus] = useState(sp.get("status") ?? ""); const [category, setCategory] = useState(""); const [page, setPage] = useState(1);
  const [open, setOpen] = useState(sp.get("new") === "1" && perms.medicines);
  useEffect(() => { const t = setTimeout(() => { setDq(q); setPage(1); }, 300); return () => clearTimeout(t); }, [q]);
  const { data, error, loading, reload } = useApi<Page>(`/api/pharmacy/medicines?${new URLSearchParams({ q: dq, status, category, page: String(page) })}`);
  const cfg = useApi<Config>("/api/pharmacy/config");
  const FILTERS = [["", "Active"], ["low", "Low stock"], ["out", "Out of stock"], ["inactive", "Inactive"]];
  return (
    <div className="space-y-section">
      <Card>
        <CardHeader title="Medicines" description="The clinic's inventory reference. It never prescribes anything." action={perms.medicines ? <Button size="sm" onClick={() => setOpen(true)}><Plus aria-hidden className="size-4" />Add medicine</Button> : undefined} />
        <div className="grid gap-3 border-b border-line p-card sm:grid-cols-[1fr_12rem_12rem]">
          <SearchInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name, code, strength, manufacturer or barcode" aria-label="Search medicines" />
          <Select aria-label="Stock filter" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} options={FILTERS.map(([value, label]) => ({ value, label }))} />
          <Select aria-label="Category" value={category} placeholder="All categories" onChange={(e) => { setCategory(e.target.value); setPage(1); }} options={(cfg.data?.categories ?? []).map((c) => ({ value: c.name, label: c.name }))} />
        </div>
        {error ? <ErrorState description={error.message} action={<Button onClick={reload}>Try again</Button>} /> : (
          <DataTable caption="Medicines" loading={loading && !data} rows={data?.rows ?? []} rowKey={(r) => r.id} empty={{ title: "No medicines found.", description: perms.medicines ? "Add the medicines your pharmacy stocks." : undefined }}
            columns={[
              { key: "code", header: "Code", cell: (r) => <span className="tabular-nums">{r.medicineCode}</span> },
              { key: "name", header: "Medicine", cell: (r) => <Link href={`/pharmacy/medicines/${r.id}`} className="type-label">{r.displayName}</Link> },
              { key: "gen", header: "Generic", cell: (r) => r.genericName, hideOnMobile: true },
              { key: "form", header: "Form", cell: (r) => r.dosageForm ?? "—", hideOnMobile: true },
              { key: "stock", header: "Available", align: "right", cell: (r) => <span className="tabular-nums">{r.availableQuantity}</span> },
              { key: "status", header: "Status", cell: (r) => r.active ? <StatusBadge tone={STOCK_TONE[r.stockStatus]}>{STOCK_LABEL[r.stockStatus]}</StatusBadge> : <StatusBadge>Inactive</StatusBadge> },
              { key: "price", header: "Selling price", align: "right", cell: (r) => <span className="tabular-nums">{money(r.sellingPriceMinor)}</span>, hideOnMobile: true },
            ]} />
        )}
        <div className="px-card pb-card"><Pagination page={data?.page ?? 1} pageCount={Math.max(1, Math.ceil((data?.total ?? 0) / (data?.pageSize ?? 20)))} onPageChange={setPage} /></div>
      </Card>
      {open && <MedicineModal config={cfg.data} onClose={() => { setOpen(false); if (sp.get("new")) router.replace("/pharmacy/medicines"); }} onSaved={async (id) => { setOpen(false); if (id) router.push(`/pharmacy/medicines/${id}`); else await reload(); }} />}
    </div>
  );
}

export interface MedicineFormValue { id?: string; genericName: string; brandName: string | null; strength: string | null; dosageForm: string | null; route?: string | null; manufacturer: string | null; category: string | null; unit: string; packSize?: number | null; barcode: string | null; reorderLevel: number; minimumStock: number; maximumStock: number | null; purchasePriceMinor: number; sellingPriceMinor: number; taxRateBp: number; prescriptionRequired: boolean; active: boolean; notes?: string | null }
export function MedicineModal({ medicine, config, onClose, onSaved }: { medicine?: MedicineFormValue; config?: Config | null; onClose: () => void; onSaved: (id?: string) => Promise<void> | void }) {
  const toast = useToast();
  const [f, setF] = useState({ genericName: medicine?.genericName ?? "", brandName: medicine?.brandName ?? "", strength: medicine?.strength ?? "", dosageForm: medicine?.dosageForm ?? "", route: medicine?.route ?? "", manufacturer: medicine?.manufacturer ?? "", category: medicine?.category ?? "", unit: medicine?.unit ?? "unit", packSize: medicine?.packSize ? String(medicine.packSize) : "", barcode: medicine?.barcode ?? "", reorderLevel: String(medicine?.reorderLevel ?? 0), minimumStock: String(medicine?.minimumStock ?? 0), maximumStock: medicine?.maximumStock != null ? String(medicine.maximumStock) : "", purchase: medicine ? minorToInput(medicine.purchasePriceMinor) : "0.00", selling: medicine ? minorToInput(medicine.sellingPriceMinor) : "0.00", tax: medicine ? bpToInput(medicine.taxRateBp) : "0", prescriptionRequired: medicine?.prescriptionRequired ?? true, active: medicine?.active ?? true, notes: medicine?.notes ?? "", reason: "", applyToBatches: false });
  const [errors, setErrors] = useState<Record<string, string>>({}); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<string>();
  const set = (k: string) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  async function save() {
    const pp = moneyToMinor(f.purchase); const sp = moneyToMinor(f.selling); const tx = percentToBp(f.tax || "0");
    const bad: Record<string, string> = {}; if (pp == null) bad.purchasePriceMinor = "Enter a price like 12 or 12.50."; if (sp == null) bad.sellingPriceMinor = "Enter a price like 12 or 12.50."; if (tx == null) bad.taxRateBp = "Enter a rate like 5 or 12.5.";
    if (Object.keys(bad).length) { setErrors(bad); return; }
    setBusy(true); setErrors({}); setMsg(undefined);
    const body = { genericName: f.genericName, brandName: f.brandName, strength: f.strength, dosageForm: f.dosageForm, route: f.route, manufacturer: f.manufacturer, category: f.category, unit: f.unit, packSize: f.packSize, barcode: f.barcode, reorderLevel: f.reorderLevel, minimumStock: f.minimumStock, maximumStock: f.maximumStock, purchasePriceMinor: pp, sellingPriceMinor: sp, taxRateBp: tx, prescriptionRequired: f.prescriptionRequired, active: f.active, notes: f.notes, priceChangeReason: f.reason, applyToBatches: f.applyToBatches };
    const r = await apiFetch<{ id: string }>(medicine?.id ? `/api/pharmacy/medicines/${medicine.id}` : "/api/pharmacy/medicines", { method: medicine?.id ? "PUT" : "POST", body: JSON.stringify(body) });
    setBusy(false);
    if (!r.ok) { setErrors(r.error.fieldErrors ?? {}); setMsg(r.error.message); return; }
    toast({ tone: "success", title: medicine?.id ? "Medicine updated" : "Medicine added" }); await onSaved(medicine?.id ? undefined : r.data.id);
  }
  const opt = (l?: { name: string; active: boolean }[]) => (l ?? []).filter((x) => x.active).map((x) => ({ value: x.name, label: x.name }));
  const priceChanged = !!medicine?.id && (moneyToMinor(f.purchase) !== medicine.purchasePriceMinor || moneyToMinor(f.selling) !== medicine.sellingPriceMinor || percentToBp(f.tax || "0") !== medicine.taxRateBp);
  return (
    <Modal open onClose={onClose} title={medicine?.id ? "Edit medicine" : "Add medicine"} description="The medicine code is created automatically and never changes." footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy}>Save medicine</Button></>}>
      <div className="space-y-3">
        {msg && <Alert tone="danger">{msg}</Alert>}
        <div className="grid gap-3 sm:grid-cols-2"><Field label="Generic name" required error={errors.genericName}><TextInput value={f.genericName} maxLength={120} onChange={set("genericName")} /></Field><Field label="Brand name" error={errors.brandName}><TextInput value={f.brandName} maxLength={120} onChange={set("brandName")} /></Field></div>
        <div className="grid gap-3 sm:grid-cols-3"><Field label="Strength" error={errors.strength}><TextInput value={f.strength} maxLength={60} onChange={set("strength")} placeholder="e.g. 500 mg" /></Field><Field label="Dosage form" error={errors.dosageForm}><Select value={f.dosageForm} placeholder="Choose" onChange={set("dosageForm")} options={opt(config?.dosageForms)} /></Field><Field label="Route" error={errors.route}><TextInput value={f.route} maxLength={40} onChange={set("route")} placeholder="e.g. Oral" /></Field></div>
        <div className="grid gap-3 sm:grid-cols-2"><Field label="Manufacturer" error={errors.manufacturer}><TextInput value={f.manufacturer} maxLength={120} onChange={set("manufacturer")} /></Field><Field label="Category" error={errors.category}><Select value={f.category} placeholder="Choose" onChange={set("category")} options={opt(config?.categories)} /></Field></div>
        <div className="grid gap-3 sm:grid-cols-3"><Field label="Unit" required error={errors.unit} hint="What one unit of stock is"><Select value={f.unit} onChange={set("unit")} options={[...(config?.units ?? []).filter((x) => x.active).map((x) => ({ value: x.name.toLowerCase(), label: x.name })), ...(f.unit && !(config?.units ?? []).some((x) => x.name.toLowerCase() === f.unit) ? [{ value: f.unit, label: f.unit }] : [])]} /></Field><Field label="Pack size" error={errors.packSize}><NumberInput value={f.packSize} onChange={set("packSize")} inputMode="numeric" /></Field><Field label="Barcode" error={errors.barcode}><TextInput value={f.barcode} maxLength={64} onChange={set("barcode")} /></Field></div>
        <div className="grid gap-3 sm:grid-cols-3"><Field label="Reorder level" error={errors.reorderLevel}><NumberInput value={f.reorderLevel} onChange={set("reorderLevel")} inputMode="numeric" /></Field><Field label="Minimum stock" error={errors.minimumStock}><NumberInput value={f.minimumStock} onChange={set("minimumStock")} inputMode="numeric" /></Field><Field label="Maximum stock" error={errors.maximumStock}><NumberInput value={f.maximumStock} onChange={set("maximumStock")} inputMode="numeric" /></Field></div>
        <div className="grid gap-3 sm:grid-cols-3"><Field label="Purchase price (per unit)" error={errors.purchasePriceMinor}><TextInput value={f.purchase} inputMode="decimal" onChange={set("purchase")} /></Field><Field label="Selling price (per unit)" error={errors.sellingPriceMinor}><TextInput value={f.selling} inputMode="decimal" onChange={set("selling")} /></Field><Field label="Tax rate (%)" error={errors.taxRateBp}><TextInput value={f.tax} inputMode="decimal" onChange={set("tax")} /></Field></div>
        {priceChanged && <div className="space-y-2 rounded-md border border-line p-3"><Field label="Reason for the price change" required error={errors.priceChangeReason} hint="Audited with the old and new price. Old bills keep the price they were issued with."><TextInput value={f.reason} maxLength={200} onChange={set("reason")} /></Field>{moneyToMinor(f.selling) !== medicine?.sellingPriceMinor && <Toggle label="Also apply the new selling price to stock already received" checked={f.applyToBatches} onChange={(v) => setF({ ...f, applyToBatches: v })} />}</div>}
        <Field label="Notes" error={errors.notes}><Textarea rows={2} value={f.notes} maxLength={500} onChange={set("notes")} /></Field>
        <Toggle label="Prescription required" checked={f.prescriptionRequired} onChange={(v) => setF({ ...f, prescriptionRequired: v })} /><Toggle label="Active (available for purchase and dispensing)" checked={f.active} onChange={(v) => setF({ ...f, active: v })} />
      </div>
    </Modal>
  );
}
