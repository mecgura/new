import type { Metadata } from "next";
import Link from "next/link";
import { BarList, Kpi, KpiGrid, Section, fmtCount, Definition } from "@/components/analytics/widgets";
import { requirePagePermission } from "@/lib/auth/context";
import { platformAnalytics } from "@/lib/services/analytics-command";
import { platformUsage } from "@/lib/services/platform-monitor";

export const metadata: Metadata = { title: "Platform analytics" };
export const dynamic = "force-dynamic";
export default async function PlatformAnalyticsPage() {
  const ctx = await requirePagePermission("platform.manage"); const [a, u] = await Promise.all([platformAnalytics(ctx), platformUsage(ctx)]);
  const rows = (x: { clinicId: string | null; clinic: string; count: number }[]) => x.map((r) => ({ key: r.clinicId ?? r.clinic, label: r.clinic, count: r.count }));
  return (
    <div className="space-y-section">
      <div><h1 className="type-page-title">Platform analytics</h1><p className="type-secondary mt-1">Aggregates across clinics. Each clinic&apos;s own analytics are inside the clinic.</p></div>
      <KpiGrid label="Clinics"><Kpi label="Clinics" value={fmtCount(a.clinics)} /><Kpi label="Active" value={fmtCount(a.active)} /><Kpi label="Trial" value={fmtCount(a.trial)} /><Kpi label="Suspended" value={fmtCount(a.suspended)} goodWhen="down" /><Kpi label="Inactive" value={fmtCount(a.inactive)} /></KpiGrid>
      <KpiGrid label={`Usage, last ${u.windowDays} days`}><Kpi label="Appointments" value={fmtCount(u.totals.appointments)} /><Kpi label="Consultations" value={fmtCount(u.totals.consultations)} /><Kpi label="Invoices created" value={fmtCount(u.totals.invoices)} /></KpiGrid>
      <div className="grid gap-section lg:grid-cols-3">
        <Section title="Most appointments"><BarList items={rows(u.topByAppointments)} hrefOf={(k) => `/platform/clinics/${k}/analytics`} empty="No appointments in this period" /></Section>
        <Section title="Most messages"><BarList items={rows(u.topByMessages)} hrefOf={(k) => `/platform/clinics/${k}/analytics`} empty="No messages in this period" /></Section>
        <Section title="Most active users"><BarList items={rows(u.topByActiveUsers)} hrefOf={(k) => `/platform/clinics/${k}/analytics`} empty="No sign-ins in this period" /></Section>
      </div>
      <Definition>Top-10 lists are for context, not a ranking of quality. Open a clinic for its usage counts, or enter it with support access for the full Analytics module. {a.note} <Link href="/platform/clinics" className="type-label">Clinics</Link></Definition>
    </div>
  );
}
