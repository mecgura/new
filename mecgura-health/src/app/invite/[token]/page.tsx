import type { Metadata } from "next";
import { Logo } from "@/components/brand/logo";
import { resolvePublicTenant } from "@/lib/tenant/resolve";
import { InviteForm } from "./invite-form";

export const metadata: Metadata = { title: "Set up your account" };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const [{ token }, tenant] = await Promise.all([params, resolvePublicTenant()]);
  return (
    <main id="main" className="flex min-h-dvh items-center justify-center px-page py-10">
      <div className="w-full max-w-sm">
        <Logo name={tenant?.name ?? "MECGURA"} sub={tenant ? null : "HEALTH"} logoUrl={tenant?.logoUrl} className="mb-8" />
        <h1 className="type-page-title">Set up your account</h1>
        <p className="type-secondary mb-6 mt-1">Choose a password to finish joining your clinic.</p>
        <InviteForm token={token} />
      </div>
    </main>
  );
}
