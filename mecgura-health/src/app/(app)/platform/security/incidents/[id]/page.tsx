import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { when } from "@/components/subscription/format";
import { IncidentUpdate } from "@/components/security/security-admin";
import { Card, StatusBadge } from "@/components/ui";
import { requirePagePermission } from "@/lib/auth/context";
import { AppError } from "@/lib/errors";
import { getIncident } from "@/lib/services/sec-center";

export const metadata: Metadata = { title: "Incident" };
export const dynamic = "force-dynamic";
const NEXT: Record<string, string[]> = { OPEN: ["INVESTIGATING", "CONTAINED", "RESOLVED"], INVESTIGATING: ["CONTAINED", "RESOLVED", "OPEN"], CONTAINED: ["INVESTIGATING", "RESOLVED"], RESOLVED: ["CLOSED", "INVESTIGATING"], CLOSED: [] };
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePagePermission("platform.manage"); const { id } = await params; const i = await getIncident(ctx, id).catch((e) => { if (e instanceof AppError && e.code === "NOT_FOUND") notFound(); throw e; });
  return (
    <div className="space-y-section">
      <div className="flex flex-wrap items-center gap-3"><h2 className="type-section-title">{i.incidentNumber} — {i.title}</h2><StatusBadge tone={["HIGH", "CRITICAL"].includes(i.severity) ? "danger" : "warning"}>{i.severity.toLowerCase()}</StatusBadge><StatusBadge>{i.status.toLowerCase()}</StatusBadge></div>
      <Card className="space-y-2 p-card"><p>{i.description}</p>{i.affectedResource && <p className="type-secondary">Affected: {i.affectedResource}</p>}{i.actionsTaken && <p><strong>Actions taken:</strong> {i.actionsTaken}</p>}{i.resolution && <p><strong>Resolution:</strong> {i.resolution}</p>}<p className="type-caption">Detected {when(i.detectedAt, "Asia/Kolkata", true)} · category {i.category.toLowerCase()}</p></Card>
      {NEXT[i.status].length > 0 || i.status !== "CLOSED" ? <Card className="p-card"><IncidentUpdate id={i.id} status={i.status} nextStatuses={NEXT[i.status]} /></Card> : null}
      <Card className="p-card"><h2 className="type-section-title mb-3">Timeline</h2><ol className="space-y-2">{i.events.map((e) => <li key={e.id}><span className="type-caption">{when(e.createdAt, "Asia/Kolkata", true)} · {e.type.toLowerCase()}</span><p>{e.note}</p></li>)}</ol></Card>
    </div>
  );
}
