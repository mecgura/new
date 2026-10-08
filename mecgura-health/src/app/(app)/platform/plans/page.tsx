import type { Metadata } from "next";
import Link from "next/link";
import { STATUS_TONE, label, rupees } from "@/components/subscription/format";
import { ButtonLink, Card, StatusBadge } from "@/components/ui";
import { requirePagePermission } from "@/lib/auth/context";
import { listPlans } from "@/lib/services/sub-plans";

export const metadata: Metadata = { title: "Plans" };
export const dynamic = "force-dynamic";
export default async function PlansPage() {
  const ctx = await requirePagePermission("platform.manage"); const plans = await listPlans(ctx);
  return (
    <div className="space-y-section">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="type-page-title">Plans</h1><p className="type-secondary mt-1">Subscription plans clinics can buy. Plans are never deleted — archive them. Editing a plan does not change what existing subscribers were sold.</p></div><ButtonLink href="/platform/plans/new">New plan</ButtonLink></div>
      <Card><div className="relative overflow-x-auto"><table className="w-full text-left"><caption className="sr-only">Plans</caption>
        <thead><tr className="type-caption border-b border-line bg-surface-muted"><th scope="col" className="p-3">Plan</th><th scope="col" className="p-3">Status</th><th scope="col" className="p-3 text-right">Monthly</th><th scope="col" className="p-3 text-right">Yearly</th><th scope="col" className="p-3">Trial</th><th scope="col" className="p-3">Public</th><th scope="col" className="p-3 text-right">Subscribers</th><th scope="col" className="p-3">Version</th></tr></thead>
        <tbody>{plans.map((p) => <tr key={p.id} className="border-b border-line last:border-0"><th scope="row" className="p-3 text-left"><Link href={`/platform/plans/${p.id}`}>{p.name}</Link><span className="type-caption block">{p.slug}{p.commercial ? "" : " · legacy menu bundle (not sellable)"}</span></th><td className="p-3"><StatusBadge tone={STATUS_TONE[p.status]}>{label(p.status)}</StatusBadge></td><td className="p-3 text-right">{rupees(p.monthlyPriceMinor)}</td><td className="p-3 text-right">{rupees(p.annualPriceMinor)}</td><td className="p-3">{p.trialDays ? `${p.trialDays} days` : "—"}</td><td className="p-3">{p.isPublic ? "Yes" : "No"}</td><td className="p-3 text-right">{p.subscribers}</td><td className="p-3">v{p.version}</td></tr>)}</tbody></table>
        {!plans.length && <p className="type-secondary p-6 text-center">No plans yet. Create the first one.</p>}</div></Card>
    </div>
  );
}
