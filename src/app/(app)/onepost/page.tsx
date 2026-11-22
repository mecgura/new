import type { Metadata } from "next";
import { getInboxContext } from "@/lib/inbox-context";
import { roleHasPermission } from "@/lib/authz";
import { NoWorkspace } from "@/components/whatsapp/states";
import { ServiceLocked } from "@/components/whatsapp/service-locked";
import { OnePostApp } from "@/components/onepost/onepost-app";
import { isServiceEnabled } from "@/services/whatsapp/guards";

export const metadata: Metadata = { title: "OnePost" };

export default async function OnePostPage() {
  const ctx = await getInboxContext();
  if (!ctx.active) return <NoWorkspace />;
  if (!(await isServiceEnabled(ctx.orgId, "ONEPOST"))) return <ServiceLocked name="OnePost — Content & PR Studio" />;
  return <OnePostApp orgId={ctx.orgId} canBrand={roleHasPermission(ctx.me.role, "onepost:brand")} />;
}
