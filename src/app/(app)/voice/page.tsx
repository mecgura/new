import type { Metadata } from "next";
import { getInboxContext } from "@/lib/inbox-context";
import { VoiceApp } from "@/components/voice/voice-app";
import { NoWorkspace } from "@/components/whatsapp/states";

export const metadata: Metadata = { title: "AI Calling" };

export default async function VoicePage() {
  const ctx = await getInboxContext();
  if (!ctx.active) return <NoWorkspace />;
  return <VoiceApp orgId={ctx.orgId} canManage={ctx.perms["voice:manage"]} />;
}
