"use client";

import * as React from "react";
import Link from "next/link";
import { Activity, BarChart3, Building2, IndianRupee, Server } from "lucide-react";
import { Badge, Card, CardBody, CardHeader, ErrorState, LoadingState, PageHeader, Select, StatCard, Table, TBody, TD, TH, THead, TR } from "@/components/ds";
import { apiFetch } from "@/lib/client-api";
import { formatINR, formatNumber } from "@/lib/catalog";
import { MiniBars, fmtPct } from "@/components/app/mini-bars";

type Data = {
  range: { days: number; labels: string[] };
  clients: { total: number; active: number; suspended: number; withPlan: number; withoutPlan: number; growth: { month: string; newClients: number; totalClients: number }[]; onboarding: { connectedNumber: number; sentMessages: number; launchedCampaign: number; activeAutomation: number } };
  revenue: { thisMonth: number; lastMonth: number; last12Months: number; byMonth: { month: string; revenue: number }[]; mrr: { contracted: number; invoiced: number; complimentary: number }; subscriptions: { active: number; invoiced: number; new30d: number; canceled30d: number }; receivables: { open: number; overdue: number }; arpa: number };
  usage: { series: Record<string, number[]>; totals: Record<string, number>; topClients: { id: string; name: string; messages: number }[] };
  system: {
    platform: { clients: number; contacts: number; messages: number; conversations: number };
    webhooks: { delivered: number; failed: number; pending: number; successRate: number | null; dueNow: number };
    api: { requests: number; clientErrors: number; serverErrors: number; rateLimited: number };
    metaEvents: { processed: number; ignored: number; failed: number };
    failedMessages: number;
    automation: { completed: number; failed: number; activeNow: number };
    campaignsSending: number;
  };
};
const METRICS: [string, string, string][] = [
  ["messages_sent", "Messages sent", "bg-app-primary"],
  ["contacts_created", "New contacts", "bg-sky-400"],
  ["ai_replies", "AI replies", "bg-violet-400"],
  ["api_calls", "API requests", "bg-amber-400"],
  ["campaigns_launched", "Campaigns launched", "bg-rose-400"],
];

export default function AdminAnalyticsPage() {
  const [days, setDays] = React.useState("30");
  const [data, setData] = React.useState<Data | null>(null);
  const [error, setError] = React.useState("");
  const load = React.useCallback(async () => {
    const r = await apiFetch<Data>(`/api/admin/analytics?days=${days}`);
    if (!r.ok) return setError(r.error);
    setError("");
    setData(r.data);
  }, [days]);
  React.useEffect(() => {
    const t = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(t);
  }, [load]);
  const header = (
    <PageHeader
      title="Analytics"
      description="Client growth, revenue, usage and the health of the platform."
      breadcrumb={[{ label: "Admin", href: "/admin" }, { label: "Analytics" }]}
      actions={<Select aria-label="Period" value={days} onChange={(e) => setDays(e.target.value)} className="h-9 w-36 text-small"><option value="14">Last 14 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option></Select>}
    />
  );
  if (error) return (<>{header}<ErrorState description={error} onRetry={load} /></>);
  if (!data) return (<>{header}<LoadingState /></>);
  const d = data;
  const funnel = [
    ["Clients", d.clients.total],
    ["Connected a number", d.clients.onboarding.connectedNumber],
    ["Sent a message", d.clients.onboarding.sentMessages],
    ["Launched a campaign", d.clients.onboarding.launchedCampaign],
    ["Has an active automation", d.clients.onboarding.activeAutomation],
  ] as [string, number][];
  return (
    <>
      {header}
      <h2 className="mb-2 flex items-center gap-2 text-h4 font-semibold text-app-text"><Building2 className="size-4" aria-hidden="true" /> Client growth</h2>
      <section aria-label="Clients" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Clients" value={formatNumber(d.clients.total)} icon={Building2} hint={`${d.clients.active} active · ${d.clients.suspended} suspended`} />
        <StatCard label="With a plan" value={formatNumber(d.clients.withPlan)} icon={BarChart3} hint={`${d.clients.withoutPlan} without a plan`} />
        <StatCard label="New subscriptions (30 d)" value={formatNumber(d.revenue.subscriptions.new30d)} icon={Activity} hint={`${d.revenue.subscriptions.canceled30d} cancelled`} />
        <StatCard label="Active subscriptions" value={formatNumber(d.revenue.subscriptions.active)} icon={IndianRupee} hint={`${d.revenue.subscriptions.invoiced} invoiced`} />
      </section>
      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="New clients per month" description="Last 12 months" />
          <CardBody>
            <MiniBars labels={d.clients.growth.map((g) => g.month)} series={[{ name: "New clients", values: d.clients.growth.map((g) => g.newClients), className: "bg-app-primary" }]} ariaLabel="New clients per month" />
            <p className="mt-2 text-caption text-app-subtle">Total clients now: {d.clients.growth.at(-1)?.totalClients}</p>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Onboarding funnel" description="How far clients get" />
          <CardBody className="space-y-2">
            {funnel.map(([label, n]) => (
              <div key={label}>
                <p className="flex justify-between text-small"><span className="text-app-muted">{label}</span><span className="tabular-nums text-app-text">{n}{d.clients.total ? <span className="text-app-subtle"> · {Math.round((n / d.clients.total) * 100)}%</span> : null}</span></p>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-app-elevated" aria-hidden="true"><div className="h-full bg-app-primary" style={{ width: `${d.clients.total ? (n / d.clients.total) * 100 : 0}%` }} /></div>
              </div>
            ))}
          </CardBody>
        </Card>
      </div>

      <h2 className="mb-2 mt-8 flex items-center gap-2 text-h4 font-semibold text-app-text"><IndianRupee className="size-4" aria-hidden="true" /> Revenue</h2>
      <section aria-label="Revenue" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Collected this month" value={formatINR(d.revenue.thisMonth)} icon={IndianRupee} hint={`Last month ${formatINR(d.revenue.lastMonth)}`} />
        <StatCard label="MRR (contracted)" value={formatINR(d.revenue.mrr.contracted)} icon={BarChart3} hint={`${formatINR(d.revenue.mrr.invoiced)} invoiced`} />
        <StatCard label="Revenue per invoiced client" value={formatINR(d.revenue.arpa)} icon={Building2} hint="Monthly" />
        <StatCard label="Unpaid" value={formatINR(d.revenue.receivables.open)} icon={Activity} hint={`${formatINR(d.revenue.receivables.overdue)} overdue`} />
      </section>
      <Card className="mt-4">
        <CardHeader title="Collected revenue by month" description="Paid invoices only — promised money isn't counted" action={<Link href="/admin/billing" className="text-small underline-offset-4 hover:underline">Billing &amp; Plans</Link>} />
        <CardBody>
          <MiniBars labels={d.revenue.byMonth.map((m) => m.month)} series={[{ name: "Collected (₹)", values: d.revenue.byMonth.map((m) => Math.round(m.revenue / 100)), className: "bg-app-primary" }]} ariaLabel="Collected revenue by month" />
        </CardBody>
      </Card>

      <h2 className="mb-2 mt-8 flex items-center gap-2 text-h4 font-semibold text-app-text"><BarChart3 className="size-4" aria-hidden="true" /> Usage</h2>
      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {METRICS.map(([k, label, cls]) => (
          <Card key={k}>
            <CardHeader title={label} description={`${formatNumber(d.usage.totals[k] ?? 0)} in the last ${d.range.days} days`} />
            <CardBody>
              <MiniBars labels={d.range.labels} series={[{ name: label, values: d.usage.series[k] ?? [], className: cls }]} height={80} ariaLabel={`${label} per day`} />
            </CardBody>
          </Card>
        ))}
        <Card>
          <CardHeader title="Top clients by messages" description="This month" />
          <Table caption="Top clients" className="min-w-0">
            <THead>
              <tr>
                <TH>Client</TH>
                <TH className="text-right">Messages</TH>
              </tr>
            </THead>
            <TBody>
              {d.usage.topClients.map((c) => (
                <TR key={c.id}>
                  <TD><Link href={`/admin/clients/${c.id}`} className="hover:text-app-primary-hover">{c.name}</Link></TD>
                  <TD className="text-right tabular-nums">{formatNumber(c.messages)}</TD>
                </TR>
              ))}
              {!d.usage.topClients.length ? <TR><TD className="text-app-subtle" colSpan={2}>No metered messages this month.</TD></TR> : null}
            </TBody>
          </Table>
        </Card>
      </div>

      <h2 className="mb-2 mt-8 flex items-center gap-2 text-h4 font-semibold text-app-text"><Server className="size-4" aria-hidden="true" /> System usage</h2>
      <section aria-label="System" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Messages stored" value={formatNumber(d.system.platform.messages)} icon={Server} hint={`${formatNumber(d.system.platform.conversations)} conversations · ${formatNumber(d.system.platform.contacts)} contacts`} />
        <StatCard label="Webhook delivery success" value={fmtPct(d.system.webhooks.successRate)} icon={Activity} hint={`${d.system.webhooks.delivered} delivered · ${d.system.webhooks.failed} failed · ${d.system.webhooks.pending} retrying`} />
        <StatCard label="API requests" value={formatNumber(d.system.api.requests)} icon={Activity} hint={`${d.system.api.clientErrors} client errors · ${d.system.api.serverErrors} server errors · ${d.system.api.rateLimited} rate limited`} />
        <StatCard label="Failed live messages" value={formatNumber(d.system.failedMessages)} icon={Activity} hint={`Last ${d.range.days} days, real numbers only`} />
      </section>
      <Card className="mt-4">
        <CardHeader title="Queues and processing" />
        <CardBody className="grid gap-3 text-small sm:grid-cols-2 xl:grid-cols-4">
          <p><span className="text-app-muted">Webhooks due for retry now: </span><Badge tone={d.system.webhooks.dueNow ? "warning" : "success"}>{d.system.webhooks.dueNow}</Badge></p>
          <p><span className="text-app-muted">Automation runs in flight: </span><Badge tone="neutral">{d.system.automation.activeNow}</Badge></p>
          <p><span className="text-app-muted">Campaigns sending: </span><Badge tone="neutral">{d.system.campaignsSending}</Badge></p>
          <p><span className="text-app-muted">Meta webhook events: </span>{d.system.metaEvents.processed} processed · {d.system.metaEvents.ignored} ignored · <span className={d.system.metaEvents.failed ? "text-red-300" : ""}>{d.system.metaEvents.failed} failed</span></p>
          <p><span className="text-app-muted">Automation runs: </span>{d.system.automation.completed} completed · <span className={d.system.automation.failed ? "text-red-300" : ""}>{d.system.automation.failed} failed</span></p>
        </CardBody>
      </Card>
    </>
  );
}
