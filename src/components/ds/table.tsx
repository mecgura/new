import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/** Horizontally scrollable on small screens — the page itself never overflows. */
export function Table({ className, caption, children, ...props }: React.TableHTMLAttributes<HTMLTableElement> & { caption?: string }) {
  return (
    <div className="app-scroll relative w-full overflow-x-auto">
      <table className={cn("w-full min-w-[640px] border-collapse text-left text-small", className)} {...props}>
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        {children}
      </table>
    </div>
  );
}

export function THead(props: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className="border-b border-app-border text-caption uppercase tracking-wider text-app-subtle" {...props} />;
}

export function TBody(props: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className="divide-y divide-app-border" {...props} />;
}

export function TR({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn("transition-colors hover:bg-app-hover/60", className)} {...props} />;
}

export function TH({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return <th scope="col" className={cn("px-4 py-3 font-medium", className)} {...props} />;
}

export function TD({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn("px-4 py-3 align-middle text-app-text", className)} {...props} />;
}

export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  className,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  className?: string;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const btn =
    "inline-flex h-8 items-center gap-1 rounded-[var(--radius-control)] border border-app-border px-2.5 text-small text-app-text hover:bg-app-hover disabled:pointer-events-none disabled:opacity-40";
  return (
    <nav aria-label="Pagination" className={cn("flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-small text-app-muted", className)}>
      <p>
        Showing <span className="text-app-text">{from}</span>–<span className="text-app-text">{to}</span> of{" "}
        <span className="text-app-text">{total}</span>
      </p>
      <div className="flex items-center gap-2">
        <button type="button" className={btn} disabled={page <= 1} onClick={() => onPageChange(page - 1)} aria-label="Previous page">
          <ChevronLeft className="size-4" aria-hidden="true" /> Prev
        </button>
        <span aria-current="page">
          {page} / {pages}
        </span>
        <button type="button" className={btn} disabled={page >= pages} onClick={() => onPageChange(page + 1)} aria-label="Next page">
          Next <ChevronRight className="size-4" aria-hidden="true" />
        </button>
      </div>
    </nav>
  );
}
