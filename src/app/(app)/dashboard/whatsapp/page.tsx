import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Code2, Gauge, MessageCircle, ShieldCheck, Smartphone } from "lucide-react";
import { getWhatsAppContext } from "@/lib/whatsapp-context";
import { listAccounts } from "@/services/whatsapp";
import { QUALITY_LABELS } from "@/lib/catalog";
import { StatusBadge } from "@/components/whatsapp/status-badge";
import { Alert, Badge, Card, CardBody, CardHeader, EmptyState, PageHeader, UsageMeter, buttonVariants } from "@/components/ds";
import { NoWorkspace, ServiceDisabled } from "@/components/whatsapp/states";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "WhatsApp Connection Center" };

export default async function WhatsAppCenterPage() {
  const ctx = await getWhatsAppContext();
  if (!ctx.active) return <NoWorkspace />;
  const accounts = await listAccounts(ctx.orgId);
  const full = ctx.slots.limit !== null && ctx.slots.used >= ctx.slots.limit;

  return (
    <>
      <PageHeader
        title="WhatsApp Connection Center"
        description="Connect your WhatsApp Business numbers to MECGURA."
        breadcrumb={[{ label: "Dashboard", href: "/dashboard" }, { label: "WhatsApp" }]}
        actions={
          <>
            <Link href="/whatsapp/quality" className={buttonVariants({ variant: "secondary" })}>
              <Gauge aria-hidden="true" /> Quality Center
            </Link>
            <Link href="/whatsapp/accounts" className={buttonVariants({ variant: "secondary" })}>
              Manage numbers <ArrowRight aria-hidden="true" />
            </Link>
          </>
        }
      />
      {!ctx.serviceEnabled ? (
        <ServiceDisabled />
      ) : (
        <>
          {!ctx.metaConfigured ? (
            <Alert tone="warning" title="Meta onboarding is not configured yet" className="mb-6">
              MECGURA&apos;s Meta app setup isn&apos;t finished on this installation, so &ldquo;Continue with Meta&rdquo; can&apos;t open Meta&apos;s onboarding yet.
              {ctx.demoAvailable ? " You can explore the full flow with a clearly labelled demo connection, or use the API / developer setup." : " You can use the API / developer setup."}
            </Alert>
          ) : null}
          {!ctx.canManage ? (
            <Alert tone="info" className="mb-6">
              You can view numbers. Only the workspace owner can connect or disconnect them.
            </Alert>
          ) : null}
          {full ? (
            <Alert tone="warning" className="mb-6">
              Your plan&apos;s WhatsApp number limit is reached ({ctx.slots.used} / {ctx.slots.limit}). Disconnect a number or ask MECGURA to upgrade.
            </Alert>
          ) : null}

          <section aria-label="Connection options" className="grid gap-4 lg:grid-cols-3">
            <OptionCard
              icon={ShieldCheck}
              badge={<Badge tone="primary">Recommended</Badge>}
              title="Connect with Meta"
              description="Connect your WhatsApp Business account through the official Meta onboarding flow."
              points={["Sign in with Facebook / Meta", "Pick your business portfolio and WhatsApp Business Account", "Add or select a phone number"]}
              href="/whatsapp/connect?method=meta"
              cta={ctx.metaConfigured ? "Continue with Meta" : ctx.demoAvailable ? "Continue (demo available)" : "View setup status"}
              primary
              disabled={!ctx.canManage}
            />
            <OptionCard
              icon={Smartphone}
              title="I already use WhatsApp Business"
              description="Connect an existing WhatsApp Business setup where Meta's supported coexistence/migration flow is available."
              points={["Eligibility is decided by Meta during the flow", "Not every number, country or app version qualifies", "If not eligible, you can connect a new number instead"]}
              href="/whatsapp/connect?method=existing"
              cta="Connect Existing Number"
              disabled={!ctx.canManage}
            />
            <OptionCard
              icon={Code2}
              title="API / Developer setup"
              description="Already have a Meta app and a system-user token? Enter your WABA ID, Phone Number ID and access token."
              points={["Verified against Meta before saving", "Token encrypted, never shown again", "Webhook URL + verify token provided"]}
              href="/whatsapp/connect?method=developer"
              cta="Set up via API"
              disabled={!ctx.canManage}
            />
          </section>

          <div className="mt-6 grid gap-4 xl:grid-cols-3">
            <Card className="xl:col-span-2">
              <CardHeader
                title="Your numbers"
                action={
                  <Link href="/whatsapp/accounts" className="text-small text-app-primary hover:text-app-primary-hover">
                    View all
                  </Link>
                }
              />
              {accounts.length === 0 ? (
                <EmptyState icon={MessageCircle} title="No numbers yet" description="Pick a connection option above to add your first WhatsApp number." className="py-8" />
              ) : (
                <ul className="divide-y divide-app-border">
                  {accounts.slice(0, 5).map((a) => (
                    <li key={a.id}>
                      <Link href={`/whatsapp/accounts/${a.id}`} className="flex flex-wrap items-center gap-3 px-5 py-3 hover:bg-app-hover/60">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-body font-medium text-app-text">{a.displayName}</p>
                          <p className="truncate text-caption text-app-muted">{a.phoneNumber}</p>
                        </div>
                        <span className="text-caption text-app-subtle">Quality: {QUALITY_LABELS[a.quality] ?? a.quality}</span>
                        <StatusBadge status={a.status} />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card>
              <CardHeader title="Plan" />
              <CardBody>
                <UsageMeter label="WhatsApp numbers" used={ctx.slots.used} limit={ctx.slots.limit} />
                <p className="mt-3 text-caption text-app-subtle">Disconnected numbers don&apos;t count toward your limit.</p>
              </CardBody>
            </Card>
          </div>
        </>
      )}
    </>
  );
}

function OptionCard({
  icon: Icon,
  badge,
  title,
  description,
  points,
  href,
  cta,
  primary,
  disabled,
}: {
  icon: typeof ShieldCheck;
  badge?: React.ReactNode;
  title: string;
  description: string;
  points: string[];
  href: string;
  cta: string;
  primary?: boolean;
  disabled?: boolean;
}) {
  return (
    <Card className={cn("flex flex-col p-5", primary && "border-app-primary/40")}>
      <div className="flex items-start justify-between gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-app-primary-soft text-app-primary">
          <Icon className="size-5" aria-hidden="true" />
        </span>
        {badge}
      </div>
      <h2 className="mt-4 text-h2 text-app-text">{title}</h2>
      <p className="mt-1 text-body text-app-muted">{description}</p>
      <ul className="mt-4 flex-1 space-y-1.5 text-small text-app-muted">
        {points.map((p) => (
          <li key={p} className="flex gap-2">
            <span aria-hidden="true" className="mt-2 size-1 shrink-0 rounded-full bg-app-primary" />
            {p}
          </li>
        ))}
      </ul>
      {disabled ? (
        <span className={cn(buttonVariants({ variant: "secondary" }), "mt-5 cursor-not-allowed opacity-60")} aria-disabled="true">
          Owner only
        </span>
      ) : (
        <Link href={href} className={cn(buttonVariants({ variant: primary ? "primary" : "secondary" }), "mt-5")}>
          {cta}
        </Link>
      )}
    </Card>
  );
}
