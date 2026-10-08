import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { ErrorState } from "@/components/ui";
import { RangeFilter } from "@/components/analytics/range-filter";
import { ThresholdsForm } from "@/components/analytics/thresholds-form";
import { Section } from "@/components/analytics/widgets";
import { doctorOptions, flat, load, type SP } from "@/components/analytics/page-helpers";
import { AppointmentsView, BillingView, ClinicalView, CommunicationView, DoctorsView, FollowUpsView, InsightsView, LabView, OpdView, PatientsView, PharmacyView, ScorecardView } from "@/components/analytics/views";
import { requireTenantPagePermission, type TenantRequestContext } from "@/lib/auth/context";
import type { Permission } from "@/lib/permissions";
import { billingAnalytics, communicationAnalytics, pharmacyAnalytics } from "@/lib/services/analytics-business";
import { clinicalAnalytics, labAnalytics } from "@/lib/services/analytics-clinical";
import { clinicInsights, getAnalyticsSettings, operationsScorecard } from "@/lib/services/analytics-command";
import { appointmentAnalytics, doctorAnalytics, followUpAnalytics, opdAnalytics, patientAnalytics } from "@/lib/services/analytics-people";

export const dynamic = "force-dynamic";
type Def = { title: string; perm: Permission | null; render: (ctx: TenantRequestContext, sp: Record<string, string | undefined>) => Promise<React.ReactNode | { error: string }> };
const ok = async <T,>(fn: () => Promise<T>, view: (r: T) => React.ReactNode) => { const r = await load(fn); return r.ok ? view(r.data) : { error: r.error }; };
const SECTIONS: Record<string, Def> = {
  patients: { title: "Patient analytics", perm: "analytics.patients", render: (c, s) => ok(() => patientAnalytics(c, s), (r) => <PatientsView r={r} />) },
  appointments: { title: "Appointment analytics", perm: "analytics.operations", render: (c, s) => ok(() => appointmentAnalytics(c, s), (r) => <AppointmentsView r={r} />) },
  opd: { title: "Live OPD analytics", perm: "analytics.operations", render: (c, s) => ok(() => opdAnalytics(c, s), (r) => <OpdView r={r} />) },
  doctors: { title: "Doctor analytics", perm: "analytics.operations", render: (c, s) => ok(() => doctorAnalytics(c, s), (r) => <DoctorsView r={r} />) },
  followups: { title: "Follow-up analytics", perm: "analytics.operations", render: (c, s) => ok(() => followUpAnalytics(c, s), (r) => <FollowUpsView r={r} />) },
  clinical: { title: "Consultation, diagnosis and prescription analytics", perm: "analytics.clinical", render: (c, s) => ok(() => clinicalAnalytics(c, s), (r) => <ClinicalView r={r} />) },
  lab: { title: "Laboratory analytics", perm: "analytics.lab", render: (c, s) => ok(() => labAnalytics(c, s), (r) => <LabView r={r} />) },
  billing: { title: "Billing analytics", perm: "analytics.financial", render: (c, s) => ok(() => billingAnalytics(c, s), (r) => <BillingView r={r} />) },
  pharmacy: { title: "Pharmacy analytics", perm: "analytics.pharmacy", render: (c, s) => ok(() => pharmacyAnalytics(c, s), (r) => <PharmacyView r={r} />) },
  communication: { title: "Communication analytics", perm: "analytics.communication", render: (c, s) => ok(() => communicationAnalytics(c, s), (r) => <CommunicationView r={r} />) },
  scorecard: { title: "Operations scorecard", perm: null, render: (c, s) => ok(() => operationsScorecard(c, s), (r) => <ScorecardView r={r} />) },
  insights: {
    title: "Clinic insights", perm: null,
    render: async (c, s) => {
      const r = await load(() => clinicInsights(c, s)); if (!r.ok) return { error: r.error };
      const st = await getAnalyticsSettings(c);
      return <><InsightsView r={r.data} />{st.canConfigure && <div className="mt-section"><Section title="Insight thresholds" description="Insights appear only when a figure reaches its threshold."><ThresholdsForm thresholds={st.thresholds as unknown as Record<string, number>} defaults={st.defaults as unknown as Record<string, number>} meta={st.meta} /></Section></div>}</>;
    },
  },
};
export async function generateMetadata({ params }: { params: Promise<{ section: string }> }): Promise<Metadata> { const d = SECTIONS[(await params).section]; return { title: d ? `${d.title} · Analytics` : "Analytics" }; }

export default async function AnalyticsSectionPage({ params, searchParams }: { params: Promise<{ section: string }>; searchParams: Promise<SP> }) {
  const { section } = await params; const def = Object.hasOwn(SECTIONS, section) ? SECTIONS[section] : undefined; if (!def) notFound();
  const ctx = await requireTenantPagePermission("analytics.view");
  if (def.perm && !ctx.permissions.has(def.perm)) redirect("/forbidden");
  const sp = flat(await searchParams); const doctors = def.perm === "analytics.communication" || def.perm === "analytics.pharmacy" ? undefined : await doctorOptions(ctx);
  const body = await def.render(ctx, sp);
  return (
    <div className="space-y-section">
      <h2 className="type-section">{def.title}</h2>
      <Suspense fallback={null}><RangeFilter doctors={doctors} /></Suspense>
      {body && typeof body === "object" && "error" in body && typeof (body as { error: unknown }).error === "string" ? <ErrorState title="Check your filters" description={(body as { error: string }).error} /> : (body as React.ReactNode)}
    </div>
  );
}
