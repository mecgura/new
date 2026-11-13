import { db } from "@/lib/db";
import { decryptSecret } from "@/lib/crypto";
import { ensureWabaDataset, sendConversion } from "@/providers/meta/conversions";

const DAY = 86_400_000;
/** Meta only accepts a click id for a short while after the click. */
const CLICK_WINDOW_DAYS = 7;

type EventName = "LeadSubmitted" | "Purchase";

/**
 * Tells Meta that a customer who came from a click-to-WhatsApp ad became a qualified lead or a sale, so the ad learns
 * which clicks are worth paying for. Sent once per customer and event. Never throws: a failure is saved on the row.
 */
export async function reportAdConversion(organizationId: string, contactId: string, event: EventName): Promise<"sent" | "failed" | "skipped" | "none"> {
  try {
    const settings = await db.organizationSettings.findUnique({ where: { organizationId }, select: { adConversions: true, currency: true } });
    if (settings && !settings.adConversions) return "none";
    const ref = await db.adReferral.findFirst({ where: { organizationId, contactId, ctwaClid: { not: "" } }, orderBy: { createdAt: "desc" } });
    if (!ref) return "none";
    if (await db.adConversion.findUnique({ where: { contactId_event: { contactId, event } } })) return "none";

    let valuePaise = 0;
    if (event === "Purchase") {
      const won = await db.deal.aggregate({ where: { organizationId, contactId, status: "won" }, _sum: { valuePaise: true } });
      valuePaise = won._sum.valuePaise ?? 0;
    }
    const save = (status: string, error = "") =>
      db.adConversion.create({ data: { organizationId, contactId, event, adId: ref.sourceId, valuePaise, status, error: error.slice(0, 300) } }).catch(() => null);

    if (Date.now() - ref.createdAt.getTime() > CLICK_WINDOW_DAYS * DAY) {
      await save("skipped", `The ad click was more than ${CLICK_WINDOW_DAYS} days ago, so Meta no longer accepts it.`);
      return "skipped";
    }
    const conv = await db.conversation.findUnique({ where: { id: ref.conversationId }, select: { whatsappAccount: { select: { isDemo: true, waba: true, connection: { select: { encryptedAccessToken: true } } } } } });
    const acc = conv?.whatsappAccount;
    if (!acc || acc.isDemo || !acc.waba || !acc.connection?.encryptedAccessToken) {
      await save("skipped", "The WhatsApp number is not connected to Meta.");
      return "skipped";
    }
    try {
      const token = decryptSecret(acc.connection.encryptedAccessToken);
      let datasetId = acc.waba.capiDatasetId;
      if (!datasetId) {
        datasetId = await ensureWabaDataset(acc.waba.wabaId, token);
        await db.whatsAppBusinessAccount.update({ where: { id: acc.waba.id }, data: { capiDatasetId: datasetId } });
      }
      await sendConversion(datasetId, token, { name: event, at: new Date(), ctwaClid: ref.ctwaClid, wabaId: acc.waba.wabaId, value: valuePaise / 100, currency: settings?.currency ?? "INR" });
      await save("sent");
      return "sent";
    } catch (e) {
      await save("failed", e instanceof Error ? e.message : "Meta refused the event.");
      return "failed";
    }
  } catch (e) {
    console.error("[ads] conversion report failed:", e);
    return "failed";
  }
}

/** Lead status → the event Meta should hear about. */
export function conversionForLeadStatus(status: string): EventName | null {
  if (status === "qualified" || status === "proposal") return "LeadSubmitted";
  if (status === "won") return "Purchase";
  return null;
}

export async function getConversionSummary(organizationId: string, days: number) {
  const since = new Date(Date.now() - days * DAY);
  const [settings, rows] = await Promise.all([
    db.organizationSettings.findUnique({ where: { organizationId }, select: { adConversions: true } }),
    db.adConversion.findMany({ where: { organizationId, createdAt: { gte: since } }, orderBy: { createdAt: "desc" }, take: 2000 }),
  ]);
  const sent = rows.filter((r) => r.status === "sent");
  const lastProblem = rows.find((r) => r.status !== "sent");
  return {
    enabled: settings?.adConversions ?? true,
    leads: sent.filter((r) => r.event === "LeadSubmitted").length,
    sales: sent.filter((r) => r.event === "Purchase").length,
    salesValuePaise: sent.filter((r) => r.event === "Purchase").reduce((n, r) => n + r.valuePaise, 0),
    notSent: rows.length - sent.length,
    lastProblem: lastProblem ? lastProblem.error : "",
  };
}

export async function setAdConversions(organizationId: string, enabled: boolean) {
  await db.organizationSettings.upsert({ where: { organizationId }, update: { adConversions: enabled }, create: { organizationId, adConversions: enabled } });
  return { enabled };
}
