import { db } from "@/lib/db";
import { emitWebhook, hasSubscribers } from "@/services/webhooks/delivery";
import type { WebhookEvent } from "@/lib/webhook-events";

/**
 * Event builders. Each one first checks (cheaply, cached) that someone listens, so the message / CRM hot paths
 * cost nothing for workspaces without webhooks. Payloads carry ids and the minimum fields a receiver needs;
 * outbound message events never include the message text.
 */

type MessageEvent = Extract<WebhookEvent, "message.received" | "message.sent" | "message.delivered" | "message.read" | "message.failed">;

export async function emitMessageEvent(event: MessageEvent, messageId: string) {
  try {
    const head = await db.message.findUnique({ where: { id: messageId }, select: { organizationId: true } });
    if (!head || !(await hasSubscribers(head.organizationId, event))) return;
    const m = await db.message.findUniqueOrThrow({
      where: { id: messageId },
      include: { conversation: { select: { id: true, whatsappAccountId: true, contact: { select: { id: true, name: true, phone: true } } } }, _count: { select: { attachments: true } } },
    });
    const c = m.conversation;
    const base = { id: m.id, wa_message_id: m.externalId, conversation_id: c.id, number_id: c.whatsappAccountId, direction: m.direction, type: m.type, status: m.status, demo: m.isDemo };
    const data =
      event === "message.received"
        ? { message: { ...base, text: m.body, attachments: m._count.attachments, received_at: m.createdAt.toISOString() }, contact: c.contact }
        : { message: { ...base, sent_at: m.sentAt?.toISOString() ?? null, delivered_at: m.deliveredAt?.toISOString() ?? null, read_at: m.readAt?.toISOString() ?? null, ...(event === "message.failed" ? { error: m.error } : {}) }, contact: c.contact };
    await emitWebhook(m.organizationId, event, data);
  } catch (e) {
    console.error("[webhooks] message event failed:", e);
  }
}

export async function emitContactEvent(event: "contact.created" | "contact.updated", organizationId: string, contactId: string, changed?: string[]) {
  try {
    if (!(await hasSubscribers(organizationId, event))) return;
    const c = await db.contact.findFirst({ where: { id: contactId, organizationId }, include: { tags: { include: { tag: { select: { name: true } } } } } });
    if (!c) return;
    let custom: Record<string, unknown> = {};
    try {
      custom = JSON.parse(c.customFields || "{}") as Record<string, unknown>;
    } catch {
      /* keep empty */
    }
    await emitWebhook(organizationId, event, {
      contact: { id: c.id, name: c.name, phone: c.phone, email: c.email, lifecycle: c.lifecycle, lead_status: c.leadStatus, source: c.source, opt_in_status: c.optInStatus, tags: c.tags.map((t) => t.tag.name), custom_fields: custom, created_at: c.createdAt.toISOString() },
      ...(changed ? { changed } : {}),
    });
  } catch (e) {
    console.error("[webhooks] contact event failed:", e);
  }
}

export async function emitConversationCreated(organizationId: string, conversationId: string) {
  try {
    if (!(await hasSubscribers(organizationId, "conversation.created"))) return;
    const c = await db.conversation.findFirst({ where: { id: conversationId, organizationId }, include: { contact: { select: { id: true, name: true, phone: true } } } });
    if (!c) return;
    await emitWebhook(organizationId, "conversation.created", { conversation: { id: c.id, number_id: c.whatsappAccountId, demo: c.isDemo, created_at: c.createdAt.toISOString() }, contact: c.contact });
  } catch (e) {
    console.error("[webhooks] conversation event failed:", e);
  }
}

export async function emitCampaignCompleted(organizationId: string, campaignId: string) {
  try {
    if (!(await hasSubscribers(organizationId, "campaign.completed"))) return;
    const c = await db.campaign.findFirst({ where: { id: campaignId, organizationId } });
    if (!c) return;
    const grouped = await db.campaignRecipient.groupBy({ by: ["status"], where: { campaignId }, _count: { _all: true } });
    await emitWebhook(organizationId, "campaign.completed", {
      campaign: { id: c.id, name: c.name, number_id: c.whatsappAccountId, completed_at: c.completedAt?.toISOString() ?? null, demo: c.isDemo },
      recipients: Object.fromEntries(grouped.map((g) => [g.status, g._count._all])),
    });
  } catch (e) {
    console.error("[webhooks] campaign event failed:", e);
  }
}

export async function emitFlowSubmitted(organizationId: string, submissionId: string) {
  try {
    if (!(await hasSubscribers(organizationId, "flow.submitted"))) return;
    const s = await db.flowSubmission.findFirst({ where: { id: submissionId, organizationId }, include: { flow: { select: { id: true, name: true } }, contact: { select: { id: true, name: true, phone: true } } } });
    if (!s) return;
    let answers: unknown = {};
    try {
      answers = JSON.parse(s.answers);
    } catch {
      /* keep empty */
    }
    await emitWebhook(organizationId, "flow.submitted", { flow: s.flow, submission: { id: s.id, source: s.source, answers, created_at: s.createdAt.toISOString() }, contact: s.contact });
  } catch (e) {
    console.error("[webhooks] flow event failed:", e);
  }
}
