import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Alert } from "@/components/ui";
import { PublicFrame } from "@/components/portal/public-frame";
import { otpConfigured } from "@/lib/integrations/otp";
import { getPatientAccess } from "@/lib/portal/ctx";
import { portalPublicTenant } from "@/lib/portal/public-tenant";
import { safePortalPath } from "@/lib/portal/safe-path";
import { PortalLoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";
const REASONS: Record<string, string> = { expired: "Your session has ended. Please sign in again.", account_unavailable: "Your portal account isn't active. Please contact the clinic.", clinic_unavailable: "This clinic's portal isn't available right now." };

export default async function PortalLoginPage({ searchParams }: { searchParams: Promise<{ clinic?: string; reason?: string; callbackUrl?: string }> }) {
  const sp = await searchParams; const { ctx } = await getPatientAccess();
  if (ctx) redirect(safePortalPath(sp.callbackUrl));
  // message links look like /portal/appointments/x?clinic=slug — carry that clinic through the login redirect
  let cb: string | null = null; try { cb = sp.callbackUrl ? new URL(sp.callbackUrl, "http://x").searchParams.get("clinic") : null; } catch { /* ignore */ }
  const tenant = await portalPublicTenant(sp.clinic ?? cb ?? undefined);
  const fromHost = !!tenant?.fromHost;
  return (
    <PublicFrame tenant={tenant} title="Patient sign in" subtitle="See your appointments, prescriptions, reports and bills.">
      {sp.reason && REASONS[sp.reason] && <Alert tone="warning" className="mb-4">{REASONS[sp.reason]}</Alert>}
      <PortalLoginForm clinic={tenant?.slug ?? sp.clinic ?? ""} needsClinic={!fromHost && !tenant} callbackUrl={safePortalPath(sp.callbackUrl)} />
      {!otpConfigured() && <p className="type-caption mt-4">Sign-in with a one-time code isn&apos;t available at this clinic. Use your password.</p>}
      <p className="type-caption mt-4">By signing in you agree to the clinic&apos;s privacy notice{fromHost ? <> (<a href="/privacy">read it</a>)</> : null}.</p>
    </PublicFrame>
  );
}
