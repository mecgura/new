import type { Metadata } from "next";
import Link from "next/link";
import { when } from "@/components/subscription/format";
import { IncidentCreate } from "@/components/security/security-admin";
import { Card, Pagination, StatusBadge } from "@/components/ui";
import { requirePagePermission } from "@/lib/auth/context";
import { listIncidents } from "@/lib/services/sec-center";

export const metadata: Metadata = { title: "Security incidents" };
export const dynamic = "force-dynamic";
export default async function Page({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const ctx = await requirePagePermission("platform.manage"); const sp = await searchParams; const r = await listIncidents(ctx, { page: Number(sp.page) || 1 });
  return (
    <div className="space-y-section">
      <div className="flex justify-between gap-3"><p className="type-secondary">Track a suspected or confirmed security problem from detection to closure. This is a record-keeping workflow, not an automated response system.</p><IncidentCreate /></div>
      <Card><div className="relative overflow-x-auto"><table className="w-full text-left"><caption className="sr-only">Incidents</caption><thead><tr className="type-caption border-b border-line bg-surface-muted"><th scope="col" className="p-3">Number</th><th scope="col" className="p-3">Title</th><th scope="col" className="p-3">Severity</th><th scope="col" className="p-3">Status</th><th scope="col" className="p-3">Detected</th></tr></thead>
        <tbody>{r.rows.map((i) => <tr key={i.id} className="border-b border-line last:border-0"><th scope="row" className="p-3 text-left"><Link href={`/platform/security/incidents/${i.id}`}>{i.incidentNumber}</Link></th><td className="p-3">{i.title}</td><td className="p-3"><StatusBadge tone={["HIGH", "CRITICAL"].includes(i.severity) ? "danger" : i.severity === "MEDIUM" ? "warning" : "neutral"}>{i.severity.toLowerCase()}</StatusBadge></td><td className="p-3">{i.status.toLowerCase()}</td><td className="p-3">{when(i.detectedAt, "Asia/Kolkata", true)}</td></tr>)}</tbody></table>
        {!r.rows.length && <p className="type-secondary p-6 text-center">No incidents recorded.</p>}</div></Card>
      <Pagination page={r.page} pageCount={Math.ceil(r.total / r.pageSize)} hrefFor={(p) => `/platform/security/incidents?page=${p}`} />
    </div>
  );
}
