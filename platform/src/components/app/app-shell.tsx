"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import {
  Building2,
  ChevronsUpDown,
  CircleHelp,
  LayoutDashboard,
  LogOut,
  Mail,
  Menu,
  MessageCircle,
  Search,
  Settings,
  Shield,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/layout/logo";
import { ADMIN_NAV, CLIENT_NAV, isActive, type NavSection } from "@/config/app-nav";
import { siteConfig } from "@/config/site";
import { ORG_ROLE_LABELS, type OrgRole } from "@/lib/authz";
import {
  Avatar,
  Badge,
  Drawer,
  Dropdown,
  DropdownItem,
  DropdownLabel,
  DropdownSeparator,
  IconButton,
  Modal,
  SearchBar,
  ToastProvider,
} from "@/components/ds";
import { NotificationsMenu } from "@/components/app/notifications-menu";

export type ShellUser = { name: string | null; email: string; isSuperAdmin: boolean };
export type ShellOrg = { id: string; name: string; role: OrgRole };

export function AppShell({
  variant,
  user,
  organizations,
  activeOrganizationId,
  children,
}: {
  variant: "client" | "admin";
  user: ShellUser;
  organizations: ShellOrg[];
  activeOrganizationId: string | null;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const [searchOpen, setSearchOpen] = React.useState(false);
  const sections = variant === "admin" ? ADMIN_NAV : CLIENT_NAV;

  // Close the mobile drawer whenever the route changes.
  const [lastPath, setLastPath] = React.useState(pathname);
  if (lastPath !== pathname) {
    setLastPath(pathname);
    setMobileOpen(false);
  }

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    // `dark` scopes Tailwind dark: variants so existing admin pages render in their dark style.
    <ToastProvider>
      <div className="app-root dark flex min-h-dvh">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:bg-app-primary focus:px-4 focus:py-2 focus:font-semibold focus:text-app-on-primary"
        >
          Skip to content
        </a>
        <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 border-r border-app-border bg-app-surface lg:block">
          <Sidebar variant={variant} sections={sections} pathname={pathname} />
        </aside>
        <Drawer open={mobileOpen} onClose={() => setMobileOpen(false)} title="Main navigation">
          <Sidebar variant={variant} sections={sections} pathname={pathname} onClose={() => setMobileOpen(false)} />
        </Drawer>

        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar
            variant={variant}
            user={user}
            organizations={organizations}
            activeOrganizationId={activeOrganizationId}
            onOpenMenu={() => setMobileOpen(true)}
            onOpenSearch={() => setSearchOpen(true)}
          />
          <main id="main-content" className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 sm:px-6 lg:px-8">
            {children}
          </main>
        </div>
        <GlobalSearch open={searchOpen} onClose={() => setSearchOpen(false)} sections={sections} />
      </div>
    </ToastProvider>
  );
}

function Sidebar({
  variant,
  sections,
  pathname,
  onClose,
}: {
  variant: "client" | "admin";
  sections: NavSection[];
  pathname: string;
  onClose?: () => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-16 items-center justify-between gap-2 border-b border-app-border px-4">
        <Logo href={variant === "admin" ? "/admin" : "/dashboard"} className="[&_img]:h-8" />
        {onClose ? (
          <IconButton label="Close navigation" onClick={onClose} size="sm">
            <X aria-hidden="true" />
          </IconButton>
        ) : null}
      </div>
      {variant === "admin" ? (
        <div className="px-4 pt-4">
          <Badge tone="primary" className="w-full justify-center py-1">
            <Shield className="size-3" aria-hidden="true" /> Super Admin
          </Badge>
        </div>
      ) : null}
      <nav aria-label={variant === "admin" ? "Admin" : "Workspace"} className="app-scroll flex-1 overflow-y-auto px-3 py-4">
        {sections.map((section, si) => (
          <div key={si} className={cn(si > 0 && "mt-5")}>
            {section.title ? <p className="mb-1.5 px-3 text-caption font-semibold uppercase tracking-wider text-app-subtle">{section.title}</p> : null}
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const Icon = item.icon;
                if (!item.href) {
                  return (
                    <li key={item.label}>
                      <span
                        aria-disabled="true"
                        className="flex cursor-not-allowed items-center gap-3 rounded-[var(--radius-control)] px-3 py-2 text-body text-app-subtle"
                      >
                        <Icon className="size-[18px] shrink-0" aria-hidden="true" />
                        <span className="flex-1">{item.label}</span>
                        <span className="rounded-full border border-app-border px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-app-subtle">
                          Soon
                        </span>
                      </span>
                    </li>
                  );
                }
                const active = isActive(pathname, item);
                return (
                  <li key={item.label}>
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex items-center gap-3 rounded-[var(--radius-control)] px-3 py-2 text-body font-medium transition-colors",
                        active ? "bg-app-primary-soft text-app-primary-hover" : "text-app-muted hover:bg-app-hover hover:text-app-text"
                      )}
                    >
                      <Icon className="size-[18px] shrink-0" aria-hidden="true" />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </div>
  );
}

function Topbar({
  variant,
  user,
  organizations,
  activeOrganizationId,
  onOpenMenu,
  onOpenSearch,
}: {
  variant: "client" | "admin";
  user: ShellUser;
  organizations: ShellOrg[];
  activeOrganizationId: string | null;
  onOpenMenu: () => void;
  onOpenSearch: () => void;
}) {
  const activeOrg = organizations.find((o) => o.id === activeOrganizationId) ?? null;
  return (
    <header className="sticky top-0 z-40 flex h-16 items-center gap-1 border-b border-app-border bg-app-bg/90 px-3 backdrop-blur sm:gap-3 sm:px-6">
      <IconButton label="Open navigation menu" onClick={onOpenMenu} className="lg:hidden">
        <Menu aria-hidden="true" />
      </IconButton>

      {variant === "client" && organizations.length > 0 ? (
        <WorkspaceSwitcher organizations={organizations} active={activeOrg} />
      ) : null}

      <button
        type="button"
        onClick={onOpenSearch}
        className="ml-auto hidden h-9 w-full max-w-xs items-center gap-2 rounded-[var(--radius-control)] border border-app-border bg-app-surface px-3 text-small text-app-subtle hover:border-app-border-strong md:flex"
      >
        <Search className="size-4" aria-hidden="true" />
        <span className="flex-1 text-left">Search pages…</span>
        <kbd className="rounded border border-app-border px-1.5 text-[10px] text-app-subtle">Ctrl K</kbd>
      </button>
      <IconButton label="Search pages" onClick={onOpenSearch} className="ml-auto md:hidden">
        <Search aria-hidden="true" />
      </IconButton>

      <NotificationsMenu />

      <Dropdown label="Help" className="hidden sm:block" trigger={<span className="flex h-10 w-10 items-center justify-center"><CircleHelp className="size-[18px]" aria-hidden="true" /></span>}>
        <DropdownLabel>Need help?</DropdownLabel>
        {siteConfig.contact.whatsapp ? (
          <DropdownItem icon={<MessageCircle className="size-4" aria-hidden="true" />} onClick={() => window.open(`https://wa.me/${siteConfig.contact.whatsapp}`, "_blank", "noopener")}>
            WhatsApp support
          </DropdownItem>
        ) : null}
        {siteConfig.contact.email ? (
          <DropdownItem icon={<Mail className="size-4" aria-hidden="true" />} onClick={() => (window.location.href = `mailto:${siteConfig.contact.email}`)}>
            Email {siteConfig.contact.email}
          </DropdownItem>
        ) : null}
        {!siteConfig.contact.whatsapp && !siteConfig.contact.email ? <DropdownLabel>Contact your administrator.</DropdownLabel> : null}
      </Dropdown>

      <ProfileMenu user={user} variant={variant} hasWorkspace={organizations.length > 0} />
    </header>
  );
}

function WorkspaceSwitcher({ organizations, active }: { organizations: ShellOrg[]; active: ShellOrg | null }) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState("");

  async function switchTo(id: string, close: () => void) {
    close();
    if (id === active?.id) return;
    setPending(true);
    setError("");
    const res = await fetch("/api/me/active-organization", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organizationId: id }),
    });
    setPending(false);
    if (!res.ok) {
      setError("Could not switch workspace");
      return;
    }
    router.refresh();
  }

  return (
    <Dropdown
      label="Switch workspace"
      align="start"
      trigger={
        <span className="flex h-10 max-w-[9.5rem] items-center gap-2 rounded-[var(--radius-control)] border border-app-border bg-app-surface px-2.5 text-small text-app-text sm:max-w-[16rem]">
          <Building2 className="size-4 shrink-0 text-app-primary" aria-hidden="true" />
          <span className="truncate">{pending ? "Switching…" : (active?.name ?? "Select workspace")}</span>
          <ChevronsUpDown className="size-3.5 shrink-0 text-app-subtle" aria-hidden="true" />
          {error ? <span className="sr-only" role="alert">{error}</span> : null}
        </span>
      }
    >
      {(close) => (
        <>
          <DropdownLabel>Workspaces</DropdownLabel>
          {organizations.map((o) => (
            <DropdownItem key={o.id} onClick={() => switchTo(o.id, close)} aria-current={o.id === active?.id ? "true" : undefined}>
              <span className="flex-1 truncate">{o.name}</span>
              <Badge tone={o.id === active?.id ? "primary" : "neutral"}>{ORG_ROLE_LABELS[o.role]}</Badge>
            </DropdownItem>
          ))}
        </>
      )}
    </Dropdown>
  );
}

function ProfileMenu({ user, variant, hasWorkspace }: { user: ShellUser; variant: "client" | "admin"; hasWorkspace: boolean }) {
  const router = useRouter();
  const [signingOut, setSigningOut] = React.useState(false);
  return (
    <Dropdown
      label="Account menu"
      trigger={
        <span className="flex items-center gap-2 py-1 pl-1 pr-2">
          <Avatar name={user.name ?? user.email} size="sm" />
          <span className="hidden max-w-[9rem] truncate text-small text-app-text sm:block">{user.name ?? user.email}</span>
        </span>
      }
    >
      {(close) => (
        <>
          <div className="border-b border-app-border px-3.5 py-3">
            <p className="truncate text-small font-semibold text-app-text">{user.name ?? "Account"}</p>
            <p className="truncate text-caption text-app-muted">{user.email}</p>
          </div>
          <div className="py-1">
            {variant === "admin" && hasWorkspace ? (
              <DropdownItem icon={<LayoutDashboard className="size-4" aria-hidden="true" />} onClick={() => { close(); router.push("/dashboard"); }}>
                Client dashboard
              </DropdownItem>
            ) : null}
            {variant === "client" && user.isSuperAdmin ? (
              <DropdownItem icon={<Shield className="size-4" aria-hidden="true" />} onClick={() => { close(); router.push("/admin"); }}>
                Super Admin panel
              </DropdownItem>
            ) : null}
            <DropdownItem icon={<Settings className="size-4" aria-hidden="true" />} onClick={() => { close(); router.push("/settings"); }}>
              Account settings
            </DropdownItem>
            {siteConfig.contact.whatsapp ? (
              <DropdownItem
                className="sm:hidden"
                icon={<CircleHelp className="size-4" aria-hidden="true" />}
                onClick={() => window.open(`https://wa.me/${siteConfig.contact.whatsapp}`, "_blank", "noopener")}
              >
                Help &amp; support
              </DropdownItem>
            ) : null}
            <DropdownSeparator />
            <DropdownItem
              tone="danger"
              icon={<LogOut className="size-4" aria-hidden="true" />}
              disabled={signingOut}
              onClick={() => {
                setSigningOut(true);
                void signOut({ callbackUrl: "/login" });
              }}
            >
              {signingOut ? "Signing out…" : "Sign out"}
            </DropdownItem>
          </div>
        </>
      )}
    </Dropdown>
  );
}

function GlobalSearch({ open, onClose, sections }: { open: boolean; onClose: () => void; sections: NavSection[] }) {
  const router = useRouter();
  const [query, setQuery] = React.useState("");
  const items = sections.flatMap((s) => s.items).filter((i) => i.href);
  const results = items.filter((i) => i.label.toLowerCase().includes(query.trim().toLowerCase()));
  const go = (href: string) => {
    onClose();
    setQuery("");
    router.push(href);
  };
  return (
    <Modal open={open} onClose={onClose} title="Search" description="Jump to any page. Searching contacts and messages arrives with those modules.">
      <SearchBar
        label="Search pages"
        placeholder="Type a page name…"
        value={query}
        autoFocus
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && results[0]?.href) go(results[0].href);
        }}
      />
      <ul className="mt-3 space-y-0.5" aria-label="Results">
        {results.length === 0 ? <li className="px-3 py-2 text-small text-app-muted">No pages match “{query}”.</li> : null}
        {results.map((r) => {
          const Icon = r.icon;
          return (
            <li key={r.href}>
              <button type="button" onClick={() => go(r.href!)} className="flex w-full items-center gap-3 rounded-[var(--radius-control)] px-3 py-2 text-left text-body text-app-text hover:bg-app-hover">
                <Icon className="size-4 text-app-muted" aria-hidden="true" /> {r.label}
                <span className="ml-auto text-caption text-app-subtle">{r.href}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}

