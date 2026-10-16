import type { Metadata } from "next";
import { Kpi, KpiGrid, Section, Definition, fmtCount } from "@/components/analytics/widgets";
import { requirePagePermission } from "@/lib/auth/context";
import { clinicUsage } from "@/lib/services/platform-clinics";
import { LIMIT_LABELS } from "@/lib/platform/limits";

export const metadata: Metadata = { title: "Clinic · Analytics" };
export const dynamic = "force-dynamic";
export default async function ClinicUsagePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePagePermission("platform.manage"); const { id } = await params; const u = await clinicUsage(ctx, id); const c = u.counts;
  return (
    <div className="space-y-section">
      <KpiGrid label="Clinic usage">
        <Kpi label="Users" value={fmtCount(c.users)} snapshot /><Kpi label="Doctors" value={fmtCount(c.doctors)} snapshot /><Kpi label="Patients" value={fmtCount(c.patients)} snapshot /><Kpi label="Appointments (30 days)" value={fmtCount(c.appointmentsLast30Days)} /><Kpi label="Appointments (all time)" value={fmtCount(c.appointmentsTotal)} snapshot />
        <Kpi label="Consultations" value={fmtCount(c.consultations)} snapshot /><Kpi label="Lab orders" value={fmtCount(c.labOrders)} snapshot /><Kpi label="Invoices" value={fmtCount(c.invoices)} snapshot /><Kpi label="Dispensings" value={fmtCount(c.dispensings)} snapshot /><Kpi label="Messages (30 days)" value={fmtCount(c.messagesLast30Days)} />
      </KpiGrid>
      <Section title="Configured limits" description="Recorded for later plans. Not enforced.">
        {Object.keys(u.limits).length ? <ul className="divide-y divide-line">{Object.entries(LIMIT_LABELS).map(([k, label]) => { const v = (u.limits as Record<string, number | null | undefined>)[k]; return <li key={k} className="flex justify-between py-2 type-secondary"><span>{label}</span><span className="tabular-nums">{v == null ? "No limit" : v}</span></li>; })}</ul> : <p className="type-secondary">No limits configured.</p>}
      </Section>
      <Section title="Storage"><p className="type-secondary">{u.storage.brandingAssets} branding file(s), {Math.round(u.storage.brandingAssetBytes / 1024)} KB.</p><Definition>{u.storage.note}</Definition></Section>
      <p className="type-caption">Clinical analytics (appointments, revenue, lab…) live inside the clinic under Analytics, available through a support-access visit. This page shows usage counts only.</p>
    </div>
  );
}
