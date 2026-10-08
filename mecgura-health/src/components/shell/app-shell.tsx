"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import { Building2, Menu, PanelLeftClose, PanelLeftOpen, Search } from "lucide-react";
import type { NavItemView } from "@/config/navigation";
import { Logo } from "@/components/brand/logo";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { Badge, Drawer } from "@/components/ui";
import { cn } from "@/lib/cn";
import { NAV_ICONS } from "./nav-icons";
import { NavList, isActive } from "./nav-list";
import { UserMenu } from "./user-menu";

export interface ShellProps {
  nav: NavItemView[];
  user: { name: string; email: string; roleLabel: string; avatarUrl?: string | null };
  workspace: { name: string; isDemo: boolean; logoUrl: string | null } | null;
  children: React.ReactNode;
}

const PAGE_TITLES: Record<string, string> = { "/settings/branding": "Theme & branding", "/settings/integrations": "Integrations", "/design-system": "Design system" };
const STORAGE_KEY = "mh.sidebar.collapsed";
const SIDEBAR_EVENT = "mh-sidebar-change";

// Remembered preference; tablets (<1024px) default to the icon rail.
function readSidebar() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved !== null) return saved === "1";
  } catch { /* storage unavailable */ }
  return window.innerWidth < 1024;
}
function subscribeSidebar(cb: () => void) {
  window.addEventListener(SIDEBAR_EVENT, cb);
  return () => window.removeEventListener(SIDEBAR_EVENT, cb);
}

export function AppShell({ nav, user, workspace, children }: ShellProps) {
  const pathname = usePathname();
  const [drawer, setDrawer] = useState(false);
  const collapsed = useSyncExternalStore(subscribeSidebar, readSidebar, () => false);
  const toggle = () => {
    try { localStorage.setItem(STORAGE_KEY, collapsed ? "0" : "1"); } catch { /* storage unavailable */ }
    window.dispatchEvent(new Event(SIDEBAR_EVENT));
  };

  const current = nav.find((n) => !n.planned && isActive(pathname, n.href));
  const title = PAGE_TITLES[pathname] ?? current?.label ?? "MECGURA HEALTH";
  const linkItems = nav.filter((n) => !n.planned).slice(0, 4);

  return (
    <div className="min-h-dvh">
      <a href="#main" className="sr-only z-[70] rounded-md bg-surface px-3 py-2 focus:not-sr-only focus:fixed focus:left-3 focus:top-3">Skip to content</a>

      {/* Sidebar (md and up) */}
      <aside className={cn("fixed inset-y-0 left-0 z-30 hidden flex-col bg-sidebar transition-[width] duration-200 md:flex", collapsed ? "w-sidebar-collapsed" : "w-sidebar")}>
        <div className={cn("flex h-header shrink-0 items-center border-b border-white/10", collapsed ? "justify-center" : "px-5")}>
          <Logo inverted iconOnly={collapsed} name={workspace?.name ?? "MECGURA"} sub={workspace ? "MECGURA HEALTH" : "HEALTH"} logoUrl={workspace?.logoUrl} />
        </div>
        <NavList items={nav} collapsed={collapsed} />
        <div className="border-t border-white/10 p-3">
          <button type="button" onClick={toggle} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} aria-expanded={!collapsed}
            className={cn("flex min-h-control w-full items-center gap-3 rounded-lg px-3 text-sm font-medium text-sidebar-text hover:bg-sidebar-hover", collapsed && "justify-center px-0")}>
            {collapsed ? <PanelLeftOpen aria-hidden className="size-5" /> : <><PanelLeftClose aria-hidden className="size-5" /><span>Collapse</span></>}
          </button>
        </div>
      </aside>

      {/* Mobile drawer navigation */}
      <Drawer flush open={drawer} onClose={() => setDrawer(false)} title="Menu" description={workspace?.name}>
        <div className="flex min-h-full flex-col bg-sidebar">
          <NavList items={nav} onNavigate={() => setDrawer(false)} />
        </div>
      </Drawer>

      <div className={cn("flex min-h-dvh flex-col transition-[padding] duration-200", collapsed ? "md:pl-sidebar-collapsed" : "md:pl-sidebar")}>
        <header className="sticky top-0 z-20 flex h-header items-center gap-2 border-b border-line bg-surface/95 px-3 backdrop-blur md:gap-3 md:px-page">
          <button type="button" onClick={() => setDrawer(true)} aria-label="Open menu" className="flex size-control items-center justify-center rounded-lg hover:bg-surface-muted md:hidden"><Menu aria-hidden className="size-6" /></button>
          <p className="type-card-title min-w-0 truncate md:shrink-0 md:text-lg">{title}</p>

          {/* Search placeholder — global search arrives with the Patients module */}
          <div className="mx-auto hidden min-w-0 flex-1 max-w-md lg:block">
            <div role="search" className="relative">
              <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
              <input type="search" disabled aria-label="Global search (not available yet)" placeholder="Search will be available in a later phase" className="type-secondary min-h-10 w-full cursor-not-allowed rounded-lg border border-line bg-surface-muted pl-9 pr-3" />
            </div>
          </div>

          <div className="ml-auto flex items-center gap-1.5 md:gap-2">
            {workspace && (
              <span className="hidden min-w-0 items-center gap-2 rounded-lg border border-line px-3 py-1.5 sm:flex" title="Current workspace">
                <Building2 aria-hidden className="size-4 shrink-0 text-muted" />
                <span className="max-w-40 truncate text-sm font-semibold">{workspace.name}</span>
                {workspace.isDemo && <Badge tone="warning">Demo</Badge>}
              </span>
            )}
            <NotificationBell />
            <UserMenu {...user} />
          </div>
        </header>

        <main id="main" tabIndex={-1} className="min-w-0 flex-1 px-page py-section pb-[calc(var(--size-bottom-nav)+1.5rem)] md:pb-section">
          {workspace?.isDemo && <p className="type-caption mb-4 rounded-lg bg-warning-soft px-3 py-2 !text-warning"><strong>Demo workspace.</strong> Contains only sample data — never enter real patient information.</p>}
          {children}
        </main>
      </div>

      {/* Bottom navigation (mobile) */}
      <nav aria-label="Quick navigation" className="fixed inset-x-0 bottom-0 z-30 flex h-bottom-nav items-stretch border-t border-line bg-surface md:hidden">
        {linkItems.map((item) => {
          const Icon = NAV_ICONS[item.icon];
          const active = isActive(pathname, item.href);
          return (
            <Link key={item.module} href={item.href} aria-current={active ? "page" : undefined} className={cn("flex flex-1 flex-col items-center justify-center gap-0.5 text-[0.75rem] font-medium", active ? "text-primary" : "text-muted")}>
              <Icon aria-hidden className="size-5" />{item.label}
            </Link>
          );
        })}
        <button type="button" onClick={() => setDrawer(true)} className="flex flex-1 flex-col items-center justify-center gap-0.5 text-[0.75rem] font-medium text-muted"><Menu aria-hidden className="size-5" />Menu</button>
      </nav>
    </div>
  );
}
