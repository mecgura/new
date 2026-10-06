import { AlertOctagon, AlertTriangle, CheckCircle2, Clock, Info, XCircle } from "lucide-react";
import { cn } from "@/lib/cn";

export type Tone = "neutral" | "primary" | "success" | "warning" | "danger" | "info" | "emergency";

const tones: Record<Tone, string> = {
  neutral: "bg-surface-muted text-ink",
  primary: "bg-primary-soft text-primary",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
  info: "bg-info-soft text-info",
  emergency: "bg-emergency text-on-brand",
};

export function Badge({ tone = "neutral", className, ...rest }: { tone?: Tone } & React.HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn("type-caption inline-flex items-center gap-1 rounded-pill px-2.5 py-0.5 font-semibold", tones[tone], className)} {...rest} />;
}

const icons = { neutral: Info, primary: Info, success: CheckCircle2, warning: Clock, danger: XCircle, info: Info, emergency: AlertOctagon } as const;

/**
 * Status = colour + icon + text (never colour alone). Emergency additionally uses a solid fill,
 * heavier weight and an alert icon so it stays unmistakable for colour-blind users.
 */
export function StatusBadge({ tone = "neutral", children, className }: { tone?: Tone; children: React.ReactNode; className?: string }) {
  const Icon = tone === "warning" ? AlertTriangle : icons[tone];
  return (
    <Badge tone={tone} className={cn(tone === "emergency" && "font-bold uppercase tracking-wide", className)}>
      <Icon aria-hidden className="size-3.5" />
      {children}
    </Badge>
  );
}
