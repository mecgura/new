"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Alert, Button, Field, Input } from "@/components/ds";
import { AuthCard } from "@/components/auth/auth-card";
import { apiFetch } from "@/lib/client-api";

export function ResetPasswordForm() {
  const router = useRouter();
  const token = useSearchParams().get("token") ?? "";
  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [errors, setErrors] = React.useState<{ password?: string; confirm?: string; form?: string }>({});
  const [loading, setLoading] = React.useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) return setErrors({ confirm: "Passwords don't match" });
    setLoading(true);
    setErrors({});
    const r = await apiFetch("/api/auth/reset-password", { method: "POST", body: { token, password } });
    setLoading(false);
    if (!r.ok) {
      setErrors({ password: r.details?.password?.[0], form: r.details?.password ? undefined : r.details?.token ? "This reset link is invalid." : r.error });
      return;
    }
    router.replace("/login?reason=password-reset");
  }

  if (!token) {
    return (
      <AuthCard title="Link missing" footer={<Link href="/forgot-password" className="text-app-primary hover:text-app-primary-hover">Request a new link</Link>}>
        <Alert tone="warning">This page needs the link from your password reset email.</Alert>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Set a new password" subtitle="At least 8 characters, with a letter and a number.">
      <form onSubmit={onSubmit} noValidate className="space-y-5">
        {errors.form ? (
          <Alert tone="danger">
            {errors.form}{" "}
            <Link href="/forgot-password" className="underline">
              Request a new link
            </Link>
          </Alert>
        ) : null}
        <Field id="password" label="New password" error={errors.password}>
          <Input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        <Field id="confirm" label="Confirm new password" error={errors.confirm}>
          <Input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
        </Field>
        <Button type="submit" size="lg" className="w-full" loading={loading} disabled={!password || !confirm}>
          Update password
        </Button>
      </form>
    </AuthCard>
  );
}
