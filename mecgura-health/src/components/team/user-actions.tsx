"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Ban, MoreHorizontal, Pencil, PauseCircle, PlayCircle, Send } from "lucide-react";
import { Button, ConfirmDialog, Dropdown, Modal, useToast, type DropdownItem } from "@/components/ui";
import { InviteLinkCard } from "@/components/clinic/invite-link-card";
import { apiFetch } from "@/lib/api/client";

type Next = "ACTIVE" | "SUSPENDED" | "DISABLED";
interface Props { id: string; name: string; status: string; canEdit: boolean; canDisable: boolean; canInvite: boolean; isSelf: boolean; variant?: "menu" | "buttons" }

const COPY: Record<Next, { title: (n: string) => string; desc: string; label: string; tone: "danger" | "primary" }> = {
  ACTIVE: { title: (n) => `Activate ${n}?`, desc: "They will be able to sign in again.", label: "Activate", tone: "primary" },
  SUSPENDED: { title: (n) => `Suspend ${n}?`, desc: "They are signed out and can't sign in until re-activated. Their data is kept.", label: "Suspend", tone: "danger" },
  DISABLED: { title: (n) => `Disable ${n}?`, desc: "The account is closed and can't sign in. It can be re-activated later.", label: "Disable", tone: "danger" },
};

export function UserActions({ id, name, status, canEdit, canDisable, canInvite, isSelf, variant = "menu" }: Props) {
  const router = useRouter();
  const toast = useToast();
  const [next, setNext] = useState<Next | null>(null);
  const [busy, setBusy] = useState(false);
  const [invite, setInvite] = useState<{ token: string; expiresAt: string } | null>(null);

  async function confirm() {
    if (!next) return;
    setBusy(true);
    const res = await apiFetch(`/api/users/${id}/status`, { method: "POST", body: JSON.stringify({ status: next }) });
    setBusy(false);
    if (!res.ok) return toast({ tone: "danger", title: "Couldn't change status", description: res.error.message });
    toast({ tone: "success", title: `${name}: status updated` }); setNext(null); router.refresh();
  }
  async function reinvite() {
    const res = await apiFetch<{ inviteToken: string; inviteExpiresAt: string }>(`/api/users/${id}/invite`, { method: "POST" });
    if (!res.ok) return toast({ tone: "danger", title: "Couldn't create invitation", description: res.error.message });
    setInvite({ token: res.data.inviteToken, expiresAt: res.data.inviteExpiresAt });
  }

  const items: DropdownItem[] = [];
  if (canEdit) items.push({ label: "Edit", href: `/team/${id}`, icon: <Pencil aria-hidden className="size-4" /> });
  if (canInvite && status === "INVITED") items.push({ label: "New invitation link", icon: <Send aria-hidden className="size-4" />, onSelect: () => void reinvite() });
  if (canDisable && !isSelf) {
    if (status !== "ACTIVE") items.push({ label: "Activate", icon: <PlayCircle aria-hidden className="size-4" />, onSelect: () => setNext("ACTIVE") });
    if (status === "ACTIVE") items.push({ label: "Suspend", icon: <PauseCircle aria-hidden className="size-4" />, tone: "danger", onSelect: () => setNext("SUSPENDED") });
    if (status !== "DISABLED") items.push({ label: "Disable", icon: <Ban aria-hidden className="size-4" />, tone: "danger", onSelect: () => setNext("DISABLED") });
  }
  if (items.length === 0) return null;

  return (
    <>
      {variant === "menu" ? (
        <Dropdown triggerLabel={`Actions for ${name}`} triggerClassName="flex size-control items-center justify-center rounded-md hover:bg-surface-muted" trigger={<MoreHorizontal aria-hidden className="size-5" />} items={items} />
      ) : (
        <div className="flex flex-wrap gap-2">
          {items.filter((i) => "onSelect" in i && i.onSelect).map((i) => i.type !== "separator" && i.type !== "label" && <Button key={i.label} variant={i.tone === "danger" ? "outline" : "primary"} size="sm" onClick={i.onSelect}>{i.label}</Button>)}
        </div>
      )}
      {next && <ConfirmDialog open onCancel={() => setNext(null)} onConfirm={confirm} loading={busy} title={COPY[next].title(name)} description={COPY[next].desc} confirmLabel={COPY[next].label} tone={COPY[next].tone} />}
      <Modal open={!!invite} onClose={() => setInvite(null)} title="Invitation link" footer={<Button onClick={() => setInvite(null)}>Done</Button>}>
        {invite && <InviteLinkCard token={invite.token} expiresAt={invite.expiresAt} name={name} />}
      </Modal>
    </>
  );
}
