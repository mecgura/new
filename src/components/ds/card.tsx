import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ds/badge";

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("min-w-0 rounded-[var(--radius-card)] border border-app-border bg-app-surface shadow-[var(--shadow-card)]", className)}
      {...props}
    />
  );
}

export function CardHeader({
  title,
  description,
  action,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-3 border-b border-app-border px-5 py-4", className)}>
      <div className="min-w-0">
        <h2 className="text-h3 text-app-text">{title}</h2>
        {description ? <p className="mt-0.5 text-small text-app-muted">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function CardBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-5", className)} {...props} />;
}

export type StatCardProps = {
  label: string;
  /** `null` renders an em dash — use for metrics that aren't connected yet. */
  value: React.ReactNode | null;
  icon: LucideIcon;
  hint?: React.ReactNode;
  /** Explicit data-source label so demo or unconnected numbers are never mistaken for live data. */
  source?: "live" | "demo" | "not-connected" | "coming-soon";
  className?: string;
};

const SOURCE_BADGE = {
  live: null,
  demo: <Badge tone="warning">Demo data</Badge>,
  "not-connected": <Badge tone="neutral">Not connected</Badge>,
  "coming-soon": <Badge tone="neutral">Coming soon</Badge>,
} as const;

export function StatCard({ label, value, icon: Icon, hint, source = "live", className }: StatCardProps) {
  return (
    <Card className={cn("flex flex-col gap-4 p-5", className)}>
      <div className="flex items-start justify-between gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-app-primary-soft text-app-primary">
          <Icon className="size-5" aria-hidden="true" />
        </span>
        {SOURCE_BADGE[source]}
      </div>
      <div>
        <p className="text-small text-app-muted">{label}</p>
        <p className="mt-1 text-h1 tabular-nums text-app-text">{value ?? <span className="text-app-subtle">—</span>}</p>
        {hint ? <p className="mt-1 text-caption text-app-subtle">{hint}</p> : null}
      </div>
    </Card>
  );
}
