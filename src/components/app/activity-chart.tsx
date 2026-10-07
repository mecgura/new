"use client";

import * as React from "react";
import { compactIndian, groupIndian } from "@/lib/catalog";

export type DayCount = { date: string; label: string; count: number };

/**
 * Single-series column chart (no legend needed — the card title names it).
 * Columns ≤ 24px with a 4px rounded data-end, hairline recessive grid, hover/focus
 * tooltip, and a visually hidden table so the values are never chart-only.
 */
export function ActivityChart({
  data,
  title,
  kind = "count",
  unit = ["event", "events"],
}: {
  data: DayCount[];
  title: string;
  /** "inr": values are paise, shown in rupees. */
  kind?: "count" | "inr";
  unit?: [string, string];
}) {
  const fmtTick = (n: number) => (kind === "inr" ? `₹${compactIndian(n / 100)}` : compactIndian(n));
  const fmtValue = (n: number) => (kind === "inr" ? `₹${groupIndian(n / 100)}` : `${groupIndian(n)} ${n === 1 ? unit[0] : unit[1]}`);
  const [hover, setHover] = React.useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => d.count));
  const rawStep = max <= 4 ? 1 : max / 4;
  const mag = 10 ** Math.floor(Math.log10(rawStep));
  const step = Math.max(1, Math.ceil(rawStep / mag) * mag);
  const top = step * Math.ceil(max / step);
  const ticks = Array.from({ length: Math.floor(top / step) + 1 }, (_, i) => i * step);
  const H = 180;

  return (
    <figure className="m-0">
      <div className="relative flex gap-2">
        <div className={`relative ${kind === "inr" ? "w-12" : "w-8"} shrink-0 text-right text-caption tabular-nums text-app-subtle`} style={{ height: H }} aria-hidden="true">
          {ticks.map((t) => (
            <span key={t} className="absolute right-0 -translate-y-1/2" style={{ top: H - (t / top) * H }}>
              {fmtTick(t)}
            </span>
          ))}
        </div>
        <div className="relative min-w-0 flex-1" style={{ height: H }}>
          {ticks.map((t) => (
            <div key={t} aria-hidden="true" className="absolute inset-x-0 h-px bg-app-border" style={{ top: H - (t / top) * H }} />
          ))}
          <div className="absolute inset-0 flex items-end">
            {data.map((d, i) => {
              const h = d.count === 0 ? 0 : Math.max(3, (d.count / top) * H);
              return (
                <button
                  key={d.date}
                  type="button"
                  aria-label={`${d.label}: ${fmtValue(d.count)}`}
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                  className="group relative flex h-full flex-1 items-end justify-center outline-none"
                >
                  <span
                    className="block w-full max-w-6 rounded-t bg-app-primary transition-opacity group-hover:opacity-80 group-focus-visible:ring-2 group-focus-visible:ring-app-primary-hover"
                    style={{ height: h, marginInline: 1 }}
                  />
                  {hover === i ? (
                    <span
                      role="tooltip"
                      className="pointer-events-none absolute z-10 -translate-y-2 whitespace-nowrap rounded-md border border-app-border bg-app-elevated px-2 py-1 text-caption text-app-text shadow-[var(--shadow-pop)]"
                      style={{ bottom: h }}
                    >
                      <span className="text-app-muted">{d.label}</span> · <span className="font-semibold tabular-nums">{fmtValue(d.count)}</span>
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      </div>
      <div className={`mt-2 flex ${kind === "inr" ? "pl-14" : "pl-10"} text-caption text-app-subtle`} aria-hidden="true">
        {data.map((d, i) => (
          <span key={d.date} className="flex-1 text-center">
            {data.length <= 8 || i % 3 === 0 || i === data.length - 1 ? d.label : ""}
          </span>
        ))}
      </div>
      <table className="sr-only">
        <caption>{title}</caption>
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Value</th>
          </tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.date}>
              <td>{d.label}</td>
              <td>{fmtValue(d.count)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
