import type { Metadata } from "next";
import { getInboxContext } from "@/lib/inbox-context";
import { AiApp } from "@/components/ai/ai-app";
import { NoWorkspace } from "@/components/whatsapp/states";
import { ServiceLocked } from "@/components/whatsapp/service-locked";
import { isServiceEnabled } from "@/services/whatsapp/guards";

export const metadata: Metadata = { title: "AI Agent" };

export default async function AiPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const ctx = await getInboxContext();
  if (!ctx.active) return <NoWorkspace />;
  if (!(await isServiceEnabled(ctx.orgId, "AI_ASSISTANT"))) return <ServiceLocked name="The AI Agent" />;
  const { tab } = await searchParams;
  return <AiApp orgId={ctx.orgId} canManage={ctx.perms["ai:manage"]} initialTab={typeof tab === "string" ? tab : "settings"} />;
}
