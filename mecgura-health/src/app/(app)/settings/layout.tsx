"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

const TABS = [
  { href: "/settings", label: "Profile & workspace" },
  { href: "/settings/clinic", label: "Clinic profile" },
  { href: "/settings/branding", label: "Theme & branding" },
  { href: "/settings/scheduling", label: "Scheduling & OPD" },
  { href: "/settings/lab", label: "Laboratory" },
  { href: "/settings/followups", label: "Follow-ups" },
  { href: "/settings/portal", label: "Patient portal" },
  { href: "/settings/communications", label: "Communications" },
  { href: "/settings/notifications", label: "Notifications" },
  { href: "/settings/integrations", label: "Integrations" },
];

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="space-y-section">
      <h1 className="type-page-title">Settings</h1>
      <nav aria-label="Settings sections" className="-mx-page flex gap-1 overflow-x-auto border-b border-line px-page">
        {TABS.map((t) => {
          const active = pathname === t.href;
          return <Link key={t.href} href={t.href} aria-current={active ? "page" : undefined} className={cn("type-label -mb-px flex min-h-control shrink-0 items-center whitespace-nowrap border-b-2 px-4 no-underline", active ? "border-primary !text-primary" : "border-transparent !text-muted hover:!text-ink")}>{t.label}</Link>;
        })}
      </nav>
      {children}
    </div>
  );
}
