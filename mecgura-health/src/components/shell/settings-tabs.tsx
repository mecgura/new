"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

export type SettingsTab = { href: string; label: string };

export function SettingsTabs({ tabs }: { tabs: SettingsTab[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Settings sections" className="-mx-page flex gap-1 overflow-x-auto border-b border-line px-page">
      {tabs.map((t) => {
        const active = pathname === t.href;
        return <Link key={t.href} href={t.href} aria-current={active ? "page" : undefined} className={cn("type-label -mb-px flex min-h-control shrink-0 items-center whitespace-nowrap border-b-2 px-4 no-underline", active ? "border-primary !text-primary" : "border-transparent !text-muted hover:!text-ink")}>{t.label}</Link>;
      })}
    </nav>
  );
}
