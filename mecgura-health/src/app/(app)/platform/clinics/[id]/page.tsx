import type { Metadata } from "next";
import { SetupChecklist } from "@/components/clinic/setup-checklist";
import { clinicTypeLabel } from "@/components/domain/badges";
import { AdminHandoff } from "@/components/platform/user-actions";
import { Kpi, KpiGrid, Section } from "@/components/analytics/widgets";
import { ButtonLink, StatusBadge } from "@/components/ui";
import { requirePagePermission } from "@/lib/auth/context";
import { getEnv } from "@/lib/env";
import { db } from "@/lib/db";
import { getClinic } from "@/lib/services/clinics";
import { clinicHealth, clinicSetup, clinicUsage, statusHistory } from "@/lib/services/platform-clinics";

export const metadata: Metadata = { title: "Clinic · Overview" };
export const dynamic = "force-dynamic";
const fmt = (d?: Date | string | null) => (d ? new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");
const Item = ({ label, children }: { label: string; children: React.ReactNode }) => <div><dt className="type-caption">{label}</dt><dd className="type-body break-words">{children || "—"}</dd></div>;

export default async function ClinicOverview({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePagePermission("platform.manage"); const { id } = await params;
  const [t, setup, health, usage, history, staff] = await Promise.all([getClinic(ctx, id), clinicSetup(ctx, id), clinicHealth(ctx, id), clinicUsage(ctx, id), statusHistory(ctx, id, 5),
    db.user.findMany({ where: { tenantId: id, deletedAt: null, status: "ACTIVE", role: { key: { notIn: ["DOCTOR", "CLINIC_ADMIN", "PATIENT", "SUPER_ADMIN"] } } }, select: { id: true, name: true, role: { select: { key: true } } }, orderBy: { name: "asc" }, take: 100 })]);
  const admins = t.users.filter((u) => u.role.key === "CLINIC_ADMIN");
  const root = getEnv().TENANT_ROOT_DOMAIN; const href = (tab: string) => `/platform/clinics/${id}/${tab}`;
  const hints: Record<string, string> = { basic: "Edit profile", admin: "Invite admin", timezone: "Edit profile", branding: "Set branding", domain: "Set domain", doctor: "Invite doctor", schedule: "Open workspace", comms: "Communications", portal: "Open workspace" };
  const tabFor: Record<string, string> = { basic: "settings", admin: "users", timezone: "settings", branding: "branding", domain: "domains", doctor: "users", schedule: "settings", comms: "communications", portal: "features" };
  return (
    <div className="space-y-section">
      <KpiGrid label="Clinic summary">
        <Kpi label="Users" value={String(usage.counts.users)} note={`${usage.counts.doctors} doctors`} href={href("users")} /><Kpi label="Patients" value={String(usage.counts.patients)} note="Count only" /><Kpi label="Appointments (30 days)" value={String(usage.counts.appointmentsLast30Days)} />
        <Kpi label="Last sign-in" value={health.lastLoginAt ? fmt(health.lastLoginAt) : "Never"} muted /><Kpi label="Setup" value={`${setup.done}/${setup.total}`} href="#setup" /><Kpi label="Warnings" value={String(health.warnings.length)} goodWhen="down" href={href("activity")} />
      </KpiGrid>
      {health.warnings.length > 0 && <Section title="Needs attention"><ul className="list-disc space-y-1 pl-5">{health.warnings.map((w) => <li key={w} className="type-secondary">{w}</li>)}</ul></Section>}
      <div className="grid gap-section lg:grid-cols-2">
        <Section title="Profile" action={<ButtonLink size="sm" variant="outline" href={`/platform/clinics/${t.id}/edit`}>Edit</ButtonLink>}>
          <dl className="grid gap-3 sm:grid-cols-2"><Item label="Legal name">{t.legalName}</Item><Item label="Type">{clinicTypeLabel(t.clinicType)}</Item><Item label="Email">{t.contactEmail}</Item><Item label="Phone">{t.contactPhone}</Item><Item label="Address">{[t.address, t.city, t.state, t.pincode, t.country].filter(Boolean).join(", ")}</Item><Item label="Timezone">{t.timezone}</Item><Item label="Workspace address">{t.slug}{root && t.subdomain ? ` · ${t.subdomain}.${root}` : ""}</Item><Item label="Created">{fmt(t.createdAt)}</Item></dl>
        </Section>
        <Section title="Clinic admin" description="People who administer this clinic." action={<AdminHandoff clinicId={t.id} clinicName={t.name} candidates={staff.map((s) => ({ id: s.id, name: s.name, role: s.role.key }))} />}>
          {admins.length ? <ul className="divide-y divide-line">{admins.map((a) => <li key={a.id} className="flex items-center justify-between py-2"><span className="type-body">{a.name}</span><StatusBadge tone={a.status === "ACTIVE" ? "success" : "warning"}>{a.status.toLowerCase()}</StatusBadge></li>)}</ul> : <p className="type-secondary">No Clinic Admin yet. Invite one from the Users tab.</p>}
        </Section>
      </div>
      <div id="setup"><SetupChecklist items={setup.items.map((i) => ({ key: i.key, label: `${i.label}${i.required ? "" : " (optional)"}`, done: i.done, href: href(tabFor[i.key] ?? "settings"), hint: hints[i.key] ?? "Open" }))} later={[]} /></div>
      <Section title="Recent status changes">{history.length ? <ul className="divide-y divide-line">{history.map((h) => <li key={h.id} className="py-2 type-secondary"><strong>{h.from} → {h.to}</strong> · {h.category.toLowerCase()} · {fmt(h.at)} by {h.by}{h.notes ? <span className="block text-muted">“{h.notes}”</span> : null}</li>)}</ul> : <p className="type-secondary">No status changes recorded.</p>}</Section>
    </div>
  );
}
