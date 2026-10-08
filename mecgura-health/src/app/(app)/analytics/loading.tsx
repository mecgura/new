import { Skeleton } from "@/components/ui";

export default function Loading() {
  return (
    <div role="status" aria-live="polite" aria-label="Loading analytics" className="space-y-4">
      <Skeleton className="h-16 w-full" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-24" />)}</div>
      <Skeleton className="h-48 w-full" /><span className="sr-only">Loading analytics…</span>
    </div>
  );
}
