"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Trash2, UserPlus, UsersRound } from "lucide-react";
import { ORG_ROLES, ORG_ROLE_LABELS, type OrgRole } from "@/lib/authz";
import { apiFetch } from "@/lib/client-api";
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  CardHeader,
  ConfirmationDialog,
  EmptyState,
  Field,
  IconButton,
  Input,
  Modal,
  Select,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  useToast,
} from "@/components/ds";

export type TeamMember = {
  id: string;
  role: OrgRole;
  userId: string;
  name: string | null;
  email: string;
  status: string;
  lastLoginAt: string | null;
};

const ROLE_HELP: Record<OrgRole, string> = {
  CLIENT_OWNER: "Full control, including team and organization settings",
  MANAGER: "Can view the team and activity log",
  AGENT: "Works in the inbox and dashboard",
};

export function TeamManager({
  organizationId,
  members,
  currentUserId,
  canManage,
}: {
  organizationId: string;
  members: TeamMember[];
  currentUserId: string;
  canManage: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [addOpen, setAddOpen] = React.useState(false);
  const [removeTarget, setRemoveTarget] = React.useState<TeamMember | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);

  async function changeRole(m: TeamMember, role: OrgRole) {
    setBusy(m.id);
    const r = await apiFetch(`/api/organizations/${organizationId}/members/${m.id}`, { method: "PATCH", body: { role } });
    setBusy(null);
    if (!r.ok) return toast(r.error, "error");
    toast(`${m.name ?? m.email} is now ${ORG_ROLE_LABELS[role]}`);
    router.refresh();
  }

  async function remove() {
    if (!removeTarget) return;
    setBusy(removeTarget.id);
    const r = await apiFetch(`/api/organizations/${organizationId}/members/${removeTarget.id}`, { method: "DELETE" });
    setBusy(null);
    if (!r.ok) return toast(r.error, "error");
    toast("Member removed");
    setRemoveTarget(null);
    router.refresh();
  }

  return (
    <Card>
      <CardHeader
        title="Team members"
        description={`${members.length} ${members.length === 1 ? "person" : "people"} in this workspace`}
        action={
          canManage ? (
            <Button onClick={() => setAddOpen(true)}>
              <UserPlus aria-hidden="true" /> Add member
            </Button>
          ) : null
        }
      />
      {members.length === 0 ? (
        <EmptyState icon={UsersRound} title="No members yet" />
      ) : (
        <Table caption="Team members">
          <THead>
            <tr>
              <TH>Name</TH>
              <TH>Role</TH>
              <TH>Status</TH>
              {canManage ? <TH className="w-12"><span className="sr-only">Actions</span></TH> : null}
            </tr>
          </THead>
          <TBody>
            {members.map((m) => {
              const self = m.userId === currentUserId;
              return (
                <TR key={m.id}>
                  <TD>
                    <div className="flex items-center gap-3">
                      <Avatar name={m.name ?? m.email} size="sm" />
                      <div className="min-w-0">
                        <p className="truncate font-medium">
                          {m.name ?? "—"} {self ? <span className="text-app-subtle">(you)</span> : null}
                        </p>
                        <p className="truncate text-caption text-app-muted">{m.email}</p>
                      </div>
                    </div>
                  </TD>
                  <TD>
                    {canManage ? (
                      <Select
                        aria-label={`Role for ${m.name ?? m.email}`}
                        value={m.role}
                        disabled={busy === m.id}
                        onChange={(e) => changeRole(m, e.target.value as OrgRole)}
                        className="h-9 w-36"
                      >
                        {ORG_ROLES.map((r) => (
                          <option key={r} value={r}>
                            {ORG_ROLE_LABELS[r]}
                          </option>
                        ))}
                      </Select>
                    ) : (
                      <Badge tone={m.role === "CLIENT_OWNER" ? "primary" : "neutral"}>{ORG_ROLE_LABELS[m.role]}</Badge>
                    )}
                  </TD>
                  <TD>
                    <Badge tone={m.status === "active" ? "success" : "danger"} dot>
                      {m.status === "active" ? "Active" : "Disabled"}
                    </Badge>
                  </TD>
                  {canManage ? (
                    <TD>
                      <IconButton label={`Remove ${m.name ?? m.email}`} size="sm" onClick={() => setRemoveTarget(m)} disabled={busy === m.id}>
                        <Trash2 aria-hidden="true" />
                      </IconButton>
                    </TD>
                  ) : null}
                </TR>
              );
            })}
          </TBody>
        </Table>
      )}

      {canManage ? (
        <AddMemberModal
          open={addOpen}
          onClose={() => setAddOpen(false)}
          organizationId={organizationId}
          onAdded={() => {
            setAddOpen(false);
            toast("Member added");
            router.refresh();
          }}
        />
      ) : null}
      <ConfirmationDialog
        open={removeTarget !== null}
        onClose={() => setRemoveTarget(null)}
        onConfirm={remove}
        loading={busy === removeTarget?.id}
        title="Remove member?"
        description={`${removeTarget?.name ?? removeTarget?.email ?? ""} will lose access to this workspace immediately. Their account is not deleted.`}
        confirmLabel="Remove"
      />
    </Card>
  );
}

export function AddMemberModal({
  open,
  onClose,
  organizationId,
  onAdded,
}: {
  open: boolean;
  onClose: () => void;
  organizationId: string;
  onAdded: () => void;
}) {
  const [form, setForm] = React.useState({ name: "", email: "", role: "AGENT" as OrgRole, password: "" });
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [saving, setSaving] = React.useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setErrors({});
    const r = await apiFetch(`/api/organizations/${organizationId}/members`, {
      method: "POST",
      body: { name: form.name, email: form.email, role: form.role, password: form.password || undefined },
    });
    setSaving(false);
    if (!r.ok) {
      const d = r.details ?? {};
      setErrors({ name: d.name?.[0] ?? "", email: d.email?.[0] ?? "", password: d.password?.[0] ?? "", form: r.details ? "" : r.error });
      return;
    }
    setForm({ name: "", email: "", role: "AGENT", password: "" });
    onAdded();
  }

  return (
    <Modal open={open} onClose={onClose} title="Add team member" description="If the email already has a MECGURA account, they're added directly.">
      <form id="add-member-form" onSubmit={onSubmit} noValidate className="space-y-4">
        {errors.form ? <Alert tone="danger">{errors.form}</Alert> : null}
        <Field id="member-name" label="Full name" error={errors.name}>
          <Input value={form.name} onChange={set("name")} autoComplete="off" required />
        </Field>
        <Field id="member-email" label="Email" error={errors.email}>
          <Input type="email" value={form.email} onChange={set("email")} autoComplete="off" required />
        </Field>
        <Field id="member-role" label="Role" hint={ROLE_HELP[form.role]}>
          <Select value={form.role} onChange={set("role")}>
            {ORG_ROLES.map((r) => (
              <option key={r} value={r}>
                {ORG_ROLE_LABELS[r]}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="member-password" label="Temporary password" hint="Required for new accounts. Share it securely; they can change it in Settings → Security." error={errors.password}>
          <Input type="password" value={form.password} onChange={set("password")} autoComplete="new-password" />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" loading={saving}>
            Add member
          </Button>
        </div>
      </form>
    </Modal>
  );
}
