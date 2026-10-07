import type { Metadata } from "next";
import Link from "next/link";
import { Alert } from "@/components/ui";
import { PublicFrame } from "@/components/portal/public-frame";
import { otpConfigured } from "@/lib/integrations/otp";
import { portalPublicTenant } from "@/lib/portal/public-tenant";
import { db } from "@/lib/db";

export const metadata: Metadata = { title: "Forgot password" };
export const dynamic = "force-dynamic";
export default async function ForgotPage({ searchParams }: { searchParams: Promise<{ clinic?: string }> }) {
  const sp = await searchParams; const tenant = await portalPublicTenant(sp.clinic);
  const t = tenant ? await db.tenant.findFirst({ where: { id: tenant.id }, select: { contactPhone: true, contactEmail: true } }) : null;
  return (
    <PublicFrame tenant={tenant} title="Forgot your password?" subtitle="We can't send a reset message yet.">
      <div className="space-y-4">
        <Alert tone="info">{otpConfigured() ? "Use the one-time code option on the sign-in page." : "Password reset by SMS or email isn't set up at this clinic. Ask the clinic reception for a new access code — it lets you choose a new password here."}</Alert>
        {t && (t.contactPhone || t.contactEmail) && <p className="type-secondary">Clinic contact: {[t.contactPhone, t.contactEmail].filter(Boolean).join(" · ")}</p>}
        <p className="type-secondary"><Link href={`/portal/activate${tenant ? `?clinic=${encodeURIComponent(tenant.slug)}` : ""}`}>I have a new code</Link> · <Link href={`/portal/login${tenant ? `?clinic=${encodeURIComponent(tenant.slug)}` : ""}`}>Back to sign in</Link></p>
      </div>
    </PublicFrame>
  );
}
