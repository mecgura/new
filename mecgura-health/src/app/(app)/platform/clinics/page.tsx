import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { ClinicRowActions } from "@/components/clinic/clinic-actions";
import { TenantStatusBadge, clinicTypeLabel } from "@/components/domain/badges";
import { ButtonLink, Card, DataTable, Field, Pagination, SearchInput, Select, Button, type Column } from "@/components/ui";
import { requirePagePermission } from "@/lib/auth/context";
import { CLINIC_TYPES, TENANT_STATUSES } from "@/lib/domain/constants";
import { listClinicsAdmin } from "@/lib/services/platform-clinics";

export const metadata: Metadata = { title: "Clinics" };

type Row = Awaited<ReturnType<typeof listClinicsAdmin>>["rows"][number];

export default async function ClinicsPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; type?: string; page?: string; sort?: string; all?: string }> }) {
  const ctx = await requirePagePermission("platform.manage");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const { rows, total, pageSize } = await listClinicsAdmin(ctx, { q: sp.q?.trim() || undefined, status: sp.status, type: sp.type, page, sort: sp.sort, includeArchived: sp.all === "1" });
  const href = (p: number) => `/platform/clinics?${new URLSearchParams({ ...(sp.q ? { q: sp.q } : {}), ...(sp.status ? { status: sp.status } : {}), ...(sp.type ? { type: sp.type } : {}), ...(sp.sort ? { sort: sp.sort } : {}), ...(sp.all ? { all: sp.all } : {}), page: String(p) })}`;

  const ago = (d: Date | null) => (d ? d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "Never");
  const columns: Column<Row>[] = [
    { key: "clinic", header: "Clinic", cell: (r) => <Link href={`/platform/clinics/${r.id}`} className="font-semibold">{r.name}<span className="type-caption block font-normal">ID {r.id.slice(0, 10)}…</span></Link> },
    { key: "type", header: "Type", cell: (r) => clinicTypeLabel(r.clinicType), hideOnMobile: true },
    { key: "status", header: "Status", cell: (r) => <TenantStatusBadge status={r.status} /> },
    { key: "owner", header: "Admin", cell: (r) => r.admin ?? "—", hideOnMobile: true },
    { key: "doctors", header: "Doctors", cell: (r) => r.doctors, align: "right" },
    { key: "staff", header: "Staff", cell: (r) => r.staff, align: "right", hideOnMobile: true },
    { key: "patients", header: "Patients", cell: (r) => r.patients.toLocaleString("en-IN"), align: "right" },
    { key: "domain", header: "Domain", cell: (r) => r.domain ?? "—", hideOnMobile: true },
    { key: "created", header: "Created", cell: (r) => ago(r.createdAt), hideOnMobile: true },
    { key: "last", header: "Last activity", cell: (r) => ago(r.lastActivity), hideOnMobile: true },
    { key: "actions", header: "Actions", cell: (r) => <ClinicRowActions id={r.id} name={r.name} status={r.status} />, align: "right" },
  ];

  return (
    <div className="space-y-section">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h1 className="type-page-title">Clinics</h1><p className="type-secondary mt-1">All clinics on the MECGURA HEALTH platform.</p></div>
        <ButtonLink href="/platform/clinics/new"><Plus aria-hidden className="size-4" />New clinic</ButtonLink>
      </div>
      <Card className="p-card">
        <form method="get" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_10rem_12rem_12rem_auto] lg:items-end">
          <Field label="Search"><SearchInput name="q" defaultValue={sp.q} placeholder="Name, ID, email or domain" /></Field>
          <Field label="Sort"><Select name="sort" defaultValue={sp.sort ?? ""} placeholder="Newest first" options={[{ value: "name", label: "Name" }, { value: "status", label: "Status" }]} /></Field>
          <Field label="Status"><Select name="status" defaultValue={sp.status ?? ""} placeholder="All statuses" options={Object.entries(TENANT_STATUSES).map(([v, s]) => ({ value: v, label: s.label }))} /></Field>
          <Field label="Type"><Select name="type" defaultValue={sp.type ?? ""} placeholder="All types" options={Object.entries(CLINIC_TYPES).map(([v, label]) => ({ value: v, label }))} /></Field>
          <label className="type-body flex min-h-control items-center gap-2"><input type="checkbox" name="all" value="1" defaultChecked={sp.all === "1"} className="size-4" />Show archived</label>
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
