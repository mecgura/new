"use client";

import * as React from "react";
import Link from "next/link";
import { BarChart3, Clock } from "lucide-react";
import { Alert, Badge, Card, CardBody, CardHeader, EmptyState, LoadingState, PageHeader } from "@/components/ds";
import { apiFetch } from "@/lib/client-api";

type Row = { id: string; name: string; startedAt: string | null; template: string; abTest: boolean; sent: number; delivered: number; read: number; replies: number; optOuts: number; failed: number; rates: { delivered: number; read: number; replies: number; optOuts: number }; costRupees: number; leads: number; revenueRupees: number; roiPct: number | null };
type Tpl = { id: string; name: string; campaigns: number; sent: number; readRate: number; replyRate: number; optOutRate: number };
type Data = { campaigns: Row[]; templates: Tpl[]; bestHour: { label: string; readRate: number } | null };

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const date = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });

/** Campaigns side by side: rates, cost, leads, revenue and ROI; each template's results; the best hour to send. */
export function CampaignPerformance({ orgId }: { orgId: string }) {
  const [d, setD] = React.useState<Data | null>(null);
  const [error, setError] = React.useState("");
  React.useEffect(() => {
    const t = window.setTimeout(async () => {
      const r = await apiFetch<Data>(`/api/organizations/${orgId}/campaigns/performance`);
      if (r.ok) setD(r.data);
      else setError(r.error);
    }, 0);
    return () => clearTimeout(t);
  }, [orgId]);
  return (
    <>
      <PageHeader title="Campaign performance" description="Compare your recent campaigns and templates. Leads and revenue come from deals and purchases after each message." breadcrumb={[{ label: "Campaigns", href: "/campaigns" }, { label: "Performance" }]} />
      {error ? <Alert tone="danger">{error}</Alert> : !d ? <LoadingState /> : !d.campaigns.length ? (
        <Card><EmptyState icon={BarChart3} title="No sent campaigns yet" description="Results appear here once a campaign has gone out." /></Card>
      ) : (
        <div className="space-y-4">
          {d.bestHour ? <Alert tone="info" title={<span className="flex items-center gap-2"><Clock className="size-4" aria-hidden="true" /> Best time to send: {d.bestHour.label}</span>}>Messages sent then were read most ({d.bestHour.readRate}%) over the last 90 days.</Alert> : null}
          <Card>
            <CardHeader title="Recent campaigns" />
            <CardBody className="overflow-x-auto p-0">
              <table className="w-full text-small">
                <thead className="text-left text-caption text-app-muted"><tr className="border-b border-app-border">{["Campaign", "Sent", "Delivered", "Read", "Replied", "Opted out", "Cost", "Leads", "Revenue", "ROI"].map((h) => <th key={h} className="whitespace-nowrap px-4 py-2 font-medium">{h}</th>)}</tr></thead>
                <tbody>
                  {d.campaigns.map((c) => (
                    <tr key={c.id} className="border-b border-app-border last:border-0">
                      <td className="px-4 py-2"><Link href={`/campaigns/${c.id}`} className="font-medium text-app-text hover:text-app-primary">{c.name}</Link>{c.abTest ? <Badge tone="info" className="ml-2">A/B</Badge> : null}<span className="block text-caption text-app-subtle">{c.startedAt ? date.format(new Date(c.startedAt)) : ""} · {c.template}</span></td>
                      <td className="px-4 py-2 tabular-nums">{c.sent}</td>
                      <td className="px-4 py-2 tabular-nums">{c.rates.delivered}%</td>
                      <td className="px-4 py-2 tabular-nums">{c.rates.read}%</td>
                      <td className="px-4 py-2 font-semibold tabular-nums text-app-text">{c.rates.replies}%</td>
                      <td className="px-4 py-2 tabular-nums">{c.rates.optOuts}%</td>
                      <td className="px-4 py-2 tabular-nums">{inr(c.costRupees)}</td>
                      <td className="px-4 py-2 tabular-nums">{c.leads}</td>
                      <td className="px-4 py-2 tabular-nums">{inr(c.revenueRupees)}</td>
                      <td className="px-4 py-2 tabular-nums">{c.roiPct === null ? "—" : `${c.roiPct}%`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardBody>
          </Card>
          {d.templates.length ? (
            <Card>
              <CardHeader title="Templates compared" description="Across campaigns without an A/B test, best reply rate first." />
              <CardBody className="overflow-x-auto p-0">
                <table className="w-full text-small">
                  <thead className="text-left text-caption text-app-muted"><tr className="border-b border-app-border">{["Template", "Campaigns", "Sent", "Read", "Replied", "Opted out"].map((h) => <th key={h} className="px-4 py-2 font-medium">{h}</th>)}</tr></thead>
                  <tbody>{d.templates.map((t) => <tr key={t.id} className="border-b border-app-border last:border-0"><td className="px-4 py-2 font-mono text-caption text-app-text">{t.name}</td><td className="px-4 py-2">{t.campaigns}</td><td className="px-4 py-2">{t.sent}</td><td className="px-4 py-2">{t.readRate}%</td><td className="px-4 py-2 font-semibold text-app-text">{t.replyRate}%</td><td className="px-4 py-2">{t.optOutRate}%</td></tr>)}</tbody>
                </table>
              </CardBody>
            </Card>
          ) : null}
        </div>
      )}
    </>
  );
}
