import { AlertOctagon, AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { cn } from "@/lib/cn";

type AlertTone = "info" | "success" | "warning" | "danger" | "emergency";
const styles: Record<AlertTone, string> = {
  info: "border-info/30 bg-info-soft text-ink [&_svg]:text-info",
  success: "border-success/30 bg-success-soft text-ink [&_svg]:text-success",
  warning: "border-warning/30 bg-warning-soft text-ink [&_svg]:text-warning",
  danger: "border-danger/30 bg-danger-soft text-ink [&_svg]:text-danger",
  emergency: "border-emergency bg-emergency-soft text-ink [&_svg]:text-emergency",
};
const icons = { info: Info, success: CheckCircle2, warning: AlertTriangle, danger: AlertOctagon, emergency: AlertOctagon };

export function Alert({ tone = "info", title, children, className }: { tone?: AlertTone; title?: string; children?: React.ReactNode; className?: string }) {
  const Icon = icons[tone];
  const urgent = tone === "danger" || tone === "emergency";
  return (
    <div role={urgent ? "alert" : "status"} className={cn("flex gap-3 rounded-lg border p-3.5", styles[tone], className)}>
      <Icon aria-hidden className="mt-0.5 size-5 shrink-0" />
      <div className="min-w-0">
        {title && <p className="type-label">{title}</p>}
        {children && <div className={cn("type-secondary", title && "mt-0.5", "!text-ink")}>{children}</div>}
      </div>
    </div>
  );
}
