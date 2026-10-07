import { db } from "@/lib/db";
import { billingState } from "@/services/billing/entitlements";
import { audit } from "@/lib/audit";
import { publish } from "@/lib/realtime/broker";
import { emitCampaignCompleted } from "@/services/webhooks/events";
import { preview, templateMessage, transmit } from "@/services/inbox/messaging";
import type { SlotValues } from "@/lib/templates";

const BATCH = 25;
/** A recipient stuck in "sending" this long was interrupted mid-send; it's failed rather than retried (no duplicate sends). */
const STALE_SENDING_MS = 10 * 60 * 1000;

async function finish(campaignId: string, organizationId: string) {
  const open = await db.campaignRecipient.count({ where: { campaignId, status: { in: ["queued", "sending"] } } });
  if (open) return false;
  const r = await db.campaign.updateMany({ where: { id: campaignId, status: "sending" }, data: { status: "completed", completedAt: new Date() } });
  publish(organizationId, { type: "campaign.updated", campaignId });
  if (r.count) {
    await audit({ action: "campaign.completed", organizationId, targetType: "campaign", targetId: campaignId });
    await emitCampaignCompleted(organizationId, campaignId);
  }
  return true;
}

async function stop(campaignId: string, organizationId: string, status: "paused" | "failed", reason: string) {
  const r = await db.campaign.updateMany({ where: { id: campaignId, status: "sending" }, data: { status, statusReason: reason } });
  publish(organizationId, { type: "campaign.updated", campaignId });
  if (r.count) await audit({ action: status === "paused" ? "campaign.paused" : "campaign.failed", organizationId, targetType: "campaign", targetId: campaignId, metadata: { reason, automatic: true } });
}

/**
 * Sends queued recipients of one campaign until done or the time budget runs
 * out (the next tick continues). Every recipient is claimed atomically, so
 * overlapping workers never double-send, and re-checked right before sending
 * because consent can change between scheduling and delivery.
 */
export async function processCampaign(campaignId: string, budgetMs = 50_000): Promise<{ sent: number; failed: number; skipped: number; done: boolean }> {
  const started = Date.now();
  const tally = { sent: 0, failed: 0, skipped: 0 };
  const c = await db.campaign.findUnique({
    where: { id: campaignId },
    include: { template: true, whatsappAccount: { include: { connection: { select: { encryptedAccessToken: true } } } } },
  });
  if (!c || c.status !== "sending") return { ...tally, done: true };

  await db.campaignRecipient.updateMany({
    where: { campaignId, status: "sending", attemptedAt: { lt: new Date(Date.now() - STALE_SENDING_MS) } },
    data: { status: "failed", failedAt: new Date(), error: "Interrupted while sending — not retried to avoid a duplicate message." },
  });

  const billing = await billingState(c.organizationId);
  if (billing.state === "blocked") {
    await stop(c.id, c.organizationId, "paused", billing.reason);
    return { ...tally, done: false };
  }
  const acct = c.whatsappAccount;
  if (!acct || (acct.status !== "connected" && acct.status !== "demo")) {
    await stop(c.id, c.organizationId, "paused", "The sending number is no longer connected.");
    return { ...tally, done: false };
  }
  const t = c.template;
  if (!t || t.status !== "approved") {
    await stop(c.id, c.organizationId, "paused", t ? `Template “${t.name}” is now ${t.status} — sending paused.` : "The template was deleted.");
    return { ...tally, done: false };
  }

  while (Date.now() - started < budgetMs) {
    const batch = await db.campaignRecipient.findMany({ where: { campaignId, status: "queued" }, orderBy: { createdAt: "asc" }, take: BATCH });
    if (!batch.length) break;
    for (const r of batch) {
      const claimed = await db.campaignRecipient.updateMany({ where: { id: r.id, status: "queued" }, data: { status: "sending", attemptedAt: new Date() } });
      if (!claimed.count) continue;

      const contact = r.contactId ? await db.contact.findFirst({ where: { id: r.contactId, organizationId: c.organizationId } }) : null;
      const skip = !contact ? "Contact was deleted." : contact.optInStatus === "opted_out" ? "Opted out before sending." : contact.suppressed ? "Suppressed before sending." : contact.optInStatus !== "opted_in" ? "Opt-in was withdrawn before sending." : "";
      if (skip || !contact) {
        await db.campaignRecipient.update({ where: { id: r.id }, data: { status: "skipped", error: skip } });
        tally.skipped++;
        continue;
      }

      const { payload, body, stored } = templateMessage(t, JSON.parse(r.variables) as SlotValues);
      const now = new Date();
      const conv =
        (await db.conversation.findUnique({ where: { whatsappAccountId_contactId: { whatsappAccountId: acct.id, contactId: contact.id } } })) ??
        (await db.conversation.create({ data: { organizationId: c.organizationId, contactId: contact.id, whatsappAccountId: acct.id, isDemo: acct.isDemo, lastMessagePreview: "" } }));
      const msg = await db.message.create({
        data: {
          organizationId: c.organizationId,
          conversationId: conv.id,
          direction: "outbound",
          type: "template",
          body,
          payload: JSON.stringify({ ...stored, campaignId: c.id, campaignName: c.name }),
          status: "pending",
          senderUserId: c.createdById,
          isDemo: acct.isDemo,
        },
      });
      await db.campaignRecipient.update({ where: { id: r.id }, data: { messageId: msg.id } });
      await db.conversation.update({ where: { id: conv.id }, data: { lastMessageAt: now, lastMessagePreview: preview("template", body) } });
      await db.contact.update({ where: { id: contact.id }, data: { lastMessageAt: now } });

      const sent = await transmit(msg.id, { isDemo: acct.isDemo, phoneNumberId: acct.phoneNumberId, connection: acct.connection }, contact.phone, payload, undefined);
      if (sent.status === "sent") {
        await db.campaignRecipient.update({ where: { id: r.id }, data: { status: "sent", sentAt: sent.sentAt ?? now } });
        if (acct.isDemo && acct.phoneRecordId) await db.phoneNumber.update({ where: { id: acct.phoneRecordId }, data: { messagesSent: { increment: 1 } } });
        tally.sent++;
      } else {
        await db.campaignRecipient.update({ where: { id: r.id }, data: { status: "failed", failedAt: now, error: sent.error } });
        tally.failed++;
      }
    }
    publish(c.organizationId, { type: "campaign.updated", campaignId: c.id });
    // A pause/cancel from the UI takes effect between batches.
    const cur = await db.campaign.findUnique({ where: { id: c.id }, select: { status: true } });
    if (cur?.status !== "sending") return { ...tally, done: false };
  }
  return { ...tally, done: await finish(c.id, c.organizationId) };
}

/** Starts due scheduled campaigns and continues sending ones. Called by the cron route / in-process scheduler. */
export async function runDueCampaigns(budgetMs = 50_000) {
  const now = new Date();
  const due = await db.campaign.findMany({ where: { status: "scheduled", scheduledAt: { lte: now } }, select: { id: true, organizationId: true } });
  for (const d of due) {
    const r = await db.campaign.updateMany({ where: { id: d.id, status: "scheduled" }, data: { status: "sending", startedAt: now } });
    if (r.count) await audit({ action: "campaign.started", organizationId: d.organizationId, targetType: "campaign", targetId: d.id, metadata: { scheduled: true } });
  }
  const sending = await db.campaign.findMany({ where: { status: "sending" }, select: { id: true }, orderBy: { startedAt: "asc" } });
  const started = Date.now();
  const results: Record<string, Awaited<ReturnType<typeof processCampaign>>> = {};
  for (const s of sending) {
    const left = budgetMs - (Date.now() - started);
    if (left < 2_000) break;
    results[s.id] = await processCampaign(s.id, left);
  }
  return { started: due.length, processed: Object.keys(results).length, results };
}
