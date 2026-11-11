import type { Metadata } from "next";
import Link from "next/link";
import { RoleBadge } from "@/components/domain/badges";
import { InviteUser, UserActions } from "@/components/platform/user-actions";
import { Section } from "@/components/analytics/widgets";
import { Card, DataTable, Pagination, StatusBadge, type Column } from "@/components/ui";
import { requirePagePermission } from "@/lib/auth/context";
import { getClinic } from "@/lib/services/clinics";
import { clinicUsers } from "@/lib/services/platform-users";

export const metadata: Metadata = { title: "Clinic · Users" };
export const dynamic = "force-dynamic";
type Row = Awaited<ReturnType<typeof clinicUsers>>["rows"][number];
const fmt = (d?: Date | null) => (d ? d.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "Never");

export default async function ClinicUsersPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ q?: string; page?: string }> }) {
  const ctx = await requirePagePermission("platform.manage"); const { id } = await params; const sp = await searchParams; const page = Math.max(1, Number(sp.page) || 1);
  const [t, r] = await Promise.all([getClinic(ctx, id), clinicUsers(ctx, id, { q: sp.q?.trim() || undefined, page })]);
  const columns: Column<Row>[] = [
    { key: "name", header: "Person", cell: (u) => <>{u.name}<span className="type-caption block">{u.email}</span></> },
    { key: "role", header: "Role", cell: (u) => <RoleBadge role={u.role} /> },
    { key: "status", header: "Status", cell: (u) => <>{u.locked ? <StatusBadge tone="danger">Locked</StatusBadge> : <StatusBadge tone={u.status === "ACTIVE" ? "success" : u.status === "INVITED" ? "info" : u.status === "SUSPENDED" ? "warning" : "neutral"}>{u.status === "DISABLED" ? "Inactive" : u.status.charAt(0) + u.status.slice(1).toLowerCase()}</StatusBadge>}</> },
    { key: "last", header: "Last sign-in", cell: (u) => fmt(u.lastLoginAt), hideOnMobile: true },
    { key: "actions", header: "Actions", cell: (u) => <UserActions id={u.id} name={u.name} status={u.status} role={u.role} clinic={t.name} /> },
  ];
  return (
    <Section title={`People (${r.total})`} description="Account details only — no clinical data. Doctors, staff and admins of this clinic." action={<InviteUser clinicId={id} clinicName={t.name} />}>
      <form method="get" className="mb-3 flex gap-2" role="search" aria-label="Search people"><label className="sr-only" htmlFor="q">Search</label><input id="q" name="q" defaultValue={sp.q ?? ""} placeholder="Name, email or phone" className="type-form min-h-control min-w-0 flex-1 rounded-md border border-line-strong bg-surface px-3" /><button className="type-button min-h-control rounded-md border border-line-strong px-4">Search</button></form>
      <Card className="overflow-hidden"><DataTable caption="Clinic people" columns={columns} rows={r.rows} rowKey={(u) => u.id} empty={{ title: "No people found" }} /></Card>
      <Pagination page={r.page} pageCount={Math.ceil(r.total / r.pageSize)} hrefFor={(p) => `/platform/clinics/${id}/users?${new URLSearchParams({ ...(sp.q ? { q: sp.q } : {}), page: String(p) })}`} />
      <p className="type-caption mt-3"><Link href="/platform/users">Search people across all clinics</Link></p>
    </Section>
  );
}
