import { db } from "@/lib/db";
import { publish } from "@/lib/realtime/broker";
import { incrementUsage } from "@/lib/services/usage";
import { audit } from "@/lib/audit";
import { emitContactEvent, emitConversationCreated, emitMessageEvent } from "@/services/webhooks/events";
import { emitAutomationEvent } from "@/services/automations/events";


export type ChannelInbound = {
  identityKind: "email" | "visitor" | "instagram" | "messenger";
  identityValue: string;
  name: string;
  subject?: string;
  body: string;
  externalId: string;
  at: Date;
  payload?: Record<string, unknown>;
};

/** Contacts need a unique phone column; non-phone identities get a clearly-marked placeholder so they never look like a dialable number. */
function placeholderPhone(kind: string, value: string) {
  return `${kind}:${value}`.slice(0, 120);
}

async function contactFor(organizationId: string, kind: ChannelInbound["identityKind"], value: string, name: string) {
  const known = await db.contactIdentity.findUnique({ where: { organizationId_kind_value: { organizationId, kind, value } }, include: { contact: true } });
  const now = new Date();
  if (known) {
    return db.contact.update({ where: { id: known.contactId }, data: { lastInboundAt: now, lastMessageAt: now, ...(!known.contact.name && name ? { name } : {}) } });
  }
  const contact = await db.contact.create({
    data: { organizationId, phone: placeholderPhone(kind, value), name, email: kind === "email" ? value : "", source: kind, lastInboundAt: now, lastMessageAt: now, identities: { create: { organizationId, kind, value } } },
  });
  await incrementUsage(organizationId, "contacts_created");
  await audit({ action: "contact.created", organizationId, targetType: "contact", targetId: contact.id, metadata: { source: kind } });
  await emitAutomationEvent(organizationId, { type: "new_contact", contactId: contact.id, source: kind });
  await emitContactEvent("contact.created", organizationId, contact.id);
  return contact;
}

/** One inbound customer message on a non-WhatsApp inbox: finds/creates the contact + conversation, stores the message, notifies the team. Duplicate deliveries are ignored. */
export async function receiveChannelMessage(account: { id: string; organizationId: string; kind: string; status: string }, input: ChannelInbound) {
  const organizationId = account.organizationId;
  // Message ids are only unique per mailbox, so the stored id carries the inbox id.
  const externalId = `${account.id}:${input.externalId}`;
  if (await db.message.findUnique({ where: { externalId }, select: { id: true } })) return null;
  const contact = await contactFor(organizationId, input.identityKind, input.identityValue, input.name);
  const isDemo = account.status === "demo";
  const prev = (input.subject ? `${input.subject} — ${input.body}` : input.body).replace(/\s+/g, " ").slice(0, 140);
  const where = { channelAccountId_contactId_externalThreadId: { channelAccountId: account.id, contactId: contact.id, externalThreadId: "" } };
  const existing = await db.conversation.findUnique({ where });
  const conv = existing
    ? await db.conversation.update({
        where: { id: existing.id },
        data: { status: "open", unreadCount: { increment: 1 }, lastInboundAt: input.at, lastMessageAt: input.at, lastMessagePreview: prev, ...(input.subject ? { subject: input.subject.slice(0, 200) } : {}) },
      })
    : await db.conversation.create({
        data: { organizationId, contactId: contact.id, channel: account.kind, channelAccountId: account.id, subject: (input.subject ?? "").slice(0, 200), isDemo, unreadCount: 1, lastInboundAt: input.at, lastMessageAt: input.at, lastMessagePreview: prev },
      });
  const msg = await db.message.create({
    data: {
      organizationId,
      conversationId: conv.id,
      direction: "inbound",
      type: "text",
      body: input.body.slice(0, 20_000),
      payload: JSON.stringify({ channel: account.kind, subject: input.subject ?? "", ...(input.payload ?? {}) }),
      externalId,
      status: "received",
      isDemo,
      createdAt: input.at,
    },
  });
  publish(organizationId, { type: "message.created", conversationId: conv.id, messageId: msg.id, assignedToUserId: conv.assignedToUserId });
  publish(organizationId, { type: "conversation.updated", conversationId: conv.id, assignedToUserId: conv.assignedToUserId });
  if (!existing) await emitConversationCreated(organizationId, conv.id);
  await emitMessageEvent("message.received", msg.id);
  return { conversationId: conv.id, messageId: msg.id, contactId: contact.id };
}
