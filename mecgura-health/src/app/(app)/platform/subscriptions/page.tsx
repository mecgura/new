import type { Metadata } from "next";
import Link from "next/link";
import { STATUS_TONE, label, rupees, when } from "@/components/subscription/format";
import { ButtonLink, Button, Card, Field, Pagination, SearchInput, Select, StatusBadge } from "@/components/ui";
import { requirePagePermission } from "@/lib/auth/context";
import { listSubscriptions } from "@/lib/services/sub-admin";

export const metadata: Metadata = { title: "Subscriptions" };
export const dynamic = "force-dynamic";
export default async function SubscriptionsPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; planId?: string; source?: string; page?: string }> }) {
  const ctx = await requirePagePermission("platform.manage"); const sp = await searchParams; const page = Math.max(1, Number(sp.page) || 1);
  const r = await listSubscriptions(ctx, { q: sp.q?.trim() || undefined, status: sp.status, planId: sp.planId, source: sp.source, page });
  const qs = (p: number) => `/platform/subscriptions?${new URLSearchParams({ ...(sp.q ? { q: sp.q } : {}), ...(sp.status ? { status: sp.status } : {}), ...(sp.planId ? { planId: sp.planId } : {}), page: String(p) })}`;
  return (
    <div className="space-y-section">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="type-page-title">Subscriptions</h1><p className="type-secondary mt-1">Clinic subscriptions to MECGURA HEALTH. {r.legacyUnmanaged > 0 ? `${r.legacyUnmanaged} clinic(s) still run on the older no-billing setup — assign them a plan from the clinic's Subscription tab.` : ""}</p></div><div className="flex gap-2"><ButtonLink href="/platform/subscriptions/analytics" variant="outline">Analytics</ButtonLink><ButtonLink href="/platform/subscriptions/settings" variant="outline">Billing settings</ButtonLink></div></div>
      <Card className="p-card"><form method="get" role="search" aria-label="Filter subscriptions" className="grid gap-3 sm:grid-cols-[1fr_12rem_12rem_auto] sm:items-end">
        <Field label="Clinic"><SearchInput name="q" defaultValue={sp.q} placeholder="Clinic name" /></Field>
        <Field label="Status"><Select name="status" defaultValue={sp.status ?? ""} placeholder="All" options={r.statuses.map((s) => ({ value: s.key, label: s.label }))} /></Field>
        <Field label="Plan"><Select name="planId" defaultValue={sp.planId ?? ""} placeholder="All" options={r.plans.map((p) => ({ value: p.id, label: p.name }))} /></Field>
        <Button type="submit" variant="outline">Apply</Button></form></Card>
      <Card><div className="relative overflow-x-auto"><table className="w-full text-left"><caption className="sr-only">Subscriptions</caption>
        <thead><tr className="type-caption border-b border-line bg-surface-muted"><th scope="col" className="p-3">Clinic</th><th scope="col" className="p-3">Plan</th><th scope="col" className="p-3">Status</th><th scope="col" className="p-3 text-right">Price</th><th scope="col" className="p-3">Trial / period ends</th><th scope="col" className="p-3 text-right">Outstanding</th></tr></thead>
        <tbody>{r.rows.map((s) => <tr key={s.id} className="border-b border-line last:border-0"><th scope="row" className="p-3 text-left"><Link href={`/platform/clinics/${s.tenantId}/subscription`}>{s.clinic}</Link></th><td className="p-3">{s.plan}<span className="type-caption block">{label(s.interval)}</span></td><td className="p-3"><StatusBadge tone={STATUS_TONE[s.status]}>{s.statusLabel}</StatusBadge>{s.cancelAtPeriodEnd && <span className="type-caption block">Ending</span>}</td><td className="p-3 text-right">{rupees(s.priceMinor)}</td><td className="p-3">{when(s.status === "TRIAL" ? s.trialEnd : s.periodEnd)}</td><td className="p-3 text-right">{s.outstandingMinor ? rupees(s.outstandingMinor) : "—"}</td></tr>)}</tbody></table>
        {!r.rows.length && <p className="type-secondary p-6 text-center">No subscriptions match.</p>}</div></Card>
      <Pagination page={r.page} pageCount={Math.ceil(r.total / r.pageSize)} hrefFor={qs} />
    </div>
  );
}
