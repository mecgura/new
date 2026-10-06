import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { buttonClass } from "./button";

interface Props {
  page: number;
  pageCount: number;
  /** Link-based (server-rendered lists): return the URL for a page */
  hrefFor?: (page: number) => string;
  /** Callback-based (client lists) */
  onPageChange?: (page: number) => void;
}

export function Pagination({ page, pageCount, hrefFor, onPageChange }: Props) {
  if (pageCount <= 1) return null;
  const item = (target: number, children: React.ReactNode, label: string) => {
    const disabled = target < 1 || target > pageCount;
    const cls = buttonClass("outline", "sm", "min-w-9");
    if (hrefFor && !disabled) return <Link href={hrefFor(target)} className={cls} aria-label={label}>{children}</Link>;
    return <button type="button" className={cls} aria-label={label} disabled={disabled} onClick={() => onPageChange?.(target)}>{children}</button>;
  };
  return (
    <nav aria-label="Pagination" className="flex items-center justify-between gap-3 pt-3">
      <p className="type-caption" aria-live="polite">Page {page} of {pageCount}</p>
      <div className="flex gap-2">
        {item(page - 1, <ChevronLeft aria-hidden className="size-4" />, "Previous page")}
        {item(page + 1, <ChevronRight aria-hidden className="size-4" />, "Next page")}
      </div>
    </nav>
  );
}
