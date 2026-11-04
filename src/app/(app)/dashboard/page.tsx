import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Ban, Building2, Contact, Inbox, Megaphone, MessageCircle, Phone, Send, UsersRound, Workflow } from "lucide-react";
import { db } from "@/lib/db";
import { getAppContext } from "@/lib/app-context";
import { roleHasPermission, ORG_ROLE_LABELS } from "@/lib/authz";
import { Alert, Avatar, Badge, Card, CardHeader, EmptyState, PageHeader, buttonVariants } from "@/components/ds";
import { ACTIVE_NUMBER_STATUSES } from "@/lib/catalog";
import { DonutCard, MessagesChart, PipelineChart, type MessageDay, type Slice, type StageBar } from "@/components/dashboard/dashboard-charts";
import { GettingStarted } from "@/components/dashboard/getting-started";
import { KpiTile } from "@/components/dashboard/kpi-tile";
import { NumberSwitcher } from "@/components/app/number-switcher";
import { readActiveNumber } from "@/lib/active-number";
import { agreementProgress } from "@/services/agreements/agreements";

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

  const usable = await db.whatsAppAccount.findMany({
    where: { organizationId: orgId, status: { in: ["connected", "demo"] } },
    orderBy: { createdAt: "asc" },
    select: { id: true, displayName: true, phoneNumber: true, status: true, isDemo: true, phone: { select: { qualityRating: true, displayPhoneNumber: true } } },
  });
  const activeId = await readActiveNumber(orgId, usable.map((a) => a.id));
  const activeNumber = usable.find((a) => a.id === activeId) ?? null;
  const scope = activeId ? { whatsappAccountId: activeId } : {};
  const convScope = activeId ? { conversation: { whatsappAccountId: activeId } } : {};
  const msgIn = (direction: "inbound" | "outbound", accountId?: string) =>
    db.message.count({ where: { organizationId: orgId, direction, createdAt: { gte: since30 }, ...(accountId ?? activeId ? { conversation: { whatsappAccountId: accountId ?? activeId } } : {}) } });

  const [memberCount, subscription, numbers, openChats, sent, received, contacts, campaigns, runs, perNumber, recentMsgs, leadGroups, channelGroups, openDeals, stages, latestConvs, latestCampaigns] = await Promise.all([
    db.organizationMember.count({ where: { organizationId: orgId } }),
    db.subscription.findFirst({ where: { organizationId: orgId, status: "active" }, select: { plan: { select: { name: true, maxUsers: true, maxWhatsAppNumbers: true } } } }),
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
    db.message.findMany({ where: { organizationId: orgId, createdAt: { gte: since }, direction: { in: ["inbound", "outbound"] }, ...convScope }, select: { createdAt: true, direction: true }, take: 100_000 }),
    db.contact.groupBy({ by: ["leadStatus"], where: { organizationId: orgId }, _count: { _all: true } }),
    db.conversation.groupBy({ by: ["channel"], where: { organizationId: orgId, ...scope }, _count: { _all: true } }),
    db.deal.groupBy({ by: ["stageId"], where: { organizationId: orgId, status: "open" }, _sum: { valuePaise: true }, _count: { _all: true } }),
    db.pipelineStage.findMany({ where: { organizationId: orgId }, orderBy: { position: "asc" }, select: { id: true, name: true } }),
    db.conversation.findMany({ where: { organizationId: orgId, ...scope }, orderBy: { lastMessageAt: "desc" }, take: 6, select: { id: true, channel: true, status: true, unreadCount: true, lastMessageAt: true, lastMessagePreview: true, contact: { select: { name: true, phone: true } } } }),
    db.campaign.findMany({ where: { organizationId: orgId, ...scope }, orderBy: { createdAt: "desc" }, take: 5, select: { id: true, name: true, status: true, createdAt: true } }),
  ]);
  const campaignStats = latestCampaigns.length
    ? await db.campaignRecipient.groupBy({ by: ["campaignId"], where: { campaignId: { in: latestCampaigns.map((c) => c.id) } }, _count: { _all: true, sentAt: true, readAt: true, repliedAt: true } })
    : [];

  // Messages per IST day (sent vs received).
  const perDay = new Map<string, { sent: number; received: number }>();
  for (const m of recentMsgs) {
    const k = dayKey.format(m.createdAt);
    const e = perDay.get(k) ?? { sent: 0, received: 0 };
    if (m.direction === "outbound") e.sent++;
    else e.received++;
    perDay.set(k, e);
  }
  const messageSeries: MessageDay[] = days.map((d) => ({ label: dayLabel.format(d), ...(perDay.get(dayKey.format(d)) ?? { sent: 0, received: 0 }) }));
  const LEAD_LABEL: Record<string, string> = { new: "New", contacted: "Contacted", qualified: "Qualified", proposal: "Proposal", won: "Won", lost: "Lost" };
  const leadSlices: Slice[] = ["new", "contacted", "qualified", "proposal", "won", "lost"].map((k) => ({ key: k, label: LEAD_LABEL[k], value: leadGroups.find((g) => g.leadStatus === k)?._count._all ?? 0, href: `/contacts?leadStatus=${k}` }));
  const CHANNEL_LABEL: Record<string, string> = { whatsapp: "WhatsApp", email: "Email", webchat: "Website chat", messenger: "Messenger", instagram: "Instagram" };
  const channelSlices: Slice[] = channelGroups.sort((a, b) => b._count._all - a._count._all).map((g) => ({ key: g.channel, label: CHANNEL_LABEL[g.channel] ?? g.channel, value: g._count._all, href: "/inbox" }));
  const pipeline: StageBar[] = stages
    .map((s) => {
      const g = openDeals.find((d) => d.stageId === s.id);
      return { label: s.name, rupees: (g?._sum.valuePaise ?? 0) / 100, deals: g?._count._all ?? 0 };
    })
    .filter((s) => s.deals > 0);

  const orgScope = { organizationId: active.organizationId };
  const [approvedTemplates, contactCount, campaignCount, automationCount] = await Promise.all([
    db.messageTemplate.count({ where: { ...orgScope, status: "approved" } }),
    db.contact.count({ where: orgScope }),
    db.campaign.count({ where: orgScope }),
    db.automation.count({ where: orgScope }),
  ]);
  const isOwner = roleHasPermission(active.role, "org:update");
  const kyc = isOwner ? await agreementProgress(active.organizationId) : null;
  const checklist = [
    ...(kyc ? [{ done: kyc.hasProof, label: "Upload your business proof (GST / Udyam / PAN)", href: "/onboarding" }, { done: kyc.signed, label: "Accept your MECGURA service agreement", href: "/onboarding" }] : []),
    { done: Boolean(user.name && user.name.trim().length >= 2), label: "Complete your profile", href: "/settings" },
    { done: memberCount > 1, label: "Invite your team", href: "/team" },
    { done: numbers > 0, label: "Connect your WhatsApp Business number", href: "/whatsapp/connect" },
    { done: sent + received > 0, label: "Exchange your first messages", href: "/inbox" },
    { done: contactCount > 1, label: "Add or import your contacts", href: "/contacts" },
    { done: approvedTemplates > 0, label: "Get a message template approved", href: "/templates" },
    { done: campaignCount + automationCount > 0, label: "Create your first campaign or automation", href: "/campaigns" },
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

      {kyc && !kyc.signed ? (
        <Alert tone="warning" title="Complete your Agreement & KYC" className="mb-6">
          Check your business details, upload one business proof (GST, Udyam or business PAN) and accept your service agreement.{" "}
          <Link href="/onboarding" className="font-semibold underline">
            Open Agreement &amp; KYC
          </Link>
        </Alert>
      ) : null}

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

      <GettingStarted orgId={orgId} items={checklist} />

      <section aria-label="Key metrics" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiTile href="/inbox" accent="emerald" label="Open conversations" value={openChats} icon={MessageCircle} hint={activeNumber ? "On this number" : "Across all numbers"} />
        <KpiTile href="/inbox" accent="sky" label="Messages sent" value={sent} icon={Send} hint="Last 30 days" />
        <KpiTile href="/inbox" accent="violet" label="Messages received" value={received} icon={Inbox} hint="Last 30 days" />
        <KpiTile href="/contacts" accent="amber" label="Contacts & leads" value={contacts} icon={Contact} hint={activeNumber ? "Chatted on this number" : "In your workspace"} />
        <KpiTile href="/campaigns" accent="pink" label="Campaigns" value={campaigns} icon={Megaphone} hint={activeNumber ? "From this number" : "All numbers"} />
        <KpiTile href="/automations" accent="orange" label="Automation runs" value={runs} icon={Workflow} hint="Last 30 days" />
        <KpiTile href="/whatsapp/accounts" accent="teal" label="WhatsApp numbers" value={numbers} icon={Phone} hint={subscription ? `${numbers} of ${subscription.plan.maxWhatsAppNumbers < 0 ? "unlimited" : subscription.plan.maxWhatsAppNumbers} on your plan` : "Connection Center"} />
        <KpiTile href="/team" accent="indigo" label="Team members" value={memberCount} icon={UsersRound} hint="In this workspace" />
      </section>

      <div className="mt-6 grid gap-4 xl:grid-cols-3">
        <MessagesChart data={messageSeries} />
        <DonutCard title="Leads by status" description="Tap a slice to open those contacts" data={leadSlices} emptyTitle="No contacts yet" icon="users" centerLabel="contacts" />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <DonutCard title="Conversations by channel" description="Where customers talk to you" data={channelSlices} emptyTitle="No conversations yet" centerLabel="conversations" />
        <div className="xl:col-span-2"><PipelineChart data={pipeline} /></div>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Latest conversations" action={<Link href="/inbox" className="text-small text-app-primary hover:underline">Inbox →</Link>} />
          {!latestConvs.length ? (
            <EmptyState icon={MessageCircle} title="No conversations yet" className="py-8" />
          ) : (
            <ul className="divide-y divide-app-border">
              {latestConvs.map((c) => (
                <li key={c.id}>
                  <Link href={`/inbox?c=${c.id}`} className="flex items-center gap-3 px-5 py-3 transition hover:bg-app-hover">
                    <Avatar name={c.contact.name || c.contact.phone} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2 text-small font-medium text-app-text">
                        <span className="truncate">{c.contact.name || c.contact.phone}</span>
                        {c.unreadCount ? <Badge tone="success">{c.unreadCount} new</Badge> : null}
                      </span>
                      <span className="block truncate text-caption text-app-subtle">{c.lastMessagePreview || "—"}</span>
                    </span>
                    <span className="shrink-0 text-right text-caption text-app-subtle">
                      <span className="block capitalize">{c.channel}</span>
                      <time dateTime={c.lastMessageAt.toISOString()}>{dateTime.format(c.lastMessageAt)}</time>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title="Recent campaigns" action={<Link href="/campaigns" className="text-small text-app-primary hover:underline">Campaigns →</Link>} />
          {!latestCampaigns.length ? (
            <EmptyState icon={Megaphone} title="No campaigns yet" description="Send an approved template to opted-in contacts." className="py-8" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-small">
                <thead>
                  <tr className="border-b border-app-border text-left text-caption text-app-subtle">
                    <th className="px-5 py-2 font-medium">Campaign</th>
                    <th className="px-3 py-2 text-right font-medium">Sent</th>
                    <th className="px-3 py-2 text-right font-medium">Read</th>
                    <th className="px-5 py-2 text-right font-medium">Replies</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-app-border">
                  {latestCampaigns.map((c) => {
                    const st = campaignStats.find((x) => x.campaignId === c.id)?._count;
                    const sentN = st?.sentAt ?? 0;
                    const pct = (n: number) => (sentN ? ` · ${Math.round((n / sentN) * 100)}%` : "");
                    return (
                      <tr key={c.id} className="transition hover:bg-app-hover">
                        <td className="px-5 py-2.5">
                          <Link href={`/campaigns/${c.id}`} className="block">
                            <span className="block truncate font-medium text-app-text">{c.name}</span>
                            <span className="text-caption capitalize text-app-subtle">{c.status.replace(/_/g, " ")}</span>
                          </Link>
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-app-text">{sentN}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-app-text">{st?.readAt ?? 0}<span className="text-caption text-app-subtle">{pct(st?.readAt ?? 0)}</span></td>
                        <td className="px-5 py-2.5 text-right tabular-nums text-app-text">{st?.repliedAt ?? 0}<span className="text-caption text-app-subtle">{pct(st?.repliedAt ?? 0)}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      {usable.length > 1 ? (
        <Card className="mt-4">
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

    </>
  );
}
