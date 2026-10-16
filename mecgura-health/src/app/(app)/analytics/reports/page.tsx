import type { Metadata } from "next";
import Link from "next/link";
import { ScheduleManager } from "@/components/analytics/schedule-manager";
import { Section } from "@/components/analytics/widgets";
import { load } from "@/components/analytics/page-helpers";
import { Badge, ErrorState } from "@/components/ui";
import { requireTenantPagePermission } from "@/lib/auth/context";
import { listSchedules, reportCatalog } from "@/lib/services/analytics-reports";

export const metadata: Metadata = { title: "Report Center · Analytics" };
export const dynamic = "force-dynamic";

export default async function ReportCenterPage() {
  const ctx = await requireTenantPagePermission("analytics.view");
  const cat = reportCatalog(ctx); const sch = await load(() => listSchedules(ctx));
  if (!cat.reports.length) return <ErrorState title="No reports available" description="Your role doesn't include any reports. Ask your clinic admin if you need access." />;
  const names = new Map(cat.reports.map((r) => [r.key, r.name]));
  return (
    <div className="space-y-section">
      <p className="type-secondary">Each report states its data source and date range, and exports use the same permissions as the screen. Patient names and contact details are only exported for people allowed to export them.</p>
      {cat.categories.map((c) => (
        <Section key={c} title={c}>
          <ul className="grid gap-3 md:grid-cols-2">
            {cat.reports.filter((r) => r.category === c).map((r) => (
              <li key={r.key} className="rounded-lg border border-line bg-surface p-3">
                <p className="type-card-title"><Link href={`/analytics/reports/${r.key}`}>{r.name}</Link></p>
                <p className="type-secondary mt-1">{r.description}</p>
                <p className="type-caption mt-2 flex flex-wrap items-center gap-2"><span>Source: {r.dataSource}</span>{r.financial && <Badge tone="info">Financial</Badge>}{!r.canExport && <Badge>View only</Badge>}</p>
              </li>))}
          </ul>
        </Section>
      ))}
      {sch.ok && (
        <Section title="Scheduled reports (foundation)" description="Save how often a report should be prepared. Delivery is not switched on yet.">
          <ScheduleManager reports={cat.reports.filter((r) => r.canExport).map((r) => ({ key: r.key, name: r.name }))} canConfigure={sch.data.canConfigure} notice={sch.data.delivery}
            schedules={sch.data.schedules.map((s) => ({ id: s.id, name: s.name, reportKey: s.reportKey, reportName: names.get(s.reportKey) ?? s.reportKey, frequency: s.frequency, format: s.format, filters: s.filters }))} />
        </Section>
      )}
    </div>
  );
}
