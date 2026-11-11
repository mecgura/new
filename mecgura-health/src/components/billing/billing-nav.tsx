"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/cn";

const TABS = [
  { href: "/billing", label: "Dashboard", exact: true }, { href: "/billing/invoices", label: "Invoices" }, { href: "/billing/payments", label: "Payments" }, { href: "/billing/payments?view=receipts", label: "Receipts", match: "view=receipts" },
  { href: "/billing/refunds", label: "Refunds" }, { href: "/billing/outstanding", label: "Outstanding" }, { href: "/billing/services", label: "Services" }, { href: "/billing/reports", label: "Reports", needs: "reports" }, { href: "/billing/settings", label: "Settings" },
];
export function BillingNav({ reports }: { reports: boolean }) {
  const path = usePathname(); const view = useSearchParams().get("view");
  return (
    <nav aria-label="Billing sections" className="-mx-page flex gap-1 overflow-x-auto border-b border-line px-page">
      {TABS.filter((t) => t.needs !== "reports" || reports).map((t) => {
        const base = t.href.split("?")[0];
        const isReceipts = t.match === "view=receipts";
        let on = t.exact ? path === base : path === base || path.startsWith(`${base}/`);
        if (base === "/billing/payments") on = on && (isReceipts ? view === "receipts" : view !== "receipts");
        return <Link key={t.href} href={t.href} aria-current={on ? "page" : undefined} className={cn("type-label -mb-px flex min-h-control shrink-0 items-center whitespace-nowrap border-b-2 px-4 no-underline", on ? "border-primary !text-primary" : "border-transparent !text-muted hover:!text-ink")}>{t.label}</Link>;
      })}
    </nav>
  );
}
