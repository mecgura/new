import Link from "next/link";
import { ChevronRight } from "lucide-react";

export function Breadcrumb({ items }: { items: { label: string; href?: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-2">
      <ol className="type-caption flex flex-wrap items-center gap-1">
        {items.map((item, i) => {
          const last = i === items.length - 1;
          return (
            <li key={item.label} className="flex items-center gap-1">
              {item.href && !last ? <Link href={item.href} className="hover:underline">{item.label}</Link> : <span aria-current={last ? "page" : undefined} className={last ? "font-semibold text-ink" : ""}>{item.label}</span>}
              {!last && <ChevronRight aria-hidden className="size-3.5" />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
