import type { Metadata } from "next";
import Link from "next/link";
import { Button, Card, Field, Pagination, SearchInput, StatusBadge } from "@/components/ui";
import { requirePagePermission } from "@/lib/auth/context";
import { featureMatrix } from "@/lib/services/platform-clinics";

export const metadata: Metadata = { title: "Features" };
export const dynamic = "force-dynamic";
export default async function FeaturesPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const ctx = await requirePagePermission("platform.manage"); const sp = await searchParams; const page = Math.max(1, Number(sp.page) || 1);
  const r = await featureMatrix(ctx, { q: sp.q?.trim() || undefined, page });
  return (
    <div className="space-y-section">
      <div><h1 className="type-page-title">Feature access</h1><p className="type-secondary mt-1">Which modules each clinic can use. Open a clinic to change a switch — switching off never deletes data.</p></div>
      <Card className="p-card"><form method="get" role="search" aria-label="Search clinics" className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end"><Field label="Clinic"><SearchInput name="q" defaultValue={sp.q} placeholder="Clinic name" /></Field><Button type="submit" variant="outline">Apply</Button></form></Card>
      <Card><div className="relative overflow-x-auto"><table className="w-full text-left"><caption className="sr-only">Features per clinic</caption>
        <thead><tr className="type-caption border-b border-line bg-surface-muted"><th scope="col" className="sticky left-0 bg-surface-muted p-3">Clinic</th>{r.features.map((f) => <th key={f.key} scope="col" className="p-3 text-center align-bottom"><span className="inline-block max-w-20">{f.label}</span></th>)}</tr></thead>
        <tbody>{r.rows.map((c) => <tr key={c.id} className="border-b border-line last:border-0"><th scope="row" className="sticky left-0 bg-surface p-3 text-left"><Link href={`/platform/clinics/${c.id}/features`}>{c.name}</Link></th>{r.features.map((f) => { const off = c.off.includes(f.key); return <td key={f.key} className="p-3 text-center"><StatusBadge tone={off ? "neutral" : "success"}>{off ? "Off" : "On"}<span className="sr-only"> — {f.label} for {c.name}</span></StatusBadge></td>; })}</tr>)}</tbody></table></div>
        {!r.rows.length && <p className="type-secondary p-6 text-center">No clinics found.</p>}</Card>
      <Pagination page={r.page} pageCount={Math.ceil(r.total / r.pageSize)} hrefFor={(p) => `/platform/features?${new URLSearchParams({ ...(sp.q ? { q: sp.q } : {}), page: String(p) })}`} />
    </div>
  );
}
