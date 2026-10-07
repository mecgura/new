import { db } from "@/lib/db";
import { publish } from "@/lib/realtime/broker";

/** Replies/opt-outs within this window after a campaign message count towards that campaign. */
export const ATTRIBUTION_WINDOW_MS = 72 * 60 * 60 * 1000;

/** Mirrors a message delivery receipt onto its campaign recipient (forward-only, like the message). */
export async function syncRecipientStatus(messageId: string, status: string, at: Date, error = "") {
  const r = await db.campaignRecipient.findUnique({ where: { messageId } });
  if (!r) return;
  if (status === "failed") {
    if (r.readAt) return;
    await db.campaignRecipient.update({ where: { id: r.id }, data: { status: "failed", failedAt: at, error: error.slice(0, 500) } });
    publish(r.organizationId, { type: "campaign.updated", campaignId: r.campaignId });
    return;
  }
  const data =
    status === "delivered"
      ? { deliveredAt: r.deliveredAt ?? at, ...(r.status === "sent" ? { status: "delivered" } : {}) }
      : status === "read"
        ? { readAt: r.readAt ?? at, deliveredAt: r.deliveredAt ?? at, ...(r.status !== "failed" ? { status: "read" } : {}) }
        : status === "sent"
          ? { sentAt: r.sentAt ?? at }
          : null;
  if (data) {
    await db.campaignRecipient.update({ where: { id: r.id }, data });
    publish(r.organizationId, { type: "campaign.updated", campaignId: r.campaignId });
  }
}

/**
 * Credits an inbound message to the campaign that prompted it: the message
 * it quotes (button replies always quote the template), otherwise the most
 * recent campaign message to this contact inside the attribution window.
 */
export async function attributeInbound(organizationId: string, contactId: string, replyToMessageId: string | null, at: Date, optOut: boolean) {
  const quoted = replyToMessageId ? await db.campaignRecipient.findUnique({ where: { messageId: replyToMessageId } }) : null;
  const r =
    quoted ??
    (await db.campaignRecipient.findFirst({
      where: { organizationId, contactId, sentAt: { gte: new Date(at.getTime() - ATTRIBUTION_WINDOW_MS), lte: at } },
      orderBy: { sentAt: "desc" },
    }));
  if (!r) return;
  if (optOut ? r.optedOutAt : r.repliedAt) return;
  await db.campaignRecipient.update({ where: { id: r.id }, data: optOut ? { optedOutAt: at } : { repliedAt: at } });
  publish(r.organizationId, { type: "campaign.updated", campaignId: r.campaignId });
}
