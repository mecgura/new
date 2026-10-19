import { randomBytes, randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notifications";
import { publish } from "@/lib/realtime/broker";
import { siteConfig } from "@/config/site";
import { formatINR } from "@/lib/catalog";
import { incrementUsage } from "@/lib/services/usage";
import { normalizePhone } from "@/services/inbox/contacts";
import { receiveChannelMessage } from "@/services/channels/inbound";
import { VISITOR_ID, widgetConfig } from "@/services/channels/webchat";
import { isServiceEnabled } from "@/services/whatsapp/guards";
import { emitAutomationEvent } from "@/services/automations/events";
import { emitContactEvent } from "@/services/webhooks/events";
import { getSetting, setSetting } from "@/lib/settings";

/**
 * The home page chatbot. A visitor leaves a name and number, becomes a lead in the chosen MECGURA
 * workspace, and a built-in assistant answers common questions. Every message also lands in that
 * workspace's inbox so a person can step in. Rule-based on purpose: free, instant, and it never
 * says anything MECGURA hasn't approved. (The AI Agent can replace it later.)
 */
const KEY = "home:chat";
const GREETING = "Hi! 👋 I'm MECGURA's assistant. Ask me about WhatsApp automation, plans or a demo.";

type Stored = { organizationId: string; channelId: string };

async function stored(): Promise<Stored | null> {
  const raw = await getSetting(KEY, "");
  try {
    const v = JSON.parse(raw) as Partial<Stored>;
    return v.organizationId && v.channelId ? { organizationId: v.organizationId, channelId: v.channelId } : null;
  } catch {
    return null;
  }
}

/** The chat inbox the home page talks to, or null while the chatbot is switched off. */
export async function siteChatAccount() {
  const s = await stored();
  if (!s) return null;
  const a = await db.channelAccount.findFirst({ where: { id: s.channelId, organizationId: s.organizationId, kind: "webchat" } });
  if (!a || a.status === "disabled" || !(await isServiceEnabled(a.organizationId, "OMNICHANNEL"))) return null;
  return a;
}

export async function siteChatStatus() {
  const s = await stored();
  const org = s ? await db.organization.findUnique({ where: { id: s.organizationId }, select: { id: true, name: true } }) : null;
  return { enabled: Boolean(await siteChatAccount()), organization: org };
}

export async function enableSiteChat(organizationId: string, adminId: string, req?: Request) {
  const org = await db.organization.findUnique({ where: { id: organizationId }, select: { id: true } });
  if (!org) throw new ApiError("NOT_FOUND", "Workspace not found.");
  await db.organizationService.upsert({
    where: { organizationId_service: { organizationId, service: "OMNICHANNEL" } },
    update: { enabled: true },
    create: { organizationId, service: "OMNICHANNEL", enabled: true },
  });
  const existing = await db.channelAccount.findFirst({ where: { organizationId, kind: "webchat", name: "MECGURA website" } });
  const account =
    existing ??
    (await db.channelAccount.create({
      data: { organizationId, kind: "webchat", name: "MECGURA website", publicKey: randomBytes(24).toString("hex"), status: "active", settings: JSON.stringify({ greeting: GREETING, color: "#128c7e" }) },
    }));
  if (account.status === "disabled") await db.channelAccount.update({ where: { id: account.id }, data: { status: "active" } });
  await setSetting(KEY, JSON.stringify({ organizationId, channelId: account.id } satisfies Stored));
  await audit({ action: "site.content_updated", actorUserId: adminId, organizationId, targetType: "site_chat", targetId: account.id, metadata: { chatbot: "enabled" }, req });
}

export async function disableSiteChat(adminId: string, req?: Request) {
  await setSetting(KEY, "");
  await audit({ action: "site.content_updated", actorUserId: adminId, targetType: "site_chat", metadata: { chatbot: "disabled" }, req });
}

export async function siteChatConfig() {
  const a = await siteChatAccount();
  return a ? { enabled: true as const, key: a.publicKey, ...widgetConfig(a) } : { enabled: false as const };
}

type Account = NonNullable<Awaited<ReturnType<typeof siteChatAccount>>>;

async function storeBotMessage(account: Account, conversationId: string, body: string) {
  const now = new Date();
  const msg = await db.message.create({
    data: {
      organizationId: account.organizationId,
      conversationId,
      direction: "outbound",
      type: "text",
      body,
      payload: JSON.stringify({ channel: "webchat", bot: "site-assistant" }),
      status: "sent",
      externalId: `wc.out.${randomUUID()}`,
      sentAt: now,
    },
  });
  await db.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: now, lastMessagePreview: body.replace(/\s+/g, " ").slice(0, 140) } });
  publish(account.organizationId, { type: "message.created", conversationId, messageId: msg.id, assignedToUserId: null });
  return { id: msg.id, text: body, at: msg.createdAt.toISOString() };
}

/** Name + number from the chat form: creates (or finds) the lead and opens the chat thread. */
export async function captureLead(account: Account, input: { visitorId: string; name: string; phone: string }) {
  if (!VISITOR_ID.test(input.visitorId)) throw new ApiError("VALIDATION_ERROR", "Invalid visitor.");
  const phone = normalizePhone(input.phone);
  if (!phone) throw new ApiError("VALIDATION_ERROR", "Enter a valid mobile number.", { details: { phone: ["Enter a valid mobile number"] } });
  const organizationId = account.organizationId;
  const name = input.name.trim().slice(0, 80);

  let contact = await db.contact.findUnique({ where: { organizationId_phone: { organizationId, phone } } });
  const isNew = !contact;
  if (!contact) {
    contact = await db.contact.create({ data: { organizationId, phone, name, source: "website", lifecycle: "lead", lastInboundAt: new Date(), lastMessageAt: new Date() } });
    await incrementUsage(organizationId, "contacts_created");
    await audit({ action: "contact.created", organizationId, targetType: "contact", targetId: contact.id, metadata: { source: "website" } });
    await emitAutomationEvent(organizationId, { type: "new_contact", contactId: contact.id, source: "website" });
    await emitContactEvent("contact.created", organizationId, contact.id);
  } else if (!contact.name && name) {
    contact = await db.contact.update({ where: { id: contact.id }, data: { name } });
  }
  // From here the visitor's browser id points at this contact, so their chat belongs to the lead.
  await db.contactIdentity.upsert({
    where: { organizationId_kind_value: { organizationId, kind: "visitor", value: input.visitorId } },
    update: { contactId: contact.id },
    create: { organizationId, contactId: contact.id, kind: "visitor", value: input.visitorId },
  });
  const first = await receiveChannelMessage(account, {
    identityKind: "visitor",
    identityValue: input.visitorId,
    name,
    body: `New website lead: ${name || "visitor"} (${phone}). They opened the chat on the home page.`,
    externalId: `lead.${randomUUID()}`,
    at: new Date(),
  });
  if (isNew) {
    const members = await db.organizationMember.findMany({ where: { organizationId, role: { in: ["CLIENT_OWNER", "MANAGER"] } }, select: { userId: true } });
    await Promise.all(members.map((m) => notify({ userId: m.userId, organizationId, type: "success", title: "New website lead", body: `${name || "A visitor"} · ${phone}`, link: `/contacts/${contact!.id}` })));
  }
  const greeting = first ? await storeBotMessage(account, first.conversationId, `Thanks${name ? `, ${name.split(" ")[0]}` : ""}! ${GREETING}`) : null;
  return { contactId: contact.id, greeting };
}

async function plansLine() {
  try {
    const plans = await db.plan.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } });
    if (!plans.length) return "";
    return plans.map((p) => `${p.name}: ${p.selfServe ? `${formatINR(p.priceMonthly)}/month` : "custom"}`).join(" · ");
  } catch {
    return "";
  }
}

const has = (t: string, words: string[]) => words.some((w) => t.includes(w));

/** Picks an answer for a visitor message. Understands English plus common Hindi/Punjabi words written in English letters. */
export async function answerFor(text: string): Promise<string> {
  const t = text.toLowerCase();
  const wa = `You can also message us on WhatsApp: +${siteConfig.contact.whatsapp}.`;
  if (has(t, ["price", "pricing", "plan", "cost", "charge", "kitn", "kimat", "rate", "fees", "paise", "rupee", "₹"])) {
    const line = await plansLine();
    return `${line ? `Our plans: ${line}. ` : ""}Meta's WhatsApp message charges are billed by Meta separately. Want a demo or a custom quote? Tell us what you need.`;
  }
  if (has(t, ["demo", "trial", "try", "dikha", "dekh"])) return `Happy to show you a demo. ${wa} Or keep chatting here and our team will call you on the number you gave.`;
  if (has(t, ["bulk", "broadcast", "campaign", "promot", "offer"])) return "Yes, you can send campaigns to your contacts with approved WhatsApp templates. Only people who opted in are messaged, and opt-outs are respected. Meta charges per template message.";
  if (has(t, ["bot", "automat", "auto reply", "chatbot", "ai "])) return "We set up automations (welcome messages, lead capture, reminders) and an AI agent that answers common questions and hands over to your team when needed.";
  if (has(t, ["instagram", "facebook", "messenger", "email", "website chat", "omni"])) return "WhatsApp, Instagram, Messenger, email and website chat all come into one shared inbox. SMS and RCS are coming soon.";
  if (has(t, ["sms", "rcs"])) return "SMS and RCS are coming soon. WhatsApp, Instagram, Messenger, email and website chat are available today.";
  if (has(t, ["api", "official", "ban", "safe", "block"])) return "We use the official WhatsApp Business Platform (Cloud API) with Meta-approved templates and consent tracking, which is the safe way to message customers.";
  if (has(t, ["number", "setup", "start", "kida", "kaise", "how", "onboard"])) return "Setup is simple: we create your workspace, connect your WhatsApp number through Meta, get your templates approved and import your contacts. Usually a number not already on the regular WhatsApp app is needed.";
  if (has(t, ["thank", "shukriya", "dhanyavad", "ok", "thanks"])) return "You're welcome! Our team will reach out to you soon.";
  if (has(t, ["hi", "hello", "hey", "sat sri akal", "namaste"])) return "Hello! What would you like to know: plans, a demo, or how it works?";
  return `Thanks for your message. Our team will reply here and on the number you shared. ${wa}`;
}

export async function visitorMessageWithBot(account: Account, visitorId: string, text: string) {
  const identity = await db.contactIdentity.findUnique({ where: { organizationId_kind_value: { organizationId: account.organizationId, kind: "visitor", value: visitorId } }, select: { contactId: true } });
  if (!identity) throw new ApiError("CONFLICT", "Please share your name and number first.");
  const contact = await db.contact.findUniqueOrThrow({ where: { id: identity.contactId }, select: { name: true } });
  const sent = await receiveChannelMessage(account, { identityKind: "visitor", identityValue: visitorId, name: contact.name, body: text, externalId: `wc.in.${randomUUID()}`, at: new Date() });
  if (!sent) return { reply: null };
  return { reply: await storeBotMessage(account, sent.conversationId, await answerFor(text)) };
}
