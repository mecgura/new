import Link from "next/link";
import { ArrowDownRight, ArrowRightLeft, ArrowUpRight, Clock, Info, Minus } from "lucide-react";
import { Card, CardBody, CardHeader, EmptyState } from "@/components/ui";
import { cn } from "@/lib/cn";
import { formatMoney } from "@/lib/billing/money";
import { formatPct, type Comparison } from "@/lib/analytics/range";
import { formatInTz } from "@/lib/scheduling/time";

/** Reusable, server-rendered analytics widgets. Charts are inline SVG/CSS with text alternatives; nothing here fetches or computes data. */
export const fmtCount = (n: number | null | undefined) => (n === null || n === undefined ? "—" : n.toLocaleString("en-IN"));
export const fmtPct = (n: number | null | undefined) => (n === null || n === undefined ? "N/A" : `${n}%`);
export function fmtMinutes(n: number | null | undefined) { if (n === null || n === undefined) return "Data unavailable"; if (n < 60) return `${n} min`; const h = Math.floor(n / 60); const m = n % 60; return m ? `${h} h ${m} min` : `${h} h`; }
export const fmtHours = (n: number | null | undefined) => (n === null || n === undefined ? "Data unavailable" : `${n} h`);
export const fmtMoney = (minor: number | null | undefined, currency: string) => (minor === null || minor === undefined ? "—" : formatMoney(minor, currency));

export function Freshness({ meta }: { meta: { generatedAt: string; timezone: string; range: { label: string; from: string; to: string }; previous: { from: string; to: string } | null; scope: { own: boolean; doctorId: string | null }; cached: boolean } }) {
  return (
    <p className="type-caption flex flex-wrap items-center gap-x-3 gap-y-1" data-testid="freshness">
      <span className="inline-flex items-center gap-1"><Clock aria-hidden className="size-3.5" />Last updated {formatInTz(new Date(meta.generatedAt), meta.timezone, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
      <span>{meta.range.label}: {meta.range.from === meta.range.to ? meta.range.from : `${meta.range.from} to ${meta.range.to}`}</span>
      <span>Timezone: {meta.timezone}</span>
      {meta.previous && <span>Compared with {meta.previous.from} to {meta.previous.to}</span>}
      {meta.scope.own ? <span>Showing your own data only</span> : meta.scope.doctorId ? <span>Filtered to one doctor</span> : null}
    </p>
  );
}

export function ComparisonBadge({ c, goodWhen = "up" }: { c: Comparison | null | undefined; goodWhen?: "up" | "down" | "neutral" }) {
  if (!c) return null;
  if (c.state === "na") return <span className="type-caption inline-flex items-center gap-1" title={c.reason === "insufficient-history" ? "The clinic has no data for the previous period." : "The previous period was zero, so a percentage would be misleading."}><ArrowRightLeft aria-hidden className="size-3" />vs previous: N/A ({c.previous} before)</span>;
  const Icon = c.state === "up" ? ArrowUpRight : c.state === "down" ? ArrowDownRight : Minus;
  const good = goodWhen === "neutral" || c.state === "flat" ? null : (c.state === "up") === (goodWhen === "up");
  return <span className={cn("type-caption inline-flex items-center gap-1 font-medium", good === null ? "text-muted" : good ? "text-success" : "text-danger")}><Icon aria-hidden className="size-3.5" /><span>{formatPct(c.pctTenths)} <span className="sr-only">compared with the previous period, which was {c.previous}.</span></span><span aria-hidden className="text-muted font-normal">(was {c.previous})</span></span>;
}

export function Kpi({ label, value, note, comparison, href, goodWhen, snapshot, muted }: { label: string; value: string; note?: string | null; comparison?: Comparison | null; href?: string; goodWhen?: "up" | "down" | "neutral"; snapshot?: boolean; muted?: boolean }) {
  const inner = (
    <>
      <p className="type-caption">{label}{snapshot && <span className="ml-1 rounded-sm bg-surface-muted px-1 text-[10px] uppercase tracking-wide" title="A snapshot as of now, not limited to the selected dates">now</span>}</p>
      <p className={cn("type-card-title mt-1 break-words text-2xl tabular-nums", muted && "!text-muted !text-base")}>{value}</p>
      <div className="mt-1 min-h-4"><ComparisonBadge c={comparison} goodWhen={goodWhen} /></div>
      {note && <p className="type-caption mt-1">{note}</p>}
    </>
  );
  const cls = "block rounded-lg border border-line bg-surface p-3 no-underline";
  return href ? <Link href={href} role="listitem" className={cn(cls, "hover:border-primary-border hover:bg-surface-muted")}>{inner}</Link> : <div role="listitem" className={cls}>{inner}</div>;
}
export const KpiGrid = ({ children, label }: { children: React.ReactNode; label: string }) => <section aria-label={label} role="list" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">{children}</section>;

export function Section({ title, description, children, action, id }: { title: string; description?: React.ReactNode; children: React.ReactNode; action?: React.ReactNode; id?: string }) {
  return <Card id={id}><CardHeader title={title} description={description} action={action} /><CardBody>{children}</CardBody></Card>;
}
export const NoData = ({ title = "No data for this period", description }: { title?: string; description?: string }) => <EmptyState title={title} description={description ?? "Nothing was recorded in the selected dates. Try a wider range."} className="py-8" />;
export function Unavailable({ children }: { children: React.ReactNode }) { return <p className="type-secondary inline-flex items-start gap-2 rounded-md bg-surface-muted p-3"><Info aria-hidden className="mt-0.5 size-4 shrink-0" />{children}</p>; }
export const Definition = ({ children }: { children: React.ReactNode }) => <p className="type-caption mt-2">{children}</p>;

/** Horizontal bars. Each row is text first (label + value + share), the bar is decoration, so it works without colour or sight. */
export function BarList({ items, total, format = fmtCount, empty, hrefOf }: { items: { key: string; label: string; count: number; extra?: string }[]; total?: number; format?: (n: number) => string; empty?: string; hrefOf?: (key: string) => string | undefined }) {
  const sum = total ?? items.reduce((a, i) => a + i.count, 0); const max = Math.max(1, ...items.map((i) => i.count));
  if (!items.length || items.every((i) => i.count === 0)) return <NoData title={empty ?? "Nothing to show"} />;
  return (
    <ul className="space-y-2">
      {items.map((i) => {
        const pct = sum > 0 ? Math.round((i.count * 1000) / sum) / 10 : 0; const href = hrefOf?.(i.key);
        const label = href ? <Link href={href}>{i.label}</Link> : i.label;
        return (
          <li key={i.key}>
            <div className="flex items-baseline justify-between gap-3 type-secondary"><span className="min-w-0 break-words">{label}</span><span className="shrink-0 tabular-nums">{format(i.count)}{sum > 0 && <span className="type-caption ml-1">({pct}%)</span>}{i.extra && <span className="type-caption ml-1">{i.extra}</span>}</span></div>
            <div aria-hidden className="mt-1 h-2 overflow-hidden rounded-pill bg-surface-muted"><div className="h-full rounded-pill bg-primary" style={{ width: `${Math.max(2, (i.count / max) * 100)}%` }} /></div>
          </li>
        );
      })}
    </ul>
  );
}

/** Line/area trend. `values` are per-day; the sr-only table is the accessible equivalent of the picture. */
export function TrendChart({ points, label, format = fmtCount }: { points: { date: string; value: number }[]; label: string; format?: (n: number) => string }) {
  if (!points.length || points.every((p) => p.value === 0)) return <NoData title={`No ${label.toLowerCase()} in this period`} />;
  const W = 640; const H = 150; const pad = 8; const max = Math.max(1, ...points.map((p) => p.value)); const step = points.length > 1 ? (W - pad * 2) / (points.length - 1) : 0;
  const xy = points.map((p, i) => [pad + i * step, H - pad - (p.value / max) * (H - pad * 2)] as const);
  const line = xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" "); const total = points.reduce((a, p) => a + p.value, 0); const peak = points.reduce((a, p) => (p.value > a.value ? p : a), points[0]);
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${label}: total ${format(total)} over ${points.length} days, highest on ${peak.date} (${format(peak.value)}).`} className="h-40 w-full">
        <title>{label}</title>
        <polygon points={`${pad},${H - pad} ${line} ${W - pad},${H - pad}`} fill="var(--color-primary)" opacity="0.12" />
        <polyline points={line} fill="none" stroke="var(--color-primary)" strokeWidth="2" strokeLinejoin="round" />
        {points.length <= 40 && xy.map(([x, y], i) => <circle key={i} cx={x} cy={y} r="2.5" fill="var(--color-primary)" />)}
      </svg>
      <figcaption className="type-caption flex justify-between"><span>{points[0].date}</span><span>Peak {format(peak.value)} on {peak.date}</span><span>{points[points.length - 1].date}</span></figcaption>
      <table className="sr-only"><caption>{label} by day</caption><thead><tr><th scope="col">Date</th><th scope="col">Value</th></tr></thead><tbody>{points.map((p) => <tr key={p.date}><td>{p.date}</td><td>{format(p.value)}</td></tr>)}</tbody></table>
    </figure>
  );
}

export function HourlyChart({ hours, label }: { hours: { hour: number; count: number }[]; label: string }) {
  const max = Math.max(1, ...hours.map((h) => h.count)); const total = hours.reduce((a, h) => a + h.count, 0);
  if (!total) return <NoData title={`No ${label.toLowerCase()} recorded`} />;
  const busiest = hours.reduce((a, h) => (h.count > a.count ? h : a), hours[0]);
  return (
    <figure>
      <div role="img" aria-label={`${label} by hour of day. Busiest hour ${String(busiest.hour).padStart(2, "0")}:00 with ${busiest.count}.`} className="flex h-32 items-end gap-0.5">
        {hours.map((h) => <div key={h.hour} className="flex-1 rounded-t-sm bg-primary" style={{ height: `${Math.max(h.count ? 4 : 1, (h.count / max) * 100)}%`, opacity: h.count ? 1 : 0.15 }} title={`${String(h.hour).padStart(2, "0")}:00 — ${h.count}`} />)}
      </div>
      <figcaption className="type-caption mt-1 flex justify-between"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>23:00</span></figcaption>
      <table className="sr-only"><caption>{label} by hour</caption><thead><tr><th scope="col">Hour</th><th scope="col">Count</th></tr></thead><tbody>{hours.filter((h) => h.count).map((h) => <tr key={h.hour}><td>{String(h.hour).padStart(2, "0")}:00</td><td>{h.count}</td></tr>)}</tbody></table>
    </figure>
  );
}

export function DataTable({ head, rows, empty, caption }: { head: { label: string; right?: boolean }[]; rows: (React.ReactNode)[][]; empty?: string; caption: string }) {
  if (!rows.length) return <NoData title={empty ?? "Nothing to show"} />;
  return (
    <div className="overflow-x-auto"><table className="w-full text-left"><caption className="sr-only">{caption}</caption>
      <thead><tr className="type-caption border-b border-line bg-surface-muted">{head.map((h) => <th key={h.label} scope="col" className={cn("p-3", h.right && "text-right")}>{h.label}</th>)}</tr></thead>
      <tbody>{rows.map((r, i) => <tr key={i} className="border-b border-line last:border-0">{r.map((c, j) => <td key={j} className={cn("p-3 type-secondary", head[j]?.right && "text-right tabular-nums")}>{c}</td>)}</tr>)}</tbody></table></div>
  );
}
