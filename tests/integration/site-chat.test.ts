import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { actAs, json, makeOrg, makeUser, req } from "../helpers";
import * as admin from "@/app/api/admin/site-chat/route";
import * as pub from "@/app/api/site-chat/route";

let boss: Awaited<ReturnType<typeof makeUser>>;
let orgId: string;
const visitor = "a".repeat(48);
const post = (body: unknown) => pub.POST(req("/api/site-chat", { method: "POST", body }));

beforeAll(async () => {
  boss = await makeUser({ role: "SUPER_ADMIN", name: "Boss" });
  orgId = (await makeOrg("MECGURA Home")).id;
});

describe("home page chatbot", () => {
  it("is off until the admin turns it on", async () => {
    actAs(null);
    expect((await json(await pub.GET())).body.enabled).toBe(false);
    expect((await post({ action: "lead", visitorId: visitor, name: "A", phone: "9876543210" })).status).toBe(404);
  });

  it("admin turns it on for a workspace; a visitor becomes a lead and gets answers", async () => {
    actAs(boss);
    const on = await json(await admin.PUT(req("/api/admin/site-chat", { method: "PUT", body: { enabled: true, organizationId: orgId } })));
    expect(on.status).toBe(200);
    expect(on.body.enabled).toBe(true);

    actAs(null);
    expect((await json(await pub.GET())).body.enabled).toBe(true);
    expect((await post({ action: "message", visitorId: visitor, text: "hi" })).status).toBe(409);
    expect((await post({ action: "lead", visitorId: visitor, name: "Ravi", phone: "12" })).status).toBe(400);

    const lead = await json(await post({ action: "lead", visitorId: visitor, name: "Ravi Kumar", phone: "98765 43210" }));
    expect(lead.status).toBe(200);
    const contact = await db.contact.findFirstOrThrow({ where: { organizationId: orgId, phone: "+919876543210" } });
    expect(contact).toMatchObject({ name: "Ravi Kumar", source: "website", lifecycle: "lead" });

    const reply = await json(await post({ action: "message", visitorId: visitor, text: "What is the price?" }));
    expect(reply.status).toBe(200);
    expect(String((reply.body.reply as { text: string }).text)).toMatch(/plan|Meta/i);
    const conv = await db.conversation.findFirstOrThrow({ where: { organizationId: orgId, contactId: contact.id } });
    expect(await db.message.count({ where: { conversationId: conv.id, direction: "inbound" } })).toBe(2);
    expect(await db.message.count({ where: { conversationId: conv.id, direction: "outbound" } })).toBe(2);

    // The same number again does not create a second contact.
    await post({ action: "lead", visitorId: "b".repeat(48), name: "Ravi", phone: "+91 98765 43210" });
    expect(await db.contact.count({ where: { organizationId: orgId, phone: "+919876543210" } })).toBe(1);
  });

  it("rejects malformed input and switches off", async () => {
    actAs(null);
    expect((await post({ action: "lead", visitorId: "short", name: "x", phone: "9876543210" })).status).toBe(400);
    expect((await post({ action: "nope" })).status).toBe(400);
    actAs(boss);
    await admin.PUT(req("/api/admin/site-chat", { method: "PUT", body: { enabled: false } }));
    actAs(null);
    expect((await json(await pub.GET())).body.enabled).toBe(false);
  });
});

describe("WhatsApp number assistant", () => {
  it("answers a stranger on the chosen number, creates the lead, and steps aside for people", async () => {
    const { receiveInbound } = await import("@/services/inbox/messaging");
    const { handleInboundForWaBot, setWaBot } = await import("@/services/site/lead-chat");
    const org = await makeOrg("WA bot org");
    const acct = await db.whatsAppAccount.create({ data: { organizationId: org.id, displayName: "MECGURA", phoneNumber: `+9178${Math.floor(Math.random() * 1e8)}`, status: "demo", isDemo: true } });
    const ev = async (body: string, externalId: string) => {
      const r = await receiveInbound(org.id, acct.id, { externalId, fromPhone: "+919811100011", profileName: "Neha Arora", type: "text", body, at: new Date(), isDemo: true });
      return { conversationId: r!.conversationId, contactId: r!.contactId, whatsappAccountId: acct.id, type: "text", text: body, optOut: false, automationHandled: false };
    };
    const first = await ev("hi, price kitna hai?", "wa-1");
    expect((await handleInboundForWaBot(org.id, first)).status).toBe("not_this_number");

    await setWaBot(acct.id, boss.id);
    expect((await handleInboundForWaBot(org.id, first)).status).toBe("replied");
    const out = await db.message.findMany({ where: { conversationId: first.conversationId, direction: "outbound" } });
    expect(out).toHaveLength(1);
    expect(out[0].body).toMatch(/Thanks for messaging MECGURA/);
    expect(await db.contact.findFirstOrThrow({ where: { organizationId: org.id, phone: "+919811100011" } })).toMatchObject({ name: "Neha Arora", lifecycle: "lead" });

    // A team member takes the chat: the assistant stays quiet.
    await db.conversation.update({ where: { id: first.conversationId }, data: { assignedToUserId: boss.id } });
    expect((await handleInboundForWaBot(org.id, await ev("hello?", "wa-2"))).status).toBe("person_owns_chat");
    expect((await handleInboundForWaBot(org.id, { ...first, optOut: true })).status).toBe("skipped");
    await setWaBot(null, boss.id);
  });
});
