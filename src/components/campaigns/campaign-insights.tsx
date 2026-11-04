"use client";

import * as React from "react";
import { FlaskConical, IndianRupee, Lightbulb, Trophy, Wrench } from "lucide-react";
import { Badge, Card, CardBody, CardHeader, LoadingState } from "@/components/ds";
import { apiFetch } from "@/lib/client-api";

type Verdict = { metric: string; rateA: number; rateB: number; pValue: number | null; winner: "A" | "B" | null; confident: boolean; note: string };
type Arm = { template: string; recipients: number; sent: number; delivered: number; read: number; replies: number; optOuts: number; failed: number; leads: number };
type Insights = {
  roi: { estimatedCostRupees: number; metaPerMessagePaise: number; feePerMessagePaise: number; replies: number; leads: number; wonDeals: number; purchases: number; revenueRupees: number; costPerReply: number | null; costPerLead: number | null; roiPct: number | null; windowNote: string };
  ab: { a: Arm; b: Arm; replyRate: Verdict; readRate: Verdict; optOutRate: Verdict } | null;
  failures: { title: string; fix: string; count: number; examples: string[] }[];
  recommendations: string[];
};

const inr = (n: number | null) => (n === null ? "—" : `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`);
const rate = (a: number, b: number) => (b ? `${Math.round((a / b) * 1000) / 10}%` : "—");

/** ROI, A/B result, failure diagnostics and recommendations for one campaign. */
export function CampaignInsights({ orgId, campaignId, refreshKey }: { orgId: string; campaignId: string; refreshKey: string }) {
  const [d, setD] = React.useState<Insights | null>(null);
  React.useEffect(() => {
    const t = window.setTimeout(async () => {
      const r = await apiFetch<Insights>(`/api/organizations/${orgId}/campaigns/${campaignId}/insights`);
      if (r.ok) setD(r.data);
    }, 0);
    return () => clearTimeout(t);
  }, [orgId, campaignId, refreshKey]);
  if (!d) return <Card><CardBody><LoadingState label="Working out results…" /></CardBody></Card>;
  const { roi, ab } = d;
  return (
    <>
      <Card>
        <CardHeader title={<span className="flex items-center gap-2"><IndianRupee className="size-4" aria-hidden="true" /> Cost and return</span>} description={roi.windowNote} />
        <CardBody>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ["Estimated cost", inr(roi.estimatedCostRupees)],
              ["Cost per reply", inr(roi.costPerReply)],
              ["Leads (deals opened)", String(roi.leads)],
              ["Cost per lead", inr(roi.costPerLead)],
              ["Deals won", String(roi.wonDeals)],
              ["Purchases", String(roi.purchases)],
              ["Revenue", inr(roi.revenueRupees)],
              ["ROI", roi.roiPct === null ? "—" : `${roi.roiPct}%`],
            ].map(([l, v]) => (
              <div key={l} className="rounded-[var(--radius-control)] border border-app-border p-3">
                <dt className="text-caption text-app-muted">{l}</dt>
                <dd className="text-body font-semibold text-app-text">{v}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-2 text-caption text-app-subtle">Cost = Meta&apos;s charge per delivered message (₹{(roi.metaPerMessagePaise / 100).toFixed(2)}) + MECGURA fee per sent message (₹{(roi.feePerMessagePaise / 100).toFixed(2)}). Meta bills its part to the WhatsApp account; this is an estimate.</p>
        </CardBody>
      </Card>

      {ab ? (
        <Card>
          <CardHeader title={<span className="flex items-center gap-2"><FlaskConical className="size-4" aria-hidden="true" /> A/B test</span>} description={ab.replyRate.note} />
          <CardBody className="overflow-x-auto p-0">
            <table className="w-full text-small">
              <thead className="text-left text-caption text-app-muted"><tr className="border-b border-app-border">{["", "Template", "Sent", "Read", "Replied", "Opted out", "Leads"].map((h) => <th key={h} className="px-4 py-2 font-medium">{h}</th>)}</tr></thead>
              <tbody>
                {(["A", "B"] as const).map((k) => {
                  const arm = k === "A" ? ab.a : ab.b;
                  const won = ab.replyRate.winner === k;
                  return (
                    <tr key={k} className="border-b border-app-border last:border-0">
                      <td className="px-4 py-2 font-semibold text-app-text">{k} {won ? <Badge tone="success"><Trophy className="size-3" aria-hidden="true" /> Winner</Badge> : null}</td>
                      <td className="px-4 py-2 font-mono text-caption text-app-text">{arm.template}</td>
                      <td className="px-4 py-2">{arm.sent}</td>
                      <td className="px-4 py-2">{rate(arm.read, arm.delivered)}</td>
                      <td className="px-4 py-2 font-semibold text-app-text">{rate(arm.replies, arm.delivered)}</td>
                      <td className="px-4 py-2">{rate(arm.optOuts, arm.delivered)}</td>
                      <td className="px-4 py-2">{arm.leads}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="px-4 py-2 text-caption text-app-subtle">{ab.readRate.note}{ab.replyRate.pValue !== null ? ` · reply-rate p = ${ab.replyRate.pValue}` : ""}</p>
          </CardBody>
        </Card>
      ) : null}

      {d.failures.length ? (
        <Card>
          <CardHeader title={<span className="flex items-center gap-2"><Wrench className="size-4" aria-hidden="true" /> Why messages failed</span>} />
          <ul className="divide-y divide-app-border">
            {d.failures.map((f) => (
              <li key={f.title} className="px-5 py-3">
                <p className="flex items-center justify-between gap-2 text-small font-medium text-app-text">{f.title}<Badge>{f.count}</Badge></p>
                <p className="text-caption text-app-muted">{f.fix}</p>
                <p className="mt-1 text-caption text-app-subtle">{f.examples.join(" · ")}</p>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {d.recommendations.length ? (
        <Card>
          <CardHeader title={<span className="flex items-center gap-2"><Lightbulb className="size-4" aria-hidden="true" /> Next time</span>} />
          <CardBody>
            <ul className="list-disc space-y-1.5 pl-5 text-small text-app-text">{d.recommendations.map((r) => <li key={r}>{r}</li>)}</ul>
          </CardBody>
        </Card>
      ) : null}
    </>
  );
}
