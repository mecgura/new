"use client";
import Link from "next/link";
import { useState } from "react";
import { Alert, Button, ButtonLink, Field, PasswordInput } from "@/components/ui";
import { apiFetch } from "@/lib/api/client";

export function InviteForm({ token }: { token: string }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMessage(undefined);
    const res = await apiFetch("/api/invitations/accept", { method: "POST", body: JSON.stringify({ token, password, confirm }) });
    setBusy(false);
    if (!res.ok) { setErrors(res.error.fieldErrors ?? {}); setMessage(res.error.fieldErrors ? undefined : res.error.message); return; }
    setDone(true);
  }

  if (done) return (
    <div className="space-y-4"><Alert tone="success" title="Account ready">Your password is set. You can sign in now.</Alert><ButtonLink href="/login" size="lg" className="w-full">Go to sign in</ButtonLink></div>
  );
  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-form">
      {message && <Alert tone="danger">{message} <Link href="/login">Back to sign in</Link></Alert>}
      <Field label="New password" required error={errors.password} hint="At least 10 characters, with a letter and a number."><PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" /></Field>
      <Field label="Confirm password" required error={errors.confirm}><PasswordInput value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" /></Field>
      <Button type="submit" size="lg" loading={busy} className="mt-1 w-full">Set password</Button>
    </form>
  );
}
