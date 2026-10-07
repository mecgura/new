import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { decryptSecret } from "@/lib/crypto";
import { publish } from "@/lib/realtime/broker";
import { currentPlan, monthTotal } from "@/lib/services/usage";
import { wouldExceed } from "@/lib/plans";
import { assertBillingActive } from "@/services/billing/entitlements";
import type { OrgAccess } from "@/lib/session";
import { MetaApiError } from "@/providers/meta/graph";
import { downloadMedia, sendMessage as metaSend, uploadMedia, type OutboundPayload } from "@/providers/meta/messages";
import { can, getVisibleConversation, toMessageDto, visibilityWhere } from "@/services/inbox/conversations";
import { normalizePhone, recordConsent, upsertInboundContact } from "@/services/inbox/contacts";
import { paramProblem, renderTemplate, templateSlots, toSendComponents, type SlotValues } from "@/lib/templates";
import { requireApprovedTemplate, toDef } from "@/services/templates/templates";
import { attributeInbound, syncRecipientStatus } from "@/services/campaigns/attribution";
import { emitAutomationEvent } from "@/services/automations/events";
import { runAfterResponse } from "@/lib/background";
import { emitConversationCreated, emitMessageEvent } from "@/services/webhooks/events";

export const WINDOW_MS = 24 * 60 * 60 * 1000;
const STATUS_RANK: Record<string, number> = { pending: 0, sent: 1, delivered: 2, read: 3 };
const OPT_OUT = /^(stop|unsubscribe|stop all|stop promotions|opt out|optout)$/i;
const OPT_IN = /^(start|subscribe|unstop|opt in|optin)$/i;

export type MediaKind = "image" | "video" | "audio" | "document";

export type SendInput =
  | { type: "text"; body: string; replyToId?: string }
  | { type: "template"; templateId: string; values: SlotValues; replyToId?: string }
  | { type: "flow"; flowId: string; body?: string; replyToId?: string }
  | { type: "interactive"; body: string; buttons: { id: string; title: string }[]; replyToId?: string }
  | { type: MediaKind; link: string; caption?: string; filename?: string; replyToId?: string };

const messageInclude = {
  attachments: true,
  sender: { select: { id: true, name: true, email: true } },
  replyTo: { select: { id: true, body: true, type: true, direction: true } },
} as const;

async function loadDto(id: string) {
  return toMessageDto(await db.message.findUniqueOrThrow({ where: { id }, include: messageInclude }));
}

export function preview(type: string, body: string) {
  const labels: Record<string, string> = { image: "📷 Photo", video: "🎬 Video", audio: "🎙️ Audio", document: "📄 Document", template: "Template", interactive: "Buttons", button: "Button reply" };
  return (body ? body : labels[type] ?? type).slice(0, 140);
}

// ---------------------------------------------------------------------------
// Outbound
// ---------------------------------------------------------------------------

/** All business rules that must pass before anything is sent to WhatsApp. */
async function preflight(access: OrgAccess, conversationId: string, kind: "template" | "session") {
  if (!can(access, "inbox:reply")) throw new ApiError("FORBIDDEN");
  const conv = await getVisibleConversation(access, conversationId);
  if (!can(access, "inbox:view_all") && conv.assignedToUserId !== access.user.id) {
    throw new ApiError("FORBIDDEN", "Take this chat before replying.");
  }
  const account = await db.whatsAppAccount.findUniqueOrThrow({
    where: { id: conv.whatsappAccountId },
    include: { connection: { select: { encryptedAccessToken: true, status: true } } },
  });
  if (account.status !== "connected" && account.status !== "demo") {
    throw new ApiError("CONFLICT", "This WhatsApp number is not connected. Reconnect it in the Connection Center.");
  }
  const contact = await db.contact.findUniqueOrThrow({ where: { id: conv.contactId } });
  if (contact.suppressed) throw new ApiError("CONFLICT", "This contact is on the suppression list. Messages are blocked.");
  if (contact.optInStatus === "opted_out") throw new ApiError("CONFLICT", "This contact opted out of WhatsApp messages.");
  const windowOpen = conv.lastInboundAt && Date.now() - conv.lastInboundAt.getTime() < WINDOW_MS;
  if (kind === "session" && !windowOpen) {
    throw new ApiError("CONFLICT", "The 24-hour reply window is closed. Send an approved template to restart the conversation.");
  }
  await assertBillingActive(conv.organizationId);
  const sub = await currentPlan(conv.organizationId);
  if (sub && !account.isDemo && wouldExceed(await monthTotal(conv.organizationId, "messages_sent"), sub.plan.maxMonthlyMessages)) {
    throw new ApiError("CONFLICT", `Your ${sub.plan.name} plan's monthly message limit is reached.`);
  }
  return { conv, account, contact };
}

type ResolvedTemplate = Awaited<ReturnType<typeof requireApprovedTemplate>>;

/** Approved template + values → Cloud API payload, readable text for the inbox, and stored metadata. */
export function templateMessage(t: ResolvedTemplate, values: SlotValues): { payload: OutboundPayload; body: string; stored: Record<string, unknown> } {
  const def = toDef(t);
  const components = toSendComponents(def, values);
  const text = renderTemplate(def, values);
  return {
    payload: { type: "template", template: { name: t.name, language: { code: t.language }, ...(components.length ? { components } : {}) } },
    body: [text.header, text.body].filter(Boolean).join("\n\n").slice(0, 4096),
    stored: {
      templateId: t.id,
      templateName: t.name,
      language: t.language,
      category: t.category,
      footer: text.footer,
      buttons: def.category === "AUTHENTICATION" ? [{ title: def.authOptions.buttonText }] : def.buttons.map((b) => ({ title: b.text })),
      headerMedia: def.headerType !== "none" && def.headerType !== "text" ? { type: def.headerType, link: values.header ?? "" } : undefined,
    },
  };
}

/** Every slot needs a valid value (WhatsApp rejects empty/multi-line params). */
export function assertTemplateValues(t: ResolvedTemplate, values: SlotValues) {
  const details: Record<string, string[]> = {};
  for (const slot of templateSlots(toDef(t))) {
    const problem = paramProblem(values[slot.key] ?? "", slot.part === "header" && slot.kind === "media" ? "media" : "text");
    if (problem) details[`values.${slot.key}`] = [`${slot.label} ${problem}`];
  }
  if (Object.keys(details).length) throw new ApiError("VALIDATION_ERROR", "Fill in every template variable.", { details });
}

export function toPayload(input: Exclude<SendInput, { type: "template" } | { type: "flow" }>, mediaId?: string): { payload: OutboundPayload; body: string; stored: Record<string, unknown> } {
  switch (input.type) {
    case "text":
      return { payload: { type: "text", text: { body: input.body, preview_url: /https?:\/\//.test(input.body) } }, body: input.body, stored: {} };
    case "interactive":
      return {
        payload: { type: "interactive", interactive: { type: "button", body: { text: input.body }, action: { buttons: input.buttons.map((b) => ({ type: "reply", reply: b })) } } },
        body: input.body,
        stored: { buttons: input.buttons },
      };
    default: {
      const ref = { ...(mediaId ? { id: mediaId } : { link: input.link }), ...(input.caption ? { caption: input.caption } : {}), ...(input.type === "document" && input.filename ? { filename: input.filename } : {}) };
      return { payload: { type: input.type, [input.type]: ref } as OutboundPayload, body: input.caption ?? "", stored: {} };
    }
  }
}

/** Sends one stored message and reports it to webhook subscribers (message.sent / message.failed). */
export async function transmit(messageId: string, account: Parameters<typeof transmitInner>[1], to: string, payload: OutboundPayload, replyToExternalId: string | undefined) {
  const result = await transmitInner(messageId, account, to, payload, replyToExternalId);
  await emitMessageEvent(result.status === "sent" ? "message.sent" : "message.failed", messageId);
  return result;
}

async function transmitInner(
  messageId: string,
  account: { isDemo: boolean; phoneNumberId: string; connection: { encryptedAccessToken: string } | null },
  to: string,
  payload: OutboundPayload,
  replyToExternalId: string | undefined
) {
  const now = new Date();
  if (account.isDemo) {
    // Demo transport: nothing leaves MECGURA. Delivery/read are simulated explicitly from the UI.
    return db.message.update({ where: { id: messageId }, data: { status: "sent", externalId: `demo.${randomUUID()}`, sentAt: now } });
  }
  const token = account.connection?.encryptedAccessToken ? decryptSecret(account.connection.encryptedAccessToken) : null;
  if (!token || !account.phoneNumberId) {
    return db.message.update({ where: { id: messageId }, data: { status: "failed", failedAt: now, error: "No active credentials for this number." } });
  }
  try {
    const { externalId } = await metaSend(account.phoneNumberId, token, to, payload, replyToExternalId);
    // "sent" here means accepted by Meta; delivered/read arrive via webhook.
    return db.message.update({ where: { id: messageId }, data: { status: "sent", externalId, sentAt: now } });
  } catch (e) {
    const error = e instanceof MetaApiError ? e.message : "Sending failed.";
    // Network errors, rate limits and Meta 5xx are worth retrying; 4xx (bad number, policy) are not.
    const retryable = !(e instanceof MetaApiError) || e.status === 0 || e.status === 429 || e.status >= 500;
    return { ...(await db.message.update({ where: { id: messageId }, data: { status: "failed", failedAt: now, error: error.slice(0, 500) } })), retryable };
  }
}

/** `opts.origin` marks messages sent by software (the public API) rather than a teammate: it is stored with the message and does not make the AI agent step back. */
export async function sendMessage(access: OrgAccess, conversationId: string, input: SendInput, upload?: { file: Blob; filename: string; mimeType: string; size: number }, opts: { origin?: Record<string, unknown> } = {}) {
  const { conv, account, contact } = await preflight(access, conversationId, input.type === "template" ? "template" : "session");
  const replyTo = input.replyToId ? await db.message.findFirst({ where: { id: input.replyToId, conversationId } }) : null;
  if (input.replyToId && !replyTo) throw new ApiError("VALIDATION_ERROR", "The message you're replying to isn't in this conversation.");

  let mediaId: string | undefined;
  if (upload && !account.isDemo) {
    const token = account.connection?.encryptedAccessToken ? decryptSecret(account.connection.encryptedAccessToken) : null;
    if (!token) throw new ApiError("CONFLICT", "No active credentials for this number.");
    try {
      mediaId = await uploadMedia(account.phoneNumberId, token, upload.file, upload.filename, upload.mimeType);
    } catch (e) {
      throw new ApiError("VALIDATION_ERROR", e instanceof MetaApiError ? `Meta rejected the file: ${e.message}` : "Upload failed.");
    }
  }
  let built;
  if (input.type === "template") {
    const t = await requireApprovedTemplate(conv.organizationId, account.wabaRecordId, { templateId: input.templateId });
    assertTemplateValues(t, input.values);
    built = templateMessage(t, input.values);
  } else if (input.type === "flow") {
    built = await flowMessage(conv.organizationId, account, input.flowId, input.body);
  } else {
    built = toPayload(input, mediaId);
  }
  const { payload, body, stored } = built;
  const isMedia = input.type === "image" || input.type === "video" || input.type === "audio" || input.type === "document";

  const msg = await db.message.create({
    data: {
      organizationId: conv.organizationId,
      conversationId,
      direction: "outbound",
      type: input.type,
      body,
      payload: JSON.stringify({ ...stored, ...(opts.origin ?? {}) }),
      status: "pending",
      replyToId: replyTo?.id ?? null,
      senderUserId: access.user.id,
      isDemo: account.isDemo,
      ...(isMedia
        ? {
            attachments: {
              create: {
                kind: input.type,
                mimeType: upload?.mimeType ?? "",
                filename: upload?.filename ?? (input as { filename?: string }).filename ?? "",
                sizeBytes: upload?.size ?? 0,
                providerMediaId: mediaId ?? "",
                url: upload ? "" : (input as { link: string }).link,
                caption: (input as { caption?: string }).caption ?? "",
              },
            },
          }
        : {}),
    },
  });
  const now = new Date();
  await db.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: now, lastMessagePreview: preview(input.type, body), status: "open" } });
  await db.contact.update({ where: { id: contact.id }, data: { lastMessageAt: now } });
  const sent = await transmit(msg.id, { isDemo: account.isDemo, phoneNumberId: account.phoneNumberId, connection: account.connection }, contact.phone, payload, replyTo?.externalId ?? undefined);
  if (account.isDemo && sent.status === "sent" && account.phoneRecordId) {
    await db.phoneNumber.update({ where: { id: account.phoneRecordId }, data: { messagesSent: { increment: 1 } } });
  }
  publish(conv.organizationId, { type: "message.created", conversationId, messageId: msg.id, assignedToUserId: conv.assignedToUserId });
  // A teammate is talking to the customer: the AI agent steps back.
  if (opts.origin) return loadDto(msg.id);
  const { onHumanReply } = await import("@/services/ai/engine");
  await onHumanReply(conv.organizationId, conversationId, access.user.name ?? access.user.email).catch((e) => console.error("[ai] human reply hook failed:", e));
  return loadDto(msg.id);
}

export async function addInternalNote(access: OrgAccess, conversationId: string, body: string) {
  if (!can(access, "inbox:note")) throw new ApiError("FORBIDDEN");
  const conv = await getVisibleConversation(access, conversationId);
  const msg = await db.message.create({
    data: { organizationId: conv.organizationId, conversationId, direction: "internal", type: "note", body, status: "received", senderUserId: access.user.id, isDemo: conv.isDemo },
  });
  publish(conv.organizationId, { type: "message.created", conversationId, messageId: msg.id, assignedToUserId: conv.assignedToUserId });
  return loadDto(msg.id);
}

/** Starts (or reopens) the thread between a contact and one of the org's numbers. */
export async function startConversation(access: OrgAccess, contactId: string, whatsappAccountId: string) {
  if (!can(access, "inbox:reply")) throw new ApiError("FORBIDDEN");
  const [contact, account] = await Promise.all([
    db.contact.findFirst({ where: { id: contactId, organizationId: access.organizationId } }),
    db.whatsAppAccount.findFirst({ where: { id: whatsappAccountId, organizationId: access.organizationId, status: { in: ["connected", "demo"] } } }),
  ]);
  if (!contact) throw new ApiError("NOT_FOUND", "Contact not found.");
  if (!account) throw new ApiError("VALIDATION_ERROR", "Choose a connected WhatsApp number.", { details: { whatsappAccountId: ["Not connected"] } });
  const existing = await db.conversation.findUnique({ where: { whatsappAccountId_contactId: { whatsappAccountId, contactId } } });
  if (existing) {
    const visible = await db.conversation.findFirst({ where: { id: existing.id, ...visibilityWhere(access) } });
    if (!visible) throw new ApiError("FORBIDDEN", "This conversation is assigned to a teammate.");
    return existing.id;
  }
  const conv = await db.conversation.create({
    data: {
      organizationId: access.organizationId,
      contactId,
      whatsappAccountId,
      isDemo: account.isDemo,
      // Agents own the threads they start; managers start them unassigned.
      assignedToUserId: can(access, "inbox:view_all") ? null : access.user.id,
      lastMessagePreview: "",
    },
  });
  await emitConversationCreated(access.organizationId, conv.id);
  publish(access.organizationId, { type: "conversation.updated", conversationId: conv.id, assignedToUserId: conv.assignedToUserId });
  return conv.id;
}

/** Published Flow → interactive "flow" message with a token that ties the answers back to it. */
async function flowMessage(organizationId: string, account: { isDemo: boolean; wabaRecordId: string | null }, flowId: string, bodyOverride?: string) {
  const flow = await db.flow.findFirst({ where: { id: flowId, organizationId } });
  if (!flow) throw new ApiError("VALIDATION_ERROR", "Flow not found.", { details: { flowId: ["Unknown flow"] } });
  if (flow.status !== "published") throw new ApiError("CONFLICT", "Only published Flows can be sent.");
  if (flow.wabaRecordId !== account.wabaRecordId) throw new ApiError("VALIDATION_ERROR", "This Flow belongs to a different WhatsApp account.");
  const def = JSON.parse(flow.definition) as { start?: { cta?: string; body?: string } };
  const cta = (def.start?.cta || "Open form").slice(0, 20);
  const text = (bodyOverride?.trim() || def.start?.body || flow.name).slice(0, 1024);
  const flowToken = `mf.${flow.id}.${randomUUID().slice(0, 8)}`;
  return {
    payload: {
      type: "interactive",
      interactive: {
        type: "flow",
        body: { text },
        action: {
          name: "flow",
          parameters: { flow_message_version: "3", flow_token: flowToken, flow_id: flow.metaFlowId, flow_cta: cta, flow_action: "navigate", flow_action_payload: { screen: "SCREEN_A" } },
        },
      },
    } as OutboundPayload,
    body: text,
    stored: { flowId: flow.id, flowName: flow.name, flowToken, buttons: [{ title: `📋 ${cta}` }] },
  };
}

export class SystemSendError extends Error {
  constructor(
    message: string,
    readonly retryable = false
  ) {
    super(message);
  }
}

/**
 * Sends a text (optionally with reply buttons) from MECGURA itself — flow
 * thank-you notes, AI replies. Same rules as people: consent, suppression and
 * the 24-hour window. The message shows in the inbox with its origin.
 */
export async function sendSystemText(organizationId: string, conversationId: string, text: string, origin: Record<string, unknown>, buttons: string[] = []) {
  const conv = await db.conversation.findFirst({
    where: { id: conversationId, organizationId },
    include: { contact: true, whatsappAccount: { include: { connection: { select: { encryptedAccessToken: true } } } } },
  });
  if (!conv) throw new SystemSendError("Conversation not found.");
  const acct = conv.whatsappAccount;
  if (acct.status !== "connected" && acct.status !== "demo") throw new SystemSendError("The WhatsApp number is disconnected.");
  if (conv.contact.optInStatus === "opted_out" || conv.contact.suppressed) throw new SystemSendError("The contact opted out or is suppressed — not messaged.");
  if (!conv.lastInboundAt || Date.now() - conv.lastInboundAt.getTime() >= WINDOW_MS) throw new SystemSendError("The 24-hour window is closed.");
  const input = buttons.length ? ({ type: "interactive", body: text.slice(0, 1024), buttons: buttons.slice(0, 3).map((b, i) => ({ id: `btn_${i + 1}`, title: b.slice(0, 20) })) } as const) : ({ type: "text", body: text.slice(0, 4096) } as const);
  const { payload, body, stored } = toPayload(input);
  const msg = await db.message.create({
    data: { organizationId, conversationId, direction: "outbound", type: input.type, body, payload: JSON.stringify({ ...stored, ...origin }), status: "pending", isDemo: acct.isDemo },
  });
  const now = new Date();
  await db.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: now, lastMessagePreview: preview(input.type, body) } });
  const sent = await transmit(msg.id, { isDemo: acct.isDemo, phoneNumberId: acct.phoneNumberId, connection: acct.connection }, conv.contact.phone, payload, undefined);
  publish(organizationId, { type: "message.created", conversationId, messageId: msg.id, assignedToUserId: conv.assignedToUserId });
  if (sent.status !== "sent") throw new SystemSendError(sent.error || "Sending failed.", "retryable" in sent && Boolean(sent.retryable));
  if (acct.isDemo && acct.phoneRecordId) await db.phoneNumber.update({ where: { id: acct.phoneRecordId }, data: { messagesSent: { increment: 1 } } });
  return msg.id;
}

// ---------------------------------------------------------------------------
// Inbound + delivery states (used by the Meta webhook and the demo simulator)
// ---------------------------------------------------------------------------

export type InboundInput = {
  externalId: string;
  fromPhone: string; // E.164
  profileName: string;
  type: string;
  body: string;
  payload?: Record<string, unknown>;
  attachments?: { kind: MediaKind; mimeType: string; filename: string; providerMediaId: string; sha256: string; caption: string }[];
  replyToExternalId?: string;
  at: Date;
  isDemo: boolean;
};

export async function receiveInbound(organizationId: string, whatsappAccountId: string, input: InboundInput) {
  if (await db.message.findUnique({ where: { externalId: input.externalId }, select: { id: true } })) return null; // duplicate delivery
  const contact = await upsertInboundContact(organizationId, input.fromPhone, input.profileName);
  const existing = await db.conversation.findUnique({ where: { whatsappAccountId_contactId: { whatsappAccountId, contactId: contact.id } } });
  const prev = preview(input.type, input.body);
  const conv = existing
    ? await db.conversation.update({
        where: { id: existing.id },
        data: { status: "open", unreadCount: { increment: 1 }, lastInboundAt: input.at, lastMessageAt: input.at, lastMessagePreview: prev },
      })
    : await db.conversation.create({
        data: { organizationId, contactId: contact.id, whatsappAccountId, isDemo: input.isDemo, unreadCount: 1, lastInboundAt: input.at, lastMessageAt: input.at, lastMessagePreview: prev },
      });
  const replyTo = input.replyToExternalId ? await db.message.findFirst({ where: { externalId: input.replyToExternalId, conversationId: conv.id }, select: { id: true, type: true, payload: true } }) : null;
  const msg = await db.message.create({
    data: {
      organizationId,
      conversationId: conv.id,
      direction: "inbound",
      type: input.type,
      body: input.body.slice(0, 4096),
      payload: JSON.stringify(input.payload ?? {}),
      externalId: input.externalId,
      status: "received",
      isDemo: input.isDemo,
      replyToId: replyTo?.id ?? null,
      createdAt: input.at,
      ...(input.attachments?.length ? { attachments: { create: input.attachments } } : {}),
    },
  });
  // Consent keywords (WhatsApp best practice): STOP opts out, START opts back in.
  const text = input.type === "text" || input.type === "button" ? input.body.trim() : "";
  const optOut = OPT_OUT.test(text);
  await attributeInbound(organizationId, contact.id, replyTo?.id ?? null, input.at, optOut);
  if (optOut && contact.optInStatus !== "opted_out") {
    await recordConsent({ organizationId, actorUserId: null }, contact.id, { status: "opted_out", source: "inbound_keyword", evidence: `Customer sent “${text}”` });
  } else if (OPT_IN.test(text) && contact.optInStatus !== "opted_in") {
    await recordConsent({ organizationId, actorUserId: null }, contact.id, { status: "opted_in", source: "inbound_keyword", evidence: `Customer sent “${text}”` });
  }
  publish(organizationId, { type: "message.created", conversationId: conv.id, messageId: msg.id, assignedToUserId: conv.assignedToUserId });
  publish(organizationId, { type: "conversation.updated", conversationId: conv.id, assignedToUserId: conv.assignedToUserId });
  if (!existing) await emitConversationCreated(organizationId, conv.id);
  await emitMessageEvent("message.received", msg.id);
  if (input.type === "flow") {
    // WhatsApp Flow answers: store the submission and run the Flow's CRM action.
    try {
      const { flowForReply, processSubmission } = await import("@/services/flows/flows");
      const p = (input.payload ?? {}) as { flowName?: string; response?: Record<string, unknown> };
      const match = await flowForReply(organizationId, p.response ?? {}, p.flowName ?? "");
      if (match) {
        await processSubmission({ flow: match.flow, contactId: contact.id, conversationId: conv.id, messageId: msg.id, raw: p.response ?? {}, source: input.isDemo ? "demo" : "whatsapp", flowToken: match.token });
      }
    } catch (e) {
      console.error("[flows] submission failed:", e);
    }
  }
  const quotedTemplate = replyTo?.type === "template" ? ((JSON.parse(replyTo.payload || "{}") as { templateId?: string }).templateId ?? null) : null;
  const automationHandled = await emitAutomationEvent(organizationId, {
    type: "inbound",
    contactId: contact.id,
    conversationId: conv.id,
    whatsappAccountId,
    messageId: msg.id,
    text: input.body,
    messageType: input.type,
    replyToTemplateId: quotedTemplate,
    flowName: input.type === "flow" ? String((input.payload as { flowName?: string } | undefined)?.flowName ?? "") : null,
    optOut,
  });
  // AI agent: answers after the response is sent (the webhook must not wait on the model).
  const aiInput = { conversationId: conv.id, contactId: contact.id, whatsappAccountId, messageId: msg.id, type: input.type, text: input.body, optOut, automationHandled };
  runAfterResponse(async () => {
    const { handleInboundForAi } = await import("@/services/ai/engine");
    await handleInboundForAi(organizationId, aiInput);
  });
  return { conversationId: conv.id, messageId: msg.id, contactId: contact.id };
}

/** Applies a delivery receipt. States only move forward (sent → delivered → read); failed is terminal. */
export async function applyStatusUpdate(organizationId: string, externalId: string, status: string, error = "", at = new Date()) {
  const msg = await db.message.findFirst({ where: { externalId, organizationId }, include: { conversation: { select: { assignedToUserId: true } } } });
  if (!msg) return false;
  if (status === "failed") {
    if (msg.status === "read") return true;
    await db.message.update({ where: { id: msg.id }, data: { status: "failed", failedAt: at, error: error.slice(0, 500) } });
  } else {
    if (!(status in STATUS_RANK) || (STATUS_RANK[status] ?? 0) <= (STATUS_RANK[msg.status] ?? -1) || msg.status === "failed") return true;
    await db.message.update({
      where: { id: msg.id },
      data: { status, ...(status === "sent" ? { sentAt: msg.sentAt ?? at } : {}), ...(status === "delivered" ? { deliveredAt: at } : {}), ...(status === "read" ? { readAt: at, deliveredAt: msg.deliveredAt ?? at } : {}) },
    });
  }
  await syncRecipientStatus(msg.id, status, at, error);
  publish(organizationId, { type: "message.status", conversationId: msg.conversationId, messageId: msg.id, status, assignedToUserId: msg.conversation.assignedToUserId });
  const hook = ({ sent: "message.sent", delivered: "message.delivered", read: "message.read", failed: "message.failed" } as const)[status as "sent"];
  if (hook) await emitMessageEvent(hook, msg.id);
  return true;
}

/** Meta inbound message object → InboundInput. Unsupported types are kept with a readable summary. */
export function fromMetaMessage(raw: Record<string, unknown>, from: string, profileName: string): Omit<InboundInput, "isDemo"> {
  const type = String(raw.type ?? "unsupported");
  const at = raw.timestamp ? new Date(Number(raw.timestamp) * 1000) : new Date();
  const base = { externalId: String(raw.id), fromPhone: normalizePhone(from) ?? `+${from}`, profileName, at, replyToExternalId: (raw.context as { id?: string } | undefined)?.id };
  const obj = (raw[type] ?? {}) as Record<string, unknown>;
  if (type === "text") return { ...base, type: "text", body: String((obj as { body?: string }).body ?? "") };
  if (type === "image" || type === "video" || type === "audio" || type === "document" || type === "sticker") {
    const kind: MediaKind = type === "sticker" ? "image" : type;
    return {
      ...base,
      type: kind,
      body: String(obj.caption ?? ""),
      attachments: [{ kind, mimeType: String(obj.mime_type ?? ""), filename: String(obj.filename ?? ""), providerMediaId: String(obj.id ?? ""), sha256: String(obj.sha256 ?? ""), caption: String(obj.caption ?? "") }],
    };
  }
  if (type === "button") return { ...base, type: "button", body: String(obj.text ?? ""), payload: { payload: obj.payload } };
  if (type === "interactive" && obj.type === "nfm_reply") {
    // WhatsApp Flow submission: keep the submitted fields for automations.
    const nfm = (obj.nfm_reply ?? {}) as { name?: string; response_json?: string; body?: string };
    let response: unknown = {};
    try {
      response = JSON.parse(nfm.response_json ?? "{}");
    } catch {
      /* keep empty */
    }
    return { ...base, type: "flow", body: nfm.body || "Form submitted", payload: { flowName: nfm.name ?? "", response } };
  }
  if (type === "interactive") {
    const reply = (obj.button_reply ?? obj.list_reply ?? {}) as { id?: string; title?: string };
    return { ...base, type: "button", body: String(reply.title ?? ""), payload: { id: reply.id } };
  }
  return { ...base, type: "unsupported", body: `Unsupported message type: ${type}` };
}

// ---------------------------------------------------------------------------
// Media proxy
// ---------------------------------------------------------------------------

/** Streams an inbound/outbound attachment from Meta to an authorized viewer (nothing is stored). */
export async function openAttachment(access: OrgAccess, attachmentId: string) {
  const att = await db.messageAttachment.findUnique({ where: { id: attachmentId }, include: { message: { select: { conversationId: true, organizationId: true, isDemo: true } } } });
  if (!att || att.message.organizationId !== access.organizationId) throw new ApiError("NOT_FOUND", "Attachment not found.");
  const conv = await getVisibleConversation(access, att.message.conversationId);
  if (att.message.isDemo || !att.providerMediaId) throw new ApiError("NOT_FOUND", "This attachment isn't stored (demo or sent by link).");
  const account = await db.whatsAppAccount.findUniqueOrThrow({ where: { id: conv.whatsappAccountId }, include: { connection: { select: { encryptedAccessToken: true } } } });
  if (!account.connection?.encryptedAccessToken) throw new ApiError("CONFLICT", "The number is disconnected; media can't be fetched.");
  try {
    const media = await downloadMedia(att.providerMediaId, decryptSecret(account.connection.encryptedAccessToken));
    return { ...media, filename: att.filename || `${att.kind}-${att.id}` };
  } catch (e) {
    throw new ApiError("NOT_FOUND", e instanceof MetaApiError ? e.message : "Media unavailable.");
  }
}

// ---------------------------------------------------------------------------
// Demo simulator (demo numbers only)
// ---------------------------------------------------------------------------

export async function simulateInbound(access: OrgAccess, input: { whatsappAccountId: string; phone: string; name: string; body: string; type: "text" | MediaKind }) {
  if (!can(access, "inbox:reply")) throw new ApiError("FORBIDDEN");
  const account = await db.whatsAppAccount.findFirst({ where: { id: input.whatsappAccountId, organizationId: access.organizationId, status: "demo", isDemo: true } });
  if (!account) throw new ApiError("VALIDATION_ERROR", "Customer messages can only be simulated on demo numbers.", { details: { whatsappAccountId: ["Not a demo number"] } });
  const phone = normalizePhone(input.phone);
  if (!phone) throw new ApiError("VALIDATION_ERROR", "Enter a valid phone number.", { details: { phone: ["Invalid number"] } });
  const media = input.type !== "text";
  const r = await receiveInbound(access.organizationId, account.id, {
    externalId: `demo.in.${randomUUID()}`,
    fromPhone: phone,
    profileName: input.name,
    type: input.type,
    body: input.body,
    at: new Date(),
    isDemo: true,
    ...(media ? { attachments: [{ kind: input.type as MediaKind, mimeType: "", filename: `demo-${input.type}`, providerMediaId: "", sha256: "", caption: input.body }] } : {}),
  });
  if (account.phoneRecordId) await db.phoneNumber.update({ where: { id: account.phoneRecordId }, data: { messagesReceived: { increment: 1 } } });
  return r!;
}

export async function simulateStatus(access: OrgAccess, messageId: string, status: "delivered" | "read" | "failed") {
  const msg = await db.message.findFirst({ where: { id: messageId, organizationId: access.organizationId, direction: "outbound", isDemo: true } });
  if (!msg?.externalId) throw new ApiError("NOT_FOUND", "Demo message not found.");
  await getVisibleConversation(access, msg.conversationId);
  await applyStatusUpdate(access.organizationId, msg.externalId, status, status === "failed" ? "Simulated failure (demo)" : "");
  return loadDto(msg.id);
}
