"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Building, MoreHorizontal, Pencil, Eye, Palette, Users, Power, PauseCircle, PlayCircle } from "lucide-react";
import { Button, ConfirmDialog, Dropdown, useToast, type DropdownItem } from "@/components/ui";
import { apiFetch } from "@/lib/api/client";
import type { TenantStatus } from "@/lib/domain/constants";

type Pending = { status: TenantStatus; title: string; description: string; label: string; tone: "danger" | "primary" } | null;

function useClinicOps(id: string, name: string) {
  const router = useRouter();
  const toast = useToast();
  const [pending, setPending] = useState<Pending>(null);
  const [busy, setBusy] = useState(false);

  async function enter(dest: string) {
    const res = await apiFetch("/api/platform/workspace", { method: "POST", body: JSON.stringify({ tenantId: id }) });
    if (!res.ok) return toast({ tone: "danger", title: "Couldn't open the clinic", description: res.error.message });
    router.push(dest);
    router.refresh();
  }
  async function confirmStatus() {
    if (!pending) return;
    setBusy(true);
    const res = await apiFetch(`/api/platform/clinics/${id}/status`, { method: "POST", body: JSON.stringify({ status: pending.status }) });
    setBusy(false);
    if (!res.ok) return toast({ tone: "danger", title: "Couldn't change status", description: res.error.message });
    toast({ tone: "success", title: `${name} is now ${pending.status.toLowerCase()}` });
    setPending(null);
    router.refresh();
  }
  const ask = (status: TenantStatus): Pending => {
    const map: Record<TenantStatus, NonNullable<Pending>> = {
      ACTIVE: { status: "ACTIVE", title: `Activate ${name}?`, description: "Staff of this clinic can sign in and use the workspace.", label: "Activate", tone: "primary" },
      TRIAL: { status: "TRIAL", title: `Set ${name} to trial?`, description: "Staff keep normal access; trial limits will apply in the future.", label: "Set to trial", tone: "primary" },
      SUSPENDED: { status: "SUSPENDED", title: `Suspend ${name}?`, description: "All staff of this clinic are signed out of the workspace and cannot sign in until it is activated again. No data is deleted.", label: "Suspend", tone: "danger" },
      INACTIVE: { status: "INACTIVE", title: `Deactivate ${name}?`, description: "The clinic's workspace is closed: no staff can sign in. No data is deleted; you can re-activate later.", label: "Deactivate", tone: "danger" },
    };
    return map[status];
  };
  return { enter, setPending: (s: TenantStatus) => setPending(ask(s)), dialog: (
    <ConfirmDialog open={!!pending} onCancel={() => setPending(null)} onConfirm={confirmStatus} loading={busy}
      title={pending?.title ?? ""} description={pending?.description ?? ""} confirmLabel={pending?.label} tone={pending?.tone} />
  ) };
}

function statusItems(status: string, set: (s: TenantStatus) => void): DropdownItem[] {
  const items: DropdownItem[] = [];
  if (status !== "ACTIVE") items.push({ label: "Activate", icon: <PlayCircle aria-hidden className="size-4" />, onSelect: () => set("ACTIVE") });
  if (status !== "SUSPENDED") items.push({ label: "Suspend", icon: <PauseCircle aria-hidden className="size-4" />, tone: "danger", onSelect: () => set("SUSPENDED") });
  if (status !== "INACTIVE") items.push({ label: "Deactivate", icon: <Power aria-hidden className="size-4" />, tone: "danger", onSelect: () => set("INACTIVE") });
  return items;
}

/** Row menu on the clinics list. */
export function ClinicRowActions({ id, name, status }: { id: string; name: string; status: string }) {
  const ops = useClinicOps(id, name);
  return (
    <>
      <Dropdown triggerLabel={`Actions for ${name}`} triggerClassName="flex size-control items-center justify-center rounded-md hover:bg-surface-muted" trigger={<MoreHorizontal aria-hidden className="size-5" />}
        items={[
          { label: "View", href: `/platform/clinics/${id}`, icon: <Eye aria-hidden className="size-4" /> },
          { label: "Edit", href: `/platform/clinics/${id}/edit`, icon: <Pencil aria-hidden className="size-4" /> },
          { label: "Manage users", icon: <Users aria-hidden className="size-4" />, onSelect: () => void ops.enter("/team") },
          { label: "Branding", icon: <Palette aria-hidden className="size-4" />, onSelect: () => void ops.enter("/settings/branding") },
          { type: "separator" },
          ...statusItems(status, ops.setPending),
        ]} />
      {ops.dialog}
    </>
  );
}

/** Button bar on the clinic details page. */
export function ClinicDetailActions({ id, name, status }: { id: string; name: string; status: string }) {
  const ops = useClinicOps(id, name);
  return (
    <div className="flex flex-wrap gap-2">
      <Button onClick={() => void ops.enter("/dashboard")}><Building aria-hidden className="size-4" />Open workspace</Button>
      <Button variant="outline" onClick={() => void ops.enter("/team")}><Users aria-hidden className="size-4" />Manage users</Button>
      <Button variant="outline" onClick={() => void ops.enter("/settings/branding")}><Palette aria-hidden className="size-4" />Branding</Button>
      {status !== "ACTIVE" && <Button variant="success" onClick={() => ops.setPending("ACTIVE")}>Activate</Button>}
      {status !== "SUSPENDED" && <Button variant="outline" onClick={() => ops.setPending("SUSPENDED")}>Suspend</Button>}
      {status !== "INACTIVE" && <Button variant="outline" onClick={() => ops.setPending("INACTIVE")}>Deactivate</Button>}
      {ops.dialog}
    </div>
  );
}
