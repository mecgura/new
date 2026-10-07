"use client";
import { useState } from "react";
import { Download } from "lucide-react";
import { Alert, Button, Card, CardBody, CardHeader, DataTable, ErrorState, Field, Select, TextInput } from "@/components/ui";
import { useApi } from "@/components/patients/use-api";
import { formatMoney } from "@/lib/billing/money";
import type { ReportResult } from "@/lib/services/pharmacy-reports";
import { dayLabel, usePharmacy } from "./pharmacy-ui";

const KINDS: [string, string][] = [["stock_summary", "Stock summary"], ["stock_ledger", "Stock ledger"], ["purchases", "Purchases"], ["dispensing", "Dispensing"], ["expiry", "Expiry"], ["low_stock", "Low stock"], ["medicine_sales", "Medicine sales"], ["supplier_purchases", "Supplier purchases"], ["adjustments", "Stock adjustments"], ["returns", "Returns"]];
const DATED = new Set(["stock_ledger", "purchases", "dispensing", "medicine_sales", "supplier_purchases", "adjustments", "returns"]);
export function ReportsView() {
  const { currency } = usePharmacy(); const [kind, setKind] = useState("stock_summary"); const [from, setFrom] = useState(""); const [to, setTo] = useState(""); const [category, setCategory] = useState(""); const [state, setState] = useState("");
  const cats = useApi<{ categories: { name: string; active: boolean }[] }>("/api/pharmacy/config");
  const qs = new URLSearchParams({ kind, from, to, category, state }); const { data, error, loading, reload } = useApi<ReportResult>(`/api/pharmacy/reports?${qs}`);
  const m = (x: number) => formatMoney(x, currency);
  return (
    <div className="space-y-section">
      <Card><CardHeader title="Pharmacy reports" description="Stock value is shown at purchase cost. It is not profit." />
        <CardBody className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Field label="Report"><Select value={kind} onChange={(e) => setKind(e.target.value)} options={KINDS.map(([value, label]) => ({ value, label }))} /></Field>
          {DATED.has(kind) && <><Field label="From"><TextInput type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field><Field label="To"><TextInput type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field></>}
          {(kind === "stock_summary" || kind === "low_stock" || kind === "expiry") && <Field label="Category"><Select value={category} placeholder="All categories" onChange={(e) => setCategory(e.target.value)} options={(cats.data?.categories ?? []).map((c) => ({ value: c.name, label: c.name }))} /></Field>}
          {kind === "expiry" && <Field label="Show"><Select value={state} placeholder="Expired and near expiry" onChange={(e) => setState(e.target.value)} options={[{ value: "expired", label: "Expired only" }, { value: "near", label: "Near expiry only" }]} /></Field>}
          <div className="flex items-end gap-2"><a href={`/api/pharmacy/reports/export?${qs}`} className="type-button inline-flex min-h-control items-center gap-2 rounded-md border border-line-strong px-4 !text-ink no-underline hover:bg-surface-muted"><Download aria-hidden className="size-4" />Export CSV</a>{(kind === "stock_summary" || kind === "expiry") && <a href={`/pharmacy/docs/${kind === "stock_summary" ? "stock" : "expiry"}/current`} className="type-button inline-flex min-h-control items-center rounded-md border border-line-strong px-4 !text-ink no-underline hover:bg-surface-muted">Print</a>}</div>
        </CardBody></Card>
      {error ? <ErrorState description={error.message} action={<Button onClick={reload}>Try again</Button>} /> : (
        <Card><CardHeader title={data?.title ?? "Report"} description={data ? `${dayLabel(data.from)} – ${dayLabel(data.to)}` : undefined} />
          {data && data.summary.length > 0 && <div className="grid gap-3 border-b border-line p-card sm:grid-cols-3">{data.summary.map((s) => <div key={s.label} className="rounded-lg border border-line p-3"><p className="type-caption">{s.label}</p><p className="type-card-title tabular-nums">{s.type === "money" ? m(Number(s.value)) : s.value}</p></div>)}</div>}
          {data?.note && <div className="p-card"><Alert tone="info">{data.note}</Alert></div>}
          <DataTable caption={data?.title ?? "Report"} loading={loading && !data} rows={(data?.rows ?? []).map((r, i) => ({ ...r, __i: i }))} rowKey={(r) => String(r.__i)} empty={{ title: "Nothing to show for these filters." }}
            columns={(data?.columns ?? []).map((c) => ({ key: c.key, header: c.label, align: c.type === "money" || c.type === "int" ? ("right" as const) : ("left" as const), cell: (r: Record<string, string | number | null>) => (c.type === "money" ? <span className="tabular-nums">{m(Number(r[c.key] ?? 0))}</span> : c.type === "date" ? dayLabel(String(r[c.key] ?? "")) : <span className={c.type === "int" ? "tabular-nums" : "break-words"}>{r[c.key] ?? "—"}</span>) }))} />
          {data?.capped && <p className="px-card pb-card type-caption">Showing the first 5,000 rows. Narrow the dates or export a smaller range.</p>}
        </Card>
      )}
    </div>
  );
}
