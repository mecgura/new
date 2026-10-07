"use client";

import * as React from "react";
import { Users } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  ConfirmationDialog,
  EmptyState,
  ErrorState,
  FilterBar,
  LoadingState,
  PageHeader,
  Pagination,
  SearchBar,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  useToast,
} from "@/components/ds";
import { apiFetch } from "@/lib/client-api";
import { ORG_ROLE_LABELS, isOrgRole, isSuperAdmin } from "@/lib/authz";
import { usePaged } from "@/components/admin/use-paged";

type User = {
  id: string;
  name: string | null;
  email: string;
  role: string;
  status: "active" | "disabled";
  lastLoginAt: string | null;
  createdAt: string;
  memberships: { role: string; organization: { id: string; name: string } }[];
};

const fmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

export default function AdminUsersPage() {
  const toast = useToast();
  const [q, setQ] = React.useState("");
  const { data, error, loading, page, setPage, reload } = usePaged<User>("/api/admin/users", { q });
  const [target, setTarget] = React.useState<User | null>(null);
  const [saving, setSaving] = React.useState(false);

  async function toggle() {
    if (!target) return;
    setSaving(true);
    const status = target.status === "active" ? "disabled" : "active";
    const r = await apiFetch(`/api/admin/users/${target.id}`, { method: "PATCH", body: { status } });
    setSaving(false);
    if (!r.ok) return toast(r.error, "error");
    toast(`${target.email} ${status === "active" ? "enabled" : "disabled"}`);
    setTarget(null);
    void reload();
  }

  return (
    <>
      <PageHeader title="Users" description="Every account on the platform." breadcrumb={[{ label: "Admin", href: "/admin" }, { label: "Users" }]} />
      <Card>
        <FilterBar>
          <SearchBar label="Search users" placeholder="Search by name or email…" value={q} onChange={(e) => setQ(e.target.value)} className="sm:w-80" />
        </FilterBar>
        {error ? (
          <ErrorState description={error} onRetry={reload} />
        ) : !data && loading ? (
          <LoadingState />
        ) : data && data.items.length === 0 ? (
          <EmptyState icon={Users} title="No users found" />
        ) : data ? (
          <>
            <Table caption="Users" aria-busy={loading}>
              <THead>
                <tr>
                  <TH>User</TH>
                  <TH>Platform role</TH>
                  <TH>Organizations</TH>
                  <TH>Status</TH>
                  <TH>Last sign-in</TH>
                  <TH className="text-right">Actions</TH>
                </tr>
              </THead>
              <TBody>
                {data.items.map((u) => (
                  <TR key={u.id}>
                    <TD>
                      <p className="font-medium">{u.name ?? "—"}</p>
                      <p className="text-caption text-app-subtle">{u.email}</p>
                    </TD>
                    <TD>{isSuperAdmin(u.role) ? <Badge tone="primary">Super Admin</Badge> : <Badge>User</Badge>}</TD>
                    <TD>
                      {u.memberships.length === 0 ? (
                        <span className="text-app-subtle">—</span>
                      ) : (
                        <ul className="space-y-0.5">
                          {u.memberships.map((m) => (
                            <li key={m.organization.id} className="text-small">
                              {m.organization.name} <span className="text-app-subtle">· {isOrgRole(m.role) ? ORG_ROLE_LABELS[m.role] : m.role}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </TD>
                    <TD>
                      <Badge tone={u.status === "active" ? "success" : "danger"} dot>
                        {u.status === "active" ? "Active" : "Disabled"}
                      </Badge>
                    </TD>
                    <TD className="text-app-muted">{u.lastLoginAt ? fmt.format(new Date(u.lastLoginAt)) : "Never"}</TD>
                    <TD className="text-right">
                      <Button size="sm" variant={u.status === "active" ? "danger" : "secondary"} onClick={() => setTarget(u)}>
                        {u.status === "active" ? "Disable" : "Enable"}
                      </Button>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <Pagination page={page} pageSize={data.pageSize} total={data.total} onPageChange={setPage} />
          </>
        ) : null}
      </Card>
      <ConfirmationDialog
        open={target !== null}
        onClose={() => setTarget(null)}
        onConfirm={toggle}
        loading={saving}
        tone={target?.status === "active" ? "danger" : "primary"}
        title={target?.status === "active" ? "Disable account?" : "Enable account?"}
        description={target?.status === "active" ? `${target?.email ?? ""} will be signed out everywhere and can't sign in until re-enabled.` : `${target?.email ?? ""} will be able to sign in again.`}
        confirmLabel={target?.status === "active" ? "Disable" : "Enable"}
      />
    </>
  );
}
