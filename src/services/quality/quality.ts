import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { audit, describeAction } from "@/lib/audit";
import type { OrgAccess } from "@/lib/session";
import { MetaApiError } from "@/providers/meta/graph";
import { getPhoneNumber } from "@/providers/meta/api";
import { campaignStats, type Signal } from "@/services/campaigns/campaigns";
import { wabaToken } from "@/services/templates/templates";

const DAY = 24 * 60 * 60 * 1000;
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : 0);

const QUALITY_ACTIONS = [
  "template.created",
  "template.submitted",
  "template.status_changed",
  "template.deleted",
  "templates.synced",
  "campaign.reviewed",
  "campaign.scheduled",
  "campaign.started",
  "campaign.paused",
  "campaign.cancelled",
  "campaign.completed",
  "campaign.failed",
  "contact.consent_changed",
  "contacts.imported",
  "whatsapp.connected",
  "whatsapp.disconnected",
  "whatsapp.quality_changed",
  "whatsapp.account_event",
];

export type Alert = Signal & { link?: string };

/** Everything the Quality Center shows, computed live from MECGURA's own records and Meta's last reports. */
export async function getQualityOverview(organizationId: string) {
  const since = new Date(Date.now() - 30 * DAY);
  const [accounts, contactGroups, suppressed, optOuts30, outbound30, failed30, convs30, templates, campaigns, logs] = await Promise.all([
    db.whatsAppAccount.findMany({
      where: { organizationId, status: { not: "disabled" } },
      include: { phone: true, waba: true, connection: { select: { status: true, method: true, webhook: { select: { status: true, lastEventAt: true } } } } },
      orderBy: { createdAt: "asc" },
    }),
    db.contact.groupBy({ by: ["optInStatus"], where: { organizationId }, _count: { _all: true } }),
    db.contact.count({ where: { organizationId, suppressed: true } }),
    db.consentRecord.count({ where: { organizationId, status: "opted_out", createdAt: { gte: since } } }),
    db.message.count({ where: { organizationId, direction: "outbound", createdAt: { gte: since }, status: { not: "pending" } } }),
    db.message.count({ where: { organizationId, direction: "outbound", createdAt: { gte: since }, status: "failed" } }),
    db.message.groupBy({ by: ["conversationId"], where: { organizationId, direction: "outbound", createdAt: { gte: since } } }),
    db.messageTemplate.findMany({ where: { organizationId }, select: { id: true, name: true, language: true, category: true, status: true, qualityScore: true, rejectedReason: true, isDemo: true, updatedAt: true } }),
    db.campaign.findMany({
      where: { organizationId, OR: [{ status: { in: ["scheduled", "sending", "paused", "failed"] } }, { completedAt: { gte: since } }] },
      include: { template: { select: { name: true, status: true } } },
      orderBy: { updatedAt: "desc" },
      take: 50,
    }),
    db.auditLog.findMany({ where: { organizationId, action: { in: QUALITY_ACTIONS } }, include: { actor: { select: { name: true, email: true } } }, orderBy: { createdAt: "desc" }, take: 30 }),
  ]);

  const byConsent = Object.fromEntries(contactGroups.map((g) => [g.optInStatus, g._count._all])) as Record<string, number>;
  const totalContacts = contactGroups.reduce((a, g) => a + g._count._all, 0);
  const optedIn = byConsent.opted_in ?? 0;
  const reached30 = convs30.length;

  const alerts: Alert[] = [];
  const numbers = accounts.map((a) => {
    const q = a.phone?.qualityRating ?? "UNKNOWN";
    if (!a.isDemo && (q === "RED" || q === "YELLOW")) {
      alerts.push({ level: q === "RED" ? "danger" : "warn", title: `${a.displayName}: ${q === "RED" ? "low" : "medium"} quality`, detail: q === "RED" ? "Pause marketing broadcasts and only message engaged, opted-in customers until quality recovers." : "Review recent campaigns for opt-outs and blocks.", link: "/whatsapp/quality" });
    }
    if (a.waba?.lastAccountEvent) {
      alerts.push({ level: "danger", title: `${a.displayName}: notice from Meta`, detail: `${a.waba.lastAccountEvent}${a.waba.accountStatus && a.waba.accountStatus !== a.waba.lastAccountEvent ? ` — ${a.waba.accountStatus}` : ""}. Check WhatsApp Manager for details.` });
    }
    if (a.status === "connected" && a.connection?.webhook && ["pending", "failed"].includes(a.connection.webhook.status)) {
      alerts.push({ level: "warn", title: `${a.displayName}: webhook not verified`, detail: "Delivery receipts, replies and opt-outs won't arrive until the webhook is verified.", link: `/whatsapp/accounts/${a.id}` });
    }
    return {
      id: a.id,
      displayName: a.displayName,
      phoneNumber: a.phone?.displayPhoneNumber || a.phoneNumber,
      status: a.status,
      isDemo: a.isDemo,
      verifiedName: a.phone?.verifiedName ?? "",
      nameStatus: a.phone?.nameStatus ?? "",
      numberStatus: a.phone?.status ?? "",
      quality: q,
      messagingLimitTier: a.phone?.messagingLimitTier ?? "",
      lastQualityEvent: a.phone?.lastQualityEvent ?? "",
      lastSyncedAt: a.phone?.lastSyncedAt ?? null,
      accountStatus: a.waba?.accountStatus ?? "",
      lastAccountEvent: a.waba?.lastAccountEvent ?? "",
      lastAccountEventAt: a.waba?.lastAccountEventAt ?? null,
      connection: a.connection ? { status: a.connection.status, method: a.connection.method, webhook: a.connection.webhook?.status ?? null } : null,
    };
  });

  const tCounts: Record<string, number> = { draft: 0, pending: 0, approved: 0, rejected: 0, paused: 0, disabled: 0 };
  for (const t of templates) tCounts[t.status] = (tCounts[t.status] ?? 0) + 1;
  const attention = templates.filter((t) => ["rejected", "paused", "disabled"].includes(t.status) || t.qualityScore === "RED" || t.qualityScore === "YELLOW");
  for (const t of attention.filter((x) => x.status === "paused" || x.status === "disabled" || x.qualityScore === "RED")) {
    alerts.push({ level: "danger", title: `Template “${t.name}”: ${t.status === "approved" ? "low quality" : t.status}`, detail: t.rejectedReason || "Customers are blocking or reporting this template. Revise it before using it again.", link: `/templates/${t.id}` });
  }

  const stats = await campaignStats(campaigns.map((c) => c.id));
  for (const c of campaigns) {
    const s = stats.get(c.id)!;
    const link = `/campaigns/${c.id}`;
    if (c.status === "paused" && c.statusReason && !c.statusReason.startsWith("Paused by")) alerts.push({ level: "danger", title: `Campaign “${c.name}” paused automatically`, detail: c.statusReason, link });
    if (c.status === "failed") alerts.push({ level: "danger", title: `Campaign “${c.name}” failed`, detail: c.statusReason || "Sending stopped.", link });
    if (c.status === "scheduled" && c.template && c.template.status !== "approved") alerts.push({ level: "danger", title: `Campaign “${c.name}” will not send`, detail: `Its template “${c.template.name}” is ${c.template.status}.`, link });
    const attempted = s.sent + s.failed;
    if (attempted >= 10 && pct(s.failed, attempted) >= 10) alerts.push({ level: "warn", title: `Campaign “${c.name}”: ${pct(s.failed, attempted)}% failed`, detail: "Open the campaign to see the error breakdown.", link });
    if (s.delivered >= 20 && pct(s.optOuts, s.delivered) >= 2) alerts.push({ level: "warn", title: `Campaign “${c.name}”: ${pct(s.optOuts, s.delivered)}% opted out`, detail: "High opt-outs lower your quality rating. Narrow the audience next time.", link });
  }
  const optOutRate = pct(optOuts30, reached30);
  const failureRate = pct(failed30, outbound30);
  if (reached30 >= 10 && optOutRate >= 2) {
    alerts.push({ level: optOutRate >= 5 ? "danger" : "warn", title: `Opt-out rate ${optOutRate}% (30 days)`, detail: "Above 2% hurts your quality rating. Message fewer, more engaged contacts and make offers more relevant.", link: "/campaigns" });
  }
  if (outbound30 >= 10 && failureRate >= 10) {
    alerts.push({ level: failureRate >= 25 ? "danger" : "warn", title: `Failure rate ${failureRate}% (30 days)`, detail: "Check campaign failure reasons — invalid numbers and limit errors should be cleaned from your lists." });
  }
  if (totalContacts >= 10 && pct(optedIn, totalContacts) < 50) {
    alerts.push({ level: "info", title: "Low opt-in coverage", detail: `Only ${pct(optedIn, totalContacts)}% of contacts have a recorded opt-in. Campaigns only reach opted-in contacts — collect consent at checkout, forms or click-to-WhatsApp ads.`, link: "/contacts" });
  }

  return {
    numbers,
    consent: {
      total: totalContacts,
      optedIn,
      optedOut: byConsent.opted_out ?? 0,
      unknown: byConsent.unknown ?? 0,
      suppressed,
      coverage: pct(optedIn, totalContacts),
    },
    rates: {
      optOuts30: optOuts30,
      reached30,
      optOutRate,
      outbound30,
      failed30,
      failureRate,
    },
    templates: {
      counts: tCounts,
      total: templates.length,
      attention: attention.map((t) => ({ id: t.id, name: t.name, language: t.language, status: t.status, qualityScore: t.qualityScore, reason: t.rejectedReason })),
    },
    alerts,
    logs: logs.map((l) => ({
      id: l.id,
      action: l.action,
      label: describeAction(l.action),
      actor: l.actor?.name || l.actor?.email || "System / Meta",
      targetType: l.targetType,
      metadata: safeJson(l.metadata),
      createdAt: l.createdAt,
    })),
  };
}

function safeJson(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** Pulls the latest quality rating / limit / status of every live number from Meta. */
export async function refreshNumberHealth(access: OrgAccess, req?: Request) {
  const accounts = await db.whatsAppAccount.findMany({ where: { organizationId: access.organizationId, status: "connected", isDemo: false }, include: { phone: true } });
  if (!accounts.length) throw new ApiError("CONFLICT", "There are no live numbers to refresh. Demo numbers have no Meta quality data.");
  let refreshed = 0;
  const errors: string[] = [];
  for (const a of accounts) {
    if (!a.phone || !a.wabaRecordId) continue;
    try {
      const p = await getPhoneNumber(a.phone.phoneNumberId, await wabaToken(a.wabaRecordId));
      const quality = p.quality_rating ?? "UNKNOWN";
      await db.phoneNumber.update({
        where: { id: a.phone.id },
        data: {
          qualityRating: quality,
          messagingLimitTier: p.messaging_limit_tier ?? a.phone.messagingLimitTier,
          nameStatus: p.name_status ?? a.phone.nameStatus,
          status: p.status ?? a.phone.status,
          verifiedName: p.verified_name ?? a.phone.verifiedName,
          lastSyncedAt: new Date(),
        },
      });
      if (quality !== a.phone.qualityRating) {
        await audit({ action: "whatsapp.quality_changed", organizationId: access.organizationId, actorUserId: access.user.id, targetType: "phone_number", targetId: a.phoneNumber, metadata: { from: a.phone.qualityRating, to: quality }, req });
      }
      refreshed++;
    } catch (e) {
      errors.push(`${a.displayName}: ${e instanceof MetaApiError || e instanceof ApiError ? e.message : "refresh failed"}`);
    }
  }
  return { refreshed, errors };
}
