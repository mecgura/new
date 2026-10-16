import { Suspense } from "react";
import { AnalyticsNav } from "@/components/analytics/analytics-nav";
import { requireTenantPagePermission } from "@/lib/auth/context";

export default async function AnalyticsLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireTenantPagePermission("analytics.view");
  const has = (p: string) => ctx.permissions.has(p as never);
  const tabs = [
    { href: "/analytics", label: ctx.user.role === "CLINIC_ADMIN" ? "Command Center" : "Overview" },
    ...(has("analytics.patients") ? [{ href: "/analytics/patients", label: "Patients" }] : []),
    ...(has("analytics.operations") ? [{ href: "/analytics/appointments", label: "Appointments" }, { href: "/analytics/opd", label: "Live OPD" }, { href: "/analytics/doctors", label: "Doctors" }, { href: "/analytics/followups", label: "Follow-ups" }] : []),
    ...(has("analytics.clinical") ? [{ href: "/analytics/clinical", label: "Clinical" }] : []),
    ...(has("analytics.lab") ? [{ href: "/analytics/lab", label: "Lab" }] : []),
    ...(has("analytics.financial") ? [{ href: "/analytics/billing", label: "Billing" }] : []),
    ...(has("analytics.pharmacy") ? [{ href: "/analytics/pharmacy", label: "Pharmacy" }] : []),
    ...(has("analytics.communication") ? [{ href: "/analytics/communication", label: "Communication" }] : []),
    { href: "/analytics/insights", label: "Insights" }, { href: "/analytics/scorecard", label: "Scorecard" }, { href: "/analytics/reports", label: "Reports" },
  ];
  return (
    <div className="space-y-section">
      <div><h1 className="type-page-title">Analytics</h1><p className="type-secondary mt-1">Real figures from your clinic&apos;s own records. Dates use the clinic timezone ({ctx.tenant.timezone}).</p></div>
      <Suspense fallback={null}><AnalyticsNav tabs={tabs} /></Suspense>
      {children}
    </div>
  );
}
