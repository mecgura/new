import type { Metadata } from "next";
import Link from "next/link";
import { RoleBadge } from "@/components/domain/badges";
import { UserActions } from "@/components/platform/user-actions";
import { Card, DataTable, Field, Pagination, Select, Button, SearchInput, StatusBadge, type Column } from "@/components/ui";
import { requirePagePermission } from "@/lib/auth/context";
import { ROLE_LABELS, TENANT_ASSIGNABLE_ROLES, type RoleKey } from "@/lib/permissions";
import { searchUsers } from "@/lib/services/platform-users";

export const metadata: Metadata = { title: "Users" };
export const dynamic = "force-dynamic";
type Row = Awaited<ReturnType<typeof searchUsers>>["rows"][number];
const fmt = (d?: Date | null) => (d ? d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "Never");

export default async function PlatformUsers({ searchParams }: { searchParams: Promise<{ q?: string; role?: string; status?: string; tenantId?: string; page?: string }> }) {
  const ctx = await requirePagePermission("platform.manage"); const sp = await searchParams; const page = Math.max(1, Number(sp.page) || 1);
  const r = await searchUsers(ctx, { q: sp.q?.trim() || undefined, role: sp.role, status: sp.status, tenantId: sp.tenantId, page });
  const href = (p: number) => `/platform/users?${new URLSearchParams({ ...Object.fromEntries(Object.entries(sp).filter(([k, v]) => v && k !== "page") as [string, string][]), page: String(p) })}`;
  const columns: Column<Row>[] = [
    { key: "name", header: "Person", cell: (u) => <>{u.name}<span className="type-caption block">{u.email}{u.phone ? ` · ${u.phone}` : ""}</span></> },
    { key: "clinic", header: "Clinic", cell: (u) => (u.clinicId ? <Link href={`/platform/clinics/${u.clinicId}`}>{u.clinic}</Link> : u.clinic) },
    { key: "role", header: "Role", cell: (u) => <RoleBadge role={u.role} /> },
    { key: "status", header: "Status", cell: (u) => (u.locked ? <StatusBadge tone="danger">Locked</StatusBadge> : <StatusBadge tone={u.status === "ACTIVE" ? "success" : u.status === "INVITED" ? "info" : u.status === "SUSPENDED" ? "warning" : "neutral"}>{u.status === "DISABLED" ? "Inactive" : u.status.charAt(0) + u.status.slice(1).toLowerCase()}</StatusBadge>) },
    { key: "last", header: "Last sign-in", cell: (u) => fmt(u.lastLoginAt), hideOnMobile: true },
    { key: "actions", header: "Actions", cell: (u) => (u.role === "SUPER_ADMIN" ? <span className="type-caption">Protected</span> : <UserActions id={u.id} name={u.name} status={u.status} role={u.role} clinic={u.clinic} />) },
  ];
  return (
    <div className="space-y-section">
      <div><h1 className="type-page-title">Users</h1><p className="type-secondary mt-1">Staff accounts across all clinics. Account details only — patient portal accounts and clinical data are not shown.</p></div>
      <Card className="p-card"><form method="get" role="search" aria-label="Search users" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_12rem_10rem_auto] lg:items-end">
        <Field label="Search"><SearchInput name="q" defaultValue={sp.q} placeholder="Name, email or phone" /></Field>
        <Field label="Role"><Select name="role" defaultValue={sp.role ?? ""} placeholder="All roles" options={TENANT_ASSIGNABLE_ROLES.map((x) => ({ value: x, label: ROLE_LABELS[x as RoleKey] ?? x }))} /></Field>
        <Field label="Status"><Select name="status" defaultValue={sp.status ?? ""} placeholder="All statuses" options={[{ value: "ACTIVE", label: "Active" }, { value: "INVITED", label: "Invited" }, { value: "SUSPENDED", label: "Suspended" }, { value: "DISABLED", label: "Inactive" }, { value: "LOCKED", label: "Locked" }]} /></Field>
        {sp.tenantId && <input type="hidden" name="tenantId" value={sp.tenantId} />}<Button type="submit" variant="outline">Apply</Button>
      </form></Card>
      <Card className="overflow-hidden"><DataTable caption="Users" columns={columns} rows={r.rows} rowKey={(u) => u.id} empty={{ title: "No users found", description: "Try different filters." }} /></Card>
      <Pagination page={r.page} pageCount={Math.ceil(r.total / r.pageSize)} hrefFor={href} />
      <p className="type-caption">{r.total.toLocaleString("en-IN")} account(s). Platform administrator accounts are protected and can&apos;t be changed here.</p>
    </div>
  );
}
