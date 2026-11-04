import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notifications";
import type { OrgAccess } from "@/lib/session";

/**
 * Inbox service levels. A conversation is "waiting" from the customer's first unanswered message until anyone (a
 * teammate, the AI agent or an automation) replies. Every reply logs how long the customer waited. Waits past the
 * first-response target alert the assignee and the managers once, can move the chat to the least busy teammate, and
 * show up as "breached" in the inbox and the supervisor view. Closing a chat can send a one-tap CSAT question.
 */

export const inboxSlaSchema = z
  .object({
    firstResponseMinutes: z.coerce.number().int().min(1).max(1440),
    alertManagers: z.boolean(),
    reassignAfterMinutes: z.coerce.number().int().min(0).max(1440), // 0 = never
    csat: z.boolean(),
    csatQuestion: z.string().trim().min(10).max(300),
  })
  .strict();
export type InboxSla = z.infer<typeof inboxSlaSchema>;

export const DEFAULT_INBOX_SLA: InboxSla = { firstResponseMinutes: 15, alertManagers: true, reassignAfterMinutes: 0, csat: false, csatQuestion: "Thanks for chatting with us! How did we do?" };
export const CSAT_BUTTONS = ["😊 Great", "🙂 Okay", "😞 Poor"] as const;

export async function getInboxSla(organizationId: string): Promise<InboxSla> {
  const s = await db.organizationSettings.findUnique({ where: { organizationId }, select: { inboxSla: true } });
  if (!s?.inboxSla) return DEFAULT_INBOX_SLA;
  try {
    const p = inboxSlaSchema.safeParse({ ...DEFAULT_INBOX_SLA, ...(JSON.parse(s.inboxSla) as object) });
    return p.success ? p.data : DEFAULT_INBOX_SLA;
  } catch {
    return DEFAULT_INBOX_SLA;
  }
}

export async function saveInboxSla(access: OrgAccess, input: InboxSla, req?: Request) {
  const json = JSON.stringify(input);
  await db.organizationSettings.upsert({ where: { organizationId: access.organizationId }, create: { organizationId: access.organizationId, inboxSla: json }, update: { inboxSla: json } });
  await audit({ action: "inbox.sla_changed", organizationId: access.organizationId, actorUserId: access.user.id, targetType: "inbox_sla", metadata: { minutes: input.firstResponseMinutes, csat: input.csat }, req });
  return getInboxSla(access.organizationId);
}

/** Customer message: start the clock if nobody is waiting already. Never throws. */
export async function markWaiting(conversationId: string, at: Date) {
  await db.conversation.updateMany({ where: { id: conversationId, waitingSince: null }, data: { waitingSince: at } }).catch(() => null);
}

/** Any reply: stop the clock and log the wait. Never throws (it sits in the send path). */
export async function markAnswered(organizationId: string, conversationId: string, userId: string | null, at = new Date()) {
  try {
    const c = await db.conversation.findFirst({ where: { id: conversationId, organizationId }, select: { waitingSince: true, slaAlertedAt: true } });
    if (!c?.waitingSince) return;
    const r = await db.conversation.updateMany({ where: { id: conversationId, waitingSince: c.waitingSince }, data: { waitingSince: null, slaAlertedAt: null } });
    if (!r.count) return; // answered by someone else at the same moment
    const sla = await getInboxSla(organizationId);
    const waitedMs = Math.max(0, at.getTime() - c.waitingSince.getTime());
    await db.inboxResponse.create({ data: { organizationId, conversationId, userId, kind: userId ? "human" : "bot", waitedMs, breached: waitedMs > sla.firstResponseMinutes * 60_000 } });
  } catch (e) {
    console.error("[inbox] response not logged:", e instanceof Error ? e.message : e);
  }
}

/** Scheduler: chats waiting past the target alert once; optionally move to the least busy teammate. */
export async function checkInboxBreaches(now = new Date()) {
  const waiting = await db.conversation.findMany({ where: { status: "open", waitingSince: { not: null, lt: new Date(now.getTime() - 60_000) }, isDemo: false }, select: { id: true, organizationId: true, waitingSince: true, slaAlertedAt: true, assignedToUserId: true, contact: { select: { name: true, phone: true } } }, take: 500 });
  let alerted = 0;
  const cache = new Map<string, InboxSla>();
  for (const c of waiting) {
    const sla = cache.get(c.organizationId) ?? (await getInboxSla(c.organizationId));
    cache.set(c.organizationId, sla);
    const waited = now.getTime() - c.waitingSince!.getTime();
    if (!c.slaAlertedAt && waited > sla.firstResponseMinutes * 60_000) {
      const r = await db.conversation.updateMany({ where: { id: c.id, slaAlertedAt: null }, data: { slaAlertedAt: now } });
      if (!r.count) continue;
      alerted++;
      const who = c.contact.name || c.contact.phone;
      const mins = Math.round(waited / 60_000);
      const targets = new Set<string>(c.assignedToUserId ? [c.assignedToUserId] : []);
      if (sla.alertManagers || !c.assignedToUserId) for (const m of await db.organizationMember.findMany({ where: { organizationId: c.organizationId, role: { in: ["CLIENT_OWNER", "MANAGER"] } }, select: { userId: true } })) targets.add(m.userId);
      for (const userId of targets) await notify({ userId, type: "warning", title: `${who} is waiting ${mins} min for a reply`, body: `First-reply target is ${sla.firstResponseMinutes} min.`, link: `/inbox?c=${c.id}` });
    }
    if (sla.reassignAfterMinutes && c.assignedToUserId && waited > sla.reassignAfterMinutes * 60_000) {
      const { pickLeastBusyMember, systemAssign } = await import("@/services/inbox/routing");
      const next = await pickLeastBusyMember(c.organizationId);
      if (next && next !== c.assignedToUserId) {
        await systemAssign(c.organizationId, c.id, next, "sla", "Moved to you: the customer was waiting past the response target.");
        await db.conversation.update({ where: { id: c.id }, data: { slaAlertedAt: now } });
      }
    }
  }
  return alerted;
}

// ---------------------------------------------------------------------------
// CSAT
// ---------------------------------------------------------------------------
/** Closing a WhatsApp chat (customer wrote in the last 24 h): ask one tap-to-answer question. */
export async function sendCsat(organizationId: string, conversationId: string) {
  const sla = await getInboxSla(organizationId);
  if (!sla.csat) return null;
  const c = await db.conversation.findFirst({ where: { id: conversationId, organizationId }, select: { channel: true, contactId: true, assignedToUserId: true, lastInboundAt: true } });
  if (!c || c.channel !== "whatsapp" || !c.lastInboundAt || Date.now() - c.lastInboundAt.getTime() > 23 * 3_600_000) return null;
  if (await db.csatSurvey.count({ where: { conversationId, sentAt: { gte: new Date(Date.now() - 24 * 3_600_000) } } })) return null; // once a day per chat
  const { sendSystemText } = await import("@/services/inbox/messaging");
  try {
    await sendSystemText(organizationId, conversationId, sla.csatQuestion, { csat: true }, [...CSAT_BUTTONS]);
  } catch {
    return null;
  }
  return db.csatSurvey.create({ data: { organizationId, conversationId, contactId: c.contactId, agentUserId: c.assignedToUserId } });
}

const csatValue = (text: string) => {
  const t = text.toLowerCase();
  return t.includes("great") || t.includes("😊") ? 3 : t.includes("okay") || t.includes("🙂") ? 2 : t.includes("poor") || t.includes("😞") ? 1 : null;
};

/** A customer's answer to the CSAT question. Returns true when it was one (so no bot answers it). */
export async function captureCsat(organizationId: string, conversationId: string, text: string) {
  const v = csatValue(text);
  if (!v) return false;
  const s = await db.csatSurvey.findFirst({ where: { organizationId, conversationId, rating: null, sentAt: { gte: new Date(Date.now() - 48 * 3_600_000) } }, orderBy: { sentAt: "desc" } });
  if (!s) return false;
  await db.csatSurvey.update({ where: { id: s.id }, data: { rating: v, ratedAt: new Date() } });
  if (v === 1) {
    for (const m of await db.organizationMember.findMany({ where: { organizationId, role: { in: ["CLIENT_OWNER", "MANAGER"] } }, select: { userId: true } })) {
      await notify({ userId: m.userId, type: "warning", title: "A customer rated their chat Poor", body: "Open the chat to follow up.", link: `/inbox?c=${conversationId}` });
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Presence (collision prevention)
// ---------------------------------------------------------------------------
export async function heartbeat(access: OrgAccess, conversationId: string, typing: boolean) {
  const name = access.user.name || access.user.email;
  await db.conversationPresence.upsert({ where: { conversationId_userId: { conversationId, userId: access.user.id } }, create: { conversationId, userId: access.user.id, organizationId: access.organizationId, name, typing }, update: { typing, name } });
  const others = await db.conversationPresence.findMany({ where: { conversationId, organizationId: access.organizationId, userId: { not: access.user.id }, updatedAt: { gte: new Date(Date.now() - 30_000) } }, select: { userId: true, name: true, typing: true } });
  return others;
}

// ---------------------------------------------------------------------------
// Supervisor view
// ---------------------------------------------------------------------------
export async function supervisorView(organizationId: string, now = new Date()) {
  const sla = await getInboxSla(organizationId);
  const dayStart = new Date(now.getTime() - 24 * 3_600_000);
  const monthStart = new Date(now.getTime() - 30 * 24 * 3_600_000);
  const [members, open, waiting, responses, csat] = await Promise.all([
    db.organizationMember.findMany({ where: { organizationId }, select: { userId: true, role: true, agentStatus: true, user: { select: { name: true, email: true } } } }),
    db.conversation.groupBy({ by: ["assignedToUserId"], where: { organizationId, status: "open" }, _count: { _all: true } }),
    db.conversation.findMany({ where: { organizationId, status: "open", waitingSince: { not: null } }, orderBy: { waitingSince: "asc" }, take: 100, select: { id: true, channel: true, waitingSince: true, assignedToUserId: true, lastMessagePreview: true, contact: { select: { name: true, phone: true } } } }),
    db.inboxResponse.findMany({ where: { organizationId, createdAt: { gte: monthStart } }, select: { userId: true, kind: true, waitedMs: true, breached: true, createdAt: true } }),
    db.csatSurvey.findMany({ where: { organizationId, sentAt: { gte: monthStart } }, select: { agentUserId: true, rating: true } }),
  ]);
  const median = (xs: number[]) => {
    if (!xs.length) return null;
    const s = [...xs].sort((a, b) => a - b);
    return Math.round(s[Math.floor(s.length / 2)] / 60_000 * 10) / 10;
  };
  const target = sla.firstResponseMinutes * 60_000;
  const csatScore = (rows: { rating: number | null }[]) => {
    const rated = rows.filter((r) => r.rating);
    return { answered: rated.length, asked: rows.length, greatPct: rated.length ? Math.round((rated.filter((r) => r.rating === 3).length / rated.length) * 100) : null };
  };
  const agents = members.map((m) => {
    const mine = responses.filter((r) => r.userId === m.userId);
    const today = mine.filter((r) => r.createdAt >= dayStart);
    const myWaiting = waiting.filter((w) => w.assignedToUserId === m.userId);
    return {
      userId: m.userId,
      name: m.user.name || m.user.email,
      role: m.role,
      status: m.agentStatus,
      openChats: open.find((o) => o.assignedToUserId === m.userId)?._count._all ?? 0,
      waiting: myWaiting.length,
      breachedNow: myWaiting.filter((w) => now.getTime() - w.waitingSince!.getTime() > target).length,
      repliesToday: today.length,
      medianReplyMin30d: median(mine.map((r) => r.waitedMs)),
      withinTargetPct30d: mine.length ? Math.round((mine.filter((r) => !r.breached).length / mine.length) * 100) : null,
      csat: csatScore(csat.filter((c) => c.agentUserId === m.userId)),
    };
  });
  return {
    targetMinutes: sla.firstResponseMinutes,
    waiting: waiting.map((w) => ({ ...w, waitedMin: Math.round((now.getTime() - w.waitingSince!.getTime()) / 60_000), breached: now.getTime() - w.waitingSince!.getTime() > target, assignee: agents.find((a) => a.userId === w.assignedToUserId)?.name ?? null })),
    unassignedOpen: open.find((o) => o.assignedToUserId === null)?._count._all ?? 0,
    team: {
      medianReplyMin30d: median(responses.filter((r) => r.kind === "human").map((r) => r.waitedMs)),
      botMedianReplyMin30d: median(responses.filter((r) => r.kind === "bot").map((r) => r.waitedMs)),
      withinTargetPct30d: responses.length ? Math.round((responses.filter((r) => !r.breached).length / responses.length) * 100) : null,
      csat: csatScore(csat),
    },
    agents: agents.sort((a, b) => b.breachedNow - a.breachedNow || b.waiting - a.waiting),
  };
}
