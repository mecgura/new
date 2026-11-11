"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

export function WebsiteTabs({ tabs }: { tabs: { href: string; label: string; badge?: number }[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Website sections" className="-mx-page flex gap-1 overflow-x-auto border-b border-line px-page">
      {tabs.map((t) => {
        const active = t.href === "/website" ? pathname === "/website" : pathname === t.href || pathname.startsWith(`${t.href}/`);
        return <Link key={t.href} href={t.href} aria-current={active ? "page" : undefined} className={cn("type-label -mb-px flex min-h-control shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-4 no-underline", active ? "border-primary !text-primary" : "border-transparent !text-muted hover:!text-ink")}>{t.label}{!!t.badge && <span className="rounded-pill bg-primary px-1.5 text-xs font-semibold text-on-brand">{t.badge}</span>}</Link>;
      })}
    </nav>
  );
}
