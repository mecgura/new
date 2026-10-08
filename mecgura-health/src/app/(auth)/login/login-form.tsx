"use client";
import { useActionState } from "react";
import { Alert, Button, Field, PasswordInput, TextInput } from "@/components/ui";
import { loginAction, type LoginState } from "@/app/actions/auth";

export function LoginForm({ callbackUrl }: { callbackUrl: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(loginAction, null);
  return (
    <form action={action} className="flex flex-col gap-form" noValidate>
      <input type="hidden" name="callbackUrl" value={callbackUrl} />
      {state && !state.fieldErrors && <Alert tone="danger">{state.message}</Alert>}
      <Field label="Email or phone" required error={state?.fieldErrors?.identifier}>
        <TextInput name="identifier" autoComplete="username" autoCapitalize="none" spellCheck={false} />
      </Field>
      <Field label="Password" required error={state?.fieldErrors?.password}>
        <PasswordInput name="password" autoComplete="current-password" />
      </Field>
      <Button type="submit" size="lg" loading={pending} className="mt-1 w-full">Sign in</Button>
      <p className="type-caption">Forgot your password? Ask your clinic admin to reset it. Self-service reset is not available yet.</p>
    </form>
  );
}
