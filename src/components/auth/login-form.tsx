"use client";

import * as React from "react";
import { siteConfig } from "@/config/site";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { Eye, EyeOff, Keyboard } from "lucide-react";
import { loginSchema } from "@/lib/validations";
import { Alert, Button, Field, Input } from "@/components/ds";
import { AuthCard } from "@/components/auth/auth-card";

/** Only same-site relative paths are allowed as post-login destinations (no open redirects). */
function safeCallback(raw: string | null): string {
  if (raw && raw.startsWith("/") && !raw.startsWith("//") && !raw.startsWith("/\\") && !raw.startsWith("/login")) return raw;
  return "/dashboard";
}

const NOTICES: Record<string, { tone: "info" | "success"; text: string }> = {
  "password-changed": { tone: "success", text: "Password changed. Please sign in with your new password." },
  "password-reset": { tone: "success", text: "Password reset. Please sign in with your new password." },
};

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const callbackUrl = safeCallback(params.get("callbackUrl"));
  const notice = NOTICES[params.get("reason") ?? ""];
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [errors, setErrors] = React.useState<{ email?: string; password?: string; form?: string }>({});
  const [loading, setLoading] = React.useState(false);
  const [showPassword, setShowPassword] = React.useState(false);
  const [capsOn, setCapsOn] = React.useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = loginSchema.safeParse({ email, password });
    if (!parsed.success) {
      const f = parsed.error.flatten().fieldErrors;
      setErrors({ email: f.email?.[0], password: f.password?.[0] });
      return;
    }
    setLoading(true);
    setErrors({});
    const result = await signIn("credentials", { email, password, redirect: false });
    if (result?.error) {
      setLoading(false);
      setErrors({
        form:
          result.code === "rate_limited"
            ? "Too many sign-in attempts. Please wait 15 minutes and try again."
            : "Invalid email or password. Please try again.",
      });
      return;
    }
    router.replace(callbackUrl);
    router.refresh();
  }

  return (
    <AuthCard
      title="Welcome back"
      subtitle="Sign in to your MECGURA account"
      footer={
        siteConfig.contact.email ? (
          <>
            Don&apos;t have an account?{" "}
            <a href={`mailto:${siteConfig.contact.email}`} className="font-medium text-app-primary hover:text-app-primary-hover">
              Contact support
            </a>
          </>
        ) : (
          "Accounts are created by your administrator."
        )
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-5" aria-label="Sign in form">
        {notice ? <Alert tone={notice.tone}>{notice.text}</Alert> : null}
        {errors.form ? <Alert tone="danger">{errors.form}</Alert> : null}
        <Field id="email" label="Email address" error={errors.email}>
          <Input type="email" autoComplete="email" placeholder="you@company.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label htmlFor="password" className="text-small font-medium text-app-text">
              Password
            </label>
            <Link href="/forgot-password" className="text-small text-app-primary hover:text-app-primary-hover">
              Forgot password?
            </Link>
          </div>
          <div className="relative">
            <Input
              id="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyUp={(e) => setCapsOn(e.getModifierState?.("CapsLock") ?? false)}
              aria-invalid={errors.password ? true : undefined}
              aria-describedby={errors.password ? "password-error" : undefined}
              className="pr-11"
              required
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              aria-pressed={showPassword}
              className="absolute right-1.5 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-app-muted hover:bg-app-hover hover:text-app-text"
            >
              {showPassword ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
            </button>
          </div>
          {errors.password ? (
            <p id="password-error" role="alert" className="mt-1.5 text-caption text-red-300">
              {errors.password}
            </p>
          ) : null}
          {capsOn ? (
            <p role="status" className="mt-1.5 flex items-center gap-1.5 text-caption text-amber-300">
              <Keyboard className="size-3.5" aria-hidden="true" /> Caps Lock is on
            </p>
          ) : null}
        </div>
        <Button type="submit" size="lg" className="w-full" loading={loading}>
          {loading ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </AuthCard>
  );
}
