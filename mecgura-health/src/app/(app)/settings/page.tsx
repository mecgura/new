import type { Metadata } from "next";
import { Avatar, Badge, Card, CardBody, CardHeader } from "@/components/ui";
import { requirePagePermission } from "@/lib/auth/context";
import { ROLE_LABELS } from "@/lib/permissions";

export const metadata: Metadata = { title: "Settings" };

function Row({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="grid gap-0.5 py-3 sm:grid-cols-3 sm:gap-4">
      <dt className="type-secondary">{label}</dt>
      <dd className="type-body break-words sm:col-span-2">{value || <span className="text-muted">Not set</span>}</dd>
    </div>
  );
}

export default async function SettingsPage() {
  const ctx = await requirePagePermission("settings.view");
  const t = ctx.tenant;
  return (
    <div className="grid gap-section lg:grid-cols-2">
      <Card>
        <CardHeader title="Your profile" description="Password change and profile self-service arrive in a later phase." />
        <CardBody>
          <div className="mb-2 flex items-center gap-3"><Avatar name={ctx.user.name} size="lg" /><div><p className="type-card-title">{ctx.user.name}</p><Badge tone="primary">{ROLE_LABELS[ctx.user.role]}</Badge></div></div>
          <dl className="divide-y divide-line"><Row label="Email" value={ctx.user.email} /></dl>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Clinic workspace" description="Read-only summary. Edit it under the Clinic profile tab." />
        <CardBody>
          {t ? (
            <dl className="divide-y divide-line">
              <Row label="Name" value={t.name} />
              <Row label="Workspace ID" value={t.slug} />
              <Row label="Plan" value={t.planName ? `${t.planName} (${t.subscriptionStatus?.toLowerCase()})` : null} />
              <Row label="Contact email" value={t.contactEmail} />
              <Row label="Contact phone" value={t.contactPhone} />
              <Row label="Address" value={t.address} />
              <Row label="Custom domain" value={t.customDomain} />
            </dl>
          ) : <p className="type-secondary">You are a platform administrator and are not attached to a clinic workspace.</p>}
        </CardBody>
      </Card>
    </div>
  );
}
