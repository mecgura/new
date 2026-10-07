import type { Metadata } from "next";
import Link from "next/link";
import {
  Activity,
  Building2,
  CheckCircle2,
  IndianRupee,
  Megaphone,
  MessageCircle,
  MessagesSquare,
  Phone,
  Plus,
  ServerCog,
  UserPlus,
} from "lucide-react";
import { db } from "@/lib/db";
import { describeAction } from "@/lib/audit";
import { formatINR, formatNumber, ACTIVE_NUMBER_STATUSES } from "@/lib/catalog";
import { isEmailConfigured } from "@/lib/mailer";
import { mrrAt } from "@/lib/services/clients";
import { dayKey, monthPrefix } from "@/lib/services/usage";
import { Avatar, Badge, Card, CardBody, CardHeader, EmptyState, PageHeader, StatCard, buttonVariants } from "@/components/ds";
import { ActivityChart, type DayCount } from "@/components/app/activity-chart";

export const metadata: Metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

const TZ = "Asia/Kolkata";
const dayLabel = new Intl.DateTimeFormat("en-IN", { timeZone: TZ, day: "numeric", month: "short" });
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dateTime = new Intl.DateTimeFormat("en-IN", { timeZone: TZ, day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const dateOnly = new Intl.DateTimeFormat("en-IN", { timeZone: TZ, day: "numeric", month: "short", year: "numeric" });

/** Time windows computed once per request (kept out of render for purity). */
function windows() {
  const now = new Date();
  const days = Array.from({ length: 14 }, (_, i) => new Date(now.getTime() - (13 - i) * 86_400_000));
  // End of each of the last 6 IST calendar months (current month = now).
  const IST_OFFSET = 330 * 60_000;
  const ist = new Date(now.getTime() + IST_OFFSET);
  const months = Array.from({ length: 6 }, (_, i) => {
    const back = 5 - i;
    const y = ist.getUTCFullYear();
    const m = ist.getUTCMonth() - back;
    const at = back === 0 ? now : new Date(Date.UTC(y, m + 1, 1) - IST_OFFSET - 1);
    return { at, label: MONTHS[((m % 12) + 12) % 12] };
  });
  return { now, days, months };
}

async function systemStatus() {
  const t0 = performance.now();
  let dbOk = true;
  try {
    await db.$queryRawUnsafe("SELECT 1");
  } catch {
    dbOk = false;
  }
  return { dbOk, dbMs: Math.round(performance.now() - t0), email: isEmailConfigured() };
}

export default async function AdminDashboardPage() {
  const { now, days, months } = windows();
  const [totalClients, activeClients, numbersRegistered, numbersConnected, messageRows, leadRows, mrr, status, recentLogs, recentClients] =
    await Promise.all([
      db.organization.count(),
      db.organization.count({ where: { status: "active" } }),
      db.whatsAppAccount.count({ where: { status: { in: ACTIVE_NUMBER_STATUSES } } }),
      db.whatsAppAccount.count({ where: { status: "connected" } }),
      db.usageCounter.groupBy({ by: ["day"], where: { metric: "messages_sent", day: { gte: dayKey(days[0]) } }, _sum: { value: true } }),
      db.usageCounter.aggregate({ where: { metric: "contacts_created", day: { startsWith: monthPrefix(now) } }, _sum: { value: true } }),
      mrrAt(now),
      systemStatus(),
      db.auditLog.findMany({
        orderBy: { createdAt: "desc" },
        take: 8,
        select: { id: true, action: true, createdAt: true, actor: { select: { name: true, email: true } }, organization: { select: { name: true } } },
      }),
      db.organization.findMany({
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { id: true, name: true, status: true, createdAt: true, subscriptions: { where: { status: "active" }, take: 1, select: { plan: { select: { name: true } } } } },
      }),
    ]);

  const messagesByDay = new Map(messageRows.map((r) => [r.day, r._sum.value ?? 0]));
  const messageSeries: DayCount[] = days.map((d) => ({ date: dayKey(d), label: dayLabel.format(d), count: messagesByDay.get(dayKey(d)) ?? 0 }));
  const messagesThisMonth = messageRows.filter((r) => r.day.startsWith(monthPrefix(now))).reduce((s, r) => s + (r._sum.value ?? 0), 0);

  const growthSeries: DayCount[] = await Promise.all(
    months.map(async (m) => ({ date: m.at.toISOString(), label: m.label, count: await db.organization.count({ where: { createdAt: { lte: m.at } } }) }))
  );
  const revenueSeries: DayCount[] = await Promise.all(months.map(async (m) => ({ date: m.at.toISOString(), label: m.label, count: await mrrAt(m.at) })));

  const healthy = status.dbOk;

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="MECGURA platform overview"
        actions={
          <Link href="/admin/clients/new" className={buttonVariants({ variant: "primary" })}>
            <Plus aria-hidden="true" /> Add client
          </Link>
        }
      />

      <section aria-label="Platform metrics" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total clients" value={formatNumber(totalClients)} icon={Building2} />
        <StatCard label="Active clients" value={formatNumber(activeClients)} icon={CheckCircle2} hint={`${totalClients - activeClients} suspended`} />
        <StatCard label="WhatsApp numbers" value={formatNumber(numbersRegistered)} icon={Phone} hint={`${numbersConnected} connected · connection ships in the WhatsApp phase`} />
        <StatCard label="Messages this month" value={formatNumber(messagesThisMonth)} icon={MessagesSquare} hint="Metered once numbers are connected" />
        <StatCard label="Leads this month" value={formatNumber(leadRows._sum.value ?? 0)} icon={UserPlus} hint="Metered by the CRM module" />
        <StatCard label="Active campaigns" value={null} icon={Megaphone} source="coming-soon" />
        <StatCard label="Revenue (MRR)" value={formatINR(mrr)} icon={IndianRupee} hint="From assigned plans of active clients — not payments collected" />
        <StatCard
          label="System status"
          value={<span className={healthy ? "text-green-300" : "text-red-300"}>{healthy ? "Operational" : "Degraded"}</span>}
          icon={ServerCog}
          hint={`Database ${status.dbOk ? `OK (${status.dbMs} ms)` : "unreachable"} · Email ${status.email ? "configured" : "not configured"} · WhatsApp API not configured`}
        />
      </section>

      <div className="mt-6 grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-3">
          <CardHeader title="Message volume" description="Messages sent across all clients — last 14 days" />
          <CardBody>
            {messageSeries.every((d) => d.count === 0) ? (
              <EmptyState icon={MessageCircle} title="No messages yet" description="Volume appears here once client numbers are connected in the WhatsApp phase." className="py-8" />
            ) : (
              <ActivityChart data={messageSeries} title="Messages sent, last 14 days" unit={["message", "messages"]} />
            )}
          </CardBody>
        </Card>
        <Card className="xl:col-span-1">
          <CardHeader title="Client growth" description="Total clients at month end" />
          <CardBody>
            <ActivityChart data={growthSeries} title="Total clients by month" unit={["client", "clients"]} />
          </CardBody>
        </Card>
        <Card className="xl:col-span-2">
          <CardHeader title="Revenue" description="Monthly recurring revenue from assigned plans" action={<Badge tone="neutral">Not payments</Badge>} />
          <CardBody>
            <ActivityChart data={revenueSeries} title="MRR by month" kind="inr" />
          </CardBody>
        </Card>
      </div>

      <div className="mt-6 grid gap-4 xl:grid-cols-5">
        <Card className="xl:col-span-3">
          <CardHeader title="Recent activity" action={<Link href="/admin/audit-logs" className="text-small text-app-primary hover:text-app-primary-hover">View all</Link>} />
          {recentLogs.length === 0 ? (
            <EmptyState icon={Activity} title="No activity yet" className="py-8" />
          ) : (
            <ul className="divide-y divide-app-border">
              {recentLogs.map((r) => (
                <li key={r.id} className="flex items-center gap-3 px-5 py-3">
                  <Avatar name={r.actor?.name ?? r.actor?.email ?? "?"} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-body text-app-text">
                      {describeAction(r.action)}
                      {r.organization ? <span className="text-app-muted"> · {r.organization.name}</span> : null}
                    </p>
                    <p className="truncate text-caption text-app-subtle">{r.actor?.name ?? r.actor?.email ?? "Anonymous"}</p>
                  </div>
                  <time dateTime={r.createdAt.toISOString()} className="shrink-0 text-caption text-app-subtle">
                    {dateTime.format(r.createdAt)}
                  </time>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="xl:col-span-2">
          <CardHeader title="Recent clients" action={<Link href="/admin/clients" className="text-small text-app-primary hover:text-app-primary-hover">View all</Link>} />
          {recentClients.length === 0 ? (
            <EmptyState icon={Building2} title="No clients yet" action={<Link href="/admin/clients/new" className={buttonVariants({ size: "sm" })}>Add client</Link>} className="py-8" />
          ) : (
            <ul className="divide-y divide-app-border">
              {recentClients.map((c) => (
                <li key={c.id}>
                  <Link href={`/admin/clients/${c.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-app-hover/60">
                    <Avatar name={c.name} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-body text-app-text">{c.name}</p>
                      <p className="truncate text-caption text-app-subtle">
                        {c.subscriptions[0]?.plan.name ?? "No plan"} · {dateOnly.format(c.createdAt)}
                      </p>
                    </div>
                    <Badge tone={c.status === "active" ? "success" : "danger"} dot>
                      {c.status === "active" ? "Active" : "Suspended"}
                    </Badge>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
