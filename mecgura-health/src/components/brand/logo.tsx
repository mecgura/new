/* eslint-disable @next/next/no-img-element -- tenant logos/avatars are arbitrary user-supplied URLs; next/image needs a fixed domain allow-list (later phase). */
import { HeartPulse } from "lucide-react";
import { cn } from "@/lib/cn";

/** Product mark, or the tenant's own logo when white-labelled. */
export function Logo({ name = "MECGURA", sub = "HEALTH", logoUrl, className, inverted, iconOnly }: { iconOnly?: boolean; name?: string; sub?: string | null; logoUrl?: string | null; className?: string; inverted?: boolean }) {
  return (
    <span className={cn("flex min-w-0 items-center gap-2.5", className)}>
      {logoUrl ? (
        <img src={logoUrl} alt="" className="size-9 shrink-0 rounded-md object-contain" />
      ) : (
        <span aria-hidden className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", inverted ? "bg-white/12 text-white" : "bg-primary text-on-brand")}><HeartPulse className="size-5" /></span>
      )}
      <span className={cn("min-w-0 leading-tight", iconOnly && "sr-only")}>
        <span className={cn("block truncate text-base font-bold tracking-wide", inverted ? "text-white" : "text-ink")}>{name}</span>
        {sub && <span className={cn("block text-[0.6875rem] font-semibold tracking-[0.18em]", inverted ? "text-sidebar-muted" : "text-muted")}>{sub}</span>}
      </span>
    </span>
  );
}
