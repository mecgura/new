"use client";

import * as React from "react";
import Link from "next/link";
import { Route } from "lucide-react";
import { Badge, Card, CardBody, CardHeader, EmptyState, LoadingState } from "@/components/ds";
import { apiFetch } from "@/lib/client-api";
import { cn } from "@/lib/utils";

type Stage = "acquired" | "engaged" | "qualified" | "opportunity" | "customer" | "advocate";
type Journey = {
  stages: { stage: Stage; reachedAt: string | null }[];
  current: Stage;
  totals: { events: number; conversations: number; campaigns: number; deals: number; purchases: number; spendPaise: number };
  daysToCustomer: number | null;
  events: { at: string; stage: Stage; kind: string; title: string; detail: string; link: string }[];
};
const LABEL: Record<Stage, string> = { acquired: "Acquired", engaged: "Engaged", qualified: "Qualified", opportunity: "Opportunity", customer: "Customer", advocate: "Advocate" };
const DOT: Record<Stage, string> = { acquired: "bg-sky-400", engaged: "bg-indigo-400", qualified: "bg-amber-400", opportunity: "bg-orange-400", customer: "bg-emerald-400", advocate: "bg-pink-400" };
const day = (d: string) => new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

/** Contact → Customer journey: stage progress plus a timeline built from the platform's own records. */
export function JourneyCard({ orgId, contactId }: { orgId: string; contactId: string }) {
  const [data, setData] = React.useState<Journey | null>(null);
  const [all, setAll] = React.useState(false);
  React.useEffect(() => {
    let alive = true;
    void apiFetch<Journey>(`/api/organizations/${orgId}/contacts/${contactId}/journey`).then((r) => alive && r.ok && setData(r.data));
    return () => {
      alive = false;
    };
  }, [orgId, contactId]);
  if (!data) return <Card><LoadingState /></Card>;
  const shown = all ? data.events : data.events.slice(0, 12);
  return (
    <Card>
      <CardHeader title="Customer journey" description={`${data.totals.events} touchpoints · ${data.totals.conversations} conversation(s) · ${data.totals.deals} deal(s)${data.totals.spendPaise ? ` · ₹${(data.totals.spendPaise / 100).toLocaleString("en-IN")} spent` : ""}${data.daysToCustomer !== null ? ` · customer after ${data.daysToCustomer} day(s)` : ""}`} />
      <CardBody className="space-y-4">
        <ol className="grid grid-cols-3 gap-2 sm:grid-cols-6" aria-label="Journey stages">
          {data.stages.map((s) => (
            <li key={s.stage} className={cn("rounded-lg border p-2 text-center", s.reachedAt ? "border-app-border" : "border-dashed border-app-border opacity-50", data.current === s.stage && "border-app-primary")}>
              <span className={cn("mx-auto mb-1 block size-2 rounded-full", s.reachedAt ? DOT[s.stage] : "bg-app-border")} aria-hidden="true" />
              <span className="block text-caption font-medium text-app-text">{LABEL[s.stage]}</span>
              <span className="block text-[11px] text-app-subtle">{s.reachedAt ? day(s.reachedAt) : "—"}</span>
            </li>
          ))}
        </ol>
        {!data.events.length ? (
          <EmptyState icon={Route} title="No activity yet" description="Conversations, campaigns, deals and purchases will appear here." className="py-4" />
        ) : (
          <ol className="relative space-y-3 border-l border-app-border pl-4">
            {shown.map((e, i) => (
              <li key={`${e.at}-${i}`} className="relative">
                <span className={cn("absolute -left-[21px] top-1.5 size-2.5 rounded-full ring-2 ring-app-surface", DOT[e.stage])} aria-hidden="true" />
                <p className="text-small text-app-text">{e.link ? <Link href={e.link} className="hover:underline">{e.title}</Link> : e.title} <Badge tone="neutral" className="ml-1">{LABEL[e.stage]}</Badge></p>
                <p className="text-caption text-app-subtle">{day(e.at)}{e.detail ? ` · ${e.detail}` : ""}</p>
              </li>
            ))}
          </ol>
        )}
        {data.events.length > 12 ? <button type="button" className="text-small text-app-primary hover:underline" onClick={() => setAll(!all)}>{all ? "Show less" : `Show all ${data.events.length}`}</button> : null}
      </CardBody>
    </Card>
  );
}
