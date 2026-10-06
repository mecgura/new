import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { RoleBadge, UserStatusBadge } from "@/components/domain/badges";
import { UserActions } from "@/components/team/user-actions";
import { Avatar, Button, ButtonLink, Card, DataTable, Field, Pagination, SearchInput, Select, type Column } from "@/components/ui";
import { requireTenantPagePermission } from "@/lib/auth/context";
import { USER_STATUSES } from "@/lib/domain/constants";
import { ROLE_LABELS } from "@/lib/permissions";
import { TENANT_ASSIGNABLE_ROLES } from "@/lib/permissions/roles";
import { listUsers } from "@/lib/services/users";

export const metadata: Metadata = { title: "Team" };

type Row = Awaited<ReturnType<typeof listUsers>>["rows"][number];
const fmt = (d?: Date | null) => (d ? d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "Never");

export default async function TeamPage({ searchParams }: { searchParams: Promise<{ q?: string; role?: string; status?: string; page?: string }> }) {
  const ctx = await requireTenantPagePermission("users.view");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const { rows, total, pageSize } = await listUsers(ctx, { q: sp.q?.trim() || undefined, role: sp.role, status: sp.status, page });
  const canEdit = ctx.permissions.has("users.edit");
  const canDisable = ctx.permissions.has("users.disable");
  const canInvite = ctx.permissions.has("users.create");
  const href = (p: number) => `/team?${new URLSearchParams({ ...(sp.q ? { q: sp.q } : {}), ...(sp.role ? { role: sp.role } : {}), ...(sp.status ? { status: sp.status } : {}), page: String(p) })}`;
  const filtered = !!(sp.q || sp.role || sp.status);

  const columns: Column<Row>[] = [
    { key: "user", header: "User", cell: (u) => (
      <span className="flex min-w-0 items-center gap-3 text-left">
        <Avatar name={u.name} src={u.avatarUrl} size="sm" />
        <span className="min-w-0">{canEdit ? <Link href={`/team/${u.id}`} className="font-semibold">{u.name}</Link> : <span className="font-semibold">{u.name}</span>}<span className="type-caption block truncate">{u.email}</span></span>
      </span>) },
    { key: "role", header: "Role", cell: (u) => <RoleBadge role={u.role.key} /> },
    { key: "detail", header: "Details", cell: (u) => u.doctorProfile?.specialization || u.staffProfile?.designation || "—", hideOnMobile: true },
    { key: "status", header: "Status", cell: (u) => <UserStatusBadge status={u.status} /> },
    { key: "last", header: "Last sign-in", cell: (u) => fmt(u.lastLoginAt), hideOnMobile: true },
    { key: "actions", header: "Actions", align: "right", cell: (u) => <UserActions id={u.id} name={u.name} status={u.status} isSelf={u.id === ctx.user.id} canEdit={canEdit} canDisable={canDisable} canInvite={canInvite} /> },
  ];

  return (
    <div className="space-y-section">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h1 className="type-page-title">Team</h1><p className="type-secondary mt-1">Doctors and staff of {ctx.tenant.name}.</p></div>
        {canInvite && <ButtonLink href="/team/new"><Plus aria-hidden className="size-4" />Add user</ButtonLink>}
      </div>
      <Card className="p-card">
        <form method="get" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_12rem_12rem_auto] lg:items-end">
          <Field label="Search"><SearchInput name="q" defaultValue={sp.q} placeholder="Name, email or phone" /></Field>
          <Field label="Role"><Select name="role" defaultValue={sp.role ?? ""} placeholder="All roles" options={TENANT_ASSIGNABLE_ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }))} /></Field>
          <Field label="Status"><Select name="status" defaultValue={sp.status ?? ""} placeholder="All statuses" options={Object.entries(USER_STATUSES).map(([v, s]) => ({ value: v, label: s.label }))} /></Field>
          <Button type="submit" variant="outline">Apply</Button>
        </form>
      </Card>
      <Card className="overflow-hidden">
        <DataTable caption="Team members" columns={columns} rows={rows} rowKey={(u) => u.id}
          empty={{ title: filtered ? "No matching users" : "No users yet", description: filtered ? "Try different filters." : "Add your doctors and staff.", action: !filtered && canInvite ? <ButtonLink href="/team/new">Add user</ButtonLink> : undefined }} />
      </Card>
      <Pagination page={page} pageCount={Math.ceil(total / pageSize)} hrefFor={href} />
    </div>
  );
}
