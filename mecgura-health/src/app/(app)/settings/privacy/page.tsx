import type { Metadata } from "next";
import { HoldsManager, RightsBoard } from "@/components/security/security-admin";
import { Card } from "@/components/ui";
import { requireTenantPagePermission } from "@/lib/auth/context";
import { listLegalHolds } from "@/lib/services/sec-audit";
import { listRightsRequests } from "@/lib/services/sec-privacy";

export const metadata: Metadata = { title: "Privacy & consent" };
export const dynamic = "force-dynamic";
export default async function Page() {
  const ctx = await requireTenantPagePermission("privacy.manage"); const [reqs, holds] = await Promise.all([listRightsRequests(ctx), listLegalHolds(ctx)]);
  return (
    <div className="space-y-section">
      <Card className="space-y-3 p-card"><h2 className="type-section-title">Patient data-rights requests</h2><p className="type-secondary">Requests from patients to see, copy, restrict or erase their data. Answer within 30 days. Records are never deleted automatically.</p><RightsBoard rows={JSON.parse(JSON.stringify(reqs.rows))} /></Card>
      <Card className="space-y-3 p-card"><h2 className="type-section-title">Legal holds</h2><HoldsManager holds={JSON.parse(JSON.stringify(holds))} platform={false} /></Card>
    </div>
  );
}
