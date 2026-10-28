import type { Metadata } from "next";
import { Lock } from "lucide-react";
import { getInboxContext } from "@/lib/inbox-context";
import { roleHasPermission } from "@/lib/authz";
import { Card, EmptyState } from "@/components/ds";
import { NoWorkspace } from "@/components/whatsapp/states";
import { ServiceLocked } from "@/components/whatsapp/service-locked";
import { SocialApp } from "@/components/social/social-app";
import { isServiceEnabled } from "@/services/whatsapp/guards";
import { getFestivals } from "@/services/site/festivals";

export const metadata: Metadata = { title: "Social Media" };

export default async function SocialPage() {
  const ctx = await getInboxContext();
  if (!ctx.active) return <NoWorkspace />;
  if (!(await isServiceEnabled(ctx.orgId, "SOCIAL_MEDIA"))) return <ServiceLocked name="Social Media Management" />;
  if (!roleHasPermission(ctx.me.role, "social:manage")) {
    return (
      <Card>
        <EmptyState icon={Lock} title="For owners and managers" description="Ask your workspace owner to plan social media posts." />
      </Card>
    );
  }
  const f = await getFestivals();
  const festivals = f.enabled ? f.festivals.map((x) => ({ name: x.name, emoji: x.emoji, start: x.start })) : [];
  return <SocialApp orgId={ctx.orgId} festivals={festivals} />;
}
