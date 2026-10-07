"use client";

import * as React from "react";
import { signOut } from "next-auth/react";
import { LogOut } from "lucide-react";
import { Alert, Button, Card, CardBody, CardHeader, ConfirmationDialog, Field, Input } from "@/components/ds";
import { apiFetch } from "@/lib/client-api";

export function SecurityForm() {
  const [form, setForm] = React.useState({ currentPassword: "", newPassword: "", confirm: "" });
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [saving, setSaving] = React.useState(false);
  const [done, setDone] = React.useState(false);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [revoking, setRevoking] = React.useState(false);
  const [revokeError, setRevokeError] = React.useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (form.newPassword !== form.confirm) {
      setErrors({ confirm: "Passwords don't match" });
      return;
    }
    setSaving(true);
    setErrors({});
    const r = await apiFetch("/api/me/password", { method: "POST", body: { currentPassword: form.currentPassword, newPassword: form.newPassword } });
    setSaving(false);
    if (!r.ok) {
      setErrors({
        currentPassword: r.details?.currentPassword?.[0] ?? "",
        newPassword: r.details?.newPassword?.[0] ?? "",
        form: r.details ? "" : r.error,
      });
      return;
    }
    // The password change revoked every session (including this one) — sign in again.
    setDone(true);
    window.setTimeout(() => void signOut({ callbackUrl: "/login?reason=password-changed" }), 1500);
  }

  async function revokeAll() {
    setRevoking(true);
    setRevokeError("");
    const r = await apiFetch("/api/me/sessions", { method: "DELETE" });
    if (!r.ok) {
      setRevoking(false);
      setRevokeError(r.error);
      return;
    }
    await signOut({ callbackUrl: "/login" });
  }

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Change password" description="At least 8 characters, with a letter and a number." />
        <CardBody>
          {done ? (
            <Alert tone="success" title="Password changed">
              For your security all sessions were signed out. Redirecting to sign in…
            </Alert>
          ) : (
            <form onSubmit={onSubmit} noValidate className="space-y-5">
              {errors.form ? <Alert tone="danger">{errors.form}</Alert> : null}
              <Field id="current-password" label="Current password" error={errors.currentPassword}>
                <Input type="password" autoComplete="current-password" value={form.currentPassword} onChange={set("currentPassword")} required />
              </Field>
              <Field id="new-password" label="New password" error={errors.newPassword}>
                <Input type="password" autoComplete="new-password" value={form.newPassword} onChange={set("newPassword")} required />
              </Field>
              <Field id="confirm-password" label="Confirm new password" error={errors.confirm}>
                <Input type="password" autoComplete="new-password" value={form.confirm} onChange={set("confirm")} required />
              </Field>
              <div className="flex justify-end">
                <Button type="submit" loading={saving} disabled={!form.currentPassword || !form.newPassword}>
                  Update password
                </Button>
              </div>
            </form>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Sessions" description="Signed in on a shared or lost device? End every session at once." />
        <CardBody className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-small text-app-muted">You will be signed out here too.</p>
          <Button variant="danger" onClick={() => setConfirmOpen(true)}>
            <LogOut aria-hidden="true" /> Sign out of all devices
          </Button>
          {revokeError ? <Alert tone="danger" className="w-full">{revokeError}</Alert> : null}
        </CardBody>
      </Card>

      <ConfirmationDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={revokeAll}
        loading={revoking}
        title="Sign out everywhere?"
        description="All active sessions for your account, including this one, will end immediately."
        confirmLabel="Sign out everywhere"
      />
    </div>
  );
}
