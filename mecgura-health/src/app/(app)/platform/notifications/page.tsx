import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardHeader } from "@/components/ui";
import { PriorityMark, full } from "@/components/notifications/labels";
import { requirePagePermission } from "@/lib/auth/context";
import { platformNotificationOverview } from "@/lib/services/notifications-platform";

export const metadata: Metadata = { title: "Platform alerts" };
export const dynamic = "force-dynamic";
const Stat = ({ label, value, danger }: { label: string; value: number; danger?: boolean }) => <div className="rounded-xl border border-line bg-surface p-4"><p className="type-caption">{label}</p><p className={`mt-1 text-2xl font-semibold tabular-nums ${danger && value ? "text-danger" : ""}`}>{value}</p></div>;

/** Super Admin: system and security alerts across all clinics (never patient content), plus delivery-failure signals. */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requirePagePermission("platform.manage"); const sp = await searchParams;
  const o = await platformNotificationOverview(ctx, { tenantId: sp.tenantId || undefined, category: sp.category || undefined, priority: sp.priority || undefined, status: sp.status || undefined, from: sp.from || undefined, to: sp.to || undefined, page: Number(sp.page) || 1 });
  const href = (p: number) => `/platform/notifications?${new URLSearchParams({ ...Object.fromEntries(Object.entries(sp).filter(([, v]) => v) as [string, string][]), page: String(p) })}`;
  const sel = "min-h-11 w-full rounded-lg border border-line bg-surface px-3";
  return (
    <div className="space-y-section">
      <div className="flex flex-wrap items-end justify-between gap-3"><div><h1 className="type-page-title">Platform alerts</h1><p className="type-secondary">System and security alerts from every clinic. Last 30 days.</p></div><Link href="/platform/communications" className="inline-flex min-h-11 items-center rounded-lg border border-line px-4 type-label">Communication monitoring</Link></div>
      <section aria-label="Totals" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Notifications (30 d)" value={o.totals.total30d} /><Stat label="Critical, unread by you" value={o.totals.criticalOpen} danger /><Stat label="Failed messages (7 d)" value={o.totals.failedJobs7d} danger /><Stat label="Provider problems (7 d)" value={o.totals.providerFailures7d} danger />
        {o.totals.byPriority.filter((p) => p.priority === "URGENT" || p.priority === "CRITICAL").map((p) => <Stat key={p.priority} label={`${p.priority === "URGENT" ? "Urgent" : "Critical"} (30 d)`} value={p.count} danger />)}
      </section>
      {o.tenantIssues.length > 0 && <Card><CardHeader title="Clinics with failed messages" description="Last 7 days." /><ul className="divide-y divide-line">{o.tenantIssues.map((t) => <li key={t.tenantId} className="flex justify-between p-card"><span className="type-label">{t.clinic}</span><span className="type-secondary">{t.failed} failed</span></li>)}</ul></Card>}
      <Card><CardHeader title="Alerts" />
        <form method="get" className="grid gap-3 border-b border-line p-card sm:grid-cols-2 lg:grid-cols-6" aria-label="Filter alerts">
          <label className="type-caption">Clinic<select name="tenantId" defaultValue={sp.tenantId ?? ""} className={sel}><option value="">All clinics</option>{o.tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
          <label className="type-caption">Category<select name="category" defaultValue={sp.category ?? ""} className={sel}><option value="">System + security</option><option value="SYSTEM">System</option><option value="SECURITY">Security</option></select></label>
          <label className="type-caption">Severity<select name="priority" defaultValue={sp.priority ?? ""} className={sel}><option value="">High and above</option><option value="HIGH">High</option><option value="URGENT">Urgent</option><option value="CRITICAL">Critical</option></select></label>
          <label className="type-caption">Status<select name="status" defaultValue={sp.status ?? ""} className={sel}><option value="">Any</option><option value="unread">Unread</option><option value="read">Read</option></select></label>
          <label className="type-caption">From<input type="date" name="from" defaultValue={sp.from ?? ""} className={sel} /></label><label className="type-caption">To<input type="date" name="to" defaultValue={sp.to ?? ""} className={sel} /></label>
          <div className="sm:col-span-2 lg:col-span-6"><button className="min-h-11 rounded-lg bg-primary px-5 type-label text-white" type="submit">Apply filters</button></div>
        </form>
        {o.alerts.length === 0 ? <p className="type-secondary p-card">No alerts match.</p> : <ul className="divide-y divide-line">{o.alerts.map((a) => <li key={a.id} className="p-card"><div className="flex flex-wrap items-center gap-2"><PriorityMark priority={a.priority} /><span className="type-caption">{a.categoryLabel} · {a.clinic}</span><span className="type-caption ml-auto">{full(a.createdAt)}</span></div><p className="type-label mt-1">{a.title}</p>{a.body && <p className="type-secondary break-words">{a.body}</p>}</li>)}</ul>}
        <div className="flex items-center justify-between p-card"><span className="type-caption">{o.total} alert(s)</span><span className="flex gap-2">{o.page > 1 && <Link className="underline" href={href(o.page - 1)}>Previous</Link>}{o.page * o.pageSize < o.total && <Link className="underline" href={href(o.page + 1)}>Next</Link>}</span></div>
      </Card>
    </div>
  );
}
