"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export type BarSeries = { name: string; values: number[]; className: string };

/**
 * Small stacked bar chart. Every bar has a text equivalent (title + screen-reader label) and the legend names
 * each series — colour is never the only signal.
 */
export function MiniBars({ labels, series, height = 144, ariaLabel }: { labels: string[]; series: BarSeries[]; height?: number; ariaLabel: string }) {
  const totals = labels.map((_, i) => series.reduce((n, s) => n + (s.values[i] ?? 0), 0));
  const max = Math.max(1, ...totals);
  return (
    <figure>
      <ul className="flex items-end gap-px sm:gap-0.5" style={{ height }} aria-label={ariaLabel}>
        {labels.map((l, i) => (
          <li key={l} className="flex h-full min-w-0 flex-1 flex-col justify-end" title={`${l}: ${series.map((s) => `${s.name} ${s.values[i] ?? 0}`).join(", ")}`}>
            <div className="flex w-full flex-col-reverse overflow-hidden rounded-t-sm" style={{ height: `${(totals[i] / max) * 100}%`, minHeight: totals[i] ? 2 : 0 }}>
              {series.map((s) => (
                <div key={s.name} className={cn("w-full", s.className)} style={{ height: totals[i] ? `${((s.values[i] ?? 0) / totals[i]) * 100}%` : 0 }} />
              ))}
            </div>
            <span className="sr-only">
              {l}: {series.map((s) => `${s.name} ${s.values[i] ?? 0}`).join(", ")}
            </span>
          </li>
        ))}
      </ul>
      <figcaption className="mt-2 flex flex-wrap items-center justify-between gap-2 text-caption text-app-subtle">
        <span>
          {labels[0]} → {labels.at(-1)} (IST)
        </span>
        <span className="flex flex-wrap gap-3">
          {series.map((s) => (
            <span key={s.name} className="inline-flex items-center gap-1">
              <span className={cn("size-2.5 rounded-sm", s.className)} aria-hidden="true" /> {s.name}
            </span>
          ))}
        </span>
      </figcaption>
    </figure>
  );
}

export function fmtDuration(sec: number | null): string {
  if (sec === null) return "—";
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m ${sec % 60}s`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h ${m % 60}m` : `${Math.floor(h / 24)}d ${h % 24}h`;
}

export const fmtPct = (v: number | null) => (v === null ? "—" : `${v}%`);
