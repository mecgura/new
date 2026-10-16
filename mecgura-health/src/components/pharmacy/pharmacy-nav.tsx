"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { usePharmacy } from "./pharmacy-ui";

export function PharmacyNav() {
  const path = usePathname(); const { perms: p } = usePharmacy();
  const TABS = [
    { href: "/pharmacy", label: "Dashboard", exact: true, show: true }, { href: "/pharmacy/medicines", label: "Medicines", show: true }, { href: "/pharmacy/stock", label: "Stock", show: true },
    { href: "/pharmacy/purchases", label: "Purchases", show: p.purchase || p.receive }, { href: "/pharmacy/suppliers", label: "Suppliers", show: true }, { href: "/pharmacy/dispensing", label: "Dispensing", show: p.dispense },
    { href: "/pharmacy/returns", label: "Returns", show: p.returnRequest || p.returnApprove }, { href: "/pharmacy/expiry", label: "Expired stock", show: true }, { href: "/pharmacy/adjustments", label: "Adjustments", show: p.adjust },
    { href: "/pharmacy/ledger", label: "Stock ledger", show: true }, { href: "/pharmacy/reports", label: "Reports", show: p.reports }, { href: "/pharmacy/settings", label: "Settings", show: p.configure },
  ];
  return (
    <nav aria-label="Pharmacy sections" className="-mx-page flex gap-1 overflow-x-auto border-b border-line px-page">
      {TABS.filter((t) => t.show).map((t) => {
        const on = t.exact ? path === t.href : path === t.href || path.startsWith(`${t.href}/`);
        return <Link key={t.href} href={t.href} aria-current={on ? "page" : undefined} className={cn("type-label -mb-px flex min-h-control shrink-0 items-center whitespace-nowrap border-b-2 px-4 no-underline", on ? "border-primary !text-primary" : "border-transparent !text-muted hover:!text-ink")}>{t.label}</Link>;
      })}
    </nav>
  );
}
