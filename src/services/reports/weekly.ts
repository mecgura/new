import { db } from "@/lib/db";
import { notify } from "@/lib/notifications";
import { sendMail } from "@/lib/mailer";
import { formatINR } from "@/lib/catalog";
import { siteConfig } from "@/config/site";

const DAY = 86_400_000;

/** Last 7 days for one workspace, as plain numbers. Every query is scoped to the organisation. */
export async function buildWeeklyReport(organizationId: string, now = new Date()) {
  const since = new Date(now.getTime() - 7 * DAY);
  const inWeek = { organizationId, createdAt: { gte: since } };
  const [received, sent, failed, newContacts, newChats, leads, campaigns, wallet] = await Promise.all([
    db.message.count({ where: { ...inWeek, direction: "inbound" } }),
    db.message.count({ where: { ...inWeek, direction: "outbound" } }),
    db.message.count({ where: { ...inWeek, direction: "outbound", status: "failed" } }),
    db.contact.count({ where: inWeek }),
    db.conversation.count({ where: inWeek }),
    db.lead.count({ where: inWeek }),
    db.campaign.count({ where: { ...inWeek, status: { in: ["completed", "sending"] } } }),
    db.wallet.findUnique({ where: { organizationId }, select: { balance: true } }),
  ]);
  return { since, received, sent, failed, newContacts, newChats, leads, campaigns, walletBalance: wallet?.balance ?? 0 };
}
export type WeeklyReport = Awaited<ReturnType<typeof buildWeeklyReport>>;

export function reportText(orgName: string, r: WeeklyReport) {
  const lines = [
    `Messages received: ${r.received}`,
    `Messages sent: ${r.sent}${r.failed ? ` (${r.failed} failed)` : ""}`,
    `New contacts: ${r.newContacts}`,
    `New conversations: ${r.newChats}`,
    ...(r.leads ? [`Leads from ads: ${r.leads}`] : []),
    ...(r.campaigns ? [`Campaigns sent: ${r.campaigns}`] : []),
    `Wallet balance: ${formatINR(r.walletBalance)}`,
  ];
  return { title: `${orgName}: your week on WhatsApp`, summary: lines.join(" · "), email: `Your last 7 days at ${orgName}\n\n${lines.join("\n")}\n\nOpen your workspace: ${siteConfig.url}/dashboard\n` };
}

/**
 * Sends each active workspace its weekly summary (in-app to the owners; email too when the workspace set a
 * notification email and email is configured). A workspace is summarised at most once every 6 days, and only when
 * it had any activity, so quiet workspaces aren't nagged. Meant to run from the weekly cron.
 */
export async function sendWeeklyReports(now = new Date()) {
  const cutoff = new Date(now.getTime() - 6 * DAY);
  const orgs = await db.organization.findMany({
    where: { status: "active", services: { some: { service: "WHATSAPP_AUTOMATION", enabled: true } }, OR: [{ settings: { is: null } }, { settings: { is: { weeklyReportAt: null } } }, { settings: { is: { weeklyReportAt: { lt: cutoff } } } }] },
    select: { id: true, name: true, settings: { select: { notificationEmail: true } }, members: { where: { role: "CLIENT_OWNER" }, select: { userId: true } } },
    take: 500,
  });
  let sentCount = 0;
  for (const org of orgs) {
    const r = await buildWeeklyReport(org.id, now);
    if (r.received + r.sent + r.newContacts + r.newChats === 0) continue;
    const t = reportText(org.name, r);
    for (const m of org.members) await notify({ userId: m.userId, organizationId: org.id, type: "info", title: t.title, body: t.summary, link: "/analytics" });
    const to = org.settings?.notificationEmail?.trim();
    if (to) await sendMail(to, t.title, t.email).catch((e) => console.error("[report] email failed:", e));
    await db.organizationSettings.upsert({ where: { organizationId: org.id }, update: { weeklyReportAt: now }, create: { organizationId: org.id, weeklyReportAt: now } });
    sentCount++;
  }
  return { checked: orgs.length, sent: sentCount };
}
