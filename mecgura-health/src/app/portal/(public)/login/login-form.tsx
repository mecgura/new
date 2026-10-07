"use client";
import Link from "next/link";
import { useActionState } from "react";
import { Alert, Button, Field, PasswordInput, TextInput } from "@/components/ui";
import { portalLoginAction, type PortalFormState } from "@/app/actions/portal";

export function PortalLoginForm({ clinic, needsClinic, callbackUrl }: { clinic: string; needsClinic: boolean; callbackUrl: string }) {
  const [state, action, pending] = useActionState<PortalFormState, FormData>(portalLoginAction, null);
  const fe = state?.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-4" noValidate>
      {state?.message && <Alert tone="danger" title="Couldn't sign you in">{state.message}</Alert>}
      <input type="hidden" name="callbackUrl" value={callbackUrl} />
      {needsClinic ? <Field label="Clinic code" required error={fe.clinic} hint="The short name in your clinic's portal link, e.g. demo-clinic"><TextInput name="clinic" defaultValue={state?.values?.clinic ?? clinic} autoCapitalize="none" autoCorrect="off" spellCheck={false} /></Field> : <input type="hidden" name="clinic" value={clinic} />}
      <Field label="Mobile number or email" required error={fe.identifier}><TextInput name="identifier" defaultValue={state?.values?.identifier} autoComplete="username" inputMode="email" autoCapitalize="none" spellCheck={false} /></Field>
      <Field label="Password" required error={fe.password}><PasswordInput name="password" autoComplete="current-password" /></Field>
      <Button type="submit" size="lg" className="w-full" loading={pending}>Sign in</Button>
      <div className="type-secondary flex flex-wrap items-center justify-between gap-2">
        <Link href={`/portal/forgot${clinic ? `?clinic=${encodeURIComponent(clinic)}` : ""}`}>Forgot your password?</Link>
        <Link href={`/portal/activate${clinic ? `?clinic=${encodeURIComponent(clinic)}` : ""}`}>Activate my account</Link>
      </div>
    </form>
  );
}
