"use client";

import * as React from "react";
import { BellRing, IndianRupee, MousePointerClick, TrendingUp, UsersRound, Eye } from "lucide-react";
import { Alert, Button, Card, CardBody, CardHeader, ErrorState, LoadingState, Select, StatCard } from "@/components/ds";
import { MiniBars } from "@/components/app/mini-bars";
import { apiFetch } from "@/lib/client-api";
import { formatINR, formatNumber } from "@/lib/catalog";

type Overview = {
  days: number;
  dates: string[];
  totals: { visits: number; visitors: number; clicks: number; leads: number; won: number; wonValuePaise: number; openPipelinePaise: number; followUpsDue: number };
  series: { visits: number[]; leads: number[] };
  funnel: { label: string; value: number }[];
  trafficSources: { source: string; visits: number }[];
  topClicks: { name: string; clicks: number }[];
  leadSources: { source: string; label: string; leads: number; won: number; rate: number }[];
  referrals: { ref: string; visits: number; leads: number }[];
};

const CLICK_LABELS: Record<string, string> = {
  demo_hero: "Book a demo (top)",
  plan_whatsapp: "Plan → WhatsApp",
  contact_whatsapp: "Contact → WhatsApp",
  contact_call: "Contact → Call",
  festival_claim: "Festival offer claim",
};
const label = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function Bars({ rows, total }: { rows: { name: string; value: number; extra?: string }[]; total: number }) {
  if (!rows.length) return <p className="text-small text-app-subtle">No data yet.</p>;
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.name}>
          <div className="flex items-baseline justify-between gap-3 text-small">
            <span className="truncate text-app-text">{r.name}</span>
            <span className="shrink-0 tabular-nums text-app-muted">
              {formatNumber(r.value)}
              {r.extra ? <span className="ml-2 text-app-subtle">{r.extra}</span> : null}
            </span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
            <div className="h-full rounded-full bg-app-primary" style={{ width: `${total ? Math.max(2, (r.value / total) * 100) : 0}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function MarketingOverview({ onOpenLeads }: { onOpenLeads: () => void }) {
  const [days, setDays] = React.useState(30);
  const [data, setData] = React.useState<Overview | null>(null);
  const [error, setError] = React.useState("");
  const load = React.useCallback(async () => {
    const r = await apiFetch<Overview>(`/api/admin/marketing/overview?days=${days}`);
    if (r.ok) {
      setData(r.data);
      setError("");
    } else setError(r.error);
  }, [days]);
  React.useEffect(() => {
    const t = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(t);
  }, [load]);

  if (error) return <ErrorState title="Couldn't load marketing numbers" description={error} onRetry={() => void load()} />;
  if (!data) return <LoadingState label="Loading marketing numbers…" />;
  const t = data.totals;
  const labels = data.dates.map((d) => d.slice(5));
  const funnelTop = Math.max(1, data.funnel[0]?.value ?? 1);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-small text-app-muted">Your website (mecgura.tech) and the leads it brings. Visitors are counted anonymously.</p>
        <Select aria-label="Period" value={String(days)} onChange={(e) => setDays(Number(e.target.value))} className="w-44">
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
          <option value="90">Last 90 days</option>
        </Select>
      </div>

      {t.followUpsDue ? (
        <Alert tone="warning" title={`${t.followUpsDue} lead${t.followUpsDue === 1 ? "" : "s"} waiting for a call or message`}>
          <span className="flex flex-wrap items-center gap-3">
            Fresh leads go cold in a day. Open today&apos;s list and message them on WhatsApp in one tap.
            <Button size="sm" variant="secondary" onClick={onOpenLeads}>
              <BellRing /> Open today&apos;s list
            </Button>
          </span>
        </Alert>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Website visitors" value={formatNumber(t.visitors)} icon={Eye} hint={`${formatNumber(t.visits)} page views`} />
        <StatCard label="WhatsApp / demo clicks" value={formatNumber(t.clicks)} icon={MousePointerClick} hint={t.visitors ? `${Math.round((t.clicks / t.visitors) * 100)}% of visitors` : undefined} />
        <StatCard label="New leads" value={formatNumber(t.leads)} icon={UsersRound} hint={`${formatNumber(t.won)} won`} />
        <StatCard label="Won (monthly value)" value={formatINR(t.wonValuePaise)} icon={IndianRupee} hint={`${formatINR(t.openPipelinePaise)} in demo / proposal`} />
      </div>

      <Card>
        <CardHeader title="Visitors and leads per day" />
        <CardBody>
          <MiniBars
            labels={labels}
            ariaLabel="Visitors and leads per day"
            series={[
              { name: "Page views", values: data.series.visits, className: "bg-app-primary/60" },
              { name: "Leads", values: data.series.leads, className: "bg-amber-400" },
            ]}
          />
        </CardBody>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Funnel" description="From a visit to a paying client." />
          <CardBody>
            <ol className="space-y-3">
              {data.funnel.map((f, i) => {
                const prev = i ? data.funnel[i - 1].value : 0;
                return (
                  <li key={f.label}>
                    <div className="flex items-baseline justify-between text-small">
                      <span className="text-app-text">{f.label}</span>
                      <span className="tabular-nums text-app-muted">
                        {formatNumber(f.value)}
                        {i && prev ? <span className="ml-2 text-app-subtle">{Math.round((f.value / prev) * 100)}% of previous</span> : null}
                      </span>
                    </div>
                    <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-white/[0.06]">
                      <div className="h-full rounded-full bg-[linear-gradient(90deg,#34d399,#14b8a6)]" style={{ width: `${Math.max(f.value ? 2 : 0, (f.value / funnelTop) * 100)}%` }} />
                    </div>
                  </li>
                );
              })}
            </ol>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Which source brings clients" description="Leads per source and how many became paying clients." />
          <CardBody>
            <Bars rows={data.leadSources.map((s) => ({ name: s.label, value: s.leads, extra: `${s.won} won · ${s.rate}%` }))} total={Math.max(1, ...data.leadSources.map((s) => s.leads))} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Where visitors come from" description="Add ?utm_source=instagram to links in your bio and ads to see them here." />
          <CardBody>
            <Bars rows={data.trafficSources.map((s) => ({ name: label(s.source), value: s.visits }))} total={Math.max(1, ...data.trafficSources.map((s) => s.visits))} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Buttons people click" />
          <CardBody>
            <Bars rows={data.topClicks.map((c) => ({ name: CLICK_LABELS[c.name] ?? c.name, value: c.clicks }))} total={Math.max(1, ...data.topClicks.map((c) => c.clicks))} />
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader title="Client referrals" description="Give each client the link mecgura.tech/?ref=their-workspace-name. Visits and leads they bring show up here, so you can thank or reward them." />
        <CardBody>
          {data.referrals.length ? (
            <Bars rows={data.referrals.map((r) => ({ name: r.ref, value: r.visits, extra: `${r.leads} lead${r.leads === 1 ? "" : "s"}` }))} total={Math.max(1, ...data.referrals.map((r) => r.visits))} />
          ) : (
            <p className="flex items-center gap-2 text-small text-app-subtle">
              <TrendingUp className="size-4" aria-hidden="true" /> No referral visits yet. Share a client&apos;s link to start.
            </p>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
