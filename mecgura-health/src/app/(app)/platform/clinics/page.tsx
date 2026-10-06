import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { ClinicRowActions } from "@/components/clinic/clinic-actions";
import { TenantStatusBadge, clinicTypeLabel } from "@/components/domain/badges";
import { ButtonLink, Card, DataTable, Field, Pagination, SearchInput, Select, Button, type Column } from "@/components/ui";
import { requirePagePermission } from "@/lib/auth/context";
import { CLINIC_TYPES, TENANT_STATUSES } from "@/lib/domain/constants";
import { listClinics } from "@/lib/services/clinics";

export const metadata: Metadata = { title: "Clinics" };

type Row = Awaited<ReturnType<typeof listClinics>>["rows"][number];
const fmt = (d: Date) => d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

export default async function ClinicsPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; type?: string; page?: string }> }) {
  const ctx = await requirePagePermission("platform.manage");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const { rows, total, pageSize } = await listClinics(ctx, { q: sp.q?.trim() || undefined, status: sp.status, type: sp.type, page });
  const href = (p: number) => `/platform/clinics?${new URLSearchParams({ ...(sp.q ? { q: sp.q } : {}), ...(sp.status ? { status: sp.status } : {}), ...(sp.type ? { type: sp.type } : {}), page: String(p) })}`;

  const columns: Column<Row>[] = [
    { key: "clinic", header: "Clinic", cell: (r) => <Link href={`/platform/clinics/${r.id}`} className="font-semibold">{r.name}<span className="type-caption block font-normal">{r.slug}</span></Link> },
    { key: "type", header: "Type", cell: (r) => clinicTypeLabel(r.clinicType), hideOnMobile: true },
    { key: "owner", header: "Admin / Doctor", cell: (r) => r.owner ?? "—" },
    { key: "status", header: "Status", cell: (r) => <TenantStatusBadge status={r.status} /> },
    { key: "created", header: "Created", cell: (r) => fmt(r.createdAt), hideOnMobile: true },
    { key: "domain", header: "Domain", cell: (r) => r.customDomain ? <>{r.customDomain}{!r.customDomainVerifiedAt && <span className="type-caption block">not verified</span>}</> : r.subdomain ? <span className="text-muted">{r.subdomain}.…</span> : "—", hideOnMobile: true },
    { key: "users", header: "Users", cell: (r) => r.userCount, align: "right" },
    { key: "actions", header: "Actions", cell: (r) => <ClinicRowActions id={r.id} name={r.name} status={r.status} />, align: "right" },
  ];

  return (
    <div className="space-y-section">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h1 className="type-page-title">Clinics</h1><p className="type-secondary mt-1">All clinics on the MECGURA HEALTH platform.</p></div>
        <ButtonLink href="/platform/clinics/new"><Plus aria-hidden className="size-4" />New clinic</ButtonLink>
      </div>
      <Card className="p-card">
        <form method="get" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_12rem_14rem_auto] lg:items-end">
          <Field label="Search"><SearchInput name="q" defaultValue={sp.q} placeholder="Name, address or domain" /></Field>
          <Field label="Status"><Select name="status" defaultValue={sp.status ?? ""} placeholder="All statuses" options={Object.entries(TENANT_STATUSES).map(([v, s]) => ({ value: v, label: s.label }))} /></Field>
          <Field label="Type"><Select name="type" defaultValue={sp.type ?? ""} placeholder="All types" options={Object.entries(CLINIC_TYPES).map(([v, label]) => ({ value: v, label }))} /></Field>
          <Button type="submit" variant="outline">Apply</Button>
        </form>
      </Card>
      <Card className="overflow-hidden">
        <DataTable caption="Clinics" columns={columns} rows={rows} rowKey={(r) => r.id}
          empty={{ title: "No clinics found", description: sp.q || sp.status || sp.type ? "Try different filters." : "Create the first clinic to get started.", action: sp.q || sp.status || sp.type ? undefined : <ButtonLink href="/platform/clinics/new">New clinic</ButtonLink> }} />
      </Card>
      <Pagination page={page} pageCount={Math.ceil(total / pageSize)} hrefFor={href} />
    </div>
  );
}
