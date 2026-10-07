import type { Metadata } from "next";
import Link from "next/link";
import { MessageCircle, Plus } from "lucide-react";
import { getWhatsAppContext } from "@/lib/whatsapp-context";
import { listAccounts } from "@/services/whatsapp";
import { formatNumber } from "@/lib/catalog";
import { Badge, Card, EmptyState, PageHeader, UsageMeter, buttonVariants } from "@/components/ds";
import { NoWorkspace, ServiceDisabled } from "@/components/whatsapp/states";
import { QualityBadge, StatusBadge } from "@/components/whatsapp/status-badge";
import { CardActions } from "@/components/whatsapp/account-actions";

export const metadata: Metadata = { title: "WhatsApp accounts" };

const dateFmt = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" });

export default async function WhatsAppAccountsPage() {
  const ctx = await getWhatsAppContext();
  if (!ctx.active) return <NoWorkspace />;
  const accounts = ctx.serviceEnabled ? await listAccounts(ctx.orgId) : [];
  const canAdd = ctx.canManage && (ctx.slots.limit === null || ctx.slots.used < ctx.slots.limit);

  return (
    <>
      <PageHeader
        title="WhatsApp accounts"
        description="Every WhatsApp number connected to your workspace."
        breadcrumb={[{ label: "WhatsApp", href: "/dashboard/whatsapp" }, { label: "Accounts" }]}
        actions={
          canAdd && ctx.serviceEnabled ? (
            <Link href="/whatsapp/connect" className={buttonVariants({ variant: "primary" })}>
              <Plus aria-hidden="true" /> Add number
            </Link>
          ) : null
        }
      />
      {!ctx.serviceEnabled ? (
        <ServiceDisabled />
      ) : (
        <>
          <div className="mb-6 max-w-sm">
            <UsageMeter label="Numbers on your plan" used={ctx.slots.used} limit={ctx.slots.limit} />
          </div>
          {accounts.length === 0 ? (
            <Card>
              <EmptyState
                icon={MessageCircle}
                title="No WhatsApp numbers yet"
                description="Connect your first number from the Connection Center."
                action={
                  ctx.canManage ? (
                    <Link href="/dashboard/whatsapp" className={buttonVariants({ variant: "primary" })}>
                      Open Connection Center
                    </Link>
                  ) : undefined
                }
              />
            </Card>
          ) : (
            <section aria-label="WhatsApp numbers" className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
              {accounts.map((a) => (
                <Card key={a.id} className="flex flex-col p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-caption uppercase tracking-wider text-app-subtle">{a.displayName}</p>
                      <h2 className="truncate text-h2 text-app-text">{a.businessName || "—"}</h2>
                      <p className="font-mono text-body text-app-muted">{a.phoneNumber}</p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1.5">
                      <StatusBadge status={a.status} />
                      {a.isDemo ? <Badge tone="info">Demo data</Badge> : null}
                    </div>
                  </div>
                  <dl className="mt-4 grid flex-1 grid-cols-2 gap-x-4 gap-y-3 text-small">
                    <div className="min-w-0">
                      <dt className="text-app-subtle">WABA</dt>
                      <dd className="truncate font-mono text-app-text">{a.wabaId ?? "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-app-subtle">Quality</dt>
                      <dd>
                        <QualityBadge quality={a.quality} />
                      </dd>
                    </div>
                    <div>
                      <dt className="text-app-subtle">Messages</dt>
                      <dd className="tabular-nums text-app-text">
                        {formatNumber(a.messagesSent)} sent · {formatNumber(a.messagesReceived)} received
                      </dd>
                    </div>
                    <div>
                      <dt className="text-app-subtle">Connected</dt>
                      <dd className="text-app-text">{a.connectedAt ? dateFmt.format(a.connectedAt) : "—"}</dd>
                    </div>
                  </dl>
                  <div className="mt-5 border-t border-app-border pt-4">
                    <CardActions orgId={ctx.orgId} accountId={a.id} label={a.phoneNumber} isDemo={a.isDemo} status={a.status} canManage={ctx.canManage} />
                  </div>
                </Card>
              ))}
            </section>
          )}
        </>
      )}
    </>
  );
}
