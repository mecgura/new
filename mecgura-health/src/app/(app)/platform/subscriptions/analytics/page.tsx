import type { Metadata } from "next";
import { rupees } from "@/components/subscription/format";
import { Card } from "@/components/ui";
import { requirePagePermission } from "@/lib/auth/context";
import { subscriptionAnalytics } from "@/lib/services/sub-analytics";

export const metadata: Metadata = { title: "Subscription analytics" };
export const dynamic = "force-dynamic";
const Tile = ({ k, v, note }: { k: string; v: string; note?: string }) => <Card className="p-card"><p className="type-caption">{k}</p><p className="text-2xl font-semibold">{v}</p>{note && <p className="type-caption mt-1">{note}</p>}</Card>;
export default async function Page() {
  const ctx = await requirePagePermission("platform.manage"); const a = await subscriptionAnalytics(ctx);
  return (
    <div className="space-y-section">
      <div><h1 className="type-page-title">Subscription analytics</h1><p className="type-secondary mt-1">Computed from real subscriptions, invoices and payments only.</p></div>
      {!a.hasData && <p className="type-secondary" role="status">No subscription data yet. Numbers appear once clinics subscribe.</p>}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Tile k="MRR" v={rupees(a.mrrMinor)} note="Monthly-equivalent price of paying subscriptions (active, past due, grace)." />
        <Tile k="ARR" v={rupees(a.arrMinor)} note="MRR × 12." />
        <Tile k="Paying clinics" v={String(a.payingCount)} /><Tile k="Trials running" v={String(a.trialCount)} />
        <Tile k="Churned (30 days)" v={String(a.churned30d)} note={a.churnRatePct === null ? "Rate needs at least one paying or churned clinic." : `${a.churnRatePct}% = churned ÷ (paying + churned)`} />
        <Tile k="Upgrades (30 days)" v={String(a.upgrades30d)} /><Tile k="Plan changes at renewal (30 days)" v={String(a.planChangesAtRenewal30d)} />
        <Tile k="Failed payments (30 days)" v={`${a.failedPayments30d.count} · ${rupees(a.failedPayments30d.amountMinor)}`} />
        <Tile k="Outstanding" v={rupees(a.outstanding.amountMinor)} note={`${a.outstanding.count} unpaid invoice(s); ${rupees(a.overdue.amountMinor)} overdue`} />
        <Tile k="Refunds (30 days)" v={`${a.refunds30d.count} · ${rupees(a.refunds30d.amountMinor)}`} />
      </div>
      <Card className="p-card"><h2 className="type-section-title mb-3">Subscriptions by status</h2><ul className="grid gap-2 sm:grid-cols-3">{a.byStatus.map((s) => <li key={s.status} className="type-body">{s.label}: <strong>{s.count}</strong></li>)}</ul></Card>
      <Card><div className="p-card pb-0"><h2 className="type-section-title">Plan distribution</h2></div><div className="relative overflow-x-auto"><table className="w-full text-left"><caption className="sr-only">Plan distribution</caption><thead><tr className="type-caption border-b border-line bg-surface-muted"><th scope="col" className="p-3">Plan</th><th scope="col" className="p-3 text-right">Clinics</th><th scope="col" className="p-3 text-right">MRR</th></tr></thead><tbody>{a.planDistribution.map((p) => <tr key={p.name} className="border-b border-line last:border-0"><th scope="row" className="p-3 text-left">{p.name}</th><td className="p-3 text-right">{p.count}</td><td className="p-3 text-right">{rupees(p.mrr)}</td></tr>)}</tbody></table>{!a.planDistribution.length && <p className="type-secondary p-6 text-center">Nothing to show yet.</p>}</div></Card>
      <Card><div className="p-card pb-0"><h2 className="type-section-title">Revenue by month (last 12)</h2><p className="type-caption">Payments received, less refunds processed in the same month. UTC months.</p></div><div className="relative overflow-x-auto"><table className="w-full text-left"><caption className="sr-only">Revenue by month</caption><thead><tr className="type-caption border-b border-line bg-surface-muted"><th scope="col" className="p-3">Month</th><th scope="col" className="p-3 text-right">Collected</th><th scope="col" className="p-3 text-right">Refunded</th><th scope="col" className="p-3 text-right">Net</th></tr></thead><tbody>{a.revenueByMonth.map((m) => <tr key={m.month} className="border-b border-line last:border-0"><th scope="row" className="p-3 text-left">{m.month}</th><td className="p-3 text-right">{rupees(m.collectedMinor)}</td><td className="p-3 text-right">{rupees(m.refundedMinor)}</td><td className="p-3 text-right">{rupees(m.netMinor)}</td></tr>)}</tbody></table></div></Card>
    </div>
  );
}
