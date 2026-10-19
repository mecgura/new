import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { receiveChannelMessage } from "@/services/channels/inbound";

export const VISITOR_ID = /^[A-Za-z0-9_-]{24,64}$/;
const KEY = /^[a-f0-9]{48}$/;

export async function webchatAccount(key: string) {
  if (!KEY.test(key)) return null;
  const a = await db.channelAccount.findUnique({ where: { publicKey: key } });
  return a && a.kind === "webchat" && a.status !== "disabled" ? a : null;
}

export function widgetConfig(a: { name: string; settings: string }) {
  let s: Record<string, unknown> = {};
  try {
    s = JSON.parse(a.settings) as Record<string, unknown>;
  } catch {
    /* defaults */
  }
  const color = typeof s.color === "string" && /^#[0-9a-fA-F]{6}$/.test(s.color) ? s.color : "#0f766e";
  return { name: a.name, greeting: typeof s.greeting === "string" && s.greeting ? s.greeting.slice(0, 300) : "Hi! How can we help you?", color };
}

/** A visitor's message from the embedded widget. The visitor id is an unguessable random token that also serves as the read key for their own thread. */
export async function visitorSend(account: NonNullable<Awaited<ReturnType<typeof webchatAccount>>>, visitorId: string, name: string, text: string) {
  return receiveChannelMessage(account, {
    identityKind: "visitor",
    identityValue: visitorId,
    name: name || `Website visitor ${visitorId.slice(-4)}`,
    subject: "",
    body: text,
    externalId: `wc.in.${randomUUID()}`,
    at: new Date(),
  });
}

/** Team replies for one visitor (never internal notes), oldest first. */
export async function visitorMessages(account: { id: string; organizationId: string }, visitorId: string, since: Date | null) {
  const identity = await db.contactIdentity.findUnique({ where: { organizationId_kind_value: { organizationId: account.organizationId, kind: "visitor", value: visitorId } } });
  if (!identity) return [];
  const conv = await db.conversation.findUnique({ where: { channelAccountId_contactId_externalThreadId: { channelAccountId: account.id, contactId: identity.contactId, externalThreadId: "" } }, select: { id: true } });
  if (!conv) return [];
  const rows = await db.message.findMany({
    where: { conversationId: conv.id, direction: "outbound", status: { not: "failed" }, ...(since ? { createdAt: { gt: since } } : {}) },
    orderBy: { createdAt: "asc" },
    take: 50,
    select: { id: true, body: true, createdAt: true },
  });
  return rows.map((m) => ({ id: m.id, text: m.body, at: m.createdAt.toISOString() }));
}

export async function visitorKnown(account: { organizationId: string }, visitorId: string) {
  return Boolean(await db.contactIdentity.findUnique({ where: { organizationId_kind_value: { organizationId: account.organizationId, kind: "visitor", value: visitorId } }, select: { id: true } }));
}
