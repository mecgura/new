import { Suspense } from "react";
import { TabNav } from "@/components/platform/tab-nav";
import { requirePagePermission } from "@/lib/auth/context";

export default async function Layout({ children }: { children: React.ReactNode }) {
  await requirePagePermission("platform.manage");
  const tabs = [{ href: "/platform/security", label: "Overview", exact: true }, { href: "/platform/security/events", label: "Events" }, { href: "/platform/security/incidents", label: "Incidents" }, { href: "/platform/security/audit", label: "Audit integrity" }, { href: "/platform/security/access", label: "Access & policy" }, { href: "/platform/security/keys", label: "API keys" }, { href: "/platform/security/holds", label: "Legal holds" }];
  return (<div className="space-y-section"><div><h1 className="type-page-title">Security &amp; compliance</h1><p className="type-secondary mt-1">Security Center for the whole platform. Built to support compliance work; it is not a certification.</p></div><Suspense fallback={null}><TabNav tabs={tabs} label="Security sections" /></Suspense>{children}</div>);
}
