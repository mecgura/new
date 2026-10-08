import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { Button, ButtonLink, Card, DataTable, Field, Pagination, SearchInput, Select, StatusBadge, type Column } from "@/components/ui";
import { requireTenantPagePermission } from "@/lib/auth/context";
import { listPatients } from "@/lib/services/patient-crm";

export const metadata: Metadata = { title: "Patients" };
export const dynamic = "force-dynamic";
type Row = Awaited<ReturnType<typeof listPatients>>["rows"][number];
const fmt = (iso: string | null) => (iso ? iso.slice(0, 10) : "—");

export default async function PatientsPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; recent?: string; page?: string }> }) {
  const ctx = await requireTenantPagePermission("patients.view");
  const sp = await searchParams;
  const data = await listPatients(ctx, { q: sp.q, status: sp.status || "ACTIVE", recent: sp.recent === "1" ? "true" : undefined, page: sp.page ?? "1" }).catch(() => null);
  const canCreate = ctx.permissions.has("patients.create");
  const href = (p: number) => `/patients?${new URLSearchParams({ ...(sp.q ? { q: sp.q } : {}), ...(sp.status ? { status: sp.status } : {}), ...(sp.recent ? { recent: sp.recent } : {}), page: String(p) })}`;
  const filtered = !!(sp.q || (sp.status && sp.status !== "ACTIVE") || sp.recent);

  const columns: Column<Row>[] = [
    { key: "code", header: "Patient ID", cell: (p) => <Link href={`/patients/${p.id}`} className="font-semibold">{p.code}</Link> },
    { key: "name", header: "Name", cell: (p) => <Link href={`/patients/${p.id}`}>{p.name}</Link> },
    { key: "age", header: "Age", cell: (p) => p.age ?? "—", hideOnMobile: true },
    { key: "gender", header: "Gender", cell: (p) => (p.gender ? p.gender[0] + p.gender.slice(1).toLowerCase() : "—"), hideOnMobile: true },
    { key: "mobile", header: "Mobile", cell: (p) => <span className="tabular-nums">{p.phoneMasked}</span> },
    { key: "last", header: "Last visit", cell: (p) => fmt(p.lastVisit), hideOnMobile: true },
    { key: "status", header: "Status", cell: (p) => <StatusBadge tone={p.status === "ACTIVE" ? "success" : p.status === "ARCHIVED" ? "neutral" : "warning"}>{p.status[0] + p.status.slice(1).toLowerCase()}</StatusBadge> },
    { key: "actions", header: "Actions", align: "right", cell: (p) => <ButtonLink href={`/patients/${p.id}`} variant="outline" size="sm">Open</ButtonLink> },
  ];

  return (
    <div className="space-y-section">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h1 className="type-page-title">Patients</h1><p className="type-secondary mt-1">{ctx.tenant.name}{data ? ` · ${data.total} ${filtered ? "matching" : ""} patient${data.total === 1 ? "" : "s"}` : ""}</p></div>
        {canCreate && <ButtonLink href="/patients/new"><Plus aria-hidden className="size-4" />Register patient</ButtonLink>}
      </div>
      <Card className="p-card">
        <form method="get" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_12rem_12rem_auto] lg:items-end">
          <Field label="Search" hint="Name, patient ID, mobile, email or date of birth (YYYY-MM-DD)"><SearchInput name="q" defaultValue={sp.q} placeholder="Search patients" /></Field>
          <Field label="Status"><Select name="status" defaultValue={sp.status ?? "ACTIVE"} options={[{ value: "ACTIVE", label: "Active" }, { value: "INACTIVE", label: "Inactive" }, { value: "ARCHIVED", label: "Archived" }, { value: "ALL", label: "All" }]} /></Field>
          <Field label="Added"><Select name="recent" defaultValue={sp.recent ?? ""} placeholder="Any time" options={[{ value: "1", label: "Last 7 days" }]} /></Field>
          <Button type="submit" variant="outline">Apply</Button>
        </form>
      </Card>
      <Card className="overflow-hidden">
        {data ? (
          <DataTable caption="Patients" columns={columns} rows={data.rows} rowKey={(p) => p.id}
            empty={{ title: filtered ? "No matching patients" : "No patients yet", description: filtered ? "Try a different search or filter." : "Register the first patient to get started.", action: !filtered && canCreate ? <ButtonLink href="/patients/new">Register patient</ButtonLink> : undefined }} />
        ) : <p role="alert" className="p-card type-secondary">Couldn&apos;t load patients. Check the search and try again.</p>}
      </Card>
      {data && <Pagination page={data.page} pageCount={Math.ceil(data.total / data.pageSize)} hrefFor={href} />}
    </div>
  );
}
