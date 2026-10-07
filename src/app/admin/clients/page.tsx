"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Ban,
  BarChart3,
  Building2,
  CheckCircle2,
  CreditCard,
  Eye,
  KeyRound,
  Layers,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import {
  Badge,
  Card,
  Dropdown,
  DropdownItem,
  DropdownSeparator,
  EmptyState,
  ErrorState,
  FilterBar,
  LoadingState,
  PageHeader,
  Pagination,
  SearchBar,
  Select,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  UsageMeter,
  buttonVariants,
} from "@/components/ds";
import { apiFetch } from "@/lib/client-api";
import { usePaged } from "@/components/admin/use-paged";
import { DeleteClientModal, EditClientModal, ResetAccessModal, StatusDialog, type ClientRef } from "@/components/admin/client-dialogs";

type ClientRow = {
  id: string;
  name: string;
  slug: string;
  status: "active" | "suspended";
  contactEmail: string;
  contactPhone: string;
  createdAt: string;
  owner: { id: string; name: string | null; email: string } | null;
  plan: { id: string; name: string; maxUsers: number; maxMonthlyMessages: number } | null;
  whatsappNumbers: number;
  seats: number;
  messagesThisMonth: number;
};

const dateFmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" });

export default function AdminClientsPage() {
  const router = useRouter();
  const [q, setQ] = React.useState("");
  const [status, setStatus] = React.useState("");
  const [planId, setPlanId] = React.useState("");
  const [plans, setPlans] = React.useState<{ id: string; name: string }[]>([]);
  const { data, error, loading, page, setPage, reload } = usePaged<ClientRow>("/api/admin/organizations", { q, status, planId });

  const [editing, setEditing] = React.useState<ClientRef | null>(null);
  const [statusTarget, setStatusTarget] = React.useState<ClientRef | null>(null);
  const [resetTarget, setResetTarget] = React.useState<ClientRef | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<ClientRef | null>(null);

  React.useEffect(() => {
    void apiFetch<{ plans: { id: string; name: string }[] }>("/api/admin/plans").then((r) => {
      if (r.ok) setPlans(r.data.plans);
    });
  }, []);

  const go = (id: string, tab?: string) => router.push(`/admin/clients/${id}${tab ? `?tab=${tab}` : ""}`);

  return (
    <>
      <PageHeader
        title="Clients"
        description="Businesses using the MECGURA platform."
        breadcrumb={[{ label: "Admin", href: "/admin" }, { label: "Clients" }]}
        actions={
          <Link href="/admin/clients/new" className={buttonVariants({ variant: "primary" })}>
            <Plus aria-hidden="true" /> Add client
          </Link>
        }
      />
      <Card>
        <FilterBar>
          <SearchBar label="Search clients" placeholder="Search company or email…" value={q} onChange={(e) => setQ(e.target.value)} className="sm:w-72" />
          <Select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)} className="sm:w-40">
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
          </Select>
          <Select aria-label="Filter by plan" value={planId} onChange={(e) => setPlanId(e.target.value)} className="sm:w-40">
            <option value="">All plans</option>
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </FilterBar>
        {error ? (
          <ErrorState description={error} onRetry={reload} />
        ) : !data && loading ? (
          <LoadingState />
        ) : data && data.items.length === 0 ? (
          <EmptyState
            icon={Building2}
            title={q || status || planId ? "No clients match these filters" : "No clients yet"}
            description={q || status || planId ? undefined : "Add your first client to create their workspace and owner login."}
            action={
              q || status || planId ? undefined : (
                <Link href="/admin/clients/new" className={buttonVariants({ variant: "primary" })}>
                  Add client
                </Link>
              )
            }
          />
        ) : data ? (
          <>
            <Table caption="Clients" aria-busy={loading} className="min-w-[1080px]">
              <THead>
                <tr>
                  <TH>Company</TH>
                  <TH>Owner</TH>
                  <TH>Email</TH>
                  <TH className="text-center">WhatsApp</TH>
                  <TH>Plan</TH>
                  <TH className="w-40">Usage</TH>
                  <TH>Status</TH>
                  <TH>Created</TH>
                  <TH className="text-right">
                    <span className="sr-only">Actions</span>
                  </TH>
                </tr>
              </THead>
              <TBody>
                {data.items.map((c) => {
                  const ref: ClientRef = { id: c.id, name: c.name, status: c.status, contactEmail: c.contactEmail, contactPhone: c.contactPhone };
                  return (
                    <TR key={c.id}>
                      <TD>
                        <Link href={`/admin/clients/${c.id}`} className="font-medium hover:text-app-primary-hover">
                          {c.name}
                        </Link>
                        <p className="text-caption text-app-subtle">{c.slug}</p>
                      </TD>
                      <TD>{c.owner?.name ?? <span className="text-app-subtle">—</span>}</TD>
                      <TD className="text-app-muted">{c.owner?.email ?? c.contactEmail ?? "—"}</TD>
                      <TD className="text-center tabular-nums">{c.whatsappNumbers}</TD>
                      <TD>{c.plan ? <Badge tone="primary">{c.plan.name}</Badge> : <Badge tone="warning">No plan</Badge>}</TD>
                      <TD>
                        <div className="space-y-1.5">
                          <UsageMeter compact label="Seats" used={c.seats} limit={c.plan?.maxUsers ?? null} />
                          <UsageMeter compact label="Msgs" used={c.messagesThisMonth} limit={c.plan?.maxMonthlyMessages ?? null} />
                        </div>
                      </TD>
                      <TD>
                        <Badge tone={c.status === "active" ? "success" : "danger"} dot>
                          {c.status === "active" ? "Active" : "Suspended"}
                        </Badge>
                      </TD>
                      <TD className="whitespace-nowrap text-app-muted">{dateFmt.format(new Date(c.createdAt))}</TD>
                      <TD className="text-right">
                        <Dropdown label={`Actions for ${c.name}`} trigger={<span className="flex h-8 w-8 items-center justify-center"><MoreHorizontal className="size-4" aria-hidden="true" /></span>}>
                          {(close) => {
                            const act = (fn: () => void) => () => {
                              close();
                              fn();
                            };
                            return (
                              <>
                                <DropdownItem icon={<Eye className="size-4" aria-hidden="true" />} onClick={act(() => go(c.id))}>View</DropdownItem>
                                <DropdownItem icon={<Pencil className="size-4" aria-hidden="true" />} onClick={act(() => setEditing(ref))}>Edit</DropdownItem>
                                {c.status === "active" ? (
                                  <DropdownItem icon={<Ban className="size-4" aria-hidden="true" />} onClick={act(() => setStatusTarget(ref))}>Suspend</DropdownItem>
                                ) : (
                                  <DropdownItem icon={<CheckCircle2 className="size-4" aria-hidden="true" />} onClick={act(() => setStatusTarget(ref))}>Activate</DropdownItem>
                                )}
                                <DropdownItem icon={<KeyRound className="size-4" aria-hidden="true" />} onClick={act(() => setResetTarget(ref))}>Reset access</DropdownItem>
                                <DropdownSeparator />
                                <DropdownItem icon={<Layers className="size-4" aria-hidden="true" />} onClick={act(() => go(c.id, "services"))}>Manage services</DropdownItem>
                                <DropdownItem icon={<CreditCard className="size-4" aria-hidden="true" />} onClick={act(() => go(c.id, "plan"))}>Manage plan</DropdownItem>
                                <DropdownItem icon={<BarChart3 className="size-4" aria-hidden="true" />} onClick={act(() => go(c.id, "usage"))}>Usage</DropdownItem>
                                <DropdownSeparator />
                                <DropdownItem tone="danger" icon={<Trash2 className="size-4" aria-hidden="true" />} onClick={act(() => setDeleteTarget(ref))}>Delete</DropdownItem>
                              </>
                            );
                          }}
                        </Dropdown>
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
            <Pagination page={page} pageSize={data.pageSize} total={data.total} onPageChange={setPage} />
          </>
        ) : null}
      </Card>

      <EditClientModal client={editing} open={editing !== null} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void reload(); }} />
      <StatusDialog client={statusTarget} onClose={() => setStatusTarget(null)} onDone={() => { setStatusTarget(null); void reload(); }} />
      <ResetAccessModal client={resetTarget} open={resetTarget !== null} onClose={() => setResetTarget(null)} />
      <DeleteClientModal client={deleteTarget} open={deleteTarget !== null} onClose={() => setDeleteTarget(null)} onDeleted={() => { setDeleteTarget(null); void reload(); }} />
    </>
  );
}
