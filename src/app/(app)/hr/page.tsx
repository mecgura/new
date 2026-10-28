import type { Metadata } from "next";
import { Lock } from "lucide-react";
import { getInboxContext } from "@/lib/inbox-context";
import { roleHasPermission } from "@/lib/authz";
import { Card, EmptyState } from "@/components/ds";
import { NoWorkspace } from "@/components/whatsapp/states";
import { ServiceLocked } from "@/components/whatsapp/service-locked";
import { HrApp } from "@/components/hr/hr-app";
import { isServiceEnabled } from "@/services/whatsapp/guards";

export const metadata: Metadata = { title: "HR & Attendance" };

export default async function HrPage() {
  const ctx = await getInboxContext();
  if (!ctx.active) return <NoWorkspace />;
  if (!(await isServiceEnabled(ctx.orgId, "HRMS"))) return <ServiceLocked name="HRMS" />;
  if (!roleHasPermission(ctx.me.role, "hr:manage")) {
    return (
      <Card>
        <EmptyState icon={Lock} title="For owners and managers" description="Ask your workspace owner about HR and attendance." />
      </Card>
    );
  }
  return <HrApp orgId={ctx.orgId} />;
}
