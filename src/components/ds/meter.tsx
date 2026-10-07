import * as React from "react";
import { cn } from "@/lib/utils";
import { groupIndian } from "@/lib/catalog";

/**
 * Usage-vs-limit meter. Text always states the numbers (colour is never the only
 * signal); the bar turns amber at 80% and red at 100%.
 */
export function UsageMeter({
  label,
  used,
  limit,
  className,
  compact = false,
}: {
  label: string;
  used: number;
  /** null = no plan / unlimited */
  limit: number | null;
  className?: string;
  compact?: boolean;
}) {
  const unlimited = limit !== null && limit < 0; // -1 = unlimited on the plan
  const pct = limit && limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const tone = limit === null || unlimited ? "bg-app-border-strong" : pct >= 100 ? "bg-app-danger" : pct >= 80 ? "bg-app-warning" : "bg-app-primary";
  const fmt = groupIndian;
  return (
    <div className={cn("min-w-0", className)}>
      <div className={cn("flex items-baseline justify-between gap-2", compact ? "text-caption" : "text-small")}>
        <span className="truncate text-app-muted">{label}</span>
        <span className="shrink-0 tabular-nums text-app-text">
          {fmt(used)}
          <span className="text-app-subtle"> / {limit === null ? "—" : unlimited ? "Unlimited" : fmt(limit)}</span>
          {limit !== null && !unlimited && pct >= 100 ? <span className="sr-only"> (limit reached)</span> : null}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={limit !== null && !unlimited ? limit : undefined}
        aria-valuenow={used}
        className={cn("mt-1 w-full overflow-hidden rounded-full bg-app-elevated", compact ? "h-1" : "h-1.5")}
      >
        <div className={cn("h-full rounded-full", tone)} style={{ width: `${limit === null || unlimited ? 0 : Math.max(pct, used > 0 ? 2 : 0)}%` }} />
      </div>
    </div>
  );
}
