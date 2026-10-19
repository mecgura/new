import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { ACTIVE_NUMBER_STATUSES } from "@/lib/catalog";
import { currentPlan } from "@/lib/services/usage";
import { limitLabel, wouldExceed } from "@/lib/plans";

/** The WhatsApp Automation service must be enabled for the client (Super Admin → Services). */
export async function assertWhatsAppEnabled(organizationId: string) {
  const svc = await db.organizationService.findUnique({
    where: { organizationId_service: { organizationId, service: "WHATSAPP_AUTOMATION" } },
  });
  if (!svc?.enabled) {
    throw new ApiError("FORBIDDEN", "WhatsApp Automation isn't enabled for this workspace. Contact MECGURA to enable it.");
  }
}

export type GatedService = "OMNICHANNEL" | "AI_CALLING";
const GATE_LABEL: Record<GatedService, string> = { OMNICHANNEL: "The omnichannel inbox (email, website chat, Messenger, Instagram)", AI_CALLING: "AI Calling" };

export async function isServiceEnabled(organizationId: string, service: GatedService) {
  const row = await db.organizationService.findUnique({ where: { organizationId_service: { organizationId, service } }, select: { enabled: true } });
  return Boolean(row?.enabled);
}

/** A module that Super Admin switches on per client (Services). */
export async function assertServiceEnabled(organizationId: string, service: GatedService) {
  if (!(await isServiceEnabled(organizationId, service))) {
    throw new ApiError("FORBIDDEN", `${GATE_LABEL[service]} isn't enabled for this workspace. Contact MECGURA to enable it.`);
  }
}

/**
 * Plan slot check before a number becomes active. A number that's already
 * registered/connected to this org (re-connection) doesn't need a new slot.
 */
export async function assertNumberSlot(organizationId: string, e164?: string) {
  const sub = await currentPlan(organizationId);
  if (!sub) return;
  const used = await db.whatsAppAccount.count({
    where: { organizationId, status: { in: ACTIVE_NUMBER_STATUSES }, ...(e164 ? { NOT: { phoneNumber: e164 } } : {}) },
  });
  if (wouldExceed(used, sub.plan.maxWhatsAppNumbers)) {
    throw new ApiError("CONFLICT", `Your ${sub.plan.name} plan allows ${limitLabel(sub.plan.maxWhatsAppNumbers)} WhatsApp number(s). Disconnect one or ask MECGURA to upgrade your plan.`);
  }
}
