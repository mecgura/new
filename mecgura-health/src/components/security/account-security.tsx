"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, Button, Card, Field, PasswordInput, StatusBadge, TextInput, useToast } from "@/components/ui";
import { apiFetch } from "@/lib/api/client";
import { logoutAction } from "@/app/actions/auth";

type Mfa = { enabled: boolean; pending: boolean; backupRemaining: number };
type Errs = { message?: string; fields: Record<string, string> };
const none: Errs = { fields: {} };

export function AccountSecurity({ mfa, required }: { mfa: Mfa; required: boolean }) {
  const router = useRouter(); const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null); const [err, setErr] = useState<Errs>(none);
  const [setup, setSetup] = useState<{ secret: string; otpauth: string } | null>(null); const [codes, setCodes] = useState<string[] | null>(null);
  async function call<T>(key: string, path: string, body: unknown): Promise<T | null> {
    setBusy(key); setErr(none); const r = await apiFetch<T>(path, { method: "POST", body: JSON.stringify(body) }); setBusy(null);
    if (!r.ok) { setErr({ message: r.error.fieldErrors ? undefined : r.error.message, fields: r.error.fieldErrors ?? {} }); return null; } return r.data;
  }
  const form = (e: React.FormEvent<HTMLFormElement>) => { e.preventDefault(); const f = new FormData(e.currentTarget); const o: Record<string, string> = {}; f.forEach((v, k) => { o[k] = String(v); }); return o; };
  return (
    <div className="space-y-section">
      <Card className="space-y-4 p-card">
        <div className="flex flex-wrap items-center gap-3"><h2 className="type-section-title">Two-factor authentication</h2><StatusBadge tone={mfa.enabled ? "success" : "neutral"}>{mfa.enabled ? "On" : "Off"}</StatusBadge>{required && <StatusBadge tone="warning">Required for your role</StatusBadge>}</div>
        {err.message && <Alert tone="danger">{err.message}</Alert>}
        {codes && <Alert tone="warning" title="Save your backup codes now">Each code works once if you lose your phone. They are shown only this time.<ul className="mt-2 grid grid-cols-2 gap-1 font-mono">{codes.map((c) => <li key={c}>{c}</li>)}</ul></Alert>}
        {!mfa.enabled && !setup && (
          <form onSubmit={async (e) => { const o = form(e); const d = await call<{ secret: string; otpauth: string }>("begin", "/api/me/security/mfa", { action: "begin", password: o.password }); if (d) setSetup(d); }} className="max-w-sm space-y-3" aria-label="Start two-factor setup">
            <p className="type-secondary">Use an authenticator app (Google Authenticator, Authy, Microsoft Authenticator, 1Password…). Confirm your password to begin.</p>
            <Field label="Your password" required error={err.fields.password}><PasswordInput name="password" autoComplete="current-password" /></Field>
            <Button type="submit" loading={busy === "begin"}>Set up two-factor</Button>
          </form>)}
        {!mfa.enabled && setup && (
          <form onSubmit={async (e) => { const o = form(e); const d = await call<{ backupCodes: string[] }>("confirm", "/api/me/security/mfa", { action: "confirm", code: o.code }); if (d) { setCodes(d.backupCodes); setSetup(null); toast({ tone: "success", title: "Two-factor is on" }); router.refresh(); } }} className="max-w-md space-y-3" aria-label="Confirm two-factor setup">
            <p className="type-secondary">In your authenticator app choose “Enter a setup key” and type this key (time-based, 6 digits):</p>
            <p className="rounded-md bg-surface-muted p-3 font-mono text-lg tracking-wider break-all" aria-label="Setup key">{setup.secret}</p>
            <Field label="6-digit code from the app" required error={err.fields.code}><TextInput name="code" inputMode="numeric" autoComplete="one-time-code" /></Field>
            <Button type="submit" loading={busy === "confirm"}>Turn on two-factor</Button>
          </form>)}
        {mfa.enabled && (
          <div className="space-y-4">
            <p className="type-secondary">{mfa.backupRemaining} backup code(s) left.</p>
            <form onSubmit={async (e) => { const o = form(e); const d = await call<{ backupCodes: string[] }>("regen", "/api/me/security/mfa", { action: "regenerate", password: o.password, code: o.code }); if (d) setCodes(d.backupCodes); }} className="grid max-w-xl gap-3 sm:grid-cols-2" aria-label="Manage two-factor">
              <Field label="Your password" error={err.fields.password}><PasswordInput name="password" autoComplete="current-password" /></Field>
              <Field label="Authenticator code" error={err.fields.code}><TextInput name="code" inputMode="numeric" autoComplete="one-time-code" /></Field>
              <div className="flex flex-wrap gap-2 sm:col-span-2"><Button type="submit" variant="outline" loading={busy === "regen"}>New backup codes</Button>
                <Button type="button" variant="danger" loading={busy === "disable"} onClick={async (e) => { const f = new FormData((e.currentTarget.form as HTMLFormElement)); const d = await call("disable", "/api/me/security/mfa", { action: "disable", password: f.get("password"), code: f.get("code") }); if (d) { toast({ tone: "success", title: "Two-factor is off" }); router.refresh(); } }}>Turn off</Button></div>
            </form>
          </div>)}
      </Card>
      <Card className="space-y-3 p-card">
        <h2 className="type-section-title">Change password</h2>
        <form onSubmit={async (e) => { const o = form(e); const d = await call("pw", "/api/me/security/password", { current: o.current, next: o.next, confirm: o.confirm, mfaCode: o.mfaCode }); if (d) { toast({ tone: "success", title: "Password changed — please sign in again" }); await logoutAction(); } }} className="grid max-w-xl gap-3 sm:grid-cols-2" aria-label="Change password">
          <Field label="Current password" required error={err.fields.current} className="sm:col-span-2"><PasswordInput name="current" autoComplete="current-password" /></Field>
          <Field label="New password" required error={err.fields.next} hint="10+ characters with a letter and a number."><PasswordInput name="next" autoComplete="new-password" /></Field>
          <Field label="Confirm" required error={err.fields.confirm}><PasswordInput name="confirm" autoComplete="new-password" /></Field>
          {mfa.enabled && <Field label="Authenticator code" required error={err.fields.mfaCode}><TextInput name="mfaCode" inputMode="numeric" /></Field>}
          <div className="sm:col-span-2"><Button type="submit" loading={busy === "pw"}>Change password</Button></div>
        </form>
      </Card>
      <Card className="space-y-3 p-card">
        <h2 className="type-section-title">Sessions</h2>
        <p className="type-secondary">Sign out of every browser and device where you are signed in, including this one.</p>
        <Button variant="outline" loading={busy === "all"} onClick={async () => { const d = await call("all", "/api/me/security/logout-all", {}); if (d) await logoutAction(); }}>Sign out everywhere</Button>
      </Card>
    </div>
  );
}
