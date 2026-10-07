import type { Metadata } from "next";
import Link from "next/link";
import { Phone } from "lucide-react";
import { Badge, ButtonLink, Card, CardBody, CardHeader, EmptyState, Field, Pagination, Select, StatusBadge } from "@/components/ui";
import { NewFollowUpButton } from "@/components/followups/new-followup-button";
import { RecallsPanel } from "@/components/followups/recalls-panel";
import { PRIORITY_LABEL, PRIORITY_TONE, SOURCE_LABEL, STATUS_LABEL, STATUS_TONE, TYPE_LABEL, dueText, pretty } from "@/components/followups/followup-ui";
import { requireTenantPagePermission } from "@/lib/auth/context";
import { AppError } from "@/lib/errors";
import { assignableUsers, followUpStats, FU_TABS, listFollowUps, type FollowUpRow } from "@/lib/services/followups";
import { tenantDb } from "@/lib/tenant/db";

export const metadata: Metadata = { title: "Follow-ups" };
export const dynamic = "force-dynamic";
const TAB_LABEL: Record<string, string> = { all: "All open", today: "Today", due: "Due", overdue: "Overdue", upcoming: "Upcoming", completed: "Completed", cancelled: "Cancelled", recalls: "Recalls" };
type SP = { tab?: string; q?: string; doctorId?: string; assignedTo?: string; priority?: string; type?: string; status?: string; source?: string; date?: string; page?: string };

export default async function FollowUpsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireTenantPagePermission("followups.view");
  const sp = await searchParams;
  const tab = sp.tab === "recalls" ? "recalls" : sp.tab && (FU_TABS as readonly string[]).includes(sp.tab) ? sp.tab : "all";
  const canRecalls = ctx.permissions.has("recalls.manage");
  let stats, data = null;
  try {
    stats = await followUpStats(ctx);
    if (tab !== "recalls") data = await listFollowUps(ctx, { ...sp, tab, page: Math.max(1, Number(sp.page) || 1) });
  } catch (e) {
    if (e instanceof AppError) return <Card className="mx-auto max-w-xl"><EmptyState title="Follow-ups aren't available to your role" description={e.message} /></Card>;
    throw e;
  }
  const tdb = tenantDb(ctx);
  const [doctors, staff] = await Promise.all([tdb.user.findMany({ where: { role: { key: "DOCTOR" }, status: "ACTIVE", deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }), assignableUsers(ctx).then((r) => r.users).catch(() => [])]);
  const href = (over: Record<string, string | undefined>) => `/followups?${new URLSearchParams(Object.entries({ tab, q: sp.q, doctorId: sp.doctorId, assignedTo: sp.assignedTo, priority: sp.priority, type: sp.type, status: sp.status, source: sp.source, date: sp.date, ...over }).filter(([, v]) => v) as [string, string][])}`;
  const doctor = ctx.user.role === "DOCTOR";
  const tiles: [string, number, string][] = [["Due today", stats.dueToday, "today"], ["Overdue", stats.overdue, "overdue"], ["Due tomorrow", stats.dueTomorrow, "upcoming"], ["Upcoming", stats.upcoming, "upcoming"], ["No response", stats.noResponse, "all"], ["Appointment booked", stats.booked, "all"], ["Completed today", stats.completedToday, "completed"], ...(canRecalls ? [["Recalls due", stats.recallDue, "recalls"] as [string, number, string]] : [])];
  const tileStatus: Record<string, string | undefined> = { "No response": "NO_RESPONSE", "Appointment booked": "APPOINTMENT_BOOKED" };
  return (
    <div className="space-y-section">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h1 className="type-page-title">Follow-up command center</h1><p className="type-secondary mt-1">{doctor ? "Your patients' follow-ups." : "Contact patients, book follow-up visits and close the loop. Counts come straight from the clinic's records."}</p></div>
        {ctx.permissions.has("followups.create") && <NewFollowUpButton canClinical={ctx.permissions.has("patients.clinical")} />}
      </div>
      <section aria-label="Follow-up summary" className="grid grid-cols-2 gap-3 sm:grid-cols-4" role="list">
        {tiles.map(([label, n, t]) => <Link key={label} role="listitem" href={href({ tab: t, status: tileStatus[label], page: undefined })} className="rounded-lg border border-line bg-surface p-3 no-underline hover:bg-surface-muted"><p className="type-caption">{label}</p><p className={`type-page-title tabular-nums ${label === "Overdue" && n > 0 ? "text-danger" : ""}`}>{n}</p></Link>)}
      </section>
      {(ctx.permissions.has("followups.configure") || doctor) && (
        <Card><CardHeader title="Retention at a glance" description="Operational counts for the last 30 days. They are not quality scores." /><CardBody>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4"><M label="Created" v={stats.retention.created30} /><M label="Completed" v={stats.retention.completed30} /><M label="Reschedules" v={stats.retention.reschedules30} /><M label="No-show follow-ups open" v={stats.retention.noShowOpen} /></dl>
          {doctor && <p className="type-secondary mt-3">Reports waiting for your review: <Link href="/lab?tab=reports" className="font-semibold">{stats.pendingReportReviews}</Link></p>}
        </CardBody></Card>
      )}
      <nav aria-label="Follow-up lists" className="-mx-page flex gap-1 overflow-x-auto px-page">
        {[...FU_TABS, ...(canRecalls ? ["recalls"] : [])].map((k) => <Link key={k} href={href({ tab: k, status: undefined, page: undefined })} aria-current={tab === k ? "page" : undefined} className={`type-label flex min-h-control shrink-0 items-center whitespace-nowrap rounded-md border px-3 no-underline ${tab === k ? "border-primary bg-primary-soft !text-primary" : "border-transparent hover:bg-surface-muted"}`}>{TAB_LABEL[k]}</Link>)}
      </nav>
      {tab === "recalls" ? <RecallsPanel canCreateFollowUp={ctx.permissions.has("followups.create")} /> : data && (
        <>
          <form method="get" action="/followups" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Filter follow-ups">
            <input type="hidden" name="tab" value={tab} />
            <Field label="Search" hint="Name, ID, mobile, FU number or title"><input name="q" defaultValue={sp.q ?? ""} maxLength={60} className="type-body min-h-control w-full rounded-md border border-line-strong bg-surface px-3" /></Field>
            <Field label="Doctor"><Select name="doctorId" defaultValue={sp.doctorId ?? ""} placeholder="All doctors" options={doctors.map((d: { id: string; name: string }) => ({ value: d.id, label: d.name }))} /></Field>
            <Field label="Assigned to"><Select name="assignedTo" defaultValue={sp.assignedTo ?? ""} placeholder="Anyone" options={[{ value: "me", label: "Me" }, { value: "unassigned", label: "Unassigned" }, ...staff.map((u) => ({ value: u.id, label: u.name }))]} /></Field>
            <Field label="Status"><Select name="status" defaultValue={sp.status ?? ""} placeholder="Any status" options={Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label }))} /></Field>
            <Field label="Priority"><Select name="priority" defaultValue={sp.priority ?? ""} placeholder="Any priority" options={Object.entries(PRIORITY_LABEL).map(([value, label]) => ({ value, label }))} /></Field>
            <Field label="Type"><Select name="type" defaultValue={sp.type ?? ""} placeholder="Any type" options={Object.entries(TYPE_LABEL).map(([value, label]) => ({ value, label }))} /></Field>
            <Field label="Source"><Select name="source" defaultValue={sp.source ?? ""} placeholder="Any source" options={Object.entries(SOURCE_LABEL).map(([value, label]) => ({ value, label }))} /></Field>
            <Field label="Due date"><input type="date" name="date" defaultValue={sp.date ?? ""} className="type-body min-h-control w-full rounded-md border border-line-strong bg-surface px-3" /></Field>
            <div className="flex items-end gap-2"><button type="submit" className="type-button min-h-control rounded-md border border-line-strong px-4 hover:bg-surface-muted">Apply filters</button><Link href={`/followups?tab=${tab}`} className="type-label min-h-control content-center px-2">Clear</Link></div>
          </form>
          {!data.rows.length ? <Card><EmptyState title={EMPTY[tab] ?? "No follow-ups"} description={sp.q || sp.doctorId || sp.priority || sp.type || sp.status ? "Nothing matches your filters." : undefined} /></Card> : (
            <>
              <Card className="hidden overflow-hidden md:block"><table className="w-full text-left"><caption className="sr-only">Follow-ups</caption>
                <thead><tr className="type-caption border-b border-line bg-surface-muted"><th className="p-3">Patient</th><th className="p-3">Follow-up</th><th className="p-3">Doctor</th><th className="p-3">Due</th><th className="p-3">Priority</th><th className="p-3">Assigned to</th><th className="p-3">Status</th><th className="p-3 text-right">Action</th></tr></thead>
                <tbody>{data.rows.map((r) => <Row key={r.id} r={r} />)}</tbody></table></Card>
              <ul className="space-y-3 md:hidden" aria-label="Follow-ups">{data.rows.map((r) => <Cardlet key={r.id} r={r} />)}</ul>
            </>
          )}
          <Pagination page={data.page} pageCount={Math.max(1, Math.ceil(data.total / data.pageSize))} hrefFor={(p) => href({ page: String(p) })} />
        </>
      )}
    </div>
  );
}
const EMPTY: Record<string, string> = { today: "No follow-ups due today.", overdue: "No overdue follow-ups.", upcoming: "No upcoming follow-ups.", due: "No follow-ups are due.", completed: "No completed follow-ups.", cancelled: "No cancelled follow-ups.", all: "No open follow-ups." };
const M = ({ label, v }: { label: string; v: number }) => <div><dt className="type-caption">{label}</dt><dd className="type-card-title tabular-nums">{v}</dd></div>;
const openRow = (r: FollowUpRow) => !["COMPLETED", "PATIENT_DECLINED", "CANCELLED", "EXPIRED"].includes(r.status);
function Actions({ r }: { r: FollowUpRow }) {
  return <div className="flex flex-wrap justify-end gap-1.5"><ButtonLink href={`/followups/${r.id}`} size="sm" variant="outline" aria-label={`View ${r.followUpNumber}`}>View</ButtonLink>
    {openRow(r) && <><ButtonLink href={`/followups/${r.id}?do=contact`} size="sm" variant="ghost" aria-label={`Contact for ${r.followUpNumber}`}>Contact</ButtonLink><ButtonLink href={`/followups/${r.id}?do=book`} size="sm" variant="ghost" aria-label={`Book for ${r.followUpNumber}`}>Book</ButtonLink><ButtonLink href={`/followups/${r.id}?do=reschedule`} size="sm" variant="ghost" aria-label={`Reschedule ${r.followUpNumber}`}>Reschedule</ButtonLink><ButtonLink href={`/followups/${r.id}?do=complete`} size="sm" variant="ghost" aria-label={`Complete ${r.followUpNumber}`}>Complete</ButtonLink></>}</div>;
}
function Row({ r }: { r: FollowUpRow }) {
  return (
    <tr className="border-b border-line align-top last:border-0">
      <td className="p-3"><p className="type-label">{r.patient?.name ?? "—"}</p><p className="type-caption tabular-nums">{r.patient?.code}</p></td>
      <td className="p-3"><p className="type-label"><Link href={`/followups/${r.id}`}>{r.title}</Link></p><p className="type-caption"><span className="tabular-nums">{r.followUpNumber}</span> · {TYPE_LABEL[r.type]}</p></td>
      <td className="p-3 type-secondary">{r.doctorName ?? "—"}</td>
      <td className={`p-3 type-secondary ${r.overdueDays > 0 ? "font-semibold text-danger" : ""}`}>{dueText(r.dueDate, r.overdueDays)}</td>
      <td className="p-3"><Badge tone={PRIORITY_TONE[r.priority]}>{PRIORITY_LABEL[r.priority]}</Badge></td>
      <td className="p-3 type-secondary">{r.assignedTo?.name ?? "Unassigned"}</td>
      <td className="p-3"><StatusBadge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</StatusBadge>{r.visitCompleted && <p className="type-caption">Visit done</p>}</td>
      <td className="p-3"><Actions r={r} /></td>
    </tr>
  );
}
function Cardlet({ r }: { r: FollowUpRow }) {
  return (
    <li className="space-y-2 rounded-lg border border-line bg-surface p-3">
      <div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="type-label">{r.patient?.name ?? "—"} <span className="type-caption tabular-nums">{r.patient?.code}</span></p><p className="type-secondary"><Link href={`/followups/${r.id}`}>{r.title}</Link></p></div><StatusBadge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</StatusBadge></div>
      <p className={`type-caption ${r.overdueDays > 0 ? "font-semibold text-danger" : ""}`}>Due {dueText(r.dueDate, r.overdueDays)} · <Badge tone={PRIORITY_TONE[r.priority]}>{PRIORITY_LABEL[r.priority]}</Badge> · {pretty(r.type)}</p>
      <div className="flex flex-wrap gap-1.5">
        {openRow(r) && r.patient?.phone && <a href={`tel:${r.patient.phone}`} className="type-button inline-flex min-h-control items-center gap-1.5 rounded-md border border-line-strong px-3 !text-ink no-underline"><Phone aria-hidden className="size-4" />Call</a>}
        <Actions r={r} />
      </div>
    </li>
  );
}
