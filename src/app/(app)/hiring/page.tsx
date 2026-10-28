import type { Metadata } from "next";
import { Lock } from "lucide-react";
import { getInboxContext } from "@/lib/inbox-context";
import { roleHasPermission } from "@/lib/authz";
import { Card, EmptyState } from "@/components/ds";
import { NoWorkspace } from "@/components/whatsapp/states";
import { ServiceLocked } from "@/components/whatsapp/service-locked";
import { HiringApp } from "@/components/hiring/hiring-app";
import { isServiceEnabled } from "@/services/whatsapp/guards";

export const metadata: Metadata = { title: "Hiring" };

export default async function HiringPage() {
  const ctx = await getInboxContext();
  if (!ctx.active) return <NoWorkspace />;
  if (!(await isServiceEnabled(ctx.orgId, "ATS"))) return <ServiceLocked name="ATS (hiring)" />;
  if (!roleHasPermission(ctx.me.role, "ats:manage")) {
    return (
      <Card>
        <EmptyState icon={Lock} title="For owners and managers" description="Ask your workspace owner about hiring." />
      </Card>
    );
  }
  return <HiringApp orgId={ctx.orgId} />;
}
