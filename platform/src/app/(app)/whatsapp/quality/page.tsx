import type { Metadata } from "next";
import { getInboxContext } from "@/lib/inbox-context";
import { getQualityOverview } from "@/services/quality/quality";
import { QualityCenter, type QualityData } from "@/components/quality/quality-center";
import { Alert, PageHeader } from "@/components/ds";
import { NoWorkspace } from "@/components/whatsapp/states";

export const metadata: Metadata = { title: "Quality Center" };

export default async function QualityPage() {
  const ctx = await getInboxContext();
  if (!ctx.active) return <NoWorkspace />;
  if (!ctx.perms["quality:read"]) {
    return (
      <>
        <PageHeader title="Quality Center" />
        <Alert tone="info">Only owners and managers can view the Quality Center.</Alert>
      </>
    );
  }
  const data = JSON.parse(JSON.stringify(await getQualityOverview(ctx.orgId))) as QualityData;
  return <QualityCenter orgId={ctx.orgId} data={data} canRefresh={ctx.perms["whatsapp:manage"]} />;
}
