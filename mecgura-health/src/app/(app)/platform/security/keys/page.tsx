import type { Metadata } from "next";
import { ApiKeysManager } from "@/components/security/security-admin";
import { Card } from "@/components/ui";
import { requirePagePermission } from "@/lib/auth/context";
import { API_SCOPES, listApiKeys } from "@/lib/services/sec-apikeys";

export const metadata: Metadata = { title: "API keys" };
export const dynamic = "force-dynamic";
export default async function Page() {
  const ctx = await requirePagePermission("platform.manage");
  if (ctx.tenant) return <Card className="p-card"><p className="type-secondary">You are inside a clinic workspace. Leave it to manage platform keys; clinic keys are managed by the clinic under Settings → Security.</p></Card>;
  const keys = await listApiKeys(ctx);
  return <Card className="space-y-3 p-card"><h2 className="type-section-title">Platform API keys</h2><ApiKeysManager keys={JSON.parse(JSON.stringify(keys))} scopes={Object.entries(API_SCOPES).filter(([, v]) => v.platform).map(([key, v]) => ({ key, label: v.label }))} /></Card>;
}
