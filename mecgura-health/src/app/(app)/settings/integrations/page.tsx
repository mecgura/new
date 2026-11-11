import type { Metadata } from "next";
import { Card, CardBody, CardHeader, StatusBadge } from "@/components/ui";
import { INTEGRATIONS } from "@/config/integrations";
import { requirePagePermission } from "@/lib/auth/context";
import { providerStatus } from "@/lib/communications/providers/registry";

export const metadata: Metadata = { title: "Integrations" };

export default async function IntegrationsPage() {
  await requirePagePermission("settings.view");
  const configured: Record<string, boolean> = { whatsapp: providerStatus("WHATSAPP").configured, sms: providerStatus("SMS").configured, email: providerStatus("EMAIL").configured };
  return (
    <Card>
      <CardHeader title="Integrations" description="WhatsApp, SMS and email show “configured” only when the server has real provider credentials. Nothing here pretends to work. Manage sending in Settings → Communications." />
      <ul className="divide-y divide-line">
        {INTEGRATIONS.map((i) => (
          <li key={i.key} className="flex flex-wrap items-center justify-between gap-2 p-card">
            <div className="min-w-0"><p className="type-card-title">{i.name}</p><p className="type-secondary">{i.description}</p></div>
            <StatusBadge tone={configured[i.key] ? "success" : "neutral"}>{configured[i.key] ? "Provider configured" : "Not configured"}</StatusBadge>
          </li>
        ))}
      </ul>
      <CardBody className="border-t border-line"><p className="type-caption">Integration code implements the interfaces in <code>src/config/integrations.ts</code>; credentials come from environment variables only.</p></CardBody>
    </Card>
  );
}
