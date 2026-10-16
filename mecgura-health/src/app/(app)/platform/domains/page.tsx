import type { Metadata } from "next";
import Link from "next/link";
import { DataTable } from "@/components/analytics/widgets";
import { Button, Card, Field, Pagination, SearchInput, Select, StatusBadge } from "@/components/ui";
import { requirePagePermission } from "@/lib/auth/context";
import { DOMAIN_STATUSES } from "@/lib/domain/constants";
import { listDomains } from "@/lib/services/platform-clinics";

export const metadata: Metadata = { title: "Domains" };
export const dynamic = "force-dynamic";
const fmt = (d?: Date | null) => (d ? d.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—");
export default async function DomainsPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; page?: string }> }) {
  const ctx = await requirePagePermission("platform.manage"); const sp = await searchParams; const page = Math.max(1, Number(sp.page) || 1);
  const r = await listDomains(ctx, { q: sp.q?.trim() || undefined, status: sp.status, page });
  return (
    <div className="space-y-section">
      <div><h1 className="type-page-title">Domains</h1><p className="type-secondary mt-1">Every clinic subdomain and custom domain. A custom domain only opens a clinic after its ownership is verified.</p></div>
      <Card className="p-card"><form method="get" role="search" aria-label="Search domains" className="grid gap-3 sm:grid-cols-[1fr_12rem_auto] sm:items-end"><Field label="Search"><SearchInput name="q" defaultValue={sp.q} placeholder="Clinic or domain" /></Field><Field label="Custom domain status"><Select name="status" defaultValue={sp.status ?? ""} placeholder="All" options={Object.entries(DOMAIN_STATUSES).map(([v, s]) => ({ value: v, label: s.label }))} /></Field><Button type="submit" variant="outline">Apply</Button></form></Card>
      <Card className="overflow-hidden p-card"><DataTable caption="Domains" empty="No domains match" head={[{ label: "Clinic" }, { label: "Subdomain" }, { label: "Custom domain" }, { label: "Verification" }, { label: "Verified" }, { label: "Last checked" }]}
        rows={r.rows.map((t) => [<Link key={t.id} href={`/platform/clinics/${t.id}/domains`}>{t.name}</Link>, t.subdomain ?? "—", t.customDomain ?? "—", t.customDomain ? <StatusBadge key="s" tone={DOMAIN_STATUSES[t.customDomainStatus as keyof typeof DOMAIN_STATUSES]?.tone ?? "neutral"}>{DOMAIN_STATUSES[t.customDomainStatus as keyof typeof DOMAIN_STATUSES]?.label ?? t.customDomainStatus}</StatusBadge> : "—", fmt(t.customDomainVerifiedAt), fmt(t.customDomainCheckedAt)])} /></Card>
      <Pagination page={r.page} pageCount={Math.ceil(r.total / r.pageSize)} hrefFor={(p) => `/platform/domains?${new URLSearchParams({ ...(sp.q ? { q: sp.q } : {}), ...(sp.status ? { status: sp.status } : {}), page: String(p) })}`} />
    </div>
  );
}
