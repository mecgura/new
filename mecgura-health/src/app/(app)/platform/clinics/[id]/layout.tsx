import { notFound } from "next/navigation";
import { Suspense } from "react";
import { TenantStatusBadge } from "@/components/domain/badges";
import { ClinicLifecycle } from "@/components/platform/clinic-lifecycle";
import { TabNav } from "@/components/platform/tab-nav";
import { Breadcrumb, StatusBadge } from "@/components/ui";
import { requirePagePermission } from "@/lib/auth/context";
import { AppError } from "@/lib/errors";
import { getClinic } from "@/lib/services/clinics";

export default async function ClinicLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const ctx = await requirePagePermission("platform.manage"); const { id } = await params;
  const t = await getClinic(ctx, id).catch((e) => { if (e instanceof AppError && e.code === "NOT_FOUND") notFound(); throw e; });
  const base = `/platform/clinics/${id}`;
  const tabs = [{ href: base, label: "Overview", exact: true }, { href: `${base}/users`, label: "Users" }, { href: `${base}/branding`, label: "Branding" }, { href: `${base}/domains`, label: "Domains" }, { href: `${base}/features`, label: "Features" }, { href: `${base}/settings`, label: "Settings" }, { href: `${base}/communications`, label: "Communications" }, { href: `${base}/notifications`, label: "Notifications" }, { href: `${base}/analytics`, label: "Analytics" }, { href: `${base}/audit`, label: "Audit" }, { href: `${base}/activity`, label: "Activity" }];
  return (
    <div className="space-y-section">
      <div>
        <Breadcrumb items={[{ label: "Clinics", href: "/platform/clinics" }, { label: t.name }]} />
        <div className="flex flex-wrap items-center gap-3"><h1 className="type-page-title">{t.name}</h1><TenantStatusBadge status={t.status} />{t.isDemo && <StatusBadge tone="warning">Demo</StatusBadge>}</div>
        <p className="type-caption mt-1 break-all">Clinic ID {t.id}</p>
      </div>
      <ClinicLifecycle id={t.id} name={t.name} status={t.status} />
      <Suspense fallback={null}><TabNav tabs={tabs} label="Clinic sections" /></Suspense>
      {children}
    </div>
  );
}
