import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Alert, ErrorState } from "@/components/ui";
import { RangeFilter } from "@/components/analytics/range-filter";
import { Freshness, Kpi, KpiGrid, Section, fmtCount, fmtMinutes, fmtMoney } from "@/components/analytics/widgets";
import { doctorOptions, flat, load, type SP } from "@/components/analytics/page-helpers";
import { requireTenantPagePermission } from "@/lib/auth/context";
import { clinicInsights, commandCenter } from "@/lib/services/analytics-command";

export const metadata: Metadata = { title: "Analytics" };
export const dynamic = "force-dynamic";

export default async function CommandCenterPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireTenantPagePermission("analytics.view");
  const sp = flat(await searchParams); const doctors = await doctorOptions(ctx);
  const [cc, ins] = await Promise.all([load(() => commandCenter(ctx, sp)), load(() => clinicInsights(ctx, sp))]);
  const filter = <Suspense fallback={null}><RangeFilter doctors={doctors} /></Suspense>;
  if (!cc.ok) return <div className="space-y-section">{filter}<ErrorState title="Check your filters" description={cc.error} /></div>;
  const r = cc.data; const fmt = (k: (typeof r.kpis)[number]) => (k.unavailable ? k.unavailable : k.value === null ? "—" : k.format === "money" ? fmtMoney(k.value, r.currency ?? "INR") : k.format === "minutes" ? fmtMinutes(k.value) : fmtCount(k.value));
  const good = (key: string) => (["cancelled", "noShows", "outstanding", "followUpsDue", "pendingLab", "lowStock", "critical"].includes(key) ? "down" : undefined);
  return (
    <div className="space-y-section">
      {filter}
      <Freshness meta={r.meta} />
      <KpiGrid label="Key figures">{r.kpis.map((k) => <Kpi key={k.key} label={k.label} value={fmt(k)} comparison={k.comparison} note={k.note} href={k.href} snapshot={k.snapshot} muted={!!k.unavailable} goodWhen={good(k.key)} />)}</KpiGrid>
      <p className="type-caption">Figures marked “now” are live snapshots. Everything else follows the selected dates. {r.kpis.length <= 2 && "Your role shows only the sections you have access to."}</p>
      {ins.ok && (
        <Section title="Needs attention" description="Rule-based checks against your thresholds — no AI, no medical advice." action={<Link href="/analytics/insights" className="type-label">All insights</Link>}>
          {ins.data.insights.length === 0 ? <p className="type-secondary">Nothing is over its threshold right now.</p> : <ul className="space-y-2">{ins.data.insights.slice(0, 5).map((i) => <li key={i.key} className="type-secondary"><strong>{i.title}.</strong> {i.detail} <Link href={i.href} className="type-label">See data</Link></li>)}</ul>}
        </Section>
      )}
      {!ins.ok && <Alert tone="warning">{ins.error}</Alert>}
    </div>
  );
}
