import type { Metadata } from "next";
import { getInboxContext } from "@/lib/inbox-context";
import { roleHasPermission } from "@/lib/authz";
import { NoWorkspace } from "@/components/whatsapp/states";
import { ServiceLocked } from "@/components/whatsapp/service-locked";
import { OnePostApp } from "@/components/onepost/onepost-app";
import { isServiceEnabled } from "@/services/whatsapp/guards";

export const metadata: Metadata = { title: "OnePost" };

export default async function OnePostPage({ searchParams }: { searchParams: Promise<{ tab?: string; connected?: string; message?: string; error?: string }> }) {
  const ctx = await getInboxContext();
  if (!ctx.active) return <NoWorkspace />;
  if (!(await isServiceEnabled(ctx.orgId, "ONEPOST"))) return <ServiceLocked name="OnePost — Content & PR Studio" />;
  const q = await searchParams;
  const role = ctx.me.role;
  return (
    <OnePostApp
      orgId={ctx.orgId}
      canBrand={roleHasPermission(role, "onepost:brand")}
      canConnect={roleHasPermission(role, "onepost:connect")}
      canPublish={roleHasPermission(role, "onepost:publish")}
      initialTab={q.tab}
      flash={{ connected: q.connected?.slice(0, 20), message: q.message?.slice(0, 200), error: q.error?.slice(0, 200) }}
    />
  );
}
