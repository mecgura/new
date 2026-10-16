"use client";
import Link from "next/link";
import { startTransition, useActionState } from "react";
import { Alert, Button, Field, PasswordInput, TextInput } from "@/components/ui";
import { loginAction, type LoginState } from "@/app/actions/auth";

export function LoginForm({ callbackUrl }: { callbackUrl: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(loginAction, null);
  return (
    <form onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); startTransition(() => action(fd)); }} className="flex flex-col gap-form" noValidate>
      <input type="hidden" name="callbackUrl" value={callbackUrl} />
      {state && !state.fieldErrors && <Alert tone={state.mfaRequired ? "info" : "danger"}>{state.message}</Alert>}
      <Field label="Email or phone" required error={state?.fieldErrors?.identifier}>
        <TextInput name="identifier" autoComplete="username" autoCapitalize="none" spellCheck={false} />
      </Field>
      <Field label="Password" required error={state?.fieldErrors?.password}>
        <PasswordInput name="password" autoComplete="current-password" />
      </Field>
      {state?.mfaRequired && <Field label="Authentication code" required hint="From your authenticator app, or one of your backup codes."><TextInput name="code" inputMode="numeric" autoComplete="one-time-code" autoFocus /></Field>}
      <Button type="submit" size="lg" loading={pending} className="mt-1 w-full">Sign in</Button>
      <p className="type-caption"><Link href="/forgot-password">Forgot your password?</Link></p>
    </form>
  );
}
