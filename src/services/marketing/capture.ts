import { db } from "@/lib/db";
import { recordLeadQuietly, type Source } from "@/services/marketing/leads";

/** MECGURA's own WhatsApp number: the one the website assistant answers on, else the agreement sender. */
export async function houseNumberIds(): Promise<string[]> {
  const { waBotAccountId } = await import("@/services/site/lead-chat");
  const { getProvider } = await import("@/services/agreements/agreements");
  const ids = [await waBotAccountId(), (await getProvider()).sendFromAccountId].filter((x): x is string => Boolean(x));
  return [...new Set(ids)];
}

/** What brought them, from the message the website's buttons pre-fill ("…I would like a demo", "…I want the Diwali offer"). */
export function sourceFromText(text: string): Source {
  const t = text.toLowerCase();
  if (/\boffer\b|\bcode\b|discount/.test(t)) return "festival";
  if (/\bdemo\b/.test(t)) return "demo_click";
  if (/\bref(erred)?\b|recommend/.test(t)) return "referral";
  return "whatsapp";
}

/** The first message someone sends to MECGURA's own number makes them a lead in the marketing pipeline. */
export async function captureWhatsAppLead(ev: { conversationId: string; contactId: string; whatsappAccountId: string; text: string; optOut: boolean }) {
  if (ev.optOut) return null;
  if (!(await houseNumberIds()).includes(ev.whatsappAccountId)) return null;
  if ((await db.message.count({ where: { conversationId: ev.conversationId, direction: "inbound" } })) > 1) return null;
  const contact = await db.contact.findUnique({ where: { id: ev.contactId }, select: { name: true, phone: true } });
  if (!contact) return null;
  return recordLeadQuietly({ phone: contact.phone, name: contact.name ?? "", source: sourceFromText(ev.text), note: ev.text.slice(0, 300) });
}
