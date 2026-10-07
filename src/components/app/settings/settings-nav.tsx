"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/settings", label: "Profile" },
  { href: "/settings/security", label: "Security" },
  { href: "/settings/organization", label: "Organization" },
  { href: "/team", label: "Team" },
];

/** Route-based tabs: each section is its own URL so it can be linked and refreshed. */
export function SettingsNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Settings sections" className="app-scroll mb-6 flex gap-1 overflow-x-auto border-b border-app-border">
      {TABS.map((t) => {
        const active = pathname === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "-mb-px whitespace-nowrap border-b-2 px-3.5 py-2.5 text-small font-medium transition-colors",
              active ? "border-app-primary text-app-text" : "border-transparent text-app-muted hover:text-app-text"
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
