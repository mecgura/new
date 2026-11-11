import { cn } from "@/lib/cn";

export function Progress({ value, max = 100, label, className }: { value: number; max?: number; label: string; className?: string }) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  return (
    <div className={className}>
      <div className="mb-1 flex justify-between"><span className="type-caption">{label}</span><span className="type-caption">{Math.round(pct)}%</span></div>
      <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} className="h-2 overflow-hidden rounded-pill bg-surface-muted">
        <div className={cn("h-full rounded-pill bg-primary transition-[width]")} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
