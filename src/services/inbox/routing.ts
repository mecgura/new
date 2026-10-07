import { db } from "@/lib/db";
import { publish } from "@/lib/realtime/broker";

/** Least busy teammate: agents before managers, online before away/offline, then fewest open chats. */
export async function pickLeastBusyMember(organizationId: string): Promise<string | null> {
  const members = await db.organizationMember.findMany({
    where: { organizationId, role: { in: ["AGENT", "MANAGER"] }, user: { status: "active" } },
    select: { userId: true, role: true, agentStatus: true },
  });
  if (!members.length) return null;
  const loads = await db.conversation.groupBy({ by: ["assignedToUserId"], where: { organizationId, status: "open", assignedToUserId: { in: members.map((m) => m.userId) } }, _count: { _all: true } });
  const load = (uid: string) => loads.find((l) => l.assignedToUserId === uid)?._count._all ?? 0;
  const rank = (m: (typeof members)[number]) => (m.role === "AGENT" ? 0 : 10) + (m.agentStatus === "online" ? 0 : m.agentStatus === "away" ? 3 : 6);
  members.sort((a, b) => rank(a) - rank(b) || load(a.userId) - load(b.userId));
  return members[0].userId;
}

/**
 * Assignment made by the system (automation, flow, AI handoff): assignment
 * history, a timeline note in the thread, a notification and realtime updates.
 */
export async function systemAssign(organizationId: string, conversationId: string, userId: string, by: string, notificationBody = "") {
  const conv = await db.conversation.findFirstOrThrow({ where: { id: conversationId, organizationId }, include: { contact: { select: { name: true, phone: true } } } });
  const user = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true, email: true } });
  const name = user.name ?? user.email;
  if (conv.assignedToUserId === userId) return { userId, name, changed: false };
  await db.$transaction([
    db.conversation.update({ where: { id: conv.id }, data: { assignedToUserId: userId } }),
    db.conversationAssignment.create({ data: { organizationId, conversationId: conv.id, action: "assigned", fromUserId: conv.assignedToUserId, toUserId: userId, byUserId: null, note: by.slice(0, 500) } }),
    db.message.create({ data: { organizationId, conversationId: conv.id, direction: "internal", type: "system", body: `${by} assigned this chat to ${name}`, status: "received" } }),
  ]);
  await db.notification.create({
    data: { userId, organizationId, type: "info", title: `New chat assigned: ${conv.contact.name || conv.contact.phone}`, body: (notificationBody || by).slice(0, 300), link: `/inbox?c=${conv.id}` },
  });
  publish(organizationId, { type: "conversation.updated", conversationId: conv.id, assignedToUserId: userId });
  if (conv.assignedToUserId) publish(organizationId, { type: "conversation.updated", conversationId: conv.id, assignedToUserId: conv.assignedToUserId });
  return { userId, name, changed: true };
}
