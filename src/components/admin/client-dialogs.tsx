"use client";

import * as React from "react";
import { Copy, KeyRound, Wand2 } from "lucide-react";
import { Alert, Button, ConfirmationDialog, Field, Input, Modal, Select, useToast } from "@/components/ds";
import { apiFetch } from "@/lib/client-api";

export type ClientRef = { id: string; name: string; status: string; contactEmail?: string; contactPhone?: string };

export function generateClientPassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(14));
  return `${Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("")}7a`;
}

const fieldErrors = (details?: Record<string, string[]>) =>
  Object.fromEntries(Object.entries(details ?? {}).map(([k, v]) => [k, v?.[0] ?? ""])) as Record<string, string>;

export function EditClientModal({ client, open, onClose, onSaved }: { client: ClientRef | null; open: boolean; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [form, setForm] = React.useState({ name: "", contactEmail: "", contactPhone: "" });
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [saving, setSaving] = React.useState(false);
  const [loadedFor, setLoadedFor] = React.useState<string | null>(null);
  if (client && open && loadedFor !== client.id) {
    setLoadedFor(client.id);
    setForm({ name: client.name, contactEmail: client.contactEmail ?? "", contactPhone: client.contactPhone ?? "" });
    setErrors({});
  }
  if (!open && loadedFor) setLoadedFor(null);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!client) return;
    setSaving(true);
    const r = await apiFetch(`/api/admin/organizations/${client.id}`, { method: "PATCH", body: form });
    setSaving(false);
    if (!r.ok) return setErrors({ ...fieldErrors(r.details), form: r.details ? "" : r.error });
    toast("Client updated");
    onSaved();
  }

  return (
    <Modal open={open} onClose={onClose} title="Edit client">
      <form onSubmit={submit} noValidate className="space-y-4">
        {errors.form ? <Alert tone="danger">{errors.form}</Alert> : null}
        <Field id="edit-name" label="Company name" error={errors.name}>
          <Input value={form.name} onChange={set("name")} required />
        </Field>
        <Field id="edit-email" label="Contact email" error={errors.contactEmail}>
          <Input type="email" value={form.contactEmail} onChange={set("contactEmail")} />
        </Field>
        <Field id="edit-phone" label="Mobile" error={errors.contactPhone}>
          <Input type="tel" value={form.contactPhone} onChange={set("contactPhone")} />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" loading={saving}>
            Save changes
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function StatusDialog({ client, onClose, onDone }: { client: ClientRef | null; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [saving, setSaving] = React.useState(false);
  const suspending = client?.status === "active";
  async function confirm() {
    if (!client) return;
    setSaving(true);
    const r = await apiFetch(`/api/admin/organizations/${client.id}`, { method: "PATCH", body: { status: suspending ? "suspended" : "active" } });
    setSaving(false);
    if (!r.ok) return toast(r.error, "error");
    toast(`${client.name} ${suspending ? "suspended" : "activated"}`);
    onDone();
  }
  return (
    <ConfirmationDialog
      open={client !== null}
      onClose={onClose}
      onConfirm={confirm}
      loading={saving}
      tone={suspending ? "danger" : "primary"}
      title={suspending ? "Suspend client?" : "Activate client?"}
      description={
        suspending
          ? `Everyone at ${client?.name ?? ""} loses access to their workspace immediately. Data, numbers and plan are kept.`
          : `${client?.name ?? ""} regains access to their workspace.`
      }
      confirmLabel={suspending ? "Suspend" : "Activate"}
    />
  );
}

type Member = { userId: string; name: string | null; email: string; role: string };

/** Resets a member's password (default: owner). Shows a generated password exactly once. */
export function ResetAccessModal({ client, members, open, onClose }: { client: ClientRef | null; members?: Member[]; open: boolean; onClose: () => void }) {
  const [userId, setUserId] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [result, setResult] = React.useState<{ email: string; password: string | null } | null>(null);
  const [copied, setCopied] = React.useState(false);

  function close() {
    setUserId("");
    setPassword("");
    setError("");
    setResult(null);
    setCopied(false);
    onClose();
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!client) return;
    setSaving(true);
    setError("");
    const r = await apiFetch<{ email: string; password: string | null }>(`/api/admin/organizations/${client.id}/reset-access`, {
      method: "POST",
      body: { ...(userId ? { userId } : {}), ...(password ? { password } : {}) },
    });
    setSaving(false);
    if (!r.ok) return setError(r.details?.password?.[0] ?? r.error);
    setResult(r.data);
  }

  return (
    <Modal open={open} onClose={close} title="Reset access" description={`Sets a new password and signs the user out everywhere${client ? ` · ${client.name}` : ""}.`}>
      {result ? (
        <div className="space-y-4">
          <Alert tone="success" title="Access reset">
            {result.email} must sign in with the new password.
          </Alert>
          {result.password ? (
            <div>
              <p className="mb-1.5 text-small text-app-muted">Temporary password — shown only once. Share it securely.</p>
              <div className="flex gap-2">
                <Input readOnly value={result.password} aria-label="Temporary password" className="font-mono" />
                <Button
                  variant="secondary"
                  onClick={async () => {
                    await navigator.clipboard.writeText(result.password!);
                    setCopied(true);
                  }}
                >
                  <Copy aria-hidden="true" /> {copied ? "Copied" : "Copy"}
                </Button>
              </div>
            </div>
          ) : null}
          <div className="flex justify-end">
            <Button onClick={close}>Done</Button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} noValidate className="space-y-4">
          {error ? <Alert tone="danger">{error}</Alert> : null}
          {members && members.length > 0 ? (
            <Field id="reset-user" label="User">
              <Select value={userId} onChange={(e) => setUserId(e.target.value)}>
                <option value="">Primary owner</option>
                {members.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.name ?? m.email} — {m.email}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          <div>
            <Field id="reset-password" label="New password" hint="Leave empty to generate a secure one.">
              <Input type="text" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" className="font-mono" />
            </Field>
            <Button size="sm" variant="secondary" className="mt-2" onClick={() => setPassword(generateClientPassword())}>
              <Wand2 aria-hidden="true" /> Generate
            </Button>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={close} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" loading={saving}>
              <KeyRound aria-hidden="true" /> Reset access
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

/** Hard delete with type-the-name confirmation. */
export function DeleteClientModal({ client, open, onClose, onDeleted }: { client: ClientRef | null; open: boolean; onClose: () => void; onDeleted: () => void }) {
  const toast = useToast();
  const [confirmName, setConfirmName] = React.useState("");
  const [error, setError] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  function close() {
    setConfirmName("");
    setError("");
    onClose();
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!client) return;
    setSaving(true);
    const r = await apiFetch<{ usersDeleted: number }>(`/api/admin/organizations/${client.id}`, { method: "DELETE", body: { confirmName } });
    setSaving(false);
    if (!r.ok) return setError(r.details?.confirmName?.[0] ?? r.error);
    toast(`${client.name} deleted (${r.data.usersDeleted} user account${r.data.usersDeleted === 1 ? "" : "s"} removed)`);
    setConfirmName("");
    onDeleted();
  }
  return (
    <Modal open={open} onClose={close} title="Delete client" size="sm">
      <form onSubmit={submit} noValidate className="space-y-4">
        <Alert tone="danger" title="This cannot be undone">
          Deletes the workspace, settings, services, plan history and WhatsApp registrations, plus user accounts that belong only to this client.
        </Alert>
        <Field id="delete-confirm" label={<>Type <strong>{client?.name}</strong> to confirm</>} error={error}>
          <Input value={confirmName} onChange={(e) => setConfirmName(e.target.value)} autoComplete="off" />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={close} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" variant="danger" loading={saving} disabled={confirmName.trim() !== client?.name}>
            Delete permanently
          </Button>
        </div>
      </form>
    </Modal>
  );
}
