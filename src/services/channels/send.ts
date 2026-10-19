import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { publish } from "@/lib/realtime/broker";
import type { OrgAccess } from "@/lib/session";
import { assertBillingActive } from "@/services/billing/entitlements";
import { assertServiceEnabled } from "@/services/whatsapp/guards";
import { can, getVisibleConversation, toMessageDto } from "@/services/inbox/conversations";
import { emitMessageEvent } from "@/services/webhooks/events";
import { sendCustomerEmail } from "@/providers/email/resend";
import { decryptSecret } from "@/lib/crypto";
import { MetaApiError } from "@/providers/meta/graph";
import { sendSocialMessage } from "@/providers/meta/social";

const WINDOW_MS = 24 * 60 * 60 * 1000;
import type { SendInput } from "@/services/inbox/messaging";

const include = {
  attachments: true,
  sender: { select: { id: true, name: true, email: true } },
  replyTo: { select: { id: true, body: true, type: true, direction: true } },
} as const;

/** Replies on non-WhatsApp inboxes. Plain text only for now; same visibility, suppression and billing rules as WhatsApp. */
export async function sendChannelReply(access: OrgAccess, conversationId: string, input: SendInput, opts: { origin?: Record<string, unknown> } = {}) {
  if (!can(access, "inbox:reply")) throw new ApiError("FORBIDDEN");
  await assertServiceEnabled(access.organizationId, "OMNICHANNEL");
  const conv = await getVisibleConversation(access, conversationId);
  if (!can(access, "inbox:view_all") && conv.assignedToUserId !== access.user.id) throw new ApiError("FORBIDDEN", "Take this chat before replying.");
  if (input.type !== "text") throw new ApiError("VALIDATION_ERROR", `Only text replies are supported on ${conv.channel} chats right now.`);
  if (!conv.channelAccountId) throw new ApiError("CONFLICT", "This inbox is no longer connected.");
  const account = await db.channelAccount.findFirst({ where: { id: conv.channelAccountId, organizationId: conv.organizationId } });
  if (!account || account.status === "disabled") throw new ApiError("CONFLICT", "This inbox is disabled. Enable it in Channels.");
  const contact = await db.contact.findUniqueOrThrow({ where: { id: conv.contactId } });
  if (contact.suppressed) throw new ApiError("CONFLICT", "This contact is on the suppression list. Messages are blocked.");
  const social = account.kind === "messenger" || account.kind === "instagram";
  if (social && (!conv.lastInboundAt || Date.now() - conv.lastInboundAt.getTime() >= WINDOW_MS)) {
    throw new ApiError("CONFLICT", "The 24-hour reply window is closed. You can answer again when the customer writes to you.");
  }
  await assertBillingActive(conv.organizationId);

  const isDemo = account.status === "demo";
  const msg = await db.message.create({
    data: {
      organizationId: conv.organizationId,
      conversationId,
      direction: "outbound",
      type: "text",
      body: input.body,
      payload: JSON.stringify({ channel: account.kind, subject: conv.subject, ...(opts.origin ?? {}) }),
      status: "pending",
      senderUserId: access.user.id,
      isDemo,
    },
  });
  const now = new Date();
  await db.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: now, lastMessagePreview: input.body.replace(/\s+/g, " ").slice(0, 140), status: "open" } });
  await db.contact.update({ where: { id: contact.id }, data: { lastMessageAt: now } });

  if (isDemo) {
    // Demo inbox: nothing leaves MECGURA.
    await db.message.update({ where: { id: msg.id }, data: { status: "sent", externalId: `demo.${randomUUID()}`, sentAt: now } });
  } else if (account.kind === "email") {
    if (!contact.email) {
      await db.message.update({ where: { id: msg.id }, data: { status: "failed", failedAt: now, error: "This contact has no email address." } });
    } else {
      const lastIn = await db.message.findFirst({ where: { conversationId, direction: "inbound" }, orderBy: { createdAt: "desc" }, select: { externalId: true } });
      const r = await sendCustomerEmail({
        fromName: account.name,
        fromAddress: account.address,
        to: contact.email,
        subject: conv.subject ? (/^re:/i.test(conv.subject) ? conv.subject : `Re: ${conv.subject}`) : `Message from ${account.name}`,
        text: input.body,
        inReplyTo: lastIn?.externalId?.startsWith(`${account.id}:<`) ? lastIn.externalId.slice(account.id.length + 1) : undefined,
      });
      await db.message.update({
        where: { id: msg.id },
        data: r.ok ? { status: "sent", externalId: r.id, sentAt: now } : { status: "failed", failedAt: now, error: r.error },
      });
    }
  } else if (social) {
    try {
      const ident = await db.contactIdentity.findFirst({ where: { contactId: contact.id, kind: account.kind } });
      if (!ident || !account.encryptedToken) throw new Error("not connected");
      const id = await sendSocialMessage(decryptSecret(account.encryptedToken), ident.value, input.body);
      await db.message.update({ where: { id: msg.id }, data: { status: "sent", externalId: id ? `${account.id}:${id}` : `${account.id}:out.${randomUUID()}`, sentAt: now } });
    } catch (e) {
      const error = e instanceof MetaApiError ? e.message : "Sending failed.";
      await db.message.update({ where: { id: msg.id }, data: { status: "failed", failedAt: now, error: error.slice(0, 500) } });
    }
  } else if (account.kind === "webchat") {
    // Delivered to the visitor's widget the next time it polls.
    await db.message.update({ where: { id: msg.id }, data: { status: "sent", externalId: `wc.out.${randomUUID()}`, sentAt: now } });
  } else {
    await db.message.update({ where: { id: msg.id }, data: { status: "failed", failedAt: now, error: "This channel can't send yet." } });
  }
  publish(conv.organizationId, { type: "message.created", conversationId, messageId: msg.id, assignedToUserId: conv.assignedToUserId });
  const final = await db.message.findUniqueOrThrow({ where: { id: msg.id }, include });
  await emitMessageEvent(final.status === "sent" ? "message.sent" : "message.failed", msg.id);
  return toMessageDto(final);
}
