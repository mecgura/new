import type { Metadata } from "next";
import { Lock } from "lucide-react";
import { getInboxContext } from "@/lib/inbox-context";
import { roleHasPermission } from "@/lib/authz";
import { Card, EmptyState, PageHeader } from "@/components/ds";
import { NoWorkspace } from "@/components/whatsapp/states";
import { AgreementSigner } from "@/components/agreements/agreement-signer";
import { workspaceAgreement } from "@/services/agreements/agreements";

export const metadata: Metadata = { title: "Agreement & KYC" };
export const dynamic = "force-dynamic";

/** Client onboarding inside the workspace: check business details, upload business proof, accept the agreement. */
export default async function OnboardingPage() {
  const ctx = await getInboxContext();
  if (!ctx.active) return <NoWorkspace />;
  if (!roleHasPermission(ctx.me.role, "org:update")) {
    return (
      <Card>
        <EmptyState icon={Lock} title="For the workspace owner" description="Only the owner can sign the agreement and upload business documents." />
      </Card>
    );
  }
  const { token, agreement } = await workspaceAgreement(ctx.orgId, ctx.me.id);
  return (
    <>
      <PageHeader title="Agreement & KYC" description="Check your business details, upload one business proof and accept your MECGURA service agreement." />
      <AgreementSigner embedded token={token} initial={JSON.parse(JSON.stringify(agreement))} />
    </>
  );
}
