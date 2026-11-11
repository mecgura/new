import type { Metadata } from "next";
import { Kpi, KpiGrid, Section, BarList, fmtCount } from "@/components/analytics/widgets";
import { requirePagePermission } from "@/lib/auth/context";
import { db } from "@/lib/db";
import { daysAgo } from "@/lib/platform/time";

export const metadata: Metadata = { title: "Clinic · Notifications" };
export const dynamic = "force-dynamic";
export default async function ClinicNotificationsPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePagePermission("platform.manage"); const { id } = await params; const d7 = daysAgo(7);
  const [byPriority, unread, ackPending] = await Promise.all([db.notification.groupBy({ by: ["priority"], where: { tenantId: id, createdAt: { gte: d7 } }, _count: { _all: true } }), db.notification.count({ where: { tenantId: id, readAt: null, archivedAt: null } }), db.notification.count({ where: { tenantId: id, ackRequired: true, acknowledgedAt: null, archivedAt: null } })]);
  return (
    <div className="space-y-section">
      <KpiGrid label="Notification summary"><Kpi label="Created (7 days)" value={fmtCount(byPriority.reduce((a, x) => a + x._count._all, 0))} /><Kpi label="Unread now" value={fmtCount(unread)} snapshot /><Kpi label="Waiting for acknowledgement" value={fmtCount(ackPending)} snapshot /></KpiGrid>
      <Section title="By priority (7 days)"><BarList items={byPriority.map((x) => ({ key: x.priority, label: x.priority.charAt(0) + x.priority.slice(1).toLowerCase(), count: x._count._all }))} empty="No notifications in the last 7 days" /></Section>
      <p className="type-caption">Counts only — notification titles and contents are not shown here. Platform-wide alerts are on the Platform alerts page.</p>
    </div>
  );
}
