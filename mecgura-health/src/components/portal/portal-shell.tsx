"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, CalendarDays, FileText, Home, LayoutGrid, LogOut, Receipt } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { cn } from "@/lib/cn";

const MAIN = [
  { href: "/portal/dashboard", label: "Home", icon: Home }, { href: "/portal/appointments", label: "Appointments", icon: CalendarDays }, { href: "/portal/records", label: "Records", icon: FileText, also: ["/portal/prescriptions", "/portal/reports", "/portal/consultations", "/portal/documents", "/portal/timeline"] },
  { href: "/portal/billing", label: "Bills", icon: Receipt }, { href: "/portal/more", label: "More", icon: LayoutGrid, also: ["/portal/follow-ups", "/portal/profile", "/portal/settings", "/portal/privacy", "/portal/security", "/portal/help", "/portal/opd"] },
];
const DESKTOP_EXTRA = [{ href: "/portal/prescriptions", label: "Prescriptions" }, { href: "/portal/reports", label: "Lab reports" }, { href: "/portal/follow-ups", label: "Follow-ups" }, { href: "/portal/documents", label: "Documents" }];

export function PortalShell({ clinic, patientName, unread, logoutAction, children }: { clinic: { name: string; logoUrl: string | null }; patientName: string; unread: number; logoutAction: () => Promise<void>; children: React.ReactNode }) {
  const path = usePathname();
  const on = (href: string, also: string[] = []) => path === href || path.startsWith(`${href}/`) || also.some((a) => path === a || path.startsWith(`${a}/`));
  return (
    <div className="min-h-dvh bg-surface-muted pb-20 lg:pb-0">
      <a href="#portal-main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2">Skip to content</a>
      <header className="sticky top-0 z-30 border-b border-line bg-surface">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-3 px-4">
          <Link href="/portal/dashboard" className="min-w-0 no-underline" aria-label={`${clinic.name} — home`}><Logo name={clinic.name} sub={null} logoUrl={clinic.logoUrl} /></Link>
          <div className="flex items-center gap-1">
            <Link href="/portal/notifications" className="relative inline-flex size-11 items-center justify-center rounded-full !text-ink hover:bg-surface-muted" aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}>
              <Bell aria-hidden className="size-5" />{unread > 0 && <span aria-hidden className="absolute right-1.5 top-1.5 flex min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[0.625rem] font-bold leading-4 text-white">{unread > 9 ? "9+" : unread}</span>}
            </Link>
            <span className="type-caption hidden max-w-40 truncate sm:block" title={patientName}>{patientName}</span>
            <form action={logoutAction}><button type="submit" className="type-button inline-flex min-h-11 items-center gap-2 rounded-md px-3 !text-muted hover:bg-surface-muted hover:!text-ink"><LogOut aria-hidden className="size-4" /><span className="hidden sm:inline">Sign out</span><span className="sr-only sm:hidden">Sign out</span></button></form>
          </div>
        </div>
        <nav aria-label="Portal sections" className="mx-auto hidden max-w-5xl gap-1 px-4 lg:flex">
          {[...MAIN.slice(0, 4), ...DESKTOP_EXTRA.map((x) => ({ ...x, also: [] as string[] })), MAIN[4]].map((i) => (
            <Link key={i.href} href={i.href} aria-current={on(i.href, "also" in i ? i.also : []) ? "page" : undefined} className={cn("type-label -mb-px border-b-2 px-3 py-3 no-underline", on(i.href, "also" in i ? i.also : []) ? "border-primary !text-primary" : "border-transparent !text-muted hover:!text-ink")}>{i.label}</Link>
          ))}
        </nav>
      </header>
      <main id="portal-main" className="mx-auto max-w-5xl px-4 py-5 sm:py-8">{children}</main>
      <nav aria-label="Portal" className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden">
        <ul className="mx-auto grid max-w-md grid-cols-5">
          {MAIN.map((i) => { const active = on(i.href, i.also); return (
            <li key={i.href}><Link href={i.href} aria-current={active ? "page" : undefined} className={cn("flex min-h-14 flex-col items-center justify-center gap-0.5 px-1 text-[0.6875rem] font-semibold no-underline", active ? "!text-primary" : "!text-muted")}><i.icon aria-hidden className="size-5" />{i.label}</Link></li>
          ); })}
        </ul>
      </nav>
    </div>
  );
}
