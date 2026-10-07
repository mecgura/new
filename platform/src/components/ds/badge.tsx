import * as React from "react";
import { cn } from "@/lib/utils";

export type BadgeTone = "neutral" | "primary" | "success" | "warning" | "danger" | "info";

const TONES: Record<BadgeTone, string> = {
  neutral: "border-app-border-strong bg-app-elevated text-app-muted",
  primary: "border-app-primary/30 bg-app-primary-soft text-app-primary-hover",
  success: "border-app-success/30 bg-app-success/10 text-green-300",
  warning: "border-app-warning/30 bg-app-warning/10 text-amber-300",
  danger: "border-app-danger/30 bg-app-danger/10 text-red-300",
  info: "border-app-info/30 bg-app-info/10 text-blue-300",
};

/** Status text is always rendered — colour is never the only indicator. */
export function Badge({
  tone = "neutral",
  dot = false,
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone; dot?: boolean }) {
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-caption font-medium", TONES[tone], className)}
      {...props}
    >
      {dot ? <span aria-hidden="true" className="size-1.5 rounded-full bg-current" /> : null}
      {children}
    </span>
  );
}

export function Avatar({ name, size = "md", className }: { name?: string | null; size?: "sm" | "md" | "lg"; className?: string }) {
  const initials =
    (name ?? "?")
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? "")
      .join("") || "?";
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center rounded-full border border-app-primary/30 bg-app-primary-soft font-semibold text-app-primary-hover",
        size === "sm" && "h-7 w-7 text-caption",
        size === "md" && "h-9 w-9 text-small",
        size === "lg" && "h-12 w-12 text-body",
        className
      )}
    >
      {initials}
    </span>
  );
}
