import type { Metadata } from "next";
import { Kpi, KpiGrid, Section, DataTable } from "@/components/analytics/widgets";
import { StatusBadge } from "@/components/ui";
import { requirePagePermission } from "@/lib/auth/context";
import { clinicHealth, statusHistory } from "@/lib/services/platform-clinics";
import { listSupportAccess } from "@/lib/services/platform-admin";

export const metadata: Metadata = { title: "Clinic · Activity" };
export const dynamic = "force-dynamic";
const fmt = (d?: Date | string | null) => (d ? new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");
export default async function ClinicActivityPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePagePermission("platform.manage"); const { id } = await params;
  const [h, hist, support] = await Promise.all([clinicHealth(ctx, id), statusHistory(ctx, id, 30), listSupportAccess(ctx, id)]);
  return (
    <div className="space-y-section">
      <KpiGrid label="Clinic health"><Kpi label="Last sign-in" value={h.lastLoginAt ? fmt(h.lastLoginAt) : "Never"} muted /><Kpi label="Active users (30 days)" value={String(h.activeUsers30d)} /><Kpi label="Appointments (7 days)" value={String(h.appointmentsLast7Days)} /><Kpi label="Failed messages (7 days)" value={String(h.communication.failedLast7Days)} goodWhen="down" /><Kpi label="Messages waiting" value={String(h.communication.queued)} snapshot /><Kpi label="Setup left" value={String(h.setup.total - h.setup.done)} goodWhen="down" /></KpiGrid>
      <Section title="Warnings">{h.warnings.length ? <ul className="list-disc space-y-1 pl-5">{h.warnings.map((w) => <li key={w} className="type-secondary">{w}</li>)}</ul> : <p className="type-secondary">No warnings.</p>}</Section>
      <Section title="Features switched off">{h.disabledFeatures.length ? <p className="type-secondary">{h.disabledFeatures.join(", ")}</p> : <p className="type-secondary">All features are on.</p>}</Section>
      <Section title="Status history"><DataTable caption="Status history" empty="No status changes" head={[{ label: "When" }, { label: "Change" }, { label: "Category" }, { label: "By" }, { label: "Notes" }]} rows={hist.map((x) => [fmt(x.at), `${x.from} → ${x.to}`, x.category.toLowerCase(), x.by, x.notes ?? "—"])} /></Section>
      <Section title="Support access visits"><DataTable caption="Support access" empty="No support visits" head={[{ label: "Started" }, { label: "By" }, { label: "Reason" }, { label: "State" }]} rows={support.map((s) => [fmt(s.startedAt), s.by, s.reason, s.open ? <StatusBadge key={s.id} tone="warning">Open until {fmt(s.expiresAt)}</StatusBadge> : <StatusBadge key={s.id}>Ended</StatusBadge>])} /></Section>
      <p className="type-caption">{h.note}</p>
    </div>
  );
}
