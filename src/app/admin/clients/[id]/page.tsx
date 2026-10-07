"use client";

import * as React from "react";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { Ban, CheckCircle2, KeyRound, Pencil, Trash2 } from "lucide-react";
import { Badge, Button, ErrorState, LoadingState, PageHeader, TabPanel, Tabs } from "@/components/ds";
import { apiFetch } from "@/lib/client-api";
import { DeleteClientModal, EditClientModal, ResetAccessModal, StatusDialog, type ClientRef } from "@/components/admin/client-dialogs";
import {
  ActivityTab,
  BillingTab,
  OverviewTab,
  PlanTab,
  ServicesTab,
  UsageTab,
  UsersTab,
  WhatsAppTab,
  type ClientDetail,
} from "@/components/admin/client-detail-tabs";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "users", label: "Users" },
  { id: "services", label: "Services" },
  { id: "whatsapp", label: "WhatsApp" },
  { id: "plan", label: "Plan" },
  { id: "usage", label: "Usage" },
  { id: "billing", label: "Billing" },
  { id: "activity", label: "Activity" },
];

function ClientDetailInner() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const tab = TABS.some((t) => t.id === params.get("tab")) ? params.get("tab")! : "overview";

  const [data, setData] = React.useState<ClientDetail | null>(null);
  const [error, setError] = React.useState<{ status: number; message: string } | null>(null);
  const [editOpen, setEditOpen] = React.useState(false);
  const [statusOpen, setStatusOpen] = React.useState(false);
  const [resetOpen, setResetOpen] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);

  const load = React.useCallback(async () => {
    const r = await apiFetch<ClientDetail>(`/api/admin/organizations/${id}`);
    if (!r.ok) return setError({ status: r.status, message: r.error });
    setError(null);
    setData(r.data);
  }, [id]);

  React.useEffect(() => {
    // Initial fetch (external data sync).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  if (error) {
    return error.status === 404 ? (
      <ErrorState title="Client not found" description="It may have been deleted." onRetry={() => router.push("/admin/clients")} />
    ) : (
      <ErrorState description={error.message} onRetry={load} />
    );
  }
  if (!data) return <LoadingState label="Loading client…" />;

  const o = data.organization;
  const ref: ClientRef = { id: o.id, name: o.name, status: o.status, contactEmail: o.contactEmail, contactPhone: o.contactPhone };
  const members = o.members.map((m) => ({ userId: m.user.id, name: m.user.name, email: m.user.email, role: m.role }));

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: "Admin", href: "/admin" }, { label: "Clients", href: "/admin/clients" }, { label: o.name }]}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {o.name}
            <Badge tone={o.status === "active" ? "success" : "danger"} dot>
              {o.status === "active" ? "Active" : "Suspended"}
            </Badge>
          </span>
        }
        description={data.plan ? `${data.plan.name} plan · ${o.members.length} user(s)` : "No plan assigned"}
        actions={
          <>
            <Button variant="secondary" onClick={() => setEditOpen(true)}>
              <Pencil aria-hidden="true" /> Edit
            </Button>
            <Button variant="secondary" onClick={() => setResetOpen(true)}>
              <KeyRound aria-hidden="true" /> Reset access
            </Button>
            <Button variant={o.status === "active" ? "danger" : "primary"} onClick={() => setStatusOpen(true)}>
              {o.status === "active" ? <Ban aria-hidden="true" /> : <CheckCircle2 aria-hidden="true" />}
              {o.status === "active" ? "Suspend" : "Activate"}
            </Button>
            <Button variant="ghost" onClick={() => setDeleteOpen(true)} aria-label="Delete client">
              <Trash2 aria-hidden="true" />
            </Button>
          </>
        }
      />
      <Tabs label="Client sections" items={TABS} value={tab} onValueChange={(t) => router.replace(`${pathname}?tab=${t}`, { scroll: false })} />
      <TabPanel id="overview" active={tab === "overview"}>
        <OverviewTab d={data} />
      </TabPanel>
      <TabPanel id="users" active={tab === "users"}>
        <UsersTab d={data} onChanged={load} onReset={() => setResetOpen(true)} />
      </TabPanel>
      <TabPanel id="services" active={tab === "services"}>
        <ServicesTab d={data} onChanged={load} />
      </TabPanel>
      <TabPanel id="whatsapp" active={tab === "whatsapp"}>
        <WhatsAppTab d={data} onChanged={load} />
      </TabPanel>
      <TabPanel id="plan" active={tab === "plan"}>
        <PlanTab d={data} onChanged={load} />
      </TabPanel>
      <TabPanel id="usage" active={tab === "usage"}>
        <UsageTab d={data} />
      </TabPanel>
      <TabPanel id="billing" active={tab === "billing"}>
        <BillingTab d={data} />
      </TabPanel>
      <TabPanel id="activity" active={tab === "activity"}>
        <ActivityTab organizationId={o.id} />
      </TabPanel>

      <EditClientModal client={ref} open={editOpen} onClose={() => setEditOpen(false)} onSaved={() => { setEditOpen(false); void load(); }} />
      <StatusDialog client={statusOpen ? ref : null} onClose={() => setStatusOpen(false)} onDone={() => { setStatusOpen(false); void load(); }} />
      <ResetAccessModal client={ref} members={members} open={resetOpen} onClose={() => setResetOpen(false)} />
      <DeleteClientModal client={ref} open={deleteOpen} onClose={() => setDeleteOpen(false)} onDeleted={() => router.push("/admin/clients")} />
    </>
  );
}

export default function ClientDetailPage() {
  return (
    <React.Suspense fallback={<LoadingState />}>
      <ClientDetailInner />
    </React.Suspense>
  );
}
