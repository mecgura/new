import type { Metadata } from "next";
import { getWhatsAppContext } from "@/lib/whatsapp-context";
import { PageHeader } from "@/components/ds";
import { ConnectWizard } from "@/components/whatsapp/connect-wizard";
import { NoWorkspace, OwnerOnly, ServiceDisabled } from "@/components/whatsapp/states";

export const metadata: Metadata = { title: "Connect WhatsApp" };

const METHODS = ["meta", "existing", "developer"] as const;

export default async function ConnectWhatsAppPage({ searchParams }: { searchParams: Promise<{ method?: string }> }) {
  const ctx = await getWhatsAppContext();
  const { method } = await searchParams;
  const header = (
    <PageHeader
      title="Connect WhatsApp"
      description="Choose how to connect your WhatsApp Business number."
      breadcrumb={[{ label: "WhatsApp", href: "/dashboard/whatsapp" }, { label: "Connect" }]}
    />
  );
  if (!ctx.active) return <NoWorkspace />;
  if (!ctx.serviceEnabled) return (<>{header}<ServiceDisabled /></>);
  if (!ctx.canManage) return (<>{header}<OwnerOnly /></>);
  return (
    <>
      {header}
      <ConnectWizard
        orgId={ctx.orgId}
        orgName={ctx.active.organizationName}
        initialMethod={METHODS.includes(method as (typeof METHODS)[number]) ? (method as (typeof METHODS)[number]) : "meta"}
        metaConfigured={ctx.metaConfigured}
        missingMeta={[...ctx.missingMeta]}
        demoAvailable={ctx.demoAvailable}
        encryptionReady={ctx.encryptionReady}
        callbackUrl={ctx.callbackUrl}
        slotsFull={ctx.slots.limit !== null && ctx.slots.used >= ctx.slots.limit}
      />
    </>
  );
}
