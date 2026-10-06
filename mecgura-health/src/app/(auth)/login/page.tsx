import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { Alert } from "@/components/ui";
import { Logo } from "@/components/brand/logo";
import { getContext } from "@/lib/auth/context";
import { safeRedirectPath } from "@/lib/auth/redirect";
import { resolvePublicTenant } from "@/lib/tenant/resolve";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ callbackUrl?: string; reason?: string }> }) {
  const [{ callbackUrl, reason }, ctx, tenant] = await Promise.all([searchParams, getContext(), resolvePublicTenant()]);
  const dest = safeRedirectPath(callbackUrl);
  if (ctx) redirect(dest);

  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      <aside className="hidden flex-col justify-between bg-sidebar p-12 text-white lg:flex">
        <Logo name={tenant?.name ?? "MECGURA"} sub={tenant ? null : "HEALTH"} logoUrl={tenant?.logoUrl} inverted />
        <div>
          <h2 className="text-3xl font-bold leading-tight">Your complete<br />clinic operating system</h2>
          <ul className="mt-6 space-y-3 text-sidebar-text">
            {["Patients & appointments", "Prescriptions & reports", "Billing & follow-ups", "Your own clinic website"].map((t) => (
              <li key={t} className="flex items-center gap-2.5"><CheckCircle2 aria-hidden className="size-5 text-accent" />{t}</li>
            ))}
          </ul>
          <p className="type-caption mt-6 !text-sidebar-muted">Modules are released in phases — this foundation release includes sign-in, workspace and theme setup only.</p>
        </div>
        <p className="type-caption !text-sidebar-muted">Secure access for clinic staff</p>
      </aside>

      <main id="main" className="flex items-center justify-center px-page py-10">
        <div className="w-full max-w-sm">
          <Logo name={tenant?.name ?? "MECGURA"} sub={tenant ? null : "HEALTH"} logoUrl={tenant?.logoUrl} className="mb-8 lg:hidden" />
          <h1 className="type-page-title">Welcome back</h1>
          <p className="type-secondary mb-6 mt-1">Sign in to your account</p>
          {reason === "tenant_unavailable" && <Alert tone="warning" className="mb-4" title="Clinic workspace unavailable">This clinic&apos;s workspace is currently suspended or inactive. Contact your MECGURA administrator.</Alert>}
          {reason === "user_unavailable" && <Alert tone="warning" className="mb-4" title="Account unavailable">Your account is not active. Contact your clinic admin.</Alert>}
          <LoginForm callbackUrl={dest} />
          {tenant?.isDemo && <p className="type-caption mt-6 rounded-lg bg-warning-soft px-3 py-2 !text-warning">Demo workspace — sample data only.</p>}
        </div>
      </main>
    </div>
  );
}
