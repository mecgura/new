import * as React from "react";
import { AlertCircle, CheckCircle2, Info, Loader2, TriangleAlert, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type AlertTone = "info" | "success" | "warning" | "danger";
const ALERT: Record<AlertTone, { cls: string; icon: LucideIcon }> = {
  info: { cls: "border-app-info/30 bg-app-info/10 text-blue-200", icon: Info },
  success: { cls: "border-app-success/30 bg-app-success/10 text-green-200", icon: CheckCircle2 },
  warning: { cls: "border-app-warning/30 bg-app-warning/10 text-amber-200", icon: TriangleAlert },
  danger: { cls: "border-app-danger/30 bg-app-danger/10 text-red-200", icon: AlertCircle },
};

export function Alert({
  tone = "info",
  title,
  children,
  className,
}: {
  tone?: AlertTone;
  title?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  const { cls, icon: Icon } = ALERT[tone];
  return (
    <div role={tone === "danger" || tone === "warning" ? "alert" : "status"} className={cn("flex gap-3 rounded-[var(--radius-control)] border px-4 py-3 text-small", cls, className)}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className={cn(title && "mt-0.5", "opacity-90")}>{children}</div> : null}
      </div>
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn("animate-pulse rounded-md bg-app-elevated", className)} />;
}

export function LoadingState({ label = "Loading…", className }: { label?: string; className?: string }) {
  return (
    <div role="status" aria-live="polite" className={cn("flex items-center justify-center gap-2 py-10 text-small text-app-muted", className)}>
      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
      {label}
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-12 text-center", className)}>
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-app-border bg-app-elevated text-app-muted">
        <Icon className="size-5" aria-hidden="true" />
      </span>
      <h3 className="mt-4 text-h3 text-app-text">{title}</h3>
      {description ? <p className="mt-1 max-w-sm text-small text-app-muted">{description}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  title = "Something went wrong",
  description = "We couldn't load this section. Please try again.",
  onRetry,
  className,
}: {
  title?: string;
  description?: React.ReactNode;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div role="alert" className={cn("flex flex-col items-center justify-center px-6 py-12 text-center", className)}>
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-app-danger/30 bg-app-danger/10 text-red-300">
        <AlertCircle className="size-5" aria-hidden="true" />
      </span>
      <h3 className="mt-4 text-h3 text-app-text">{title}</h3>
      <p className="mt-1 max-w-sm text-small text-app-muted">{description}</p>
      {onRetry ? (
        <button type="button" onClick={onRetry} className="mt-5 rounded-[var(--radius-control)] border border-app-border bg-app-elevated px-4 py-2 text-small font-semibold text-app-text hover:bg-app-hover">
          Try again
        </button>
      ) : null}
    </div>
  );
}

export type Step = { id: string; label: string; description?: string };

/** Vertical progress stepper. State is announced in text, not just colour. */
export function Stepper({ steps, current, failedAt, className }: { steps: Step[]; current: number; failedAt?: number; className?: string }) {
  return (
    <ol className={cn("space-y-0", className)}>
      {steps.map((s, i) => {
        const state = failedAt === i ? "failed" : i < current ? "done" : i === current ? "current" : "upcoming";
        return (
          <li key={s.id} className="relative flex gap-3 pb-5 last:pb-0" aria-current={state === "current" ? "step" : undefined}>
            {i < steps.length - 1 ? (
              <span aria-hidden="true" className={cn("absolute left-[11px] top-6 h-[calc(100%-1.25rem)] w-px", i < current ? "bg-app-primary" : "bg-app-border")} />
            ) : null}
            <span
              aria-hidden="true"
              className={cn(
                "relative z-10 flex size-6 shrink-0 items-center justify-center rounded-full border text-caption font-semibold",
                state === "done" && "border-app-primary bg-app-primary text-app-on-primary",
                state === "current" && "border-app-primary bg-app-primary-soft text-app-primary-hover",
                state === "upcoming" && "border-app-border-strong bg-app-elevated text-app-subtle",
                state === "failed" && "border-app-danger bg-app-danger/15 text-red-300"
              )}
            >
              {state === "done" ? "✓" : state === "failed" ? "!" : i + 1}
            </span>
            <div className="min-w-0 pt-0.5">
              <p className={cn("text-small font-medium", state === "upcoming" ? "text-app-subtle" : "text-app-text")}>
                {s.label}
                <span className="sr-only"> — {state}</span>
              </p>
              {s.description ? <p className="text-caption text-app-subtle">{s.description}</p> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
