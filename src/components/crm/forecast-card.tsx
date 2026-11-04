"use client";

import * as React from "react";
import { ChevronDown, LineChart } from "lucide-react";
import { Card, CardBody, CardHeader, Table, TBody, TD, TH, THead, TR } from "@/components/ds";
import { apiFetch } from "@/lib/client-api";

type Bucket = { deals: number; bestCaseRupees: number; weightedRupees: number; historyRupees: number | null };
type Forecast = { months: (Bucket & { month: string })[]; later: Bucket; overdue: Bucket; noDate: Bucket; history: { month: string; wonDeals: number; wonRupees: number }[]; runRateRupees: number; winRate180: number | null; closedSample: number };
const inr = (n: number | null) => (n === null ? "—" : `₹${Math.round(n).toLocaleString("en-IN")}`);

/** Deals → Forecast: next 3 months by expected close date, three views, and last 6 months of wins. */
export function ForecastCard({ base }: { base: string }) {
  const [open, setOpen] = React.useState(false);
  const [data, setData] = React.useState<Forecast | null>(null);
  React.useEffect(() => {
    if (!open || data) return;
    void apiFetch<Forecast>(`${base}/forecast`).then((r) => r.ok && setData(r.data));
  }, [open, data, base]);
  const max = data ? Math.max(1, ...data.history.map((h) => h.wonRupees)) : 1;
  return (
    <Card className="mb-4">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-center justify-between px-5 py-3 text-left">
        <span className="flex items-center gap-2 text-body font-semibold text-app-text"><LineChart className="size-4" aria-hidden="true" /> Sales forecast (next 3 months)</span>
        <ChevronDown className={`size-4 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>
      {open ? (
        !data ? <CardBody><p className="text-small text-app-muted">Loading…</p></CardBody> : (
          <CardBody className="space-y-4 pt-0">
            <p className="text-caption text-app-subtle">
              By each deal&apos;s expected close date. <strong>Weighted</strong> = value × stage win chance. <strong>Based on history</strong> = value × your real win rate
              {data.winRate180 !== null ? ` (${data.winRate180}% of ${data.closedSample} deals closed in 180 days)` : " — shown after 5 deals are won or lost"}.
            </p>
            <Table>
              <THead><TR><TH>Month</TH><TH className="text-right">Deals</TH><TH className="text-right">Best case</TH><TH className="text-right">Weighted</TH><TH className="text-right">Based on history</TH></TR></THead>
              <TBody>
                {data.months.map((m) => (
                  <TR key={m.month}><TD>{m.month}</TD><TD className="text-right tabular-nums">{m.deals}</TD><TD className="text-right tabular-nums">{inr(m.bestCaseRupees)}</TD><TD className="text-right tabular-nums font-medium">{inr(m.weightedRupees)}</TD><TD className="text-right tabular-nums">{inr(m.historyRupees)}</TD></TR>
                ))}
                <TR><TD className="text-app-muted">Later</TD><TD className="text-right tabular-nums">{data.later.deals}</TD><TD className="text-right tabular-nums">{inr(data.later.bestCaseRupees)}</TD><TD className="text-right tabular-nums">{inr(data.later.weightedRupees)}</TD><TD className="text-right tabular-nums">{inr(data.later.historyRupees)}</TD></TR>
                <TR><TD className="text-amber-300">Overdue</TD><TD className="text-right tabular-nums">{data.overdue.deals}</TD><TD className="text-right tabular-nums">{inr(data.overdue.bestCaseRupees)}</TD><TD className="text-right tabular-nums">{inr(data.overdue.weightedRupees)}</TD><TD className="text-right tabular-nums">{inr(data.overdue.historyRupees)}</TD></TR>
                <TR><TD className="text-app-muted">No close date</TD><TD className="text-right tabular-nums">{data.noDate.deals}</TD><TD className="text-right tabular-nums">{inr(data.noDate.bestCaseRupees)}</TD><TD className="text-right tabular-nums">{inr(data.noDate.weightedRupees)}</TD><TD className="text-right tabular-nums">{inr(data.noDate.historyRupees)}</TD></TR>
              </TBody>
            </Table>
            <div>
              <p className="mb-2 text-small font-medium text-app-text">Won in the last 6 months <span className="font-normal text-app-subtle">· recent average {inr(data.runRateRupees)} / month</span></p>
              <div className="flex h-28 items-end gap-2" role="img" aria-label={data.history.map((h) => `${h.month}: ${inr(h.wonRupees)}`).join(", ")}>
                {data.history.map((h) => (
                  <div key={h.month} className="flex flex-1 flex-col items-center gap-1">
                    <span className="text-[11px] tabular-nums text-app-subtle">{h.wonRupees ? inr(h.wonRupees) : ""}</span>
                    <div className="w-full rounded-t bg-emerald-500/70" style={{ height: `${Math.max(2, (h.wonRupees / max) * 72)}px` }} />
                    <span className="text-[11px] text-app-subtle">{h.month.split(" ")[0]}</span>
                  </div>
                ))}
              </div>
            </div>
          </CardBody>
        )
      ) : null}
    </Card>
  );
}
