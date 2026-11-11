"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

export function TabNav({ tabs, label }: { tabs: { href: string; label: string; exact?: boolean }[]; label: string }) {
  const path = usePathname();
  return (
    <nav aria-label={label} className="-mx-page flex gap-1 overflow-x-auto border-b border-line px-page">
      {tabs.map((t) => { const on = t.exact ? path === t.href : path === t.href || path.startsWith(`${t.href}/`); return <Link key={t.href} href={t.href} aria-current={on ? "page" : undefined} className={cn("type-label -mb-px flex min-h-control shrink-0 items-center whitespace-nowrap border-b-2 px-4 no-underline", on ? "border-primary !text-primary" : "border-transparent !text-muted hover:!text-ink")}>{t.label}</Link>; })}
    </nav>
  );
}
