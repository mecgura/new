import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { StatusBadge, type Tone } from "@/components/ui";
import { cn } from "@/lib/cn";

/** Small, calm building blocks for the portal's server-rendered pages. */
export function PageTitle({ title, subtitle, action, back }: { title: string; subtitle?: string; action?: React.ReactNode; back?: { href: string; label: string } }) {
  return (
    <div className="mb-5">
      {back && <Link href={back.href} className="type-label mb-2 inline-flex min-h-10 items-center">← {back.label}</Link>}
      <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h1 className="type-page-title">{title}</h1>{subtitle && <p className="type-secondary mt-1">{subtitle}</p>}</div>{action}</div>
    </div>
  );
}
export const Pill = ({ status, map }: { status: string; map: Record<string, [string, Tone]> }) => <StatusBadge tone={map[status]?.[1] ?? "neutral"}>{map[status]?.[0] ?? status.replace(/_/g, " ").toLowerCase()}</StatusBadge>;
export function Section({ title, action, children, className }: { title?: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-2xl border border-line bg-surface", className)}>
      {(title || action) && <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3"><h2 className="type-card-title">{title}</h2>{action}</div>}
      {children}
    </section>
  );
}
export function RowLink({ href, title, meta, right, children }: { href?: string; title: React.ReactNode; meta?: React.ReactNode; right?: React.ReactNode; children?: React.ReactNode }) {
  const body = (
    <>
      <div className="min-w-0 flex-1"><p className="type-label break-words">{title}</p>{meta && <p className="type-secondary mt-0.5 break-words">{meta}</p>}{children}</div>
      {right && <div className="flex shrink-0 flex-col items-end gap-1">{right}</div>}
      {href && <ChevronRight aria-hidden className="size-5 shrink-0 text-muted" />}
    </>
  );
  const cls = "flex min-h-14 items-center gap-3 px-4 py-3";
  return href ? <li><Link href={href} className={cn(cls, "no-underline hover:bg-surface-muted")}>{body}</Link></li> : <li className={cls}>{body}</li>;
}
export const Empty = ({ title, hint, action }: { title: string; hint?: string; action?: React.ReactNode }) => <div className="px-4 py-10 text-center"><p className="type-card-title">{title}</p>{hint && <p className="type-secondary mt-1">{hint}</p>}{action && <div className="mt-4 flex justify-center">{action}</div>}</div>;
export function FilterTabs({ items, current, base, param = "filter" }: { items: [string, string][]; current: string; base: string; param?: string }) {
  return (
    <nav aria-label="Filter" className="-mx-1 mb-4 flex gap-2 overflow-x-auto px-1">
      {items.map(([k, l]) => <Link key={k} href={`${base}${k ? `${base.includes("?") ? "&" : "?"}${param}=${k}` : ""}`} aria-current={current === k ? "true" : undefined} className={cn("type-label inline-flex min-h-11 shrink-0 items-center rounded-full border px-4 no-underline", current === k ? "border-primary bg-primary-soft !text-primary" : "border-line !text-ink hover:bg-surface-muted")}>{l}</Link>)}
    </nav>
  );
}
export function Pager({ page, total, pageSize, href }: { page: number; total: number; pageSize: number; href: (p: number) => string }) {
  const pages = Math.max(1, Math.ceil(total / pageSize)); if (pages <= 1) return null;
  return <nav aria-label="Pages" className="mt-4 flex items-center justify-between gap-3"><p className="type-caption">Page {page} of {pages}</p><div className="flex gap-2">{page > 1 && <Link href={href(page - 1)} className="type-button inline-flex min-h-11 items-center rounded-md border border-line-strong px-4 no-underline">Previous</Link>}{page < pages && <Link href={href(page + 1)} className="type-button inline-flex min-h-11 items-center rounded-md border border-line-strong px-4 no-underline">Next</Link>}</div></nav>;
}
