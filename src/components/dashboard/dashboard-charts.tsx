"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardBody, CardHeader, EmptyState } from "@/components/ds";
import { BarChart3, MessageCircle, PieChart as PieIcon, Users } from "lucide-react";
import { compactIndian, groupIndian } from "@/lib/catalog";

/** Categorical slots in fixed order (validated palette in globals.css → .viz-root). */
const SLOT = ["var(--series-1)", "var(--series-2)", "var(--series-3)", "var(--series-4)", "var(--series-5)", "var(--series-6)"];

export type MessageDay = { label: string; sent: number; received: number };
export type Slice = { key: string; label: string; value: number; href: string };
export type StageBar = { label: string; rupees: number; deals: number };

function TipBox({ title, rows }: { title: string; rows: { color?: string; label: string; value: string }[] }) {
  return (
    <div className="rounded-lg border border-app-border bg-app-surface px-3 py-2 text-caption shadow-lg">
      <p className="mb-1 font-medium text-app-text">{title}</p>
      {rows.map((r) => (
        <p key={r.label} className="flex items-center gap-2 text-app-muted">
          {r.color ? <span className="size-2.5 rounded-sm" style={{ background: r.color }} aria-hidden="true" /> : null}
          {r.label}: <span className="font-medium tabular-nums text-app-text">{r.value}</span>
        </p>
      ))}
    </div>
  );
}

function Legend({ items }: { items: { color: string; label: string; value?: string; href?: string }[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-caption">
      {items.map((i) => {
        const body = (
          <>
            <span className="size-2.5 shrink-0 rounded-sm" style={{ background: i.color }} aria-hidden="true" />
            <span className="text-app-muted">{i.label}</span>
            {i.value ? <span className="font-medium tabular-nums text-app-text">{i.value}</span> : null}
          </>
        );
        return <li key={i.label}>{i.href ? <Link href={i.href} className="flex items-center gap-1.5 rounded px-1 hover:bg-app-hover">{body}</Link> : <span className="flex items-center gap-1.5 px-1">{body}</span>}</li>;
      })}
    </ul>
  );
}

/** Messages sent vs received per day (two series, one axis), with crosshair tooltip and a hidden table. */
export function MessagesChart({ data }: { data: MessageDay[] }) {
  const total = data.reduce((a, d) => a + d.sent + d.received, 0);
  return (
    <Card className="viz-root xl:col-span-2">
      <CardHeader title="Messages — last 14 days" description={`${groupIndian(data.reduce((a, d) => a + d.sent, 0))} sent · ${groupIndian(data.reduce((a, d) => a + d.received, 0))} received`} action={<Link href="/inbox" className="text-small text-app-primary hover:underline">Open inbox →</Link>} />
      <CardBody>
        {!total ? (
          <EmptyState icon={MessageCircle} title="No messages yet" description="Messages you send and receive on WhatsApp will show here." className="py-8" />
        ) : (
          <>
            <Legend items={[{ color: SLOT[0], label: "Sent" }, { color: SLOT[1], label: "Received" }]} />
            <div className="mt-3 h-64" aria-hidden="true">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                  <defs>
                    <linearGradient id="g-sent" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={SLOT[0]} stopOpacity={0.35} /><stop offset="100%" stopColor={SLOT[0]} stopOpacity={0} /></linearGradient>
                    <linearGradient id="g-recv" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={SLOT[1]} stopOpacity={0.3} /><stop offset="100%" stopColor={SLOT[1]} stopOpacity={0} /></linearGradient>
                  </defs>
                  <CartesianGrid stroke="var(--viz-grid)" vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: "currentColor", fontSize: 11 }} className="text-app-subtle" tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={16} />
                  <YAxis tick={{ fill: "currentColor", fontSize: 11 }} className="text-app-subtle" tickLine={false} axisLine={false} allowDecimals={false} tickFormatter={(v: number) => compactIndian(v)} width={40} />
                  <Tooltip cursor={{ stroke: "currentColor", strokeOpacity: 0.25 }} content={({ active, payload, label }) => (active && payload?.length ? <TipBox title={String(label)} rows={payload.map((p) => ({ color: String(p.color), label: p.dataKey === "sent" ? "Sent" : "Received", value: groupIndian(Number(p.value)) }))} /> : null)} />
                  <Area type="monotone" dataKey="sent" stroke={SLOT[0]} strokeWidth={2} fill="url(#g-sent)" activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--color-app-surface, #111)" }} />
                  <Area type="monotone" dataKey="received" stroke={SLOT[1]} strokeWidth={2} fill="url(#g-recv)" activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--color-app-surface, #111)" }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <table className="sr-only">
              <caption>Messages per day</caption>
              <thead><tr><th>Day</th><th>Sent</th><th>Received</th></tr></thead>
              <tbody>{data.map((d) => <tr key={d.label}><td>{d.label}</td><td>{d.sent}</td><td>{d.received}</td></tr>)}</tbody>
            </table>
          </>
        )}
      </CardBody>
    </Card>
  );
}

/** Donut with a centre total; each slice and legend item opens the matching list. */
export function DonutCard({ title, description, data, emptyTitle, icon = "pie", centerLabel }: { title: string; description: string; data: Slice[]; emptyTitle: string; icon?: "pie" | "users"; centerLabel: string }) {
  const router = useRouter();
  const [hover, setHover] = React.useState<number | null>(null);
  const shown = data.filter((d) => d.value > 0).slice(0, 6);
  const total = shown.reduce((a, d) => a + d.value, 0);
  const focus = hover !== null ? shown[hover] : null;
  return (
    <Card className="viz-root">
      <CardHeader title={title} description={description} />
      <CardBody>
        {!total ? (
          <EmptyState icon={icon === "users" ? Users : PieIcon} title={emptyTitle} className="py-8" />
        ) : (
          <>
            <div className="relative mx-auto h-48 w-48" aria-hidden="true">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={shown} dataKey="value" nameKey="label" innerRadius="62%" outerRadius="100%" paddingAngle={shown.length > 1 ? 2 : 0} stroke="none" isAnimationActive onMouseLeave={() => setHover(null)} onMouseEnter={(_, i) => setHover(i)} onClick={(_, i) => router.push(shown[i].href)} className="cursor-pointer">
                    {shown.map((d, i) => <Cell key={d.key} fill={SLOT[i]} opacity={hover === null || hover === i ? 1 : 0.45} />)}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
                <span className="text-h3 font-semibold tabular-nums text-app-text">{groupIndian(focus ? focus.value : total)}</span>
                <span className="text-caption text-app-subtle">{focus ? `${focus.label} · ${Math.round((focus.value / total) * 100)}%` : centerLabel}</span>
              </div>
            </div>
            <div className="mt-4">
              <Legend items={shown.map((d, i) => ({ color: SLOT[i], label: d.label, value: groupIndian(d.value), href: d.href }))} />
            </div>
            <table className="sr-only">
              <caption>{title}</caption>
              <tbody>{shown.map((d) => <tr key={d.key}><td>{d.label}</td><td>{d.value}</td></tr>)}</tbody>
            </table>
          </>
        )}
      </CardBody>
    </Card>
  );
}

/** Open deal value per pipeline stage (single series → no legend; the title names it). */
export function PipelineChart({ data }: { data: StageBar[] }) {
  const router = useRouter();
  const total = data.reduce((a, d) => a + d.rupees, 0);
  return (
    <Card className="viz-root">
      <CardHeader title="Open pipeline by stage" description={`₹${groupIndian(Math.round(total))} in ${data.reduce((a, d) => a + d.deals, 0)} open deal(s)`} action={<Link href="/deals" className="text-small text-app-primary hover:underline">Deals →</Link>} />
      <CardBody>
        {!total ? (
          <EmptyState icon={BarChart3} title="No open deals" description="Add deals to see your pipeline here." className="py-8" />
        ) : (
          <>
            <div className="h-56" aria-hidden="true">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data} layout="vertical" margin={{ top: 0, right: 12, left: 0, bottom: 0 }} barCategoryGap={8}>
                  <CartesianGrid stroke="var(--viz-grid)" horizontal={false} />
                  <XAxis type="number" tick={{ fill: "currentColor", fontSize: 11 }} className="text-app-subtle" tickLine={false} axisLine={false} tickFormatter={(v: number) => `₹${compactIndian(v)}`} />
                  <YAxis type="category" dataKey="label" tick={{ fill: "currentColor", fontSize: 11 }} className="text-app-muted" tickLine={false} axisLine={false} width={88} />
                  <Tooltip cursor={{ fill: "currentColor", fillOpacity: 0.06 }} content={({ active, payload }) => (active && payload?.length ? <TipBox title={String(payload[0].payload.label)} rows={[{ color: SLOT[0], label: "Value", value: `₹${groupIndian(Math.round(Number(payload[0].value)))}` }, { label: "Deals", value: String(payload[0].payload.deals) }]} /> : null)} />
                  <Bar dataKey="rupees" fill={SLOT[0]} radius={[0, 4, 4, 0]} maxBarSize={22} className="cursor-pointer" onClick={() => router.push("/deals")} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <table className="sr-only">
              <caption>Open pipeline by stage</caption>
              <tbody>{data.map((d) => <tr key={d.label}><td>{d.label}</td><td>{d.rupees}</td><td>{d.deals}</td></tr>)}</tbody>
            </table>
          </>
        )}
      </CardBody>
    </Card>
  );
}
