import { AlertTriangle, Inbox, Loader2, WifiOff } from "lucide-react";
import { cn } from "@/lib/cn";
import type { ErrorCode } from "@/lib/errors";

export function Spinner({ className }: { className?: string }) {
  return <Loader2 aria-hidden className={cn("animate-spin", className)} />;
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("animate-[skeleton-pulse_1.4s_ease-in-out_infinite] rounded-md bg-surface-muted", className)} />;
}

/** Loading state: always announced to screen readers. */
export function LoadingState({ label = "Loading…", className }: { label?: string; className?: string }) {
  return (
    <div role="status" aria-live="polite" className={cn("flex flex-col items-center justify-center gap-3 px-4 py-12 text-center", className)}>
      <Spinner className="size-7 text-primary" />
      <p className="type-secondary">{label}</p>
    </div>
  );
}

/** Empty state: say what is empty and (optionally) what to do next. Never a blank screen. */
export function EmptyState({ title, description, action, icon, className }: { title: string; description?: string; action?: React.ReactNode; icon?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 px-4 py-12 text-center", className)}>
      <div aria-hidden className="mb-1 flex size-12 items-center justify-center rounded-pill bg-surface-muted text-muted">{icon ?? <Inbox className="size-6" />}</div>
      <h3 className="type-card-title">{title}</h3>
      {description && <p className="type-secondary max-w-sm">{description}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

const ERROR_COPY: Partial<Record<ErrorCode, { title: string; description: string }>> = {
  UNAUTHENTICATED: { title: "Please sign in", description: "Your session has ended. Sign in again to continue." },
  FORBIDDEN: { title: "No access", description: "You don't have permission to view this. Ask your clinic admin if you need access." },
  NOT_FOUND: { title: "Not found", description: "We couldn't find what you were looking for." },
  NETWORK_ERROR: { title: "You appear to be offline", description: "Check your internet connection and try again." },
  INTERNAL: { title: "Something went wrong", description: "This is on our side, not yours. Please try again." },
};

/** Error state with friendly copy per error code. Never shows technical details. */
export function ErrorState({ code = "INTERNAL", title, description, action, className }: { code?: ErrorCode; title?: string; description?: string; action?: React.ReactNode; className?: string }) {
  const copy = ERROR_COPY[code] ?? ERROR_COPY.INTERNAL!;
  const Icon = code === "NETWORK_ERROR" ? WifiOff : AlertTriangle;
  return (
    <div role="alert" className={cn("flex flex-col items-center justify-center gap-2 px-4 py-12 text-center", className)}>
      <div aria-hidden className="mb-1 flex size-12 items-center justify-center rounded-pill bg-danger-soft text-danger"><Icon className="size-6" /></div>
      <h3 className="type-card-title">{title ?? copy.title}</h3>
      <p className="type-secondary max-w-sm">{description ?? copy.description}</p>
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
