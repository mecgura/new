"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { NavItemView } from "@/config/navigation";
import { cn } from "@/lib/cn";
import { NAV_ICONS } from "./nav-icons";

export function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Sidebar navigation. Not-yet-built modules render as disabled "Soon" entries, never as links. */
export function NavList({ items, collapsed, onNavigate }: { items: NavItemView[]; collapsed?: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main navigation" className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
      <ul className="flex flex-col gap-1">
        {items.map((item) => {
          const Icon = NAV_ICONS[item.icon];
          const base = cn("flex min-h-control items-center gap-3 rounded-lg px-3 text-sm font-medium", collapsed && "justify-center px-0");
          const label = <span className={cn("min-w-0 flex-1 truncate", collapsed && "sr-only")}>{item.label}</span>;
          if (item.planned) {
            return (
              <li key={item.module}>
                <span aria-disabled="true" title={collapsed ? `${item.label} (coming soon)` : undefined} className={cn(base, "cursor-not-allowed text-sidebar-muted/70")}>
                  <Icon aria-hidden className="size-5 shrink-0" />
                  {label}
                  <span className={cn("rounded-pill bg-white/10 px-2 py-0.5 text-[0.6875rem] font-semibold text-sidebar-muted", collapsed && "sr-only")}>Soon</span>
                  {collapsed && <span className="sr-only">(coming soon)</span>}
                </span>
              </li>
            );
          }
          const active = isActive(pathname, item.href);
          return (
            <li key={item.module}>
              <Link href={item.href} onClick={onNavigate} aria-current={active ? "page" : undefined} title={collapsed ? item.label : undefined}
                className={cn(base, active ? "bg-sidebar-active text-white" : "text-sidebar-text hover:bg-sidebar-hover")}>
                <Icon aria-hidden className="size-5 shrink-0" />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
