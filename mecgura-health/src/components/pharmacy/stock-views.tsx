"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { Alert, Button, Card, CardBody, CardHeader, DataTable, ErrorState, Field, LoadingState, Modal, NumberInput, Pagination, SearchInput, Select, StatusBadge, TextInput, useToast } from "@/components/ui";
import { useApi } from "@/components/patients/use-api";
import { apiFetch } from "@/lib/api/client";
import type { BatchRow, LedgerRow } from "@/lib/services/pharmacy-inventory";
import { BatchTable } from "./batch-table";
import { OpeningStockModal } from "./stock-actions";
import { BATCH_LABEL, BATCH_TONE, LEDGER_LABEL, dayLabel, daysText, stamp, useMoney, usePharmacy } from "./pharmacy-ui";
import { LEDGER_TYPES } from "@/lib/pharmacy/stock";

interface BatchPage { rows: BatchRow[]; total: number; page: number; pageSize: number; nearExpiryDays: number }
const pages = (d?: { total: number; pageSize: number } | null) => Math.max(1, Math.ceil((d?.total ?? 0) / (d?.pageSize ?? 20)));

/** Stock = batches with quantity. Filter by state; expired and near-expiry live on their own page. */
export function StockView() {
  const { perms } = usePharmacy(); const [q, setQ] = useState(""); const [dq, setDq] = useState(""); const [state, setState] = useState(""); const [page, setPage] = useState(1); const [opening, setOpening] = useState(false);
  useEffect(() => { const t = setTimeout(() => { setDq(q); setPage(1); }, 300); return () => clearTimeout(t); }, [q]);
  const { data, error, loading, reload } = useApi<BatchPage>(`/api/pharmacy/batches?${new URLSearchParams({ q: dq, state, page: String(page) })}`);
  return (
    <Card>
      <CardHeader title="Stock by batch" description="Every batch with its expiry. Only valid, unblocked batches with stock can be dispensed." action={perms.configure ? <Button size="sm" onClick={() => setOpening(true)}><Plus aria-hidden className="size-4" />Opening stock</Button> : undefined} />
      <div className="grid gap-3 border-b border-line p-card sm:grid-cols-[1fr_14rem]">
        <SearchInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by medicine, code or batch number" aria-label="Search stock" />
        <Select aria-label="Batch state" value={state} onChange={(e) => { setState(e.target.value); setPage(1); }} options={[{ value: "", label: "With stock" }, { value: "available", label: "Available to dispense" }, { value: "near", label: "Near expiry" }, { value: "expired", label: "Expired" }, { value: "blocked", label: "Blocked" }, { value: "depleted", label: "Depleted (history)" }]} />
      </div>
      {error ? <ErrorState description={error.message} action={<Button onClick={reload}>Try again</Button>} /> : <BatchTable rows={data?.rows ?? []} loading={loading && !data} onChanged={reload} caption="Stock batches" emptyTitle="No stock found." />}
      <div className="px-card pb-card"><Pagination page={data?.page ?? 1} pageCount={pages(data)} onPageChange={setPage} /></div>
      {opening && <OpeningStockModal onClose={() => setOpening(false)} onDone={async () => { setOpening(false); await reload(); }} />}
    </Card>
  );
}

export function ExpiryView() {
  const sp = useSearchParams(); const [tab, setTab] = useState(sp.get("state") === "near" ? "near" : "expired"); const [page, setPage] = useState(1);
  const { data, error, loading, reload } = useApi<BatchPage>(`/api/pharmacy/batches?${new URLSearchParams({ state: tab, page: String(page) })}`);
  return (
    <Card>
      <CardHeader title="Expired and near-expiry stock" description={`Expired stock can't be dispensed. It stays visible and in history; "Dispose" moves it out with an EXPIRY ledger entry. Near expiry = within ${data?.nearExpiryDays ?? 90} days (set in settings).`} />
      <div className="flex gap-2 border-b border-line p-card" role="group" aria-label="Expiry view">{[["expired", "Expired"], ["near", "Near expiry"]].map(([k, l]) => <Button key={k} size="sm" variant={tab === k ? "primary" : "outline"} aria-pressed={tab === k} onClick={() => { setTab(k); setPage(1); }}>{l}</Button>)}</div>
      {error ? <ErrorState description={error.message} action={<Button onClick={reload}>Try again</Button>} /> : <BatchTable mode="expiry" rows={data?.rows ?? []} loading={loading && !data} onChanged={reload} caption="Expiry" emptyTitle={tab === "expired" ? "No expired batches." : "No near-expiry batches."} />}
      <div className="px-card pb-card"><Pagination page={data?.page ?? 1} pageCount={pages(data)} onPageChange={setPage} /></div>
    </Card>
  );
}

interface LedgerPage { rows: LedgerRow[]; total: number; page: number; pageSize: number }
export function LedgerView({ medicineId, batchId, compact }: { medicineId?: string; batchId?: string; compact?: boolean }) {
  const [type, setType] = useState(""); const [from, setFrom] = useState(""); const [to, setTo] = useState(""); const [page, setPage] = useState(1);
  const qs = new URLSearchParams({ type, from, to, page: String(page), ...(medicineId ? { medicineId } : {}), ...(batchId ? { batchId } : {}) });
  const { data, error, loading, reload } = useApi<LedgerPage>(`/api/pharmacy/ledger?${qs}`);
  const body = (
    <>
      <div className="grid gap-3 border-b border-line p-card sm:grid-cols-3"><Field label="Transaction"><Select value={type} placeholder="All types" onChange={(e) => { setType(e.target.value); setPage(1); }} options={LEDGER_TYPES.map((t) => ({ value: t, label: LEDGER_LABEL[t] }))} /></Field><Field label="From"><TextInput type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} /></Field><Field label="To"><TextInput type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} /></Field></div>
      {error ? <ErrorState description={error.message} action={<Button onClick={reload}>Try again</Button>} /> : (
        <DataTable caption="Stock ledger" loading={loading && !data} rows={data?.rows ?? []} rowKey={(r) => r.id} empty={{ title: "No stock movements yet." }}
          columns={[
            { key: "date", header: "Date", cell: (r) => stamp(r.createdAt) }, { key: "med", header: "Medicine", cell: (r) => r.medicineName }, { key: "batch", header: "Batch", cell: (r) => r.batchNumber },
            { key: "type", header: "Transaction", cell: (r) => LEDGER_LABEL[r.type] ?? r.type }, { key: "qty", header: "Quantity", align: "right", cell: (r) => <span className={`tabular-nums ${r.quantity < 0 ? "!text-danger" : "!text-success"}`}>{r.quantity > 0 ? "+" : ""}{r.quantity}</span> },
            { key: "bal", header: "Balance", align: "right", cell: (r) => <span className="tabular-nums">{r.balanceAfter}</span> }, { key: "ref", header: "Reference", cell: (r) => <span className="break-words">{r.reason ?? r.referenceType ?? "—"}</span>, hideOnMobile: true }, { key: "user", header: "User", cell: (r) => r.user ?? "—", hideOnMobile: true },
          ]} />
      )}
      <div className="px-card pb-card"><Pagination page={data?.page ?? 1} pageCount={pages(data)} onPageChange={setPage} /></div>
    </>
  );
  return compact ? <div>{body}</div> : <Card><CardHeader title="Stock ledger" description="Immutable: rows are never edited or deleted. Mistakes are corrected with a new row (adjustment or reversal)." />{body}</Card>;
}

interface BatchDetail { batch: BatchRow & { quantityReceived: number; dispensedQuantity: number; returnedQuantity: number; damagedQuantity: number; expiredQuantity: number; manufacturingDate: string | null; purchasePriceMinor: number; blockedReason: string | null }; medicine: { id: string; medicineCode: string; name: string; unit: string }; ledgerConsistent: boolean; transactions: { id: string; createdAt: string; type: string; quantity: number; balanceAfter: number; reason: string | null; notes: string | null; user: string | null; referenceType: string | null }[] }
export function BatchDetailView({ id }: { id: string }) {
  const money = useMoney(); const { data, error, loading, reload } = useApi<BatchDetail>(`/api/pharmacy/batches/${id}`);
  if (loading && !data) return <LoadingState />;
  if (error || !data) return <ErrorState code={error?.code} description={error?.message} action={<Button onClick={reload}>Try again</Button>} />;
  const b = data.batch;
  const facts: [string, React.ReactNode][] = [["Medicine", <Link key="m" href={`/pharmacy/medicines/${data.medicine.id}`}>{data.medicine.name} · {data.medicine.medicineCode}</Link>], ["Batch number", b.batchNumber], ["Manufacturing date", dayLabel(b.manufacturingDate)], ["Expiry date", `${dayLabel(b.expiryDate)} (${daysText(b.daysRemaining)})`], ["Purchase price", money(b.purchasePriceMinor)], ["Selling price", money(b.sellingPriceMinor)], ["Received", b.quantityReceived], ["Available", b.quantityAvailable], ["Dispensed", b.dispensedQuantity], ["Returned (restocked)", b.returnedQuantity], ["Damaged", b.damagedQuantity], ["Expired", b.expiredQuantity]];
  return (
    <div className="space-y-section">
      <div className="flex items-center justify-between gap-2"><Link href="/pharmacy/stock" className="type-label">← Stock</Link><StatusBadge tone={BATCH_TONE[b.displayStatus]}>{BATCH_LABEL[b.displayStatus]}</StatusBadge></div>
      {b.status === "BLOCKED" && <Alert tone="danger" title="Blocked">{b.blockedReason ?? "This batch can't be dispensed."}</Alert>}
      {!data.ledgerConsistent && <Alert tone="danger" title="Ledger mismatch">The ledger doesn&apos;t add up to the stock quantity. Contact a manager.</Alert>}
      <Card><CardHeader title={`Batch ${b.batchNumber}`} /><CardBody><dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{facts.map(([k, v]) => <div key={k}><dt className="type-caption">{k}</dt><dd className="type-label tabular-nums break-words">{v}</dd></div>)}</dl></CardBody></Card>
      <Card><CardHeader title="Transaction history" description="Every unit in and out of this batch." />
        <DataTable caption="Batch transactions" rows={data.transactions} rowKey={(r) => r.id} empty={{ title: "No transactions." }} columns={[{ key: "d", header: "Date", cell: (r) => stamp(r.createdAt) }, { key: "t", header: "Transaction", cell: (r) => LEDGER_LABEL[r.type] ?? r.type }, { key: "q", header: "Quantity", align: "right", cell: (r) => <span className="tabular-nums">{r.quantity > 0 ? "+" : ""}{r.quantity}</span> }, { key: "b", header: "Balance", align: "right", cell: (r) => <span className="tabular-nums">{r.balanceAfter}</span> }, { key: "r", header: "Reason / notes", cell: (r) => <span className="break-words">{[r.reason, r.notes].filter(Boolean).join(" — ") || "—"}</span>, hideOnMobile: true }, { key: "u", header: "User", cell: (r) => r.user ?? "—", hideOnMobile: true }]} />
      </Card>
    </div>
  );
}

/* ----------------------------------------------- adjustments & physical count ----------------------------------------------- */
interface CountList { rows: { id: string; countNumber: string; status: string; createdAt: string; lines: number }[] }
interface CountDetail { id: string; countNumber: string; status: string; lines: { batchId: string; medicineName: string; batchNumber: string; expiryDate: string; systemQuantity: number; currentQuantity: number; physicalQuantity: number | null; difference: number | null; reason: string | null }[] }
export function AdjustmentsView() {
  const toast = useToast(); const [medQ, setMedQ] = useState("");
  const list = useApi<CountList>("/api/pharmacy/counts"); const led = useApi<LedgerPage>("/api/pharmacy/ledger?type=ADJUSTMENT_IN");
  const outs = useApi<LedgerPage>("/api/pharmacy/ledger?type=ADJUSTMENT_OUT");
  const batches = useApi<BatchPage>(`/api/pharmacy/batches?${new URLSearchParams({ q: medQ, state: "available" })}`);
  const [counting, setCounting] = useState<CountDetail | null>(null); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<string>();
  async function start() { setBusy(true); setMsg(undefined); const r = await apiFetch<{ id: string }>("/api/pharmacy/counts", { method: "POST", body: JSON.stringify({}) }); setBusy(false); if (!r.ok) { setMsg(r.error.message); return; } await openCount(r.data.id); await list.reload(); }
  async function openCount(id: string) { const r = await apiFetch<CountDetail>(`/api/pharmacy/counts/${id}`); if (r.ok) setCounting(r.data); else toast({ tone: "danger", title: r.error.message }); }
  const recent = [...(led.data?.rows ?? []), ...(outs.data?.rows ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 15);
  return (
    <div className="space-y-section">
      <Card><CardHeader title="Adjust stock" description="Pick a batch, then adjust, record damage or block it. Every change needs a reason and creates a ledger entry." />
        <div className="border-b border-line p-card"><SearchInput value={medQ} onChange={(e) => setMedQ(e.target.value)} placeholder="Search by medicine or batch number" aria-label="Search batches to adjust" /></div>
        <BatchTable rows={batches.data?.rows ?? []} loading={batches.loading && !batches.data} onChanged={async () => { await batches.reload(); await led.reload(); await outs.reload(); }} caption="Batches to adjust" emptyTitle="No stock to adjust." />
      </Card>
      <Card><CardHeader title="Physical stock count" description="Compare the system quantity with what is on the shelf. Differences are applied as adjustments with a reason — stock is never overwritten." action={<Button size="sm" onClick={start} loading={busy}>Start a count</Button>} />
        <CardBody className="space-y-2">{msg && <Alert tone="danger">{msg}</Alert>}
          {!list.data?.rows.length ? <p className="type-secondary">No counts yet.</p> : <ul className="divide-y divide-line">{list.data.rows.map((c) => <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2"><span className="type-label">{c.countNumber} <span className="type-caption">· {c.lines} batches · {stamp(c.createdAt)}</span></span><span className="flex items-center gap-2"><StatusBadge tone={c.status === "APPLIED" ? "success" : c.status === "OPEN" ? "warning" : "neutral"}>{c.status.toLowerCase()}</StatusBadge><Button size="sm" variant="outline" onClick={() => openCount(c.id)}>Open</Button></span></li>)}</ul>}
        </CardBody>
      </Card>
      <Card><CardHeader title="Recent adjustments" />{!recent.length ? <p className="p-card type-secondary">No stock adjustments.</p> : <ul className="divide-y divide-line">{recent.map((r) => <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 p-card"><div className="min-w-0"><p className="type-label">{r.medicineName}</p><p className="type-caption">Batch {r.batchNumber} · {r.reason ?? ""} · {r.user ?? "—"} · {stamp(r.createdAt)}</p></div><span className="type-label tabular-nums">{r.quantity > 0 ? "+" : ""}{r.quantity}</span></li>)}</ul>}</Card>
      {counting && <CountModal count={counting} onClose={() => setCounting(null)} onChanged={async () => { await list.reload(); await batches.reload(); await led.reload(); await outs.reload(); }} reopen={openCount} />}
    </div>
  );
}
function CountModal({ count, onClose, onChanged, reopen }: { count: CountDetail; onClose: () => void; onChanged: () => Promise<void>; reopen: (id: string) => Promise<void> }) {
  const toast = useToast(); const open = count.status === "OPEN";
  const [vals, setVals] = useState<Record<string, { p: string; r: string }>>(() => Object.fromEntries(count.lines.map((l) => [l.batchId, { p: l.physicalQuantity != null ? String(l.physicalQuantity) : "", r: l.reason ?? "" }])));
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<string>();
  const payload = () => ({ lines: count.lines.filter((l) => vals[l.batchId].p !== "").map((l) => ({ batchId: l.batchId, physicalQuantity: vals[l.batchId].p, reason: vals[l.batchId].r })) });
  async function save(apply: boolean) {
    setBusy(true); setMsg(undefined);
    const body = payload(); if (!body.lines.length) { setMsg("Enter at least one physical quantity."); setBusy(false); return; }
    const r = await apiFetch(`/api/pharmacy/counts/${count.id}`, { method: "PUT", body: JSON.stringify(body) });
    if (!r.ok) { setBusy(false); setMsg(r.error.message); return; }
    if (apply) { const a = await apiFetch<{ adjusted: number }>(`/api/pharmacy/counts/${count.id}/apply`, { method: "POST" }); setBusy(false); if (!a.ok) { setMsg(a.error.message); return; } toast({ tone: "success", title: `Count applied — ${a.data.adjusted} adjustment${a.data.adjusted === 1 ? "" : "s"}` }); await onChanged(); await reopen(count.id); onClose(); return; }
    setBusy(false); toast({ tone: "success", title: "Count saved (stock unchanged)" });
  }
  async function cancel() { await apiFetch(`/api/pharmacy/counts/${count.id}/cancel`, { method: "POST" }); await onChanged(); onClose(); }
  return (
    <Modal open onClose={onClose} title={`Count ${count.countNumber}`} description={open ? "Enter what you counted. Lines that differ need a reason." : `This count is ${count.status.toLowerCase()}.`} footer={open ? <><Button variant="outline" onClick={cancel}>Cancel count</Button><Button variant="outline" onClick={() => save(false)} loading={busy}>Save</Button><Button onClick={() => save(true)} loading={busy}>Apply differences</Button></> : <Button onClick={onClose}>Close</Button>}>
      <div className="space-y-3">
        {msg && <Alert tone="danger">{msg}</Alert>}
        <ul className="divide-y divide-line">{count.lines.map((l) => { const v = vals[l.batchId]; const diff = v.p !== "" ? Number(v.p) - l.systemQuantity : l.difference; return (
          <li key={l.batchId} className="space-y-2 py-3">
            <p className="type-label">{l.medicineName} <span className="type-caption">batch {l.batchNumber} · exp. {dayLabel(l.expiryDate)}</span></p>
            <div className="grid gap-2 sm:grid-cols-[6rem_8rem_5rem_1fr] sm:items-end">
              <div><p className="type-caption">System</p><p className="type-label tabular-nums">{l.systemQuantity}</p></div>
              <Field label="Physical"><NumberInput value={v.p} inputMode="numeric" disabled={!open} onChange={(e) => setVals({ ...vals, [l.batchId]: { ...v, p: e.target.value } })} /></Field>
              <div><p className="type-caption">Difference</p><p className={`type-label tabular-nums ${diff ? (diff < 0 ? "!text-danger" : "!text-success") : ""}`}>{diff == null || Number.isNaN(diff) ? "—" : diff > 0 ? `+${diff}` : diff}</p></div>
              {diff ? <Field label="Reason" required><TextInput value={v.r} maxLength={200} disabled={!open} onChange={(e) => setVals({ ...vals, [l.batchId]: { ...v, r: e.target.value } })} /></Field> : <span />}
            </div>
          </li>); })}</ul>
      </div>
    </Modal>
  );
}
