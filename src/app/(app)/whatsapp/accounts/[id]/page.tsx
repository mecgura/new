import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ApiError } from "@/lib/api";
import { getWhatsAppContext } from "@/lib/whatsapp-context";
import { getAccount, getWebhookInfo } from "@/services/whatsapp";
import { CONNECTION_METHOD_LABELS, formatNumber } from "@/lib/catalog";
import { idSchema } from "@/lib/validations";
import { Alert, Badge, Card, CardBody, CardHeader, PageHeader } from "@/components/ds";
import { NoWorkspace, OwnerOnly, ServiceDisabled } from "@/components/whatsapp/states";
import { QualityBadge, StatusBadge } from "@/components/whatsapp/status-badge";
import { AccountSettingsForm, DisconnectButton } from "@/components/whatsapp/account-actions";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "WhatsApp number" };

const dateTime = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
const TABS = ["overview", "webhook", "settings"] as const;

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 py-2.5 sm:flex-row sm:gap-4">
      <dt className="w-44 shrink-0 text-small text-app-muted">{label}</dt>
      <dd className="min-w-0 break-words text-body text-app-text">{children}</dd>
    </div>
  );
}

export default async function WhatsAppAccountPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const ctx = await getWhatsAppContext();
  if (!ctx.active) return <NoWorkspace />;
  if (!ctx.serviceEnabled) return <ServiceDisabled />;
  const parsed = idSchema.safeParse((await params).id);
  if (!parsed.success) notFound();
  const requestedTab = (await searchParams).tab;
  const tab = TABS.find((t) => t === requestedTab) ?? "overview";

  let account;
  try {
    // Scoped to the active organization: another tenant's id resolves to 404.
    account = await getAccount(ctx.orgId, parsed.data);
  } catch (e) {
    if (e instanceof ApiError && e.code === "NOT_FOUND") notFound();
    throw e;
  }
  const webhook = ctx.canManage && tab === "webhook" ? await getWebhookInfo(ctx.orgId, account.id) : null;
  const live = account.status === "connected" || account.status === "demo";

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: "WhatsApp", href: "/dashboard/whatsapp" }, { label: "Accounts", href: "/whatsapp/accounts" }, { label: account.displayName }]}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {account.displayName}
            <StatusBadge status={account.status} />
            {account.isDemo ? <Badge tone="info">Demo data</Badge> : null}
          </span>
        }
        description={account.phoneNumber}
        actions={ctx.canManage && live ? <DisconnectButton orgId={ctx.orgId} accountId={account.id} label={account.phoneNumber} isDemo={account.isDemo} size="md" /> : null}
      />
      <nav aria-label="Number sections" className="mb-6 flex gap-1 border-b border-app-border">
        {TABS.map((t) => (
          <Link
            key={t}
            href={`/whatsapp/accounts/${account.id}?tab=${t}`}
            aria-current={tab === t ? "page" : undefined}
            className={cn("-mb-px border-b-2 px-3.5 py-2.5 text-small font-medium capitalize", tab === t ? "border-app-primary text-app-text" : "border-transparent text-app-muted hover:text-app-text")}
          >
            {t}
          </Link>
        ))}
      </nav>

      {account.isDemo ? (
        <Alert tone="info" className="mb-4">
          This is a demo connection with fictional ids and number. It is not connected to Meta and cannot send or receive messages.
        </Alert>
      ) : null}

      {tab === "overview" ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title="Number" />
            <CardBody>
              <dl className="divide-y divide-app-border">
                <Row label="Business name">{account.businessName || "—"}</Row>
                <Row label="Verified name">{account.verifiedName || "—"}</Row>
                <Row label="Phone number">{account.phoneNumber}</Row>
                <Row label="Quality rating"><QualityBadge quality={account.quality} /></Row>
                <Row label="Messaging limit">{account.messagingLimitTier || "—"}</Row>
                <Row label="Messages">{formatNumber(account.messagesSent)} sent · {formatNumber(account.messagesReceived)} received</Row>
              </dl>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Connection" />
            <CardBody>
              <dl className="divide-y divide-app-border">
                <Row label="Method">{account.connection ? CONNECTION_METHOD_LABELS[account.connection.method] ?? account.connection.method : "Registered by MECGURA (not connected)"}</Row>
                <Row label="WABA ID"><span className="font-mono">{account.wabaId ?? "—"}</span></Row>
                <Row label="Phone Number ID"><span className="font-mono">{account.phoneNumberId ?? "—"}</span></Row>
                <Row label="Credentials">
                  {account.connection?.credentialStored ? `Encrypted access token (${account.connection.tokenHint})` : account.status === "disconnected" ? "Deleted on disconnect" : "None stored"}
                </Row>
                <Row label="Connected">{account.connectedAt ? dateTime.format(account.connectedAt) : "—"}</Row>
                {account.disconnectedAt ? <Row label="Disconnected">{dateTime.format(account.disconnectedAt)}</Row> : null}
              </dl>
            </CardBody>
          </Card>
        </div>
      ) : tab === "webhook" ? (
        !ctx.canManage ? (
          <OwnerOnly what="view webhook settings" />
        ) : webhook ? (
          <Card>
            <CardHeader title="Webhook" description="Where Meta delivers messages and status updates for this number." />
            <CardBody>
              <dl className="divide-y divide-app-border">
                <Row label="Callback URL"><span className="font-mono text-small">{webhook.callbackUrl}</span></Row>
                <Row label="Managed by">{webhook.mode === "platform" ? "MECGURA's Meta app (automatic)" : webhook.mode === "own_app" ? "Your Meta app — configure the values below" : "Demo — no webhook"}</Row>
                {webhook.verifyToken ? <Row label="Verify token"><span className="font-mono text-small">{webhook.verifyToken}</span></Row> : null}
                <Row label="Signature verification">{webhook.mode === "platform" ? "MECGURA app secret" : webhook.signatureSecretStored ? "Your app secret (encrypted)" : "Not possible — add your app secret by reconnecting"}</Row>
                <Row label="Fields">{webhook.fields.join(", ")}</Row>
                <Row label="Status"><Badge tone={webhook.status === "subscribed" || webhook.status === "verified" ? "success" : webhook.status === "failed" ? "danger" : "neutral"}>{webhook.status}</Badge></Row>
                <Row label="Last verified">{webhook.lastVerifiedAt ? dateTime.format(webhook.lastVerifiedAt) : "—"}</Row>
                <Row label="Last event">{webhook.lastEventAt ? dateTime.format(webhook.lastEventAt) : "—"}</Row>
              </dl>
            </CardBody>
          </Card>
        ) : null
      ) : ctx.canManage ? (
        <AccountSettingsForm orgId={ctx.orgId} accountId={account.id} displayName={account.displayName} />
      ) : (
        <OwnerOnly what="change number settings" />
      )}
    </>
  );
}
