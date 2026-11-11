import type { Metadata } from "next";
import { when } from "@/components/subscription/format";
import { Button, Card, Field, Pagination, Select, StatusBadge } from "@/components/ui";
import { requirePagePermission } from "@/lib/auth/context";
import { listSecurityEvents } from "@/lib/services/sec-center";

export const metadata: Metadata = { title: "Security events" };
export const dynamic = "force-dynamic";
export default async function Page({ searchParams }: { searchParams: Promise<{ severity?: string; category?: string; page?: string }> }) {
  const ctx = await requirePagePermission("platform.manage"); const sp = await searchParams; const r = await listSecurityEvents(ctx, { severity: sp.severity, category: sp.category, page: Number(sp.page) || 1 });
  const qs = (p: number) => `/platform/security/events?${new URLSearchParams({ ...(sp.severity ? { severity: sp.severity } : {}), ...(sp.category ? { category: sp.category } : {}), page: String(p) })}`;
  return (
    <div className="space-y-section">
      <Card className="p-card"><form method="get" role="search" aria-label="Filter events" className="grid gap-3 sm:grid-cols-[12rem_12rem_auto] sm:items-end"><Field label="Severity"><Select name="severity" defaultValue={sp.severity ?? ""} placeholder="All" options={r.severities.map((v) => ({ value: v, label: v.toLowerCase() }))} /></Field><Field label="Category"><Select name="category" defaultValue={sp.category ?? ""} placeholder="All" options={r.categories.map((v) => ({ value: v, label: v.toLowerCase().replace("_", " ") }))} /></Field><Button type="submit" variant="outline">Apply</Button></form></Card>
      <Card><div className="relative overflow-x-auto"><table className="w-full text-left"><caption className="sr-only">Security events</caption><thead><tr className="type-caption border-b border-line bg-surface-muted"><th scope="col" className="p-3">When</th><th scope="col" className="p-3">Severity</th><th scope="col" className="p-3">Event</th><th scope="col" className="p-3">Address</th></tr></thead>
        <tbody>{r.rows.map((e) => <tr key={e.id} className="border-b border-line last:border-0"><td className="p-3">{when(e.createdAt, "Asia/Kolkata", true)}</td><td className="p-3"><StatusBadge tone={e.severity === "INFO" ? "neutral" : e.severity === "LOW" ? "info" : e.severity === "MEDIUM" ? "warning" : "danger"}>{e.severity.toLowerCase()}</StatusBadge></td><td className="p-3">{e.summary}<span className="type-caption block">{e.category.toLowerCase()} · {e.type}</span></td><td className="p-3">{e.ip ?? "—"}</td></tr>)}</tbody></table>
        {!r.rows.length && <p className="type-secondary p-6 text-center">No events match.</p>}</div></Card>
      <Pagination page={r.page} pageCount={Math.ceil(r.total / r.pageSize)} hrefFor={qs} />
    </div>
  );
}
