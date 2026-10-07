"use client";

import * as React from "react";
import { BarChart3, Bot, Megaphone, MessageSquare, Users, Workflow } from "lucide-react";
import { Alert, Badge, Card, CardBody, CardHeader, EmptyState, ErrorState, LoadingState, PageHeader, Select, Table, TBody, TD, TH, THead, TR } from "@/components/ds";
import { apiFetch } from "@/lib/client-api";
import { formatNumber } from "@/lib/catalog";
import { MiniBars, fmtDuration, fmtPct } from "@/components/app/mini-bars";

type Daily = { date: string; count: number };
type Data = {
  range: { days: number; from: string; to: string; numberId: string | null };
  truncated: boolean;
  messages: { inbound: number; outbound: number; daily: { date: string; inbound: number; outbound: number }[] };
  delivery: { pending: number; sent: number; delivered: number; read: number; failed: number; accepted: number; deliveryRate: number | null; readRate: number | null; failureRate: number | null };
  conversations: { started: number; openNow: number; unassignedOpen: number; closed: number; active: number; dailyStarted: Daily[] };
  response: { conversationsWithCustomerMessage: number; answered: number; responseRate: number | null; medianFirstResponseSec: number | null; averageFirstResponseSec: number | null; within5MinRate: number | null };
  leads: { created: number; converted: number; conversionRate: number | null; newContacts: number; daily: Daily[]; bySource: Record<string, number>; pipeline: { stage: string; count: number }[] };
  campaigns: { count: number; sent: number; delivered: number; read: number; failed: number; replied: number; items: { id: string; name: string; status: string; recipients: number; sent: number; delivered: number; read: number; failed: number; replied: number; deliveryRate: number | null; readRate: number | null }[] };
  automation: { runs: number; byStatus: Record<string, number>; successRate: number | null; top: { name: string; runs: number; failed: number }[] };
  agents: { team: { userId: string; name: string; role: string; replies: number; answeredThreads: number; medianResponseSec: number | null; within5MinRate: number | null }[]; ai: { replies: number; liveReplies: number; demoReplies: number; handoffs: number; skipped: number; errors: number } };
};

const ROLE: Record<string, string> = { CLIENT_OWNER: "Owner", MANAGER: "Manager", AGENT: "Agent" };

function Kpi({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <Card className="p-5">
      <p className="text-small text-app-muted">{label}</p>
      <p className="mt-1 text-h2 tabular-nums text-app-text">{value}</p>
      {hint ? <p className="mt-0.5 text-caption text-app-subtle">{hint}</p> : null}
    </Card>
  );
}

export function AnalyticsApp({ orgId, numbers }: { orgId: string; numbers: { id: string; displayName: string; phoneNumber: string }[] }) {
  const [days, setDays] = React.useState("30");
  const [numberId, setNumberId] = React.useState("");
  const [data, setData] = React.useState<Data | null>(null);
  const [error, setError] = React.useState("");
  const load = React.useCallback(async () => {
    const r = await apiFetch<Data>(`/api/organizations/${orgId}/analytics?days=${days}&numberId=${numberId}`);
    if (!r.ok) return setError(r.error);
    setError("");
    setData(r.data);
  }, [orgId, days, numberId]);
  React.useEffect(() => {
    const t = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(t);
  }, [load]);

  const controls = (
    <div className="flex flex-wrap gap-2">
      {numbers.length > 1 ? (
        <Select aria-label="WhatsApp number" value={numberId} onChange={(e) => setNumberId(e.target.value)} className="h-9 w-56 text-small">
          <option value="">All numbers</option>
          {numbers.map((n) => (
            <option key={n.id} value={n.id}>{n.displayName} · {n.phoneNumber}</option>
          ))}
        </Select>
      ) : null}
      <Select aria-label="Period" value={days} onChange={(e) => setDays(e.target.value)} className="h-9 w-36 text-small">
        <option value="7">Last 7 days</option>
        <option value="30">Last 30 days</option>
        <option value="90">Last 90 days</option>
      </Select>
    </div>
  );

  if (error) return (<><PageHeader title="Analytics" /><ErrorState description={error} onRetry={load} /></>);
  if (!data) return (<><PageHeader title="Analytics" actions={controls} /><LoadingState /></>);
  const d = data;
  const labels = d.messages.daily.map((x) => x.date);
  const empty = d.messages.inbound + d.messages.outbound + d.conversations.started + d.leads.newContacts === 0;
  const stageMax = Math.max(1, ...d.leads.pipeline.map((s) => s.count));

  return (
    <>
      <PageHeader title="Analytics" description={`${d.range.from} → ${d.range.to} (IST). Every figure is computed from your real conversations — demo traffic is included only on demo numbers.`} actions={controls} />
      {d.truncated ? <Alert tone="warning" className="mb-4">This period has a very large number of messages; response figures use the most recent portion.</Alert> : null}
      {empty ? (
        <Card>
          <EmptyState icon={BarChart3} title="Nothing to report for this period" description="Analytics fill in as customers message you and your team replies." />
        </Card>
      ) : null}

      <section aria-label="Key figures" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Messages received" value={formatNumber(d.messages.inbound)} />
        <Kpi label="Messages sent" value={formatNumber(d.messages.outbound)} hint={`${fmtPct(d.delivery.deliveryRate)} delivered · ${fmtPct(d.delivery.readRate)} read`} />
        <Kpi label="Conversations started" value={formatNumber(d.conversations.started)} hint={`${d.conversations.openNow} open now · ${d.conversations.unassignedOpen} unassigned`} />
        <Kpi label="Response rate" value={fmtPct(d.response.responseRate)} hint={`${d.response.answered} of ${d.response.conversationsWithCustomerMessage} conversations answered`} />
        <Kpi label="Median first response" value={fmtDuration(d.response.medianFirstResponseSec)} hint={`${fmtPct(d.response.within5MinRate)} within 5 minutes`} />
        <Kpi label="New leads" value={formatNumber(d.leads.created)} hint={`${d.leads.converted} converted (${fmtPct(d.leads.conversionRate)})`} />
        <Kpi label="Campaign messages" value={formatNumber(d.campaigns.sent)} hint={`${d.campaigns.count} campaign(s) · ${d.campaigns.replied} repl${d.campaigns.replied === 1 ? "y" : "ies"}`} />
        <Kpi label="Automation runs" value={formatNumber(d.automation.runs)} hint={`${fmtPct(d.automation.successRate)} succeeded`} />
      </section>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Messages per day" description="Received from customers vs sent by you" />
          <CardBody>
            <MiniBars labels={labels} ariaLabel="Messages per day" series={[{ name: "Received", values: d.messages.daily.map((x) => x.inbound), className: "bg-sky-400" }, { name: "Sent", values: d.messages.daily.map((x) => x.outbound), className: "bg-app-primary" }]} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="New conversations and leads per day" />
          <CardBody>
            <MiniBars labels={labels} ariaLabel="Conversations and leads per day" series={[{ name: "Conversations", values: d.conversations.dailyStarted.map((x) => x.count), className: "bg-amber-400" }, { name: "Leads", values: d.leads.daily.map((x) => x.count), className: "bg-violet-400" }]} />
          </CardBody>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Delivery and read" description="What happened to the messages you sent" />
          <CardBody className="space-y-3">
            {([
              ["Accepted by WhatsApp", d.delivery.accepted, null],
              ["Delivered", d.delivery.delivered + d.delivery.read, d.delivery.deliveryRate],
              ["Read", d.delivery.read, d.delivery.readRate],
              ["Failed", d.delivery.failed, d.delivery.failureRate],
            ] as [string, number, number | null][]).map(([label, n, rate]) => (
              <div key={label}>
                <p className="flex justify-between text-small"><span className="text-app-muted">{label}</span><span className="tabular-nums text-app-text">{formatNumber(n)}{rate !== null ? <span className="text-app-subtle"> · {rate}%</span> : null}</span></p>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-app-elevated" aria-hidden="true">
                  <div className={label === "Failed" ? "h-full bg-app-danger" : "h-full bg-app-primary"} style={{ width: `${Math.min(100, rate ?? (d.delivery.accepted ? (n / d.delivery.accepted) * 100 : 0))}%` }} />
                </div>
              </div>
            ))}
            {d.delivery.pending ? <p className="text-caption text-app-subtle">{d.delivery.pending} message(s) still sending.</p> : null}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Lead pipeline" description="Current stage of everyone marked as a lead" action={<Users className="size-4 text-app-subtle" aria-hidden="true" />} />
          <CardBody className="space-y-2">
            {d.leads.pipeline.map((s) => (
              <div key={s.stage}>
                <p className="flex justify-between text-small"><span className="capitalize text-app-muted">{s.stage}</span><span className="tabular-nums text-app-text">{formatNumber(s.count)}</span></p>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-app-elevated" aria-hidden="true"><div className={s.stage === "lost" ? "h-full bg-app-danger" : "h-full bg-violet-400"} style={{ width: `${(s.count / stageMax) * 100}%` }} /></div>
              </div>
            ))}
            {Object.keys(d.leads.bySource).length ? (
              <p className="pt-2 text-caption text-app-subtle">New contacts by source: {Object.entries(d.leads.bySource).map(([k, v]) => `${k} ${v}`).join(" · ")}</p>
            ) : null}
          </CardBody>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader title="Agent performance" description="Replies sent by each teammate and how fast they answered a waiting customer" action={<MessageSquare className="size-4 text-app-subtle" aria-hidden="true" />} />
        {d.agents.team.length ? (
          <Table caption="Agent performance" className="min-w-[640px]">
            <THead>
              <tr>
                <TH>Teammate</TH>
                <TH className="text-right">Replies</TH>
                <TH className="text-right">Customers answered</TH>
                <TH className="text-right">Median first response</TH>
                <TH className="text-right">Within 5 min</TH>
              </tr>
            </THead>
            <TBody>
              {d.agents.team.map((a) => (
                <TR key={a.userId}>
                  <TD>{a.name} <span className="text-caption text-app-subtle">{ROLE[a.role] ?? a.role}</span></TD>
                  <TD className="text-right tabular-nums">{a.replies}</TD>
                  <TD className="text-right tabular-nums">{a.answeredThreads}</TD>
                  <TD className="text-right tabular-nums">{fmtDuration(a.medianResponseSec)}</TD>
                  <TD className="text-right tabular-nums">{fmtPct(a.within5MinRate)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        ) : (
          <EmptyState icon={Users} title="No team replies in this period" className="py-6" />
        )}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 border-t border-app-border px-5 py-3 text-small text-app-muted">
          <span className="inline-flex items-center gap-1.5 text-app-text"><Bot className="size-4" aria-hidden="true" /> AI agent</span>
          <span>{d.agents.ai.liveReplies} live repl{d.agents.ai.liveReplies === 1 ? "y" : "ies"}</span>
          {d.agents.ai.demoReplies ? <span>{d.agents.ai.demoReplies} demo repl{d.agents.ai.demoReplies === 1 ? "y" : "ies"} <Badge tone="warning">rule-based</Badge></span> : null}
          <span>{d.agents.ai.handoffs} handoff(s)</span>
          <span>{d.agents.ai.skipped} skipped</span>
          {d.agents.ai.errors ? <span className="text-red-300">{d.agents.ai.errors} error(s)</span> : null}
        </div>
      </Card>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Campaigns" description="Campaigns launched in this period" action={<Megaphone className="size-4 text-app-subtle" aria-hidden="true" />} />
          {d.campaigns.items.length ? (
            <Table caption="Campaign results" className="min-w-[560px]">
              <THead>
                <tr>
                  <TH>Campaign</TH>
                  <TH className="text-right">Sent</TH>
                  <TH className="text-right">Delivered</TH>
                  <TH className="text-right">Read</TH>
                  <TH className="text-right">Replies</TH>
                </tr>
              </THead>
              <TBody>
                {d.campaigns.items.map((c) => (
                  <TR key={c.id}>
                    <TD>{c.name}<p className="text-caption text-app-subtle">{c.status}</p></TD>
                    <TD className="text-right tabular-nums">{c.sent}</TD>
                    <TD className="text-right tabular-nums">{c.delivered} <span className="text-caption text-app-subtle">{fmtPct(c.deliveryRate)}</span></TD>
                    <TD className="text-right tabular-nums">{c.read} <span className="text-caption text-app-subtle">{fmtPct(c.readRate)}</span></TD>
                    <TD className="text-right tabular-nums">{c.replied}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          ) : (
            <EmptyState icon={Megaphone} title="No campaigns in this period" className="py-6" />
          )}
        </Card>
        <Card>
          <CardHeader title="Automation" description="Runs started in this period (test runs excluded)" action={<Workflow className="size-4 text-app-subtle" aria-hidden="true" />} />
          {d.automation.top.length ? (
            <>
              <p className="px-5 pt-3 text-small text-app-muted">
                {Object.entries(d.automation.byStatus).map(([k, v]) => `${v} ${k}`).join(" · ")}
              </p>
              <Table caption="Automation runs" className="min-w-[420px]">
                <THead>
                  <tr>
                    <TH>Automation</TH>
                    <TH className="text-right">Runs</TH>
                    <TH className="text-right">Failed</TH>
                  </tr>
                </THead>
                <TBody>
                  {d.automation.top.map((a) => (
                    <TR key={a.name}>
                      <TD>{a.name}</TD>
                      <TD className="text-right tabular-nums">{a.runs}</TD>
                      <TD className="text-right tabular-nums">{a.failed}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </>
          ) : (
            <EmptyState icon={Workflow} title="No automation runs in this period" className="py-6" />
          )}
        </Card>
      </div>
    </>
  );
}
