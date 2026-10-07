"use client";

import * as React from "react";
import Link from "next/link";
import { MailCheck } from "lucide-react";
import { Alert, Button, Field, Input } from "@/components/ds";
import { AuthCard } from "@/components/auth/auth-card";
import { apiFetch } from "@/lib/client-api";

export function ForgotPasswordForm() {
  const [email, setEmail] = React.useState("");
  const [error, setError] = React.useState("");
  const [fieldError, setFieldError] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [sent, setSent] = React.useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    setFieldError("");
    const r = await apiFetch("/api/auth/forgot-password", { method: "POST", body: { email } });
    setLoading(false);
    if (!r.ok) {
      if (r.details?.email) setFieldError(r.details.email[0]);
      else setError(r.error);
      return;
    }
    setSent(true);
  }

  return (
    <AuthCard
      title="Reset your password"
      subtitle="We'll email you a secure link to set a new password."
      footer={
        <Link href="/login" className="font-medium text-app-primary hover:text-app-primary-hover">
          ← Back to sign in
        </Link>
      }
    >
      {sent ? (
        <div className="flex flex-col items-center text-center">
          <MailCheck className="size-10 text-app-primary" aria-hidden="true" />
          <p className="mt-3 text-body text-app-text" role="status">
            If an account exists for <strong>{email}</strong>, a reset link is on its way. It expires in 30 minutes.
          </p>
        </div>
      ) : (
        <form onSubmit={onSubmit} noValidate className="space-y-5">
          {error ? <Alert tone="warning">{error}</Alert> : null}
          <Field id="email" label="Email address" error={fieldError}>
            <Input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </Field>
          <Button type="submit" size="lg" className="w-full" loading={loading} disabled={!email}>
            Send reset link
          </Button>
        </form>
      )}
    </AuthCard>
  );
}
