"use client";
import Link from "next/link";
import { useActionState } from "react";
import { Alert, Button, Field, PasswordInput, TextInput } from "@/components/ui";
import { portalActivateAction, type PortalFormState } from "@/app/actions/portal";

export function ActivateForm({ clinic, needsClinic }: { clinic: string; needsClinic: boolean }) {
  const [state, action, pending] = useActionState<PortalFormState, FormData>(portalActivateAction, null);
  const fe = state?.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-4" noValidate>
      {state?.message && <Alert tone="danger">{state.message}</Alert>}
      {needsClinic ? <Field label="Clinic code" required error={fe.clinic}><TextInput name="clinic" defaultValue={state?.values?.clinic ?? clinic} autoCapitalize="none" spellCheck={false} /></Field> : <input type="hidden" name="clinic" value={clinic} />}
      <Field label="Activation code" required error={fe.code} hint="The code the clinic gave you, e.g. AB3KT-9XMQ2"><TextInput name="code" defaultValue={state?.values?.code} autoCapitalize="characters" autoComplete="off" spellCheck={false} /></Field>
      <Field label="Your mobile number or email" required error={fe.identifier} hint="The one the clinic has on file for you. You will use it to sign in."><TextInput name="identifier" defaultValue={state?.values?.identifier} autoComplete="username" inputMode="email" autoCapitalize="none" spellCheck={false} /></Field>
      <Field label="Choose a password" required error={fe.password} hint="At least 10 characters, with a letter and a number"><PasswordInput name="password" autoComplete="new-password" /></Field>
      <Field label="Repeat the password" required error={fe.confirm}><PasswordInput name="confirm" autoComplete="new-password" /></Field>
      <div>
        <label className="type-secondary flex items-start gap-3"><input type="checkbox" name="acceptPrivacy" className="mt-1 size-5 shrink-0" /><span>I have read the clinic&apos;s privacy notice and agree that the clinic keeps my health records and shows them to me here.</span></label>
        {fe.acceptPrivacy && <p role="alert" className="type-caption mt-1 !text-danger">{fe.acceptPrivacy}</p>}
      </div>
      <Button type="submit" size="lg" className="w-full" loading={pending}>Activate and sign in</Button>
      <p className="type-secondary text-center">Already activated? <Link href={`/portal/login${clinic ? `?clinic=${encodeURIComponent(clinic)}` : ""}`}>Sign in</Link></p>
    </form>
  );
}
