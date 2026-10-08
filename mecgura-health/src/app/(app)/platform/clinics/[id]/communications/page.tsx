import type { Metadata } from "next";
import { Section, DataTable, fmtCount } from "@/components/analytics/widgets";
import { Kpi, KpiGrid } from "@/components/analytics/widgets";
import { StatusBadge } from "@/components/ui";
import { requirePagePermission } from "@/lib/auth/context";
import { db } from "@/lib/db";
import { CHANNELS } from "@/lib/communications/catalog";
import { providerStatus } from "@/lib/communications/providers/registry";
import { loadSettings } from "@/lib/communications/settings";
import { daysAgo } from "@/lib/platform/time";
import { clinicFeatures } from "@/lib/services/platform-clinics";

export const metadata: Metadata = { title: "Clinic · Communications" };
export const dynamic = "force-dynamic";
export default async function ClinicCommsPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePagePermission("platform.manage"); const { id } = await params;
  const [s, feats] = await Promise.all([loadSettings(id), clinicFeatures(ctx, id)]); const d7 = daysAgo(7);
  const rows = await Promise.all(CHANNELS.map(async (c) => { const p = providerStatus(c); const [sent, failed, queued] = await Promise.all([db.communicationMessage.count({ where: { tenantId: id, channel: c, sentAt: { gte: d7 } } }), db.communicationMessage.count({ where: { tenantId: id, channel: c, status: "FAILED", failedAt: { gte: d7 } } }), db.communicationMessage.count({ where: { tenantId: id, channel: c, status: { in: ["QUEUED", "RETRYING"] } } })]);
    const on = c === "WHATSAPP" ? s.whatsappEnabled : c === "SMS" ? s.smsEnabled : s.emailEnabled; const platformOff = !feats.find((f) => f.key === c.toLowerCase())?.enabled;
    return [c, <StatusBadge key="p" tone={platformOff ? "neutral" : on ? "success" : "warning"}>{platformOff ? "Off (platform)" : on ? "On" : "Off"}</StatusBadge>, p.configured ? "Configured ✓" : "Not configured", sent, failed, queued]; }));
  return (
    <div className="space-y-section">
      <KpiGrid label="Communication summary"><Kpi label="Sent (7 days)" value={fmtCount(rows.reduce((a, r) => a + (r[3] as number), 0))} /><Kpi label="Failed (7 days)" value={fmtCount(rows.reduce((a, r) => a + (r[4] as number), 0))} goodWhen="down" /><Kpi label="Waiting" value={fmtCount(rows.reduce((a, r) => a + (r[5] as number), 0))} snapshot /></KpiGrid>
      <Section title="Channels" description="Clinic setting, server provider and recent delivery. Credentials are never shown — only whether a provider is configured."><DataTable caption="Channels" head={[{ label: "Channel" }, { label: "Clinic setting" }, { label: "Provider" }, { label: "Sent", right: true }, { label: "Failed", right: true }, { label: "Waiting", right: true }]} rows={rows} /></Section>
      <p className="type-caption">Message contents and recipients are not shown. Channel switches are on the Features tab.</p>
    </div>
  );
}
