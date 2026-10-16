"use client";
import Link from "next/link";
import { useState } from "react";
import { Alert, Badge, Button, Card, CardBody, CardHeader, DataTable, ErrorState, LoadingState, StatusBadge, Tabs } from "@/components/ui";
import { useApi } from "@/components/patients/use-api";
import { bpToInput } from "@/lib/billing/money";
import type { getMedicine } from "@/lib/services/pharmacy-master";
import { BatchTable } from "./batch-table";
import { LedgerView, } from "./stock-views";
import { MedicineModal } from "./medicine-list";
import { OpeningStockModal } from "./stock-actions";
import { STOCK_LABEL, STOCK_TONE, dayLabel, useMoney, usePharmacy } from "./pharmacy-ui";
import type { BatchRow } from "@/lib/services/pharmacy-inventory";

type Detail = Awaited<ReturnType<typeof getMedicine>>;
interface Config { dosageForms: { name: string; active: boolean }[]; categories: { name: string; active: boolean }[]; units: { name: string; active: boolean }[] }
interface PurchaseRows { rows: { id: string; purchaseNumber: string; supplierName: string; purchaseDate: string; totalMinor: number; status: string }[] }
interface RetRows { rows: { id: string; returnNumber: string; type: string; status: string; medicineName: string; quantity: number; createdAt: string }[] }

export function MedicineDetail({ id }: { id: string }) {
  const { perms } = usePharmacy(); const money = useMoney(); const { data, error, loading, reload } = useApi<Detail>(`/api/pharmacy/medicines/${id}`); const cfg = useApi<Config>("/api/pharmacy/config");
  const [edit, setEdit] = useState(false); const [opening, setOpening] = useState(false);
  if (loading && !data) return <LoadingState />;
  if (error || !data) return <ErrorState code={error?.code} description={error?.message} action={<Button onClick={reload}>Try again</Button>} />;
  const m = data.medicine; const t = data.totals;
  const facts: [string, React.ReactNode][] = [["Medicine name", m.displayName], ["Generic name", m.genericName], ["Brand", m.brandName ?? "—"], ["Strength", m.strength ?? "—"], ["Dosage form", m.dosageForm ?? "—"], ["Manufacturer", m.manufacturer ?? "—"], ["Category", m.category ?? "—"], ["Unit", m.unit], ["Barcode", m.barcode ?? "—"], ["Prescription required", m.prescriptionRequired ? "Yes" : "No"]];
  const batches = data.batches.map((b) => ({ ...b, medicineName: m.displayName })) as unknown as BatchRow[];
  return (
    <div className="space-y-section">
      <div className="flex flex-wrap items-center justify-between gap-2"><Link href="/pharmacy/medicines" className="type-label">← Medicines</Link>
        <div className="flex gap-2">{perms.configure && <Button size="sm" variant="outline" onClick={() => setOpening(true)}>Opening stock</Button>}{perms.purchase && <Link href={`/pharmacy/purchases/new?medicineId=${m.id}`} className="type-button inline-flex min-h-9 items-center rounded-md border border-line-strong px-3 !text-ink no-underline hover:bg-surface-muted">Create purchase</Link>}{perms.medicines && <Button size="sm" onClick={() => setEdit(true)}>Edit</Button>}</div></div>
      <Card><CardHeader title={<>{m.displayName} <span className="type-caption">{m.medicineCode}</span></>} action={m.active ? <StatusBadge tone={STOCK_TONE[m.stockStatus]}>{STOCK_LABEL[m.stockStatus]}</StatusBadge> : <Badge>Inactive</Badge>} />
        <CardBody className="space-y-4">
          {m.stockStatus === "OUT_OF_STOCK" && <Alert tone="warning" title="Medicine unavailable">No dispensable stock. Prescriptions for it stay valid; nothing is substituted automatically.</Alert>}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><div className="rounded-lg border border-line p-3"><p className="type-caption">Available</p><p className="type-page-title tabular-nums">{t.available}</p></div><div className="rounded-lg border border-line p-3"><p className="type-caption">On hand (all batches)</p><p className="type-page-title tabular-nums">{t.totalOnHand}</p></div><div className="rounded-lg border border-line p-3"><p className="type-caption">Reserved</p><p className="type-page-title tabular-nums">{t.reserved}</p></div><div className="rounded-lg border border-line p-3"><p className="type-caption">Stock value (cost)</p><p className="type-card-title tabular-nums">{money(t.valueMinor)}</p></div></div>
          <p className="type-caption">{t.valuationMethod}</p>
        </CardBody></Card>
      <Tabs label="Medicine sections" tabs={[
        { key: "overview", label: "Overview", content: (
          <Card><CardBody className="space-y-4"><dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{facts.map(([k, v]) => <div key={k}><dt className="type-caption">{k}</dt><dd className="type-label break-words">{v}</dd></div>)}</dl>
            <div><h3 className="type-card-title">Pricing</h3><dl className="mt-2 grid gap-3 sm:grid-cols-3"><div><dt className="type-caption">Purchase price</dt><dd className="type-label tabular-nums">{money(m.purchasePriceMinor)}</dd></div><div><dt className="type-caption">Selling price</dt><dd className="type-label tabular-nums">{money(m.sellingPriceMinor)}</dd></div><div><dt className="type-caption">Tax</dt><dd className="type-label tabular-nums">{m.taxRateBp ? `${bpToInput(m.taxRateBp)}%` : "None"}</dd></div></dl></div>
            <div><h3 className="type-card-title">Stock rules</h3><dl className="mt-2 grid gap-3 sm:grid-cols-3"><div><dt className="type-caption">Reorder level</dt><dd className="type-label tabular-nums">{m.reorderLevel}</dd></div><div><dt className="type-caption">Minimum stock</dt><dd className="type-label tabular-nums">{m.minimumStock}</dd></div><div><dt className="type-caption">Maximum stock</dt><dd className="type-label tabular-nums">{m.maximumStock ?? "—"}</dd></div></dl></div>
            {m.notes && <p className="type-secondary">{m.notes}</p>}
          </CardBody></Card>) },
        { key: "batches", label: `Batches (${data.batches.length})`, content: <Card><BatchTable showMedicine={false} rows={batches} onChanged={reload} caption="Batches" emptyTitle="No batches yet." /></Card> },
        { key: "ledger", label: "Stock ledger", content: <Card><LedgerView medicineId={m.id} compact /></Card> },
        { key: "purchases", label: "Purchases", content: <PurchasesTab medicineId={m.id} /> },
        { key: "dispensing", label: "Dispensing", content: <DispensingTab medicineId={m.id} /> },
        { key: "returns", label: "Returns", content: <ReturnsTab medicineId={m.id} /> },
      ]} />
      {edit && <MedicineModal medicine={{ id: m.id, genericName: m.genericName, brandName: m.brandName, strength: m.strength, dosageForm: m.dosageForm, route: m.route, manufacturer: m.manufacturer, category: m.category, unit: m.unit, packSize: m.packSize, barcode: m.barcode, reorderLevel: m.reorderLevel, minimumStock: m.minimumStock, maximumStock: m.maximumStock, purchasePriceMinor: m.purchasePriceMinor, sellingPriceMinor: m.sellingPriceMinor, taxRateBp: m.taxRateBp, prescriptionRequired: m.prescriptionRequired, active: m.active, notes: m.notes }} config={cfg.data} onClose={() => setEdit(false)} onSaved={async () => { setEdit(false); await reload(); }} />}
      {opening && <OpeningStockModal medicine={{ ...m } as never} onClose={() => setOpening(false)} onDone={async () => { setOpening(false); await reload(); }} />}
    </div>
  );
}
function PurchasesTab({ medicineId }: { medicineId: string }) {
  const money = useMoney(); const { perms } = usePharmacy(); const { data, loading } = useApi<PurchaseRows>(perms.purchase || perms.receive ? `/api/pharmacy/purchases?q=&medicineId=${medicineId}` : null);
  if (!perms.purchase && !perms.receive) return <Card><CardBody><p className="type-secondary">Purchases are visible to managers.</p></CardBody></Card>;
  return <Card><DataTable caption="Purchases" loading={loading && !data} rows={data?.rows ?? []} rowKey={(r) => r.id} empty={{ title: "No purchases." }} columns={[{ key: "n", header: "Purchase", cell: (r) => <Link href={`/pharmacy/purchases/${r.id}`}>{r.purchaseNumber}</Link> }, { key: "s", header: "Supplier", cell: (r) => r.supplierName }, { key: "d", header: "Date", cell: (r) => dayLabel(r.purchaseDate) }, { key: "t", header: "Total", align: "right", cell: (r) => money(r.totalMinor) }, { key: "st", header: "Status", cell: (r) => r.status.toLowerCase() }]} /></Card>;
}
function DispensingTab({ medicineId }: { medicineId: string }) {
  const { perms } = usePharmacy(); const { data, loading } = useApi<{ rows: { date: string; number: string; patient: string; quantity: number; batch: string }[] }>(perms.reports ? `/api/pharmacy/reports?kind=dispensing&medicineId=${medicineId}` : null);
  if (!perms.reports) return <Card><CardBody><p className="type-secondary">Dispensing history by medicine is visible to managers. Find individual dispensings under Dispensing.</p></CardBody></Card>;
  return <Card><DataTable caption="Dispensing history" loading={loading && !data} rows={data?.rows ?? []} rowKey={(r) => `${r.number}${r.batch}${r.quantity}`} empty={{ title: "No dispensing records." }} columns={[{ key: "d", header: "Date", cell: (r) => dayLabel(r.date) }, { key: "n", header: "Dispensing", cell: (r) => r.number }, { key: "p", header: "Patient ID", cell: (r) => r.patient }, { key: "b", header: "Batch", cell: (r) => r.batch }, { key: "q", header: "Quantity", align: "right", cell: (r) => r.quantity }]} /></Card>;
}
function ReturnsTab({ medicineId }: { medicineId: string }) {
  const { perms } = usePharmacy(); const { data, loading } = useApi<RetRows>(perms.returnRequest || perms.returnApprove ? `/api/pharmacy/returns?medicineId=${medicineId}` : null);
  return <Card><DataTable caption="Returns" loading={loading && !data} rows={data?.rows ?? []} rowKey={(r) => r.id} empty={{ title: "No returns." }} columns={[{ key: "n", header: "Return", cell: (r) => r.returnNumber }, { key: "m", header: "Medicine", cell: (r) => r.medicineName }, { key: "q", header: "Quantity", align: "right", cell: (r) => r.quantity }, { key: "s", header: "Status", cell: (r) => r.status.toLowerCase() }]} /></Card>;
}
