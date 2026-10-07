import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Activity,
  Ban,
  Building2,
  CheckCircle2,
  Circle,
  Contact,
  Megaphone,
  MessageCircle,
  Inbox,
  Phone,
  Send,
  UsersRound,
  Workflow,
} from "lucide-react";
import { db } from "@/lib/db";
import { getAppContext } from "@/lib/app-context";
import { describeAction } from "@/lib/audit";
import { roleHasPermission, ORG_ROLE_LABELS } from "@/lib/authz";
import { Alert, Avatar, Badge, Card, CardBody, CardHeader, EmptyState, PageHeader, StatCard, UsageMeter, buttonVariants } from "@/components/ds";
import { SERVICE_LABELS, ACTIVE_NUMBER_STATUSES } from "@/lib/catalog";
import { ActivityChart, type DayCount } from "@/components/app/activity-chart";
import { NumberSwitcher } from "@/components/app/number-switcher";
import { readActiveNumber } from "@/lib/active-number";

export const metadata: Metadata = { title: "Dashboard" };

const TZ = "Asia/Kolkata";
const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
const dayLabel = new Intl.DateTimeFormat("en-IN", { timeZone: TZ, day: "numeric", month: "short" });
const dateTime = new Intl.DateTimeFormat("en-IN", { timeZone: TZ, day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

/** The 14 IST calendar days ending today, plus the UTC instant to query from. */
function activityWindow() {
  const now = Date.now();
  const since = new Date(now - 15 * 86_400_000); // covers the whole first IST day
  const days = Array.from({ length: 14 }, (_, i) => new Date(now - (13 - i) * 86_400_000));
  return { since, days, since30: new Date(now - 30 * 86_400_000) };
}

function greeting(now: Date) {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "numeric", hourCycle: "h23" }).format(now));
  return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const { user, active } = await getAppContext();
  const { denied } = await searchParams;
  const firstName = (user.name ?? user.email).split(/[\s@]/)[0];

  if (!active) {
    if (user.platformRole === "SUPER_ADMIN") redirect("/admin");
    const suspended = user.memberships.find((m) => m.organizationStatus !== "active");
    if (suspended) {
      return (
        <>
          <PageHeader title={`${greeting(new Date())}, ${firstName}`} />
          <Card>
            <EmptyState
              icon={Ban}
              title={`${suspended.organizationName} is suspended`}
              description="Access to this workspace has been paused by MECGURA. Please contact MECGURA support to restore access."
            />
          </Card>
        </>
      );
    }
    return (
      <>
        <PageHeader title={`${greeting(new Date())}, ${firstName}`} />
        <Card>
          <EmptyState
            icon={Building2}
            title="You're not part of a workspace yet"
            description="Your account is active, but no organization has added you. Ask your organization owner or the MECGURA team to invite you."
          />
        </Card>
      </>
    );
  }

  const orgId = active.organizationId;
  const { since, days, since30 } = activityWindow();
  const canSeeAudit = roleHasPermission(active.role, "audit:read");

  const usable = await db.whatsAppAccount.findMany({
    where: { organizationId: orgId, status: { in: ["connected", "demo"] } },
    orderBy: { createdAt: "asc" },
    select: { id: true, displayName: true, phoneNumber: true, status: true, isDemo: true, phone: { select: { qualityRating: true, displayPhoneNumber: true } } },
  });
  const activeId = await readActiveNumber(orgId, usable.map((a) => a.id));
  const activeNumber = usable.find((a) => a.id === activeId) ?? null;
  const scope = activeId ? { whatsappAccountId: activeId } : {};
  const msgIn = (direction: "inbound" | "outbound", accountId?: string) =>
    db.message.count({ where: { organizationId: orgId, direction, createdAt: { gte: since30 }, ...(accountId ?? activeId ? { conversation: { whatsappAccountId: accountId ?? activeId } } : {}) } });

  const [memberCount, events, recent, subscription, services, numbers, openChats, sent, received, contacts, campaigns, runs, perNumber] = await Promise.all([
    db.organizationMember.count({ where: { organizationId: orgId } }),
    db.auditLog.findMany({ where: { organizationId: orgId, createdAt: { gte: since } }, select: { createdAt: true } }),
    canSeeAudit
      ? db.auditLog.findMany({
          where: { organizationId: orgId },
          orderBy: { createdAt: "desc" },
          take: 6,
          select: { id: true, action: true, createdAt: true, actor: { select: { name: true, email: true } } },
        })
      : Promise.resolve([]),
    db.subscription.findFirst({ where: { organizationId: orgId, status: "active" }, select: { plan: { select: { name: true, maxUsers: true, maxWhatsAppNumbers: true } } } }),
    db.organizationService.findMany({ where: { organizationId: orgId, enabled: true }, select: { service: true } }),
    db.whatsAppAccount.count({ where: { organizationId: orgId, status: { in: ACTIVE_NUMBER_STATUSES } } }),
    db.conversation.count({ where: { organizationId: orgId, status: "open", ...scope } }),
    msgIn("outbound"),
    msgIn("inbound"),
    db.contact.count({ where: { organizationId: orgId, ...(activeId ? { conversations: { some: { whatsappAccountId: activeId } } } : {}) } }),
    db.campaign.count({ where: { organizationId: orgId, ...scope } }),
    db.automationExecution.count({ where: { organizationId: orgId, isTest: false, createdAt: { gte: since30 }, ...(activeId ? { automation: { whatsappAccountId: activeId } } : {}) } }),
    Promise.all(
      usable.map(async (a) => ({
        id: a.id,
        open: await db.conversation.count({ where: { organizationId: orgId, status: "open", whatsappAccountId: a.id } }),
        sent: await msgIn("outbound", a.id),
        received: await msgIn("inbound", a.id),
      }))
    ),
  ]);

  const counts = new Map<string, number>();
  for (const e of events) counts.set(dayKey.format(e.createdAt), (counts.get(dayKey.format(e.createdAt)) ?? 0) + 1);
  const series: DayCount[] = days.map((d) => {
    const key = dayKey.format(d);
    return { date: key, label: dayLabel.format(d), count: counts.get(key) ?? 0 };
  });

  const checklist = [
    { done: Boolean(user.name && user.name.trim().length >= 2), label: "Complete your profile", href: "/settings" },
    { done: memberCount > 1, label: "Invite your team", href: "/team" },
    { done: numbers > 0, label: "Connect your WhatsApp Business number", href: "/whatsapp/connect" },
    { done: sent + received > 0, label: "Exchange your first messages", href: "/inbox" },
  ];

  return (
    <>
      {denied === "admin" ? (
        <Alert tone="warning" title="Access denied" className="mb-6">
          The Super Admin area is only available to MECGURA platform administrators.
        </Alert>
      ) : null}

      <PageHeader
        title={`${greeting(new Date())}, ${firstName}`}
        description={
          <>
            {active.organizationName} · <Badge tone="primary">{ORG_ROLE_LABELS[active.role]}</Badge>
          </>
        }
        actions={
          roleHasPermission(active.role, "members:manage") ? (
            <Link href="/team" className={buttonVariants({ variant: "primary" })}>
              <UsersRound aria-hidden="true" /> Invite team
            </Link>
          ) : null
        }
      />

      {numbers === 0 ? (
        <Alert tone="info" title="Connect a WhatsApp number" className="mb-6">
          Connect your numbers in the{" "}
          <Link href="/dashboard/whatsapp" className="underline">
            Connection Center
          </Link>
          . Everything below is live data from your workspace.
        </Alert>
      ) : (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-small text-app-muted">
            Showing {activeNumber ? <strong className="text-app-text">{activeNumber.displayName} · {activeNumber.phone?.displayPhoneNumber || activeNumber.phoneNumber}</strong> : <strong className="text-app-text">all {usable.length} number(s)</strong>} · messages are from the last 30 days
          </p>
          <NumberSwitcher orgId={orgId} numbers={usable.map((a) => ({ id: a.id, displayName: a.displayName, phoneNumber: a.phone?.displayPhoneNumber || a.phoneNumber, isDemo: a.isDemo }))} activeId={activeId} />
        </div>
      )}

      <section aria-label="Key metrics" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard label="WhatsApp numbers" value={numbers} icon={Phone} source={numbers ? "live" : "not-connected"} hint={subscription ? `${numbers} of ${subscription.plan.maxWhatsAppNumbers} allowed by your plan` : "Manage in WhatsApp → Connection Center"} />
        <StatCard label="Open conversations" value={openChats} icon={MessageCircle} hint={activeNumber ? "On this number" : "Across all numbers"} />
        <StatCard label="Messages sent" value={sent} icon={Send} hint="Last 30 days" />
        <StatCard label="Messages received" value={received} icon={Inbox} hint="Last 30 days" />
        <StatCard label="Contacts & leads" value={contacts} icon={Contact} hint={activeNumber ? "Who have chatted on this number" : "In your workspace"} />
        <StatCard label="Campaigns" value={campaigns} icon={Megaphone} hint={activeNumber ? "Sending from this number" : "All numbers"} />
        <StatCard label="Automation runs" value={runs} icon={Workflow} hint="Last 30 days" />
        <StatCard label="Team members" value={memberCount} icon={UsersRound} hint="Live from your workspace" />
      </section>

      {usable.length > 1 ? (
        <Card className="mt-6">
          <CardHeader title="Your WhatsApp numbers" description="Each number belongs to this workspace only. Pick one to focus the dashboard and inbox on it." />
          <ul className="divide-y divide-app-border">
            {usable.map((a) => {
              const m = perNumber.find((x) => x.id === a.id);
              return (
                <li key={a.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3">
                  <div className="min-w-[12rem] flex-1">
                    <p className="text-body font-medium text-app-text">
                      {a.displayName} {a.id === activeId ? <Badge tone="primary">Active</Badge> : null} {a.isDemo ? <Badge tone="warning">Demo</Badge> : null}
                    </p>
                    <p className="text-caption text-app-subtle">{a.phone?.displayPhoneNumber || a.phoneNumber} · quality {a.phone?.qualityRating?.toLowerCase() ?? "unknown"}</p>
                  </div>
                  <p className="text-small text-app-muted tabular-nums">{m?.open ?? 0} open · {m?.sent ?? 0} sent · {m?.received ?? 0} received</p>
                  <Link href={`/whatsapp/accounts/${a.id}`} className="text-small text-app-text underline-offset-4 hover:underline">
                    Manage
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
      ) : null}

      <div className="mt-6 grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Workspace activity" description="Workspace, team and access events — last 14 days" action={<Badge tone="success" dot>Live</Badge>} />
          <CardBody>
            {events.length === 0 ? (
              <EmptyState icon={Activity} title="No activity yet" description="Actions in your workspace will appear here." className="py-8" />
            ) : (
              <ActivityChart data={series} title="Workspace activity, last 14 days" />
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Getting started" />
          <CardBody>
            <ul className="space-y-3">
              {checklist.map((c) => (
                <li key={c.label} className="flex items-start gap-3">
                  {c.done ? (
                    <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-app-success" aria-hidden="true" />
                  ) : (
                    <Circle className="mt-0.5 size-5 shrink-0 text-app-subtle" aria-hidden="true" />
                  )}
                  <div className="min-w-0 text-body">
                    {c.href && !c.done ? (
                      <Link href={c.href} className="text-app-text underline-offset-4 hover:underline">
                        {c.label}
                      </Link>
                    ) : (
                      <span className={c.done ? "text-app-muted line-through" : "text-app-text"}>{c.label}</span>
                    )}
                    <span className="sr-only">{c.done ? " (done)" : " (to do)"}</span>
                  </div>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      </div>

      <div className="mt-6 grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Recent activity" />
          {!canSeeAudit ? (
            <EmptyState icon={Activity} title="Visible to owners and managers" description="Ask your workspace owner if you need the activity log." className="py-8" />
          ) : recent.length === 0 ? (
            <EmptyState icon={Activity} title="No activity yet" className="py-8" />
          ) : (
            <ul className="divide-y divide-app-border">
              {recent.map((r) => (
                <li key={r.id} className="flex items-center gap-3 px-5 py-3">
                  <Avatar name={r.actor?.name ?? r.actor?.email ?? "System"} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-body text-app-text">{describeAction(r.action)}</p>
                    <p className="truncate text-caption text-app-subtle">{r.actor?.name ?? r.actor?.email ?? "System"}</p>
                  </div>
                  <time dateTime={r.createdAt.toISOString()} className="shrink-0 text-caption text-app-subtle">
                    {dateTime.format(r.createdAt)}
                  </time>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title="Plan & services" />
          <CardBody className="space-y-4">
            {subscription ? (
              <>
                <p className="text-body text-app-text">
                  <span className="font-semibold">{subscription.plan.name}</span> plan
                </p>
                <UsageMeter label="Team seats" used={memberCount} limit={subscription.plan.maxUsers} />
              </>
            ) : (
              <p className="text-small text-app-muted">No plan assigned yet — contact MECGURA.</p>
            )}
            <div>
              <p className="mb-2 text-small text-app-muted">Enabled services</p>
              <div className="flex flex-wrap gap-1.5">
                {services.length ? (
                  services.map((s) => (
                    <Badge key={s.service} tone="primary">
                      {SERVICE_LABELS[s.service as keyof typeof SERVICE_LABELS] ?? s.service}
                    </Badge>
                  ))
                ) : (
                  <span className="text-small text-app-subtle">None yet</span>
                )}
              </div>
            </div>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
