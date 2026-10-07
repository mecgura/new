import type { Metadata } from "next";
import { Empty, PageTitle, Pager, RowLink, Section } from "@/components/portal/portal-server";
import { dayLabel } from "@/components/portal/portal-labels";
import { requirePatientContext } from "@/lib/portal/ctx";
import { listReports } from "@/lib/services/portal-records";

export const metadata: Metadata = { title: "Lab reports" };
export const dynamic = "force-dynamic";
export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ page?: string; q?: string; from?: string; to?: string }> }) {
  const sp = await searchParams; const ctx = await requirePatientContext(); const r = await listReports(ctx, { page: Number(sp.page), q: sp.q, from: sp.from, to: sp.to });
  return (
    <div>
      <PageTitle title="Lab reports" subtitle="Only reports the clinic has released to you. Please talk to your doctor about what the results mean." />
      <form method="get" className="mb-4 grid gap-3 sm:max-w-xl sm:grid-cols-3" aria-label="Filter reports">
        <label className="type-label sm:col-span-3">Test name<input name="q" defaultValue={sp.q ?? ""} placeholder="e.g. Blood count" maxLength={60} className="type-body mt-1 min-h-12 w-full rounded-md border border-line-strong bg-surface px-3" /></label>
        <label className="type-label">From<input type="date" name="from" defaultValue={sp.from ?? ""} className="type-body mt-1 min-h-12 w-full rounded-md border border-line-strong bg-surface px-3" /></label>
        <label className="type-label">To<input type="date" name="to" defaultValue={sp.to ?? ""} className="type-body mt-1 min-h-12 w-full rounded-md border border-line-strong bg-surface px-3" /></label>
        <button type="submit" className="type-button mt-auto min-h-12 rounded-md border border-line-strong px-4 hover:bg-surface-muted">Search</button>
      </form>
      <Section>
        {!r.rows.length ? <Empty title="No reports available" hint="Released lab reports appear here." /> : <ul className="divide-y divide-line">{r.rows.map((x) => <RowLink key={x.id} href={`/portal/reports/${x.id}`} title={`${x.tests.slice(0, 2).join(", ")}${x.tests.length > 2 ? ` +${x.tests.length - 2}` : ""}`} meta={`${x.reportNumber} · ${dayLabel(x.date)} · ${x.doctorName}${x.amended ? " · updated" : ""}`} />)}</ul>}
      </Section>
      <Pager page={r.page} total={r.total} pageSize={r.pageSize} href={(n) => `/portal/reports?${new URLSearchParams({ ...(sp.q ? { q: sp.q } : {}), ...(sp.from ? { from: sp.from } : {}), ...(sp.to ? { to: sp.to } : {}), page: String(n) })}`} />
    </div>
  );
}
