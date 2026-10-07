import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notifications";
import { publish } from "@/lib/realtime/broker";
import { roleHasPermission, type OrgPermission } from "@/lib/authz";
import type { OrgAccess } from "@/lib/session";

export const INBOX_TABS = ["all", "unread", "assigned", "mine"] as const;
export type InboxTab = (typeof INBOX_TABS)[number];

export function can(access: OrgAccess, permission: OrgPermission) {
  return access.isPlatformAdmin || (access.role !== null && roleHasPermission(access.role, permission));
}

/** Agents see conversations assigned to them plus the unassigned queue; owners/managers see everything. */
export function visibilityWhere(access: OrgAccess) {
  return can(access, "inbox:view_all") ? {} : { OR: [{ assignedToUserId: access.user.id }, { assignedToUserId: null }] };
}

const listInclude = {
  contact: { select: { id: true, name: true, phone: true, optInStatus: true, tags: { include: { tag: { select: { id: true, name: true, color: true } } } } } },
  assignedTo: { select: { id: true, name: true, email: true } },
  whatsappAccount: { select: { id: true, displayName: true, phoneNumber: true, status: true, isDemo: true } },
} as const;

type ConvRow = Awaited<ReturnType<typeof db.conversation.findFirstOrThrow<{ include: typeof listInclude }>>>;

const WINDOW_MS = 24 * 60 * 60 * 1000;

export function toConversationDto(c: ConvRow) {
  const windowOpen = Boolean(c.lastInboundAt && Date.now() - c.lastInboundAt.getTime() < WINDOW_MS);
  return {
    id: c.id,
    status: c.status,
    unreadCount: c.unreadCount,
    lastMessageAt: c.lastMessageAt,
    lastMessagePreview: c.lastMessagePreview,
    lastInboundAt: c.lastInboundAt,
    windowOpen,
    windowExpiresAt: c.lastInboundAt ? new Date(c.lastInboundAt.getTime() + WINDOW_MS) : null,
    isDemo: c.isDemo,
    contact: { id: c.contact.id, name: c.contact.name, phone: c.contact.phone, optInStatus: c.contact.optInStatus, tags: c.contact.tags.map((t) => t.tag) },
    assignedTo: c.assignedTo ? { id: c.assignedTo.id, name: c.assignedTo.name ?? c.assignedTo.email } : null,
    account: c.whatsappAccount,
  };
}
export type ConversationDto = ReturnType<typeof toConversationDto>;

export type ConversationFilters = { tab: InboxTab; q: string; status: "open" | "closed" | "all"; accountId?: string; tagId?: string; page: number; pageSize: number };

function tabWhere(access: OrgAccess, tab: InboxTab) {
  if (tab === "unread") return { unreadCount: { gt: 0 } };
  if (tab === "assigned") return { assignedToUserId: { not: null } };
  if (tab === "mine") return { assignedToUserId: access.user.id };
  return {};
}

export async function listConversations(access: OrgAccess, f: ConversationFilters) {
  const q = f.q.trim();
  const digits = q.replace(/\D/g, "");
  const base = {
    organizationId: access.organizationId,
    AND: [
      visibilityWhere(access),
      q ? { OR: [{ contact: { name: { contains: q } } }, { lastMessagePreview: { contains: q } }, ...(digits.length >= 3 ? [{ contact: { phone: { contains: digits } } }] : [])] } : {},
    ],
    ...(f.status !== "all" ? { status: f.status } : {}),
    ...(f.accountId ? { whatsappAccountId: f.accountId } : {}),
    ...(f.tagId ? { contact: { tags: { some: { tagId: f.tagId } } } } : {}),
  };
  const [rows, total, ...counts] = await Promise.all([
    db.conversation.findMany({ where: { ...base, ...tabWhere(access, f.tab) }, orderBy: { lastMessageAt: "desc" }, skip: (f.page - 1) * f.pageSize, take: f.pageSize, include: listInclude }),
    db.conversation.count({ where: { ...base, ...tabWhere(access, f.tab) } }),
    ...INBOX_TABS.map((t) => db.conversation.count({ where: { ...base, ...tabWhere(access, t) } })),
  ]);
  return { items: rows.map(toConversationDto), total, counts: Object.fromEntries(INBOX_TABS.map((t, i) => [t, counts[i]])) as Record<InboxTab, number> };
}

/** Loads a conversation the caller may see; invisible and foreign ids both resolve to 404. */
export async function getVisibleConversation(access: OrgAccess, id: string) {
  const c = await db.conversation.findFirst({ where: { id, organizationId: access.organizationId, ...visibilityWhere(access) }, include: listInclude });
  if (!c) throw new ApiError("NOT_FOUND", "Conversation not found.");
  return c;
}

export async function getConversation(access: OrgAccess, id: string) {
  return toConversationDto(await getVisibleConversation(access, id));
}

/** Post-mutation reload (org-scoped). The caller may legitimately lose visibility, e.g. after a transfer. */
async function reload(organizationId: string, id: string) {
  return toConversationDto(await db.conversation.findFirstOrThrow({ where: { id, organizationId }, include: listInclude }));
}

export async function listMessages(access: OrgAccess, conversationId: string, opts: { before?: string; limit: number }) {
  await getVisibleConversation(access, conversationId);
  const cursor = opts.before ? await db.message.findFirst({ where: { id: opts.before, conversationId }, select: { createdAt: true } }) : null;
  const rows = await db.message.findMany({
    where: { conversationId, ...(cursor ? { createdAt: { lt: cursor.createdAt } } : {}) },
    orderBy: { createdAt: "desc" },
    take: opts.limit + 1,
    include: {
      attachments: true,
      sender: { select: { id: true, name: true, email: true } },
      replyTo: { select: { id: true, body: true, type: true, direction: true } },
    },
  });
  const hasMore = rows.length > opts.limit;
  return { items: rows.slice(0, opts.limit).reverse().map(toMessageDto), hasMore };
}

type MessageRow = Awaited<ReturnType<typeof db.message.findFirstOrThrow<{ include: { attachments: true; sender: { select: { id: true; name: true; email: true } }; replyTo: { select: { id: true; body: true; type: true; direction: true } } } }>>>;

export function toMessageDto(m: MessageRow) {
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(m.payload) as Record<string, unknown>;
  } catch {
    /* keep empty */
  }
  return {
    id: m.id,
    direction: m.direction,
    type: m.type,
    body: m.body,
    payload,
    status: m.status,
    error: m.error,
    isDemo: m.isDemo,
    createdAt: m.createdAt,
    sentAt: m.sentAt,
    deliveredAt: m.deliveredAt,
    readAt: m.readAt,
    sender: m.sender ? { id: m.sender.id, name: m.sender.name ?? m.sender.email } : null,
    replyTo: m.replyTo,
    attachments: m.attachments.map((a) => ({
      id: a.id,
      kind: a.kind,
      mimeType: a.mimeType,
      filename: a.filename,
      sizeBytes: a.sizeBytes,
      caption: a.caption,
      url: a.url || null,
      downloadable: Boolean(a.providerMediaId) && !m.isDemo,
    })),
  };
}
export type MessageDto = ReturnType<typeof toMessageDto>;

export async function markConversationRead(access: OrgAccess, id: string) {
  const c = await getVisibleConversation(access, id);
  if (c.unreadCount === 0) return;
  await db.conversation.update({ where: { id }, data: { unreadCount: 0 } });
  publish(access.organizationId, { type: "conversation.updated", conversationId: id, assignedToUserId: c.assignedToUserId });
}

/** Timeline entry (assignment, status change) shown inside the thread to the team only. */
async function systemMessage(organizationId: string, conversationId: string, body: string, userId: string | null) {
  return db.message.create({ data: { organizationId, conversationId, direction: "internal", type: "system", body, status: "received", senderUserId: userId } });
}

function displayName(u: { name: string | null; email: string } | null | undefined) {
  return u ? u.name ?? u.email : "nobody";
}

/**
 * Assign / claim / transfer / unassign.
 * - inbox:assign (owner, manager): any change.
 * - inbox:claim (agent): take an unassigned chat for themselves.
 * - inbox:transfer (agent): hand a chat they hold to a teammate, or release it.
 */
export async function assignConversation(access: OrgAccess, id: string, toUserId: string | null, note = "", req?: Request) {
  const c = await getVisibleConversation(access, id);
  const me = access.user.id;
  if (toUserId === c.assignedToUserId) return reload(access.organizationId, id);

  let action: "assigned" | "claimed" | "transferred" | "unassigned";
  if (can(access, "inbox:assign")) {
    action = toUserId === null ? "unassigned" : c.assignedToUserId ? "transferred" : "assigned";
  } else if (c.assignedToUserId === null && toUserId === me && can(access, "inbox:claim")) {
    action = "claimed";
  } else if (c.assignedToUserId === me && can(access, "inbox:transfer")) {
    action = toUserId === null ? "unassigned" : "transferred";
  } else {
    throw new ApiError("FORBIDDEN", "You can only take unassigned chats or transfer chats assigned to you.");
  }

  const target = toUserId
    ? await db.organizationMember.findFirst({ where: { organizationId: access.organizationId, userId: toUserId }, include: { user: { select: { id: true, name: true, email: true, status: true } } } })
    : null;
  if (toUserId && (!target || target.user.status !== "active")) {
    throw new ApiError("VALIDATION_ERROR", "Choose an active member of this workspace.", { details: { toUserId: ["Not an active team member"] } });
  }
  const actor = await db.user.findUnique({ where: { id: me }, select: { name: true, email: true } });

  await db.$transaction([
    db.conversation.update({ where: { id }, data: { assignedToUserId: toUserId } }),
    db.conversationAssignment.create({ data: { organizationId: access.organizationId, conversationId: id, action, fromUserId: c.assignedToUserId, toUserId, byUserId: me, note: note.slice(0, 500) } }),
  ]);
  const label =
    action === "claimed"
      ? `${displayName(actor)} took this chat`
      : action === "unassigned"
        ? `${displayName(actor)} unassigned this chat`
        : `${displayName(actor)} ${action === "transferred" ? "transferred" : "assigned"} this chat to ${displayName(target?.user)}`;
  await systemMessage(access.organizationId, id, note ? `${label} — “${note.slice(0, 200)}”` : label, me);
  await audit({ action: "conversation.assigned", actorUserId: me, organizationId: access.organizationId, targetType: "conversation", targetId: id, metadata: { action, from: c.assignedToUserId, to: toUserId }, req });
  if (toUserId && toUserId !== me) {
    await notify({ userId: toUserId, organizationId: access.organizationId, title: `Chat with ${c.contact.name || c.contact.phone} assigned to you`, body: note.slice(0, 200), link: `/inbox?c=${id}` });
  }
  // Publish with both old and new assignee so both agents' views update.
  publish(access.organizationId, { type: "conversation.updated", conversationId: id, assignedToUserId: toUserId });
  // Also notify whoever could see it before (previous assignee, or everyone when it sat in the unassigned queue).
  if (c.assignedToUserId !== toUserId) publish(access.organizationId, { type: "conversation.updated", conversationId: id, assignedToUserId: c.assignedToUserId });
  return reload(access.organizationId, id);
}

export async function setConversationStatus(access: OrgAccess, id: string, status: "open" | "closed", req?: Request) {
  const c = await getVisibleConversation(access, id);
  if (c.status === status) return reload(access.organizationId, id);
  if (!can(access, "inbox:view_all") && c.assignedToUserId !== access.user.id) {
    throw new ApiError("FORBIDDEN", "Take the chat before closing or reopening it.");
  }
  await db.conversation.update({ where: { id }, data: { status, ...(status === "closed" ? { unreadCount: 0 } : {}) } });
  const actor = await db.user.findUnique({ where: { id: access.user.id }, select: { name: true, email: true } });
  await systemMessage(access.organizationId, id, `${displayName(actor)} ${status === "closed" ? "closed" : "reopened"} this chat`, access.user.id);
  await audit({ action: "conversation.status_changed", actorUserId: access.user.id, organizationId: access.organizationId, targetType: "conversation", targetId: id, metadata: { to: status }, req });
  publish(access.organizationId, { type: "conversation.updated", conversationId: id, assignedToUserId: c.assignedToUserId });
  if (status === "closed") {
    const { onConversationClosed } = await import("@/services/ai/engine");
    await onConversationClosed(access.organizationId, id).catch((e) => console.error("[ai] close hook failed:", e));
  }
  return reload(access.organizationId, id);
}

export async function assignmentHistory(access: OrgAccess, id: string) {
  await getVisibleConversation(access, id);
  const rows = await db.conversationAssignment.findMany({ where: { conversationId: id }, orderBy: { createdAt: "desc" }, take: 30 });
  const users = await db.user.findMany({ where: { id: { in: rows.flatMap((r) => [r.fromUserId, r.toUserId, r.byUserId]).filter((x): x is string => !!x) } }, select: { id: true, name: true, email: true } });
  const name = (uid: string | null) => (uid ? displayName(users.find((u) => u.id === uid)) : null);
  return rows.map((r) => ({ id: r.id, action: r.action, from: name(r.fromUserId), to: name(r.toUserId), by: name(r.byUserId), note: r.note, createdAt: r.createdAt }));
}
