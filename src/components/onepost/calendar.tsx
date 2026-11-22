"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Alert, Badge, Button, Card, CardBody, ErrorState, LoadingState, useToast } from "@/components/ds";
import { apiFetch } from "@/lib/client-api";
import { DELIVERY_LABELS, DELIVERY_TONES, PUBLISH_LABELS, dateToIstInput, istParts, istToDate, moveToIstDay, type DeliveryStatus, type PublishChannel } from "@/lib/onepost-publish";

type Item = { id: string; postId: string; title: string; channel: PublishChannel; status: DeliveryStatus; at: string; movable: boolean; url: string };
type Data = { items: Item[]; ready: { id: string; title: string }[] };

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const pad = (n: number) => String(n).padStart(2, "0");
const key = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const timeFmt = (iso: string) => {
  const p = istParts(new Date(iso));
  return `${pad(p.hour)}:${pad(p.minute)}`;
};
const SHORT: Record<PublishChannel, string> = { facebook: "FB", instagram: "IG", linkedin: "in", gbp: "GBP", wordpress: "WP", youtube: "YT" };
const STATUS_CLASS: Record<DeliveryStatus, string> = {
  queued: "border-app-info/40 bg-app-info/10",
  publishing: "border-app-info/40 bg-app-info/10",
  published: "border-app-success/40 bg-app-success/10",
  failed: "border-app-danger/40 bg-app-danger/10",
  cancelled: "border-app-border bg-app-elevated opacity-60",
};

/** A day in India time as a plain calendar date (no timezone maths in the grid). */
const utcDay = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
const parts = (dt: Date) => ({ y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() });
const addDays = (dt: Date, n: number) => new Date(dt.getTime() + n * 86_400_000);
const mondayOf = (dt: Date) => addDays(dt, -((dt.getUTCDay() + 6) % 7));

/** Month and week view of everything queued or published. Posts that are still waiting can be dragged to another day. */
export function OnePostCalendar({ orgId, canMove }: { orgId: string; canMove: boolean }) {
  const toast = useToast();
  const today = istParts(new Date());
  const [view, setView] = React.useState<"month" | "week">("month");
  const [cursor, setCursor] = React.useState(() => utcDay(today.year, today.month, today.day));
  const [data, setData] = React.useState<Data | null>(null);
  const [error, setError] = React.useState("");
  const [dragging, setDragging] = React.useState<string | null>(null);
  const [over, setOver] = React.useState("");

  const c = parts(cursor);
  // Primitive dependencies only: a new Date object every render would make the data reload in an endless loop.
  const firstMs = (view === "month" ? mondayOf(utcDay(c.y, c.m, 1)) : mondayOf(cursor)).getTime();
  const count = view === "month" ? 42 : 7;
  const days = React.useMemo(() => Array.from({ length: count }, (_, i) => new Date(firstMs + i * 86_400_000)), [firstMs, count]);

  const load = React.useCallback(async () => {
    const a = parts(days[0]);
    const b = parts(addDays(days[days.length - 1], 1));
    const from = istToDate(`${key(a.y, a.m, a.d)}T00:00`)!.toISOString();
    const to = istToDate(`${key(b.y, b.m, b.d)}T00:00`)!.toISOString();
    const r = await apiFetch<Data>(`/api/organizations/${orgId}/onepost/calendar?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
    if (!r.ok) return setError(r.error);
    setError("");
    setData(r.data);
  }, [orgId, days]);
  React.useEffect(() => {
    const id = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(id);
  }, [load]);

  const byDay = React.useMemo(() => {
    const m = new Map<string, Item[]>();
    for (const it of data?.items ?? []) {
      const p = istParts(new Date(it.at));
      const k = key(p.year, p.month, p.day);
      m.set(k, [...(m.get(k) ?? []), it]);
    }
    for (const list of m.values()) list.sort((x, y) => x.at.localeCompare(y.at));
    return m;
  }, [data]);

  async function drop(dayKey: string, y: number, mo: number, d: number, dragged: string) {
    const id = dragged || dragging;
    setDragging(null);
    setOver("");
    const it = data?.items.find((x) => x.id === id);
    if (!it || !it.movable) return;
    const next = moveToIstDay(new Date(it.at), y, mo, d);
    if (!next || key(istParts(new Date(it.at)).year, istParts(new Date(it.at)).month, istParts(new Date(it.at)).day) === dayKey) return;
    const r = await apiFetch(`/api/organizations/${orgId}/onepost/deliveries/${it.id}`, { method: "PATCH", body: { scheduledAt: dateToIstInput(next) } });
    if (!r.ok) toast(r.error, "error");
    else toast(`Moved to ${d} ${MONTHS[mo - 1].slice(0, 3)}, same time`, "success");
    void load();
  }

  const step = (dir: -1 | 1) => setCursor(view === "month" ? utcDay(c.y, c.m + dir, 1) : addDays(cursor, dir * 7));
  const title = view === "month" ? `${MONTHS[c.m - 1]} ${c.y}` : `${days[0].getUTCDate()} ${MONTHS[days[0].getUTCMonth()].slice(0, 3)} – ${days[6].getUTCDate()} ${MONTHS[days[6].getUTCMonth()].slice(0, 3)} ${days[6].getUTCFullYear()}`;
  const todayKey = key(today.year, today.month, today.day);

  return (
    <div className="mt-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" aria-label="Previous" onClick={() => step(-1)}>
            <ChevronLeft aria-hidden="true" />
          </Button>
          <h2 className="min-w-44 text-center text-h3 text-app-text" aria-live="polite">{title}</h2>
          <Button variant="secondary" size="sm" aria-label="Next" onClick={() => step(1)}>
            <ChevronRight aria-hidden="true" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setCursor(utcDay(today.year, today.month, today.day))}>
            Today
          </Button>
        </div>
        <div className="flex gap-1" role="group" aria-label="Calendar view">
          {(["month", "week"] as const).map((v) => (
            <Button key={v} size="sm" variant={view === v ? "primary" : "secondary"} aria-pressed={view === v} onClick={() => setView(v)}>
              {v === "month" ? "Month" : "Week"}
            </Button>
          ))}
        </div>
      </div>
      <p className="text-caption text-app-subtle">All times are India time (IST). {canMove ? "Drag a waiting post to another day to move it; its time of day stays the same." : "Owners and managers can move waiting posts."}</p>

      {error ? (
        <ErrorState description={error} onRetry={load} />
      ) : !data ? (
        <LoadingState label="Loading calendar…" />
      ) : (
        <>
          <div className="overflow-x-auto">
            <div className="grid min-w-[44rem] grid-cols-7 gap-px overflow-hidden rounded-[var(--radius-card)] border border-app-border bg-app-border">
              {DAYS.map((d) => (
                <div key={d} className="bg-app-surface px-2 py-1.5 text-center text-caption font-medium text-app-muted">
                  {d}
                </div>
              ))}
              {days.map((dt) => {
                const p = parts(dt);
                const k = key(p.y, p.m, p.d);
                const items = byDay.get(k) ?? [];
                const muted = view === "month" && p.m !== c.m;
                return (
                  <div
                    key={k}
                    onDragOver={(e) => {
                      if (canMove) {
                        e.preventDefault();
                        setOver(k);
                      }
                    }}
                    onDragLeave={() => setOver((o) => (o === k ? "" : o))}
                    onDrop={(e) => {
                      e.preventDefault();
                      void drop(k, p.y, p.m, p.d, e.dataTransfer.getData("text/plain"));
                    }}
                    className={`${view === "week" ? "min-h-56" : "min-h-28"} bg-app-surface p-1.5 ${muted ? "opacity-50" : ""} ${over === k ? "outline outline-2 -outline-offset-2 outline-[var(--color-app-primary)]" : ""}`}
                  >
                    <p className={`mb-1 text-caption ${k === todayKey ? "inline-flex size-5 items-center justify-center rounded-full bg-[var(--color-app-primary)] font-bold text-app-on-primary" : "text-app-subtle"}`}>{p.d}</p>
                    <ul className="space-y-1">
                      {items.map((it) => (
                        <li key={it.id}>
                          <Link
                            href={`/onepost/${it.postId}`}
                            draggable={canMove && it.movable}
                            onDragStart={(e) => {
                              e.dataTransfer.setData("text/plain", it.id);
                              e.dataTransfer.effectAllowed = "move";
                              setDragging(it.id);
                            }}
                            onDragEnd={() => {
                              setDragging(null);
                              setOver("");
                            }}
                            title={`${PUBLISH_LABELS[it.channel]} · ${DELIVERY_LABELS[it.status]} · ${it.title}`}
                            className={`block truncate rounded border px-1.5 py-1 text-caption text-app-text ${STATUS_CLASS[it.status]} ${canMove && it.movable ? "cursor-grab" : ""}`}
                          >
                            <span className="font-semibold">{SHORT[it.channel]}</span> {timeFmt(it.at)} {it.title}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          </div>
          {!data.items.length ? <Alert tone="info">Nothing is scheduled or published in this period. Approve a post, then choose Publish or Schedule on its page.</Alert> : null}
          {data.ready.length ? (
            <Card>
              <CardBody>
                <h3 className="text-body font-semibold text-app-text">Approved and ready to schedule</h3>
                <ul className="mt-2 flex flex-wrap gap-2">
                  {data.ready.map((r) => (
                    <li key={r.id}>
                      <Link href={`/onepost/${r.id}`} className="rounded-full border border-app-border px-3 py-1 text-small text-app-text hover:border-app-primary/50">
                        {r.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          ) : null}
          <div className="flex flex-wrap gap-2 text-caption text-app-subtle">
            {(["queued", "published", "failed"] as const).map((s) => (
              <Badge key={s} tone={DELIVERY_TONES[s]} dot>
                {DELIVERY_LABELS[s]}
              </Badge>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
