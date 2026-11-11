"use client";
import Link from "next/link";
import { useState } from "react";
import { Alert, Button, ButtonLink, Field, PasswordInput, TextInput } from "@/components/ui";
import { apiFetch } from "@/lib/api/client";

export function ForgotForm() {
  const [busy, setBusy] = useState(false); const [done, setDone] = useState(false); const [err, setErr] = useState<string | null>(null);
  async function submit(e: React.FormEvent<HTMLFormElement>) { e.preventDefault(); const email = String(new FormData(e.currentTarget).get("email") ?? ""); setBusy(true); setErr(null); const r = await apiFetch("/api/auth/forgot", { method: "POST", body: JSON.stringify({ email }) }); setBusy(false); if (!r.ok) setErr(r.error.message); else setDone(true); }
  if (done) return <div className="space-y-4"><Alert tone="success" title="Check your email">If that address belongs to an account, a reset link is on its way. It expires soon and works once. If nothing arrives, ask your clinic admin to reset your access.</Alert><ButtonLink href="/login" variant="outline" className="w-full">Back to sign in</ButtonLink></div>;
  return (<form onSubmit={submit} noValidate className="flex flex-col gap-form">{err && <Alert tone="danger">{err}</Alert>}<Field label="Email" required><TextInput name="email" type="email" autoComplete="email" /></Field><Button type="submit" size="lg" loading={busy} className="w-full">Send reset link</Button><Link href="/login" className="type-caption">Back to sign in</Link></form>);
}
export function ResetForm({ token }: { token: string }) {
  const [busy, setBusy] = useState(false); const [done, setDone] = useState(false); const [err, setErr] = useState<{ message?: string; fields: Record<string, string> }>({ fields: {} });
  async function submit(e: React.FormEvent<HTMLFormElement>) { e.preventDefault(); const f = new FormData(e.currentTarget); setBusy(true); setErr({ fields: {} }); const r = await apiFetch("/api/auth/reset", { method: "POST", body: JSON.stringify({ token, password: f.get("password"), confirm: f.get("confirm") }) }); setBusy(false); if (!r.ok) setErr({ message: r.error.fieldErrors ? undefined : r.error.message, fields: r.error.fieldErrors ?? {} }); else setDone(true); }
  if (done) return <div className="space-y-4"><Alert tone="success" title="Password changed">You can sign in with your new password.</Alert><ButtonLink href="/login" size="lg" className="w-full">Go to sign in</ButtonLink></div>;
  return (<form onSubmit={submit} noValidate className="flex flex-col gap-form">{err.message && <Alert tone="danger">{err.message} <Link href="/forgot-password">Request a new link</Link></Alert>}<Field label="New password" required error={err.fields.password} hint="At least 10 characters, with a letter and a number."><PasswordInput name="password" autoComplete="new-password" /></Field><Field label="Confirm password" required error={err.fields.confirm}><PasswordInput name="confirm" autoComplete="new-password" /></Field><Button type="submit" size="lg" loading={busy} className="w-full">Change password</Button></form>);
}
