"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, Download, IndianRupee, Repeat, TrendingUp, Users } from "lucide-react";
import { Alert, Badge, Button, Card, CardBody, CardHeader, LoadingState, PageHeader, StatCard } from "@/components/ds";
import { apiFetch } from "@/lib/client-api";

type Month = { month: string; mrr: number; clients: number; added: number; expansion: number; contraction: number; churned: number; newClients: number; lostClients: number; logoChurnPct: number | null; revenueChurnPct: number | null; netRetentionPct: number | null };
type Data = {
  mrr: number;
  arr: number;
  activeClients: number;
  arpa: number;
  avgLogoChurn3m: number | null;
  avgRevenueChurn3m: number | null;
  netRetention3m: number | null;
  renewalRatePct: number | null;
  renewalsOpen: number;
  trend: Month[];
  byPlan: { id: string; name: string; clients: number; mrr: number }[];
  clients: { id: string; name: string; mrr: number; paid12m: number; invoices12m: number }[];
  wallet30: { topups: number; topupCount: number; usage: number; refunds: number; refundCount: number; corrections: number };
  reconciliation: { checked: number; mismatches: { kind: string; invoice: string; client: string; amount: number; at: string }[] };
};

const inr = (paise: number) => `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;
/** ₹12.5L / ₹48k / ₹900 for chart labels (paise in). */
const short = (paise: number) => {
  const r = paise / 100;
  return !r ? "" : r >= 100_000 ? `₹${Math.round(r / 10_000) / 10}L` : r >= 1000 ? `₹${Math.round(r / 1000)}k` : `₹${Math.round(r)}`;
};
const pct = (v: number | null) => (v === null ? "—" : `${v}%`);
const monthName = (m: string) => new Date(`${m}-15T00:00:00Z`).toLocaleDateString("en-IN", { month: "short", year: "2-digit", timeZone: "UTC" });

/** MECGURA's revenue: MRR trend, movements, churn, renewals, clients and plans, wallet ledger, reconciliation. */
export function RevenueDashboard() {
  const [d, setD] = React.useState<Data | null>(null);
  const [error, setError] = React.useState("");
  React.useEffect(() => {
    const t = window.setTimeout(async () => {
      const r = await apiFetch<Data>("/api/admin/revenue");
      if (r.ok) setD(r.data);
      else setError(r.error);
    }, 0);
    return () => clearTimeout(t);
  }, []);
  if (error) return <Alert tone="danger">{error}</Alert>;
  if (!d) return <LoadingState label="Working out revenue…" />;
  const max = Math.max(1, ...d.trend.map((t) => t.mrr));
  const last = d.trend.at(-1)!;
  const prev = d.trend.at(-2);
  const growth = prev && prev.mrr ? Math.round(((last.mrr - prev.mrr) / prev.mrr) * 1000) / 10 : null;
  return (
    <>
      <PageHeader
        title="Revenue"
        description="Monthly recurring revenue from client plans (complimentary contracts included), how it moved, and money in and out."
        breadcrumb={[{ label: "Admin", href: "/admin" }, { label: "Revenue" }]}
        actions={<a href="/api/admin/revenue/csv"><Button variant="secondary"><Download className="size-4" aria-hidden="true" /> Revenue by client (CSV)</Button></a>}
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="MRR" value={inr(d.mrr)} icon={IndianRupee} hint={growth === null ? "This month" : `${growth >= 0 ? "+" : ""}${growth}% vs last month`} featured />
        <StatCard label="ARR" value={inr(d.arr)} icon={TrendingUp} hint="MRR × 12" />
        <StatCard label="Paying clients" value={String(d.activeClients)} icon={Users} hint={`${inr(d.arpa)} average per client`} />
        <StatCard label="Renewal rate" value={pct(d.renewalRatePct)} icon={Repeat} hint={`Renewal invoices paid (last 90 days)${d.renewalsOpen ? ` · ${d.renewalsOpen} still open` : ""}`} />
      </div>
      <div className="mb-4 grid grid-cols-3 gap-3">
        <StatCard label="Client churn (3-month avg)" value={pct(d.avgLogoChurn3m)} icon={ArrowDownRight} hint="Clients lost ÷ clients at month start" />
        <StatCard label="Revenue churn (3-month avg)" value={pct(d.avgRevenueChurn3m)} icon={ArrowDownRight} hint="Lost + downgraded MRR" />
        <StatCard label="Net revenue retention" value={pct(d.netRetention3m)} icon={ArrowUpRight} hint="Above 100% = existing clients grow" />
      </div>

      <Card className="mb-4">
        <CardHeader title="MRR, last 12 months" />
        <CardBody>
          <div className="flex h-48 items-end gap-1.5" role="img" aria-label={`MRR by month: ${d.trend.map((t) => `${monthName(t.month)} ${inr(t.mrr)}`).join(", ")}`}>
            {d.trend.map((t) => (
              <div key={t.month} className="flex flex-1 flex-col items-center gap-1" title={`${monthName(t.month)}: ${inr(t.mrr)} from ${t.clients} clients`}>
                <span className="text-[10px] text-app-muted">{short(t.mrr)}</span>
                <span className="w-full rounded-t bg-app-primary/70" style={{ height: `${(t.mrr / max) * 140}px`, minHeight: t.mrr ? 2 : 0 }} />
                <span className="text-[10px] text-app-subtle">{monthName(t.month)}</span>
              </div>
            ))}
          </div>
        </CardBody>
      </Card>

      <Card className="mb-4">
        <CardHeader title="Where MRR moved" description="New clients, upgrades (expansion), downgrades (contraction) and cancellations (churn) each month." />
        <CardBody className="overflow-x-auto p-0">
          <table className="w-full text-small">
            <thead className="text-left text-caption text-app-muted"><tr className="border-b border-app-border">{["Month", "MRR", "New", "Expansion", "Contraction", "Churned", "Clients ±", "Client churn", "Net retention"].map((h) => <th key={h} className="whitespace-nowrap px-4 py-2 font-medium">{h}</th>)}</tr></thead>
            <tbody>
              {[...d.trend].reverse().map((t) => (
                <tr key={t.month} className="border-b border-app-border last:border-0">
                  <td className="px-4 py-2 text-app-text">{monthName(t.month)}</td>
                  <td className="px-4 py-2 font-semibold text-app-text">{inr(t.mrr)}</td>
                  <td className="px-4 py-2 text-green-300">{t.added ? `+${inr(t.added)}` : "—"}</td>
                  <td className="px-4 py-2 text-green-300">{t.expansion ? `+${inr(t.expansion)}` : "—"}</td>
                  <td className="px-4 py-2 text-amber-300">{t.contraction ? `−${inr(t.contraction)}` : "—"}</td>
                  <td className="px-4 py-2 text-red-300">{t.churned ? `−${inr(t.churned)}` : "—"}</td>
                  <td className="px-4 py-2">+{t.newClients} / −{t.lostClients}</td>
                  <td className="px-4 py-2">{pct(t.logoChurnPct)}</td>
                  <td className="px-4 py-2">{pct(t.netRetentionPct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardBody>
      </Card>

      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="MRR by plan" />
          <CardBody className="space-y-2">
            {!d.byPlan.length ? <p className="text-small text-app-muted">No active plans yet.</p> : d.byPlan.map((p) => (
              <div key={p.id} className="text-small">
                <div className="flex justify-between"><span className="text-app-text">{p.name} <span className="text-app-subtle">· {p.clients} client{p.clients === 1 ? "" : "s"}</span></span><span className="font-semibold text-app-text">{inr(p.mrr)}</span></div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-app-elevated"><div className="h-full rounded-full bg-app-primary/70" style={{ width: `${d.mrr ? (p.mrr / d.mrr) * 100 : 0}%` }} /></div>
              </div>
            ))}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Wallet ledger (30 days)" description="Prepaid WhatsApp wallets: money clients added, what messages used, refunds and corrections." />
          <CardBody>
            <dl className="grid grid-cols-2 gap-3 text-small">
              <div><dt className="text-app-muted">Top-ups</dt><dd className="text-h3 font-semibold text-app-text">{inr(d.wallet30.topups)}</dd><dd className="text-caption text-app-subtle">{d.wallet30.topupCount} top-ups</dd></div>
              <div><dt className="text-app-muted">Used by messages</dt><dd className="text-h3 font-semibold text-app-text">{inr(d.wallet30.usage)}</dd></div>
              <div><dt className="text-app-muted">Refunds</dt><dd className="text-h3 font-semibold text-app-text">{inr(d.wallet30.refunds)}</dd><dd className="text-caption text-app-subtle">{d.wallet30.refundCount} refunds</dd></div>
              <div><dt className="text-app-muted">Corrections (net)</dt><dd className="text-h3 font-semibold text-app-text">{inr(d.wallet30.corrections)}</dd></div>
            </dl>
          </CardBody>
        </Card>
      </div>

      <Card className="mb-4">
        <CardHeader title="Reconciliation (30 days)" description={`${d.reconciliation.checked} online payments and paid invoices checked against each other.`} />
        <CardBody className="p-0">
          {!d.reconciliation.mismatches.length ? <p className="px-4 py-3 text-small text-green-300">Everything matches.</p> : (
            <ul className="divide-y divide-app-border">
              {d.reconciliation.mismatches.map((m, i) => (
                <li key={i} className="flex flex-col gap-1 px-4 py-2 text-small sm:flex-row sm:items-center sm:justify-between">
                  <span><Badge tone="warning">{m.kind}</Badge> <span className="text-app-text">{m.invoice}</span> <span className="text-app-muted">· {m.client}</span></span>
                  <span className="font-semibold text-app-text">{inr(m.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Revenue by client" description="Current MRR and invoices paid in the last 12 months." />
        <CardBody className="overflow-x-auto p-0">
          <table className="w-full text-small">
            <thead className="text-left text-caption text-app-muted"><tr className="border-b border-app-border"><th className="px-4 py-2 font-medium">Client</th><th className="px-4 py-2 font-medium">MRR</th><th className="px-4 py-2 font-medium">Paid (12 months)</th><th className="px-4 py-2 font-medium">Invoices</th></tr></thead>
            <tbody>
              {d.clients.slice(0, 100).map((c) => (
                <tr key={c.id} className="border-b border-app-border last:border-0">
                  <td className="px-4 py-2"><Link href={`/admin/clients/${c.id}`} className="text-app-text hover:text-app-primary">{c.name}</Link></td>
                  <td className="px-4 py-2">{inr(c.mrr)}</td>
                  <td className="px-4 py-2 font-semibold text-app-text">{inr(c.paid12m)}</td>
                  <td className="px-4 py-2 text-app-muted">{c.invoices12m}</td>
                </tr>
              ))}
              {!d.clients.length ? <tr><td colSpan={4} className="px-4 py-3 text-app-muted">No revenue yet.</td></tr> : null}
            </tbody>
          </table>
        </CardBody>
      </Card>
    </>
  );
}
