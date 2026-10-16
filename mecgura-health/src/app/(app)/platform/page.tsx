import type { Metadata } from "next";
import Link from "next/link";
import { TenantStatusBadge } from "@/components/domain/badges";
import { BarList, DataTable, Kpi, KpiGrid, Section, fmtCount } from "@/components/analytics/widgets";
import { Alert } from "@/components/ui";
import { requirePagePermission } from "@/lib/auth/context";
import { ROLE_LABELS, type RoleKey } from "@/lib/permissions";
import { platformDashboard } from "@/lib/services/platform-monitor";
import { TENANT_STATUSES } from "@/lib/domain/constants";

export const metadata: Metadata = { title: "Platform" };
export const dynamic = "force-dynamic";
const fmt = (d: Date | string) => new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

export default async function PlatformDashboard() {
  const ctx = await requirePagePermission("platform.manage"); const d = await platformDashboard(ctx); const k = d.kpis;
  return (
    <div className="space-y-section">
      <div><h1 className="type-page-title">MECGURA HEALTH Platform</h1><p className="type-secondary mt-1">Live figures from the platform database. Last updated {fmt(d.generatedAt)}.</p></div>
      {d.health !== "ok" && <Alert tone={d.health === "down" ? "danger" : "warning"} title={d.health === "down" ? "A system component is down" : "Something needs attention"}>{d.alerts.join(" · ") || "See System health."} <Link href="/platform/system" className="type-label">System health</Link></Alert>}
      <KpiGrid label="Platform summary">
        <Kpi label="Total clinics" value={fmtCount(k.clinics)} href="/platform/clinics" /><Kpi label="Active clinics" value={fmtCount(k.active)} href="/platform/clinics?status=ACTIVE" /><Kpi label="Suspended" value={fmtCount(k.suspended)} href="/platform/clinics?status=SUSPENDED" goodWhen="down" /><Kpi label="Pending onboarding" value={fmtCount(k.pending)} href="/platform/clinics?status=PENDING" />
        <Kpi label="Staff accounts" value={fmtCount(k.users)} href="/platform/users" snapshot /><Kpi label="Doctors" value={fmtCount(k.doctors)} snapshot /><Kpi label="Patients" value={fmtCount(k.patients)} note="Count only" snapshot /><Kpi label="Today's appointments" value={fmtCount(k.todayAppointments)} note="Each clinic's own today" />
        <Kpi label="Communication providers" value={`${k.activeProviders} of ${k.providersTotal}`} note="Configured on the server" href="/platform/communications" /><Kpi label="Critical alerts" value={fmtCount(k.criticalAlerts)} note="Unread for you" href="/platform/notifications" goodWhen="down" />
      </KpiGrid>
      <div className="grid gap-section lg:grid-cols-2">
        <Section title="Clinics by status"><BarList items={d.tenants.byStatus.map((s) => ({ key: s.status, label: TENANT_STATUSES[s.status as keyof typeof TENANT_STATUSES]?.label ?? s.status, count: s.count }))} hrefOf={(s) => `/platform/clinics?status=${s}&all=1`} empty="No clinics yet" /></Section>
        <Section title="People" description={`${d.users.locked} account(s) locked right now · ${d.activity.loginsLast24h} sign-ins in 24 h.`}><BarList items={d.users.byRole.map((r) => ({ key: r.role, label: ROLE_LABELS[r.role as RoleKey] ?? r.role, count: r.count }))} empty="No staff accounts" /></Section>
        <Section title="Recent clinics" action={<Link href="/platform/clinics" className="type-label">All clinics</Link>}><DataTable caption="Recent clinics" empty="No clinics" head={[{ label: "Clinic" }, { label: "Status" }, { label: "Created" }]} rows={d.tenants.recent.map((c) => [<Link key={c.id} href={`/platform/clinics/${c.id}`}>{c.name}</Link>, <TenantStatusBadge key="s" status={c.status} />, fmt(c.createdAt)])} /></Section>
        <Section title="Communication health (7 days)" action={<Link href="/platform/communications" className="type-label">Details</Link>}>
          <p className="type-secondary tabular-nums">{fmtCount(d.communication.totals.sent)} sent · {fmtCount(d.communication.totals.delivered)} delivered · {fmtCount(d.communication.totals.failed)} failed · {fmtCount(d.communication.totals.pending)} waiting</p>
          <ul className="mt-2 divide-y divide-line">{d.communication.providers.map((p) => <li key={p.channel} className="flex justify-between py-1.5 type-secondary"><span>{p.channel}</span><span>{p.configured ? "Configured ✓" : "Not configured"}</span></li>)}</ul>
        </Section>
      </div>
      <Section title="Recent admin activity" action={<Link href="/platform/audit" className="type-label">Audit logs</Link>}><DataTable caption="Recent admin activity" empty="No admin activity yet" head={[{ label: "When" }, { label: "Action" }, { label: "By" }, { label: "Clinic" }]} rows={d.recentAdminActivity.map((a) => [fmt(a.at), a.action, a.actor, a.clinic])} /></Section>
    </div>
  );
}
