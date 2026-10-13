import type { Metadata } from "next";
import { AccountSecurity } from "@/components/security/account-security";
import { Alert } from "@/components/ui";
import { requireContext } from "@/lib/auth/context";
import { mfaStatus } from "@/lib/services/sec-mfa";
import { mfaRequiredFor } from "@/lib/services/sec-policy";

export const metadata: Metadata = { title: "Account security" };
export const dynamic = "force-dynamic";
export default async function Page() {
  const ctx = await requireContext(); const [mfa, required] = await Promise.all([mfaStatus(ctx.user.id), mfaRequiredFor(ctx.user.role, ctx.user.tenantId)]);
  return (
    <div className="space-y-section">
      <div><h1 className="type-page-title">Account security</h1><p className="type-secondary mt-1">Protect your sign-in. These settings are about <strong>your</strong> account only.</p></div>
      {ctx.mfaEnrollRequired && <Alert tone="warning" title="Two-factor authentication is required">Your organisation requires it for your role. Set it up below to continue to the rest of the application.</Alert>}
      <AccountSecurity mfa={mfa} required={required} />
    </div>
  );
}
