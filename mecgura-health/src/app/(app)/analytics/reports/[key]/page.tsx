import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Download, Printer } from "lucide-react";
import { Alert, ErrorState } from "@/components/ui";
import { RangeFilter, type Extra } from "@/components/analytics/range-filter";
import { DataTable, NoData, Section } from "@/components/analytics/widgets";
import { doctorOptions, flat, load, type SP } from "@/components/analytics/page-helpers";
import { requireTenantPagePermission } from "@/lib/auth/context";
import { titleCase } from "@/lib/analytics/stats";
import { runReport } from "@/lib/services/analytics-reports";

export const metadata: Metadata = { title: "Report · Analytics" };
export const dynamic = "force-dynamic";

export default async function ReportPage({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<SP> }) {
  const { key } = await params; const ctx = await requireTenantPagePermission("analytics.view");
  const sp = flat(await searchParams); const res = await load(() => runReport(ctx, key, sp));
  if (!res.ok) return <div className="space-y-section"><Link href="/analytics/reports" className="type-label">← All reports</Link><ErrorState title="This report can't be shown" description={res.error} /></div>;
  const r = res.data; const doctors = r.report.filters.includes("doctor") ? await doctorOptions(ctx) : undefined;
  const extras: Extra[] = [];
  if (r.report.filters.includes("status") && r.report.statusOptions) extras.push({ name: "status", label: "Status", options: r.report.statusOptions.map((v) => ({ value: v, label: titleCase(v) })) });
  if (r.report.filters.includes("type")) extras.push({ name: "type", label: "Type", options: ["OPD", "ONLINE_APPOINTMENT", "WALK_IN", "FOLLOW_UP", "EMERGENCY", "PROCEDURE", "OTHER"].map((v) => ({ value: v, label: titleCase(v) })) });
  if (r.report.filters.includes("channel")) extras.push({ name: "channel", label: "Channel", options: ["WHATSAPP", "SMS", "EMAIL"].map((v) => ({ value: v, label: titleCase(v) })) });
  const qs = new URLSearchParams(Object.entries(sp).filter(([k, v]) => v && k !== "refresh") as [string, string][]);
  const href = (format: string) => `/api/analytics/reports/${key}/export?${new URLSearchParams([...qs.entries(), ["format", format]])}`;
  const btn = "type-button inline-flex min-h-control items-center gap-2 rounded-md border border-line-strong px-4 no-underline hover:bg-surface-muted";
  return (
    <div className="space-y-section">
      <div><Link href="/analytics/reports" className="type-label">← All reports</Link><h2 className="type-section mt-2">{r.report.name}</h2><p className="type-secondary mt-1">{r.report.description}</p></div>
      <Suspense fallback={null}><RangeFilter doctors={doctors} extras={extras} /></Suspense>
      <p className="type-caption flex flex-wrap gap-x-3" data-testid="report-meta"><span>Source: {r.report.dataSource}</span><span>{r.meta.range.label}: {r.meta.range.from} to {r.meta.range.to}</span><span>Timezone: {r.meta.timezone}</span><span>Generated {new Date(r.meta.generatedAt).toLocaleString("en-IN", { timeZone: r.meta.timezone })} by {r.meta.generatedBy}</span>{r.meta.filters && <span>{r.meta.filters}</span>}</p>
      {!r.identityIncluded && <Alert tone="info">Patients are shown by Patient ID only. Names and contact details are not included for your role.</Alert>}
      <Section title={`${r.shown}${r.more ? "+" : ""} rows`} description={r.more ? `Showing the first ${r.shown}. Export to get the full report (up to 50,000 rows).` : undefined}
        action={r.canExport ? <div className="flex flex-wrap gap-2"><a href={href("csv")} className={btn}><Download aria-hidden className="size-4" />CSV</a><a href={href("xlsx")} className={btn}><Download aria-hidden className="size-4" />Excel</a><a href={href("pdf")} target="_blank" rel="noopener" className={btn}><Printer aria-hidden className="size-4" />PDF / Print</a></div> : <span className="type-caption">Export isn&apos;t available for your role.</span>}>
        {r.rows.length === 0 ? <NoData /> : <DataTable caption={r.report.name} head={r.columns.map((c) => ({ label: c.label, right: c.type === "money" || c.type === "number" }))} rows={r.rows.map((row) => r.columns.map((c) => { const v = (row as Record<string, string | number | null>)[c.key]; return v === null || v === undefined || v === "" ? "—" : String(v); }))} />}
      </Section>
    </div>
  );
}
