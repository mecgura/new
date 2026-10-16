import type { Metadata } from "next";
import Link from "next/link";
import { Badge, ButtonLink, Card, DataTable, EmptyState, Field, Pagination, Select, StatusBadge, type Column } from "@/components/ui";
import { ORDER_STATUS_LABEL, ORDER_STATUS_TONE, PRIORITY_LABEL, PRIORITY_TONE, fmt } from "@/components/lab/lab-ui";
import { requireTenantPagePermission } from "@/lib/auth/context";
import { AppError } from "@/lib/errors";
import { labStats, listLabOrders, TABS } from "@/lib/services/lab-orders";

export const metadata: Metadata = { title: "Laboratory" };
export const dynamic = "force-dynamic";
type Row = Awaited<ReturnType<typeof listLabOrders>>["rows"][number];
const TAB_LABEL: Record<string, string> = { new: "New orders", collected: "Samples", processing: "Processing", results: "Results ready", reports: "Reports", cancelled: "Cancelled", all: "All" };

export default async function LabPage({ searchParams }: { searchParams: Promise<{ tab?: string; q?: string; priority?: string; page?: string }> }) {
  const ctx = await requireTenantPagePermission("tests.view");
  const sp = await searchParams;
  const tab = sp.tab && sp.tab in TABS ? sp.tab : "new";
  let data, stats;
  try { [data, stats] = await Promise.all([listLabOrders(ctx, { tab, q: sp.q, priority: sp.priority, page: Math.max(1, Number(sp.page) || 1) }), labStats(ctx)]); } catch (e) {
    if (e instanceof AppError) return <Card className="mx-auto max-w-xl"><EmptyState title="Laboratory isn't available to your role" description={e.message} /></Card>;
    throw e;
  }
  const isDoctor = ctx.user.role === "DOCTOR";
  const href = (over: Record<string, string | undefined>) => `/lab?${new URLSearchParams(Object.entries({ tab, q: sp.q, priority: sp.priority, ...over }).filter(([, v]) => v) as [string, string][])}`;
  const tiles: [string, number, string][] = isDoctor
    ? [["Awaiting your review", stats.awaitingDoctorReview, "reports"], ["Samples & processing", stats.collected + stats.processing, "collected"], ["New orders", stats.newOrders, "new"], ["Urgent / STAT open", stats.urgent, "all"]]
    : [["New orders", stats.newOrders, "new"], ["Samples", stats.collected, "collected"], ["Processing", stats.processing, "processing"], ["Results ready", stats.resultsReady, "results"], ["Awaiting release", stats.awaitingRelease, "results"], ["Urgent / STAT open", stats.urgent, "all"], ["Rejected today", stats.rejectedSamples, "all"], ["Completed today", stats.completedToday, "reports"]];
  const columns: Column<Row>[] = [
    { key: "no", header: "Order", cell: (r) => <Link href={`/lab/orders/${r.id}`} className="font-semibold tabular-nums">{r.orderNumber}</Link> },
    { key: "pri", header: "Priority", cell: (r) => <Badge tone={PRIORITY_TONE[r.priority]}>{PRIORITY_LABEL[r.priority]}</Badge> },
    { key: "patient", header: "Patient", cell: (r) => (r.patient ? `${r.patient.name} · ${r.patient.code}` : "—") },
    { key: "tests", header: "Tests", cell: (r) => <span title={r.tests.join(", ")}>{r.tests.slice(0, 2).join(", ")}{r.testCount > 2 ? ` +${r.testCount - 2}` : ""}</span>, hideOnMobile: true },
    { key: "doc", header: "Doctor", cell: (r) => r.doctorName ?? "—", hideOnMobile: true },
    { key: "at", header: "Ordered", cell: (r) => <span className="tabular-nums">{fmt(r.orderedAt)}</span>, hideOnMobile: true },
    { key: "st", header: "Status", cell: (r) => <StatusBadge tone={ORDER_STATUS_TONE[r.status]}>{ORDER_STATUS_LABEL[r.status]}</StatusBadge> },
    { key: "open", header: "Open", align: "right", cell: (r) => <ButtonLink href={isDoctor && r.report && ["RELEASED", "AMENDED"].includes(r.report.status) ? `/lab/reports/${r.report.id}` : `/lab/orders/${r.id}`} size="sm" variant="outline" aria-label={`Open order ${r.orderNumber}`}>Open</ButtonLink> },
  ];
  return (
    <div className="space-y-section">
      <div><h1 className="type-page-title">Laboratory</h1><p className="type-secondary mt-1">{isDoctor ? "Investigations you ordered and their reports." : "Investigation orders, samples, results and reports. Counts come straight from the clinic's records."}</p></div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" role="list" aria-label="Laboratory summary">
        {tiles.map(([label, n, t]) => <Link key={label} href={href({ tab: t, page: undefined })} role="listitem" className="rounded-lg border border-line bg-surface p-3 no-underline hover:bg-surface-muted"><p className="type-caption">{label}</p><p className="type-page-title tabular-nums">{n}</p></Link>)}
      </div>
      <nav aria-label="Worklist sections" className="-mx-page flex gap-1 overflow-x-auto px-page">
        {Object.keys(TABS).map((k) => <Link key={k} href={href({ tab: k, page: undefined })} aria-current={tab === k ? "page" : undefined} className={`type-label flex min-h-control shrink-0 items-center whitespace-nowrap rounded-md border px-3 no-underline ${tab === k ? "border-primary bg-primary-soft !text-primary" : "border-transparent hover:bg-surface-muted"}`}>{TAB_LABEL[k]}</Link>)}
      </nav>
      <form method="get" action="/lab" className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="tab" value={tab} />
        <Field label="Search" hint="Order number, patient name or ID"><input name="q" defaultValue={sp.q ?? ""} maxLength={60} className="type-body min-h-control w-full min-w-56 rounded-md border border-line-strong bg-surface px-3" /></Field>
        <Field label="Priority"><Select name="priority" defaultValue={sp.priority ?? ""} placeholder="All priorities" options={Object.entries(PRIORITY_LABEL).map(([value, label]) => ({ value, label }))} /></Field>
        <button className="type-button min-h-control rounded-md border border-line-strong px-4 hover:bg-surface-muted" type="submit">Apply</button>
      </form>
      <Card className="overflow-hidden"><DataTable caption={`${TAB_LABEL[tab]} lab orders`} columns={columns} rows={data.rows} rowKey={(r) => r.id} empty={{ title: "No orders here", description: sp.q || sp.priority ? "Nothing matches your filters." : "Nothing is waiting in this list." }} /></Card>
      <Pagination page={data.page} pageCount={Math.max(1, Math.ceil(data.total / data.pageSize))} hrefFor={(p) => href({ page: String(p) })} />
    </div>
  );
}
