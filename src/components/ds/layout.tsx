import * as React from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export type Crumb = { label: string; href?: string };

export function Breadcrumb({ items, className }: { items: Crumb[]; className?: string }) {
  return (
    <nav aria-label="Breadcrumb" className={className}>
      <ol className="flex flex-wrap items-center gap-1 text-caption text-app-subtle">
        {items.map((c, i) => {
          const last = i === items.length - 1;
          return (
            <li key={`${c.label}-${i}`} className="flex items-center gap-1">
              {c.href && !last ? (
                <Link href={c.href} className="hover:text-app-text">
                  {c.label}
                </Link>
              ) : (
                <span aria-current={last ? "page" : undefined} className={cn(last && "text-app-muted")}>
                  {c.label}
                </span>
              )}
              {!last ? <ChevronRight className="size-3" aria-hidden="true" /> : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function PageHeader({
  title,
  description,
  breadcrumb,
  actions,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  breadcrumb?: Crumb[];
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between", className)}>
      <div className="min-w-0">
        {breadcrumb ? <Breadcrumb items={breadcrumb} className="mb-2" /> : null}
        <h1 className="text-h1 text-app-text">{title}</h1>
        {description ? <p className="mt-1 text-body text-app-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

/** Horizontal container for search + filter controls; wraps on small screens. */
export function FilterBar({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div role="search" className={cn("flex flex-col gap-2 border-b border-app-border p-4 sm:flex-row sm:flex-wrap sm:items-center", className)}>
      {children}
    </div>
  );
}
