import "server-only";
import type { PatientContext } from "@/lib/portal/ctx";
import { EVENTS } from "@/lib/communications/catalog";
import { pdb } from "./portal-core";

const LABEL: Record<string, string> = { WHATSAPP: "WhatsApp", SMS: "SMS", EMAIL: "Email" };
/** What the clinic sent THIS patient: when, by which channel, about what. No message text, no provider details, no failures that aren't the patient's business. */
export async function myCommunications(ctx: PatientContext) {
  const rows = (await pdb(ctx).communicationMessage.findMany({ where: { patientId: ctx.patientId, status: { in: ["SENT", "DELIVERED", "READ", "FAILED"] }, category: { not: "MARKETING" } }, orderBy: { createdAt: "desc" }, take: 30, select: { id: true, createdAt: true, channel: true, eventType: true, status: true } })) as { id: string; createdAt: Date; channel: string; eventType: string; status: string }[];
  return { rows: rows.map((m) => ({ id: m.id, at: m.createdAt.toISOString(), channel: LABEL[m.channel] ?? m.channel, label: (EVENTS as Record<string, { label: string }>)[m.eventType]?.label ?? "Notification", status: m.status === "FAILED" ? "Not delivered" : m.status === "SENT" ? "Sent" : "Delivered" })) };
}
