import type { Metadata } from "next";
import { getInboxContext } from "@/lib/inbox-context";
import { VoiceApp } from "@/components/voice/voice-app";
import { NoWorkspace } from "@/components/whatsapp/states";
import { ServiceLocked } from "@/components/whatsapp/service-locked";
import { isServiceEnabled } from "@/services/whatsapp/guards";

export const metadata: Metadata = { title: "AI Calling" };

export default async function VoicePage({ searchParams }: { searchParams: Promise<{ phone?: string }> }) {
  const ctx = await getInboxContext();
  if (!ctx.active) return <NoWorkspace />;
  if (!(await isServiceEnabled(ctx.orgId, "AI_CALLING"))) return <ServiceLocked name="AI Calling" />;
  const phone = (await searchParams).phone ?? "";
  return <VoiceApp orgId={ctx.orgId} canManage={ctx.perms["voice:manage"]} initialPhone={/^\+\d{8,15}$/.test(phone) ? phone : ""} />;
}
