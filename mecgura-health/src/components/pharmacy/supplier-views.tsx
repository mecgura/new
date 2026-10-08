"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { Alert, Badge, Button, Card, CardBody, CardHeader, DataTable, ErrorState, Field, LoadingState, Modal, Pagination, SearchInput, StatusBadge, TextInput, Textarea, Toggle, useToast } from "@/components/ui";
import { useApi } from "@/components/patients/use-api";
import { apiFetch } from "@/lib/api/client";
import type { getSupplier, listSuppliers } from "@/lib/services/pharmacy-master";
import { PURCHASE_LABEL, PURCHASE_TONE, dayLabel, useMoney, usePharmacy } from "./pharmacy-ui";

type Page = Awaited<ReturnType<typeof listSuppliers>>; type Row = Page["rows"][number];
export function SupplierList() {
  const { perms } = usePharmacy(); const [q, setQ] = useState(""); const [dq, setDq] = useState(""); const [page, setPage] = useState(1); const [edit, setEdit] = useState<Row | "new" | null>(null);
  useEffect(() => { const t = setTimeout(() => { setDq(q); setPage(1); }, 300); return () => clearTimeout(t); }, [q]);
  const { data, error, loading, reload } = useApi<Page>(`/api/pharmacy/suppliers?${new URLSearchParams({ q: dq, all: "1", page: String(page) })}`);
  return (
    <Card><CardHeader title="Suppliers" description="Who you buy stock from. Purchase history only — this is not supplier accounting." action={perms.suppliers ? <Button size="sm" onClick={() => setEdit("new")}><Plus aria-hidden className="size-4" />Add supplier</Button> : undefined} />
      <div className="border-b border-line p-card"><SearchInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name, code or phone" aria-label="Search suppliers" /></div>
      {error ? <ErrorState description={error.message} action={<Button onClick={reload}>Try again</Button>} /> : <DataTable caption="Suppliers" loading={loading && !data} rows={data?.rows ?? []} rowKey={(r) => r.id} empty={{ title: "No suppliers." }} columns={[
        { key: "c", header: "Code", cell: (r) => <span className="tabular-nums">{r.supplierCode}</span> }, { key: "n", header: "Supplier", cell: (r) => <Link href={`/pharmacy/suppliers/${r.id}`} className="type-label">{r.supplierName}</Link> }, { key: "p", header: "Contact", cell: (r) => [r.contactPerson, r.phone].filter(Boolean).join(" · ") || "—", hideOnMobile: true },
        { key: "t", header: "Payment terms", cell: (r) => r.paymentTerms ?? "—", hideOnMobile: true }, { key: "s", header: "Status", cell: (r) => (r.active ? <StatusBadge tone="success">Active</StatusBadge> : <Badge>Inactive</Badge>) }, { key: "a", header: "", align: "right", cell: (r) => (perms.suppliers ? <Button size="sm" variant="outline" onClick={() => setEdit(r)}>Edit</Button> : null) },
      ]} />}
      <div className="px-card pb-card"><Pagination page={data?.page ?? 1} pageCount={Math.max(1, Math.ceil((data?.total ?? 0) / (data?.pageSize ?? 20)))} onPageChange={setPage} /></div>
      {edit && <SupplierModal supplier={edit === "new" ? null : edit} onClose={() => setEdit(null)} onSaved={async () => { setEdit(null); await reload(); }} />}
    </Card>
  );
}
export function SupplierModal({ supplier, onClose, onSaved }: { supplier: Row | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const toast = useToast(); const [f, setF] = useState({ supplierName: supplier?.supplierName ?? "", contactPerson: supplier?.contactPerson ?? "", phone: supplier?.phone ?? "", email: supplier?.email ?? "", address: supplier?.address ?? "", taxId: supplier?.taxId ?? "", paymentTerms: supplier?.paymentTerms ?? "", notes: supplier?.notes ?? "", active: supplier?.active ?? true });
  const [errors, setErrors] = useState<Record<string, string>>({}); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<string>();
  const set = (k: string) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  async function save() { setBusy(true); setErrors({}); setMsg(undefined); const r = await apiFetch(supplier ? `/api/pharmacy/suppliers/${supplier.id}` : "/api/pharmacy/suppliers", { method: supplier ? "PUT" : "POST", body: JSON.stringify(f) }); setBusy(false); if (!r.ok) { setErrors(r.error.fieldErrors ?? {}); setMsg(r.error.message); return; } toast({ tone: "success", title: supplier ? "Supplier updated" : "Supplier added" }); await onSaved(); }
  return (
    <Modal open onClose={onClose} title={supplier ? `Edit ${supplier.supplierCode}` : "Add supplier"} footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy}>Save supplier</Button></>}>
      <div className="space-y-3">{msg && <Alert tone="danger">{msg}</Alert>}
        <Field label="Supplier name" required error={errors.supplierName}><TextInput value={f.supplierName} maxLength={120} onChange={set("supplierName")} /></Field>
        <div className="grid gap-3 sm:grid-cols-2"><Field label="Contact person" error={errors.contactPerson}><TextInput value={f.contactPerson} maxLength={80} onChange={set("contactPerson")} /></Field><Field label="Phone" error={errors.phone}><TextInput value={f.phone} maxLength={30} inputMode="tel" onChange={set("phone")} /></Field></div>
        <div className="grid gap-3 sm:grid-cols-2"><Field label="Email" error={errors.email}><TextInput value={f.email} maxLength={120} inputMode="email" onChange={set("email")} /></Field><Field label="Tax ID" error={errors.taxId}><TextInput value={f.taxId} maxLength={40} onChange={set("taxId")} /></Field></div>
        <Field label="Address" error={errors.address}><Textarea rows={2} value={f.address} maxLength={300} onChange={set("address")} /></Field>
        <Field label="Payment terms" error={errors.paymentTerms}><TextInput value={f.paymentTerms} maxLength={120} onChange={set("paymentTerms")} placeholder="e.g. 30 days" /></Field>
        <Field label="Notes" error={errors.notes}><Textarea rows={2} value={f.notes} maxLength={300} onChange={set("notes")} /></Field>
        <Toggle label="Active" checked={f.active} onChange={(v) => setF({ ...f, active: v })} />
      </div>
    </Modal>
  );
}
type Detail = Awaited<ReturnType<typeof getSupplier>>;
export function SupplierDetail({ id }: { id: string }) {
  const money = useMoney(); const { data, error, loading, reload } = useApi<Detail>(`/api/pharmacy/suppliers/${id}`);
  if (loading && !data) return <LoadingState />;
  if (error || !data) return <ErrorState code={error?.code} description={error?.message} action={<Button onClick={reload}>Try again</Button>} />;
  const s = data.supplier as Record<string, string | null> & { supplierCode: string; supplierName: string };
  return (
    <div className="space-y-section">
      <Link href="/pharmacy/suppliers" className="type-label">← Suppliers</Link>
      <Card><CardHeader title={<>{s.supplierName} <span className="type-caption">{s.supplierCode}</span></>} /><CardBody className="space-y-3">
        <dl className="grid gap-3 sm:grid-cols-3">{[["Contact", [s.contactPerson, s.phone, s.email].filter(Boolean).join(" · ") || "—"], ["Tax ID", s.taxId ?? "—"], ["Payment terms", s.paymentTerms ?? "—"]].map(([k, v]) => <div key={k}><dt className="type-caption">{k}</dt><dd className="type-label break-words">{v}</dd></div>)}</dl>
        <div className="grid gap-3 sm:grid-cols-2"><div className="rounded-lg border border-line p-3"><p className="type-caption">Purchases received</p><p className="type-page-title tabular-nums">{data.purchaseCount}</p></div><div className="rounded-lg border border-line p-3"><p className="type-caption">Total purchased</p><p className="type-page-title tabular-nums">{money(data.totalPurchasedMinor)}</p></div></div>
      </CardBody></Card>
      <Card><CardHeader title="Purchases" />
        <DataTable caption="Supplier purchases" rows={data.purchases} rowKey={(p) => p.id} empty={{ title: "No purchases." }} columns={[{ key: "n", header: "Purchase", cell: (p) => <Link href={`/pharmacy/purchases/${p.id}`}>{p.purchaseNumber}</Link> }, { key: "i", header: "Supplier invoice", cell: (p) => p.supplierInvoiceNumber ?? "—", hideOnMobile: true }, { key: "d", header: "Date", cell: (p) => dayLabel(p.purchaseDate) }, { key: "t", header: "Total", align: "right", cell: (p) => money(p.totalMinor) }, { key: "s", header: "Status", cell: (p) => <StatusBadge tone={PURCHASE_TONE[p.status]}>{PURCHASE_LABEL[p.status]}</StatusBadge> }]} />
      </Card>
      <Card><CardHeader title="Medicines purchased" />{!data.medicines.length ? <p className="p-card type-secondary">No medicines purchased yet.</p> : <ul className="flex flex-wrap gap-2 p-card">{data.medicines.map((m) => <li key={m}><Badge>{m}</Badge></li>)}</ul>}</Card>
    </div>
  );
}
