import type { Metadata } from "next";
import Link from "next/link";
import { ApiKeysManager } from "@/components/security/security-admin";
import { PolicyEditor } from "@/components/security/security-admin";
import { Card } from "@/components/ui";
import { requireTenantPagePermission } from "@/lib/auth/context";
import { API_SCOPES, listApiKeys } from "@/lib/services/sec-apikeys";
import { getSecurityPolicy, getTenantMfaRoles } from "@/lib/services/sec-policy";

export const metadata: Metadata = { title: "Security" };
export const dynamic = "force-dynamic";
export default async function Page() {
  const ctx = await requireTenantPagePermission("security.manage"); const [mfaRoles, platform, keys] = await Promise.all([getTenantMfaRoles(ctx.tenantId), getSecurityPolicy(), ctx.permissions.has("apikeys.manage") ? listApiKeys(ctx) : Promise.resolve([])]);
  return (
    <div className="space-y-section">
      <Card className="space-y-3 p-card"><h2 className="type-section-title">Two-factor authentication policy</h2><p className="type-secondary">Choose which roles in your clinic must use an authenticator app. Everyone can set theirs up in <Link href="/account/security">Account security</Link>.</p><PolicyEditor scope="clinic" mfaRoles={mfaRoles} lockedRoles={platform.mfaRequiredRoles} /></Card>
      {ctx.permissions.has("apikeys.manage") && <Card className="space-y-3 p-card"><h2 className="type-section-title">Integration API keys</h2><ApiKeysManager keys={JSON.parse(JSON.stringify(keys))} scopes={Object.entries(API_SCOPES).filter(([, v]) => !v.platform).map(([key, v]) => ({ key, label: v.label }))} /></Card>}
    </div>
  );
}
