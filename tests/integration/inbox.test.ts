import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createHmac, randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { realtime, type RealtimeEvent } from "@/lib/realtime/broker";
import { actAs, addMember, json, makeOrg, makePlan, makeUser, params, req } from "../helpers";
import * as demoConnect from "@/app/api/organizations/[orgId]/whatsapp/connect/demo/route";
import * as manualConnect from "@/app/api/organizations/[orgId]/whatsapp/connect/manual/route";
import * as convs from "@/app/api/organizations/[orgId]/inbox/conversations/route";
import * as conv from "@/app/api/organizations/[orgId]/inbox/conversations/[cid]/route";
import * as messages from "@/app/api/organizations/[orgId]/inbox/conversations/[cid]/messages/route";
import * as media from "@/app/api/organizations/[orgId]/inbox/conversations/[cid]/media/route";
import * as notes from "@/app/api/organizations/[orgId]/inbox/conversations/[cid]/notes/route";
import * as readRoute from "@/app/api/organizations/[orgId]/inbox/conversations/[cid]/read/route";
import * as assign from "@/app/api/organizations/[orgId]/inbox/conversations/[cid]/assign/route";
import * as attachment from "@/app/api/organizations/[orgId]/inbox/attachments/[aid]/route";
import * as demoInbound from "@/app/api/organizations/[orgId]/inbox/demo/inbound/route";
import * as demoStatus from "@/app/api/organizations/[orgId]/inbox/demo/status/route";
import * as realtimeRoute from "@/app/api/organizations/[orgId]/realtime/route";
import * as contacts from "@/app/api/organizations/[orgId]/contacts/route";
import * as contact from "@/app/api/organizations/[orgId]/contacts/[id]/route";
import * as contactNotes from "@/app/api/organizations/[orgId]/contacts/[id]/notes/route";
import * as contactConsent from "@/app/api/organizations/[orgId]/contacts/[id]/consent/route";
import * as contactTags from "@/app/api/organizations/[orgId]/contacts/[id]/tags/route";
import * as importRoute from "@/app/api/organizations/[orgId]/contacts/import/route";
import * as exportRoute from "@/app/api/organizations/[orgId]/contacts/export/route";
import * as team from "@/app/api/organizations/[orgId]/team/route";
import * as teamStatus from "@/app/api/organizations/[orgId]/team/status/route";
import * as metaWebhook from "@/app/api/webhooks/meta/route";
import * as templatesRoute from "@/app/api/organizations/[orgId]/templates/route";
import * as templateSubmit from "@/app/api/organizations/[orgId]/templates/[tid]/submit/route";
import * as templateReview from "@/app/api/organizations/[orgId]/templates/[tid]/review/route";

type U = Awaited<ReturnType<typeof makeUser>>;
let n = 0;
const uniqPhone = () => `+9198${String(Date.now()).slice(-6)}${String(n++).padStart(2, "0")}`;
const P = <E extends Record<string, string> = Record<never, string>>(orgId: string, extra?: E) => params({ orgId, ...(extra ?? ({} as E)) });
const post = (body: unknown) => req("/x", { method: "POST", body });

type Tenant = { orgId: string; owner: U; manager: U; agent1: U; agent2: U; accountId: string };

async function makeTenant(opts: { maxContacts?: number } = {}): Promise<Tenant> {
  const org = await makeOrg(`Inbox ${n++}`);
  const [owner, manager, agent1, agent2] = await Promise.all([makeUser({ name: "Owner" }), makeUser({ name: "Manager" }), makeUser({ name: "Agent One" }), makeUser({ name: "Agent Two" })]);
  await addMember(org.id, owner.id, "CLIENT_OWNER");
  await addMember(org.id, manager.id, "MANAGER");
  await addMember(org.id, agent1.id, "AGENT");
  await addMember(org.id, agent2.id, "AGENT");
  const plan = await makePlan({ maxUsers: 20, maxWhatsAppNumbers: 3 });
  if (opts.maxContacts) await db.plan.update({ where: { id: plan.id }, data: { maxContacts: opts.maxContacts } });
  await db.subscription.create({ data: { organizationId: org.id, planId: plan.id, priceMonthly: plan.priceMonthly } });
  await db.organizationService.create({ data: { organizationId: org.id, service: "WHATSAPP_AUTOMATION", enabled: true } });
  actAs(owner);
  const demo = await json(await demoConnect.POST(post({ businessName: "Demo Shop" }), P(org.id)));
  return { orgId: org.id, owner, manager, agent1, agent2, accountId: (demo.body.account as { id: string }).id };
}

async function inbound(t: Tenant, body = "Hi, I need pricing", phone = uniqPhone(), name = "Rahul Sharma") {
  const r = await json(await demoInbound.POST(post({ whatsappAccountId: t.accountId, phone, name, body }), P(t.orgId)));
  expect(r.status).toBe(201);
  return { ...(r.body as { conversationId: string; messageId: string; contactId: string }), phone };
}

/** Creates a template on the tenant's demo WABA and runs it through (simulated) Meta approval. */
async function approvedTemplate(t: Tenant, name: string, body = "Hello {{1}}, your order {{2}} is confirmed. Thanks for shopping!") {
  const acct = await db.whatsAppAccount.findUniqueOrThrow({ where: { id: t.accountId } });
  const created = await json(await templatesRoute.POST(post({ wabaId: acct.wabaRecordId, name, language: "en_US", category: "UTILITY", body, examples: { body: ["Rahul", "#1234"] } }), P(t.orgId)));
  expect(created.status).toBe(201);
  const tid = (created.body.template as { id: string }).id;
  expect((await templateSubmit.POST(post({}), P(t.orgId, { tid }))).status).toBe(200);
  expect((await templateReview.POST(post({ decision: "approved" }), P(t.orgId, { tid }))).status).toBe(200);
  return tid;
}

function capture(orgId: string) {
  const events: RealtimeEvent[] = [];
  const off = realtime().subscribe(orgId, (e) => events.push(e));
  return { events, off };
}

let t: Tenant;
beforeAll(async () => {
  t = await makeTenant();
});
afterEach(() => vi.restoreAllMocks());

describe("receive demo message → conversation creation", () => {
  it("creates contact, conversation and inbound message, and publishes realtime events", async () => {
    const cap = capture(t.orgId);
    actAs(t.owner);
    const r = await inbound(t, "Hello! Do you deliver?", undefined, "Simran Kaur");
    cap.off();
    const c = await db.conversation.findUniqueOrThrow({ where: { id: r.conversationId }, include: { contact: true, messages: true } });
    expect(c).toMatchObject({ unreadCount: 1, status: "open", isDemo: true, assignedToUserId: null, lastMessagePreview: "Hello! Do you deliver?" });
    expect(c.contact).toMatchObject({ name: "Simran Kaur", phone: r.phone, source: "whatsapp" });
    expect(c.messages[0]).toMatchObject({ direction: "inbound", type: "text", status: "received", isDemo: true });
    expect(cap.events.map((e) => e.type)).toEqual(expect.arrayContaining(["message.created", "conversation.updated"]));
    // A second message from the same customer goes to the same thread.
    await json(await demoInbound.POST(post({ whatsappAccountId: t.accountId, phone: r.phone, name: "Simran Kaur", body: "Hello?" }), P(t.orgId)));
    expect(await db.conversation.count({ where: { contactId: r.contactId } })).toBe(1);
    expect((await db.conversation.findUniqueOrThrow({ where: { id: r.conversationId } })).unreadCount).toBe(2);
    // Mark read
    expect((await readRoute.POST(post({}), P(t.orgId, { cid: r.conversationId }))).status).toBe(200);
    expect((await db.conversation.findUniqueOrThrow({ where: { id: r.conversationId } })).unreadCount).toBe(0);
  });

  it("demo inbound is refused for non-demo numbers", async () => {
    actAs(t.owner);
    const res = await demoInbound.POST(post({ whatsappAccountId: "nonexistent123", phone: uniqPhone(), body: "x" }), P(t.orgId));
    expect(res.status).toBe(400);
  });
});

describe("send demo message + delivery/read states", () => {
  it("text → sent; simulated delivered → read; states never move backwards", async () => {
    actAs(t.owner);
    const r = await inbound(t);
    const sent = await json(await messages.POST(post({ type: "text", body: "Hello Rahul! Here are our packages." }), P(t.orgId, { cid: r.conversationId })));
    expect(sent.status).toBe(201);
    const m = sent.body.message as { id: string; status: string; direction: string; isDemo: boolean };
    expect(m).toMatchObject({ status: "sent", direction: "outbound", isDemo: true });
    expect((await db.message.findUniqueOrThrow({ where: { id: m.id } })).externalId).toMatch(/^demo\./);
    for (const s of ["delivered", "read"]) expect((await demoStatus.POST(post({ messageId: m.id, status: s }), P(t.orgId))).status).toBe(200);
    await demoStatus.POST(post({ messageId: m.id, status: "delivered" }), P(t.orgId));
    const row = await db.message.findUniqueOrThrow({ where: { id: m.id } });
    expect(row.status).toBe("read");
    expect(row.deliveredAt).not.toBeNull();
    expect(row.readAt).not.toBeNull();
    const list = await json(await messages.GET(req("/x"), P(t.orgId, { cid: r.conversationId })));
    expect((list.body.items as { id: string }[]).map((x) => x.id)).toContain(m.id);
  });

  it("supports reply-to, templates, buttons, media by link, uploads and internal notes", async () => {
    actAs(t.owner);
    const r = await inbound(t);
    const cid = r.conversationId;
    const reply = await json(await messages.POST(post({ type: "text", body: "Replying to you", replyToId: r.messageId }), P(t.orgId, { cid })));
    expect((reply.body.message as { replyTo: { id: string } }).replyTo.id).toBe(r.messageId);
    const tid = await approvedTemplate(t, "order_update");
    // Every variable needs a value; the inbox shows the rendered text.
    expect((await messages.POST(post({ type: "template", templateId: tid, values: { "body.1": "Rahul" } }), P(t.orgId, { cid }))).status).toBe(400);
    const tpl = await json(await messages.POST(post({ type: "template", templateId: tid, values: { "body.1": "Rahul", "body.2": "#1234" } }), P(t.orgId, { cid })));
    expect(tpl.status).toBe(201);
    expect((tpl.body.message as { body: string }).body).toBe("Hello Rahul, your order #1234 is confirmed. Thanks for shopping!");
    const btn = await json(await messages.POST(post({ type: "interactive", body: "Choose one", buttons: [{ id: "pricing", title: "View Pricing" }, { id: "demo", title: "Book Demo" }] }), P(t.orgId, { cid })));
    expect(btn.status).toBe(201);
    expect((await messages.POST(post({ type: "interactive", body: "x", buttons: [{ id: "a", title: "This title is far too long for WhatsApp" }] }), P(t.orgId, { cid }))).status).toBe(400);
    expect((await messages.POST(post({ type: "image", link: "https://cdn.example.com/menu.jpg", caption: "Menu" }), P(t.orgId, { cid }))).status).toBe(201);
    expect((await messages.POST(post({ type: "document", link: "http://insecure.example.com/a.pdf" }), P(t.orgId, { cid }))).status).toBe(400);

    const fd = new FormData();
    fd.set("file", new File([new Uint8Array([137, 80, 78, 71])], "photo.png", { type: "image/png" }));
    fd.set("caption", "Our shop");
    const up = await json(await media.POST(new Request("http://localhost:3000/x", { method: "POST", headers: { host: "localhost:3000" }, body: fd }), P(t.orgId, { cid })));
    expect(up.status).toBe(201);
    const att = (up.body.message as { type: string; attachments: { id: string; filename: string; mimeType: string; downloadable: boolean }[] });
    expect(att.type).toBe("image");
    expect(att.attachments[0]).toMatchObject({ filename: "photo.png", mimeType: "image/png", downloadable: false });
    // Demo attachments aren't stored → 404 from the media proxy.
    expect((await attachment.GET(req("/x"), P(t.orgId, { aid: att.attachments[0].id }))).status).toBe(404);
    const bad = new FormData();
    bad.set("file", new File(["<svg/>"], "x.svg", { type: "image/svg+xml" }));
    expect((await media.POST(new Request("http://localhost:3000/x", { method: "POST", headers: { host: "localhost:3000" }, body: bad }), P(t.orgId, { cid }))).status).toBe(400);

    const note = await json(await notes.POST(post({ body: "Customer prefers Hindi" }), P(t.orgId, { cid })));
    expect(note.body.message).toMatchObject({ direction: "internal", type: "note" });
    expect((await db.message.findUniqueOrThrow({ where: { id: (note.body.message as { id: string }).id } })).externalId).toBeNull();
  });

  it("enforces the 24-hour window (templates only) and blocks opted-out / suppressed contacts", async () => {
    actAs(t.owner);
    const c = await json(await contacts.POST(post({ phone: uniqPhone(), name: "Cold Lead" }), P(t.orgId)));
    const contactId = (c.body.contact as { id: string }).id;
    const started = await json(await convs.POST(post({ contactId, whatsappAccountId: t.accountId }), P(t.orgId)));
    const cid = (started.body.conversation as { id: string; windowOpen: boolean }).id;
    expect((started.body.conversation as { windowOpen: boolean }).windowOpen).toBe(false);
    const text = await json(await messages.POST(post({ type: "text", body: "Hi" }), P(t.orgId, { cid })));
    expect(text.status).toBe(409);
    expect(String(text.body.error)).toContain("24-hour");
    const hello = await approvedTemplate(t, "hello_world_followup", "Hello! Thanks for your interest in our store. Reply to continue.");
    expect((await messages.POST(post({ type: "template", templateId: hello, values: {} }), P(t.orgId, { cid }))).status).toBe(201);

    const r = await inbound(t, "STOP");
    const ct = await db.contact.findUniqueOrThrow({ where: { id: r.contactId }, include: { consents: true } });
    expect(ct.optInStatus).toBe("opted_out");
    expect(ct.consents[0]).toMatchObject({ status: "opted_out", source: "inbound_keyword" });
    const blocked = await json(await messages.POST(post({ type: "text", body: "Are you sure?" }), P(t.orgId, { cid: r.conversationId })));
    expect(blocked.status).toBe(409);
    expect(String(blocked.body.error)).toContain("opted out");
    await demoInbound.POST(post({ whatsappAccountId: t.accountId, phone: r.phone, body: "START" }), P(t.orgId));
    expect((await db.contact.findUniqueOrThrow({ where: { id: r.contactId } })).optInStatus).toBe("opted_in");

    await contact.PATCH(req("/x", { method: "PATCH", body: { suppressed: true, suppressionReason: "Legal request" } }), P(t.orgId, { id: r.contactId }));
    expect((await messages.POST(post({ type: "text", body: "x" }), P(t.orgId, { cid: r.conversationId }))).status).toBe(409);
  });
});

describe("assignment & team permissions", () => {
  it("claim, transfer, reassign; agents only see their own and unassigned chats", async () => {
    const tt = await makeTenant();
    actAs(tt.owner);
    const r = await inbound(tt);
    const cid = r.conversationId;

    // Agent 1 sees the unassigned chat but must take it before replying.
    actAs(tt.agent1);
    expect((await conv.GET(req("/x"), P(tt.orgId, { cid }))).status).toBe(200);
    const early = await json(await messages.POST(post({ type: "text", body: "hi" }), P(tt.orgId, { cid })));
    expect(early.status).toBe(403);
    // Agents can't hand an unassigned chat to someone else.
    expect((await assign.POST(post({ toUserId: tt.agent2.id }), P(tt.orgId, { cid }))).status).toBe(403);
    const claim = await json(await assign.POST(post({ toUserId: tt.agent1.id }), P(tt.orgId, { cid })));
    expect(claim.status).toBe(200);
    expect((claim.body.conversation as { assignedTo: { id: string } }).assignedTo.id).toBe(tt.agent1.id);
    expect((await messages.POST(post({ type: "text", body: "I'll help you" }), P(tt.orgId, { cid }))).status).toBe(201);

    // Agent 2 can no longer see it.
    actAs(tt.agent2);
    expect((await conv.GET(req("/x"), P(tt.orgId, { cid }))).status).toBe(404);
    expect((await messages.POST(post({ type: "text", body: "hijack" }), P(tt.orgId, { cid }))).status).toBe(404);
    expect((await assign.POST(post({ toUserId: tt.agent2.id }), P(tt.orgId, { cid }))).status).toBe(404);
    const list2 = await json(await convs.GET(req("/x?tab=all"), P(tt.orgId)));
    expect((list2.body.items as { id: string }[]).some((c) => c.id === cid)).toBe(false);

    // Agent 1 transfers to agent 2 with a note.
    actAs(tt.agent1);
    expect((await assign.POST(post({ toUserId: tt.agent2.id, note: "Needs Hindi speaker" }), P(tt.orgId, { cid }))).status).toBe(200);
    expect((await conv.GET(req("/x"), P(tt.orgId, { cid }))).status).toBe(404);
    actAs(tt.agent2);
    const mine = await json(await convs.GET(req("/x?tab=mine"), P(tt.orgId)));
    expect((mine.body.items as { id: string }[]).map((c) => c.id)).toContain(cid);
    expect(await db.notification.count({ where: { userId: tt.agent2.id, link: `/inbox?c=${cid}` } })).toBe(1);

    // Manager reassigns freely and sees everything.
    actAs(tt.manager);
    expect((await assign.POST(post({ toUserId: tt.agent1.id }), P(tt.orgId, { cid }))).status).toBe(200);
    expect((await assign.POST(post({ toUserId: null }), P(tt.orgId, { cid }))).status).toBe(200);
    const history = await db.conversationAssignment.findMany({ where: { conversationId: cid }, orderBy: { createdAt: "asc" } });
    expect(history.map((h) => h.action)).toEqual(["claimed", "transferred", "transferred", "unassigned"]);
    const system = await db.message.findMany({ where: { conversationId: cid, type: "system" } });
    expect(system).toHaveLength(4);
    expect(await db.auditLog.count({ where: { organizationId: tt.orgId, action: "conversation.assigned" } })).toBe(4);

    // Assigning to a non-member is rejected.
    const outsider = await makeUser();
    expect((await assign.POST(post({ toUserId: outsider.id }), P(tt.orgId, { cid }))).status).toBe(400);
  });

  it("tabs: unread / assigned / mine counts respect visibility", async () => {
    const tt = await makeTenant();
    actAs(tt.owner);
    const a = await inbound(tt);
    await inbound(tt);
    await assign.POST(post({ toUserId: tt.agent1.id }), P(tt.orgId, { cid: a.conversationId }));
    actAs(tt.agent1);
    const res = await json(await convs.GET(req("/x"), P(tt.orgId)));
    expect(res.body.counts).toEqual({ all: 2, unread: 2, assigned: 1, mine: 1 });
    actAs(tt.agent2);
    const res2 = await json(await convs.GET(req("/x"), P(tt.orgId)));
    expect(res2.body.counts).toEqual({ all: 1, unread: 1, assigned: 0, mine: 0 });
  });

  it("agent status, team list and closing chats", async () => {
    const tt = await makeTenant();
    actAs(tt.agent1);
    expect((await teamStatus.PUT(req("/x", { method: "PUT", body: { status: "online" } }), P(tt.orgId))).status).toBe(200);
    expect((await teamStatus.PUT(req("/x", { method: "PUT", body: { status: "busy" } }), P(tt.orgId))).status).toBe(400);
    const list = await json(await team.GET(req("/x"), P(tt.orgId)));
    expect((list.body.members as { userId: string; agentStatus: string }[]).find((m) => m.userId === tt.agent1.id)?.agentStatus).toBe("online");
    actAs(tt.owner);
    const r = await inbound(tt);
    actAs(tt.agent1);
    expect((await conv.PATCH(req("/x", { method: "PATCH", body: { status: "closed" } }), P(tt.orgId, { cid: r.conversationId }))).status).toBe(403);
    await assign.POST(post({ toUserId: tt.agent1.id }), P(tt.orgId, { cid: r.conversationId }));
    expect((await conv.PATCH(req("/x", { method: "PATCH", body: { status: "closed" } }), P(tt.orgId, { cid: r.conversationId }))).status).toBe(200);
    // A new customer message reopens the chat.
    await demoInbound.POST(post({ whatsappAccountId: tt.accountId, phone: r.phone, body: "One more question" }), P(tt.orgId));
    expect((await db.conversation.findUniqueOrThrow({ where: { id: r.conversationId } })).status).toBe("open");
  });
});

describe("contacts & CRM", () => {
  it("create (normalised phone), duplicates, validation, search and tabs", async () => {
    const tt = await makeTenant();
    actAs(tt.agent1);
    const local = `98${String(Date.now()).slice(-8)}`;
    const created = await json(await contacts.POST(post({ phone: local, name: "Aman Verma", email: "AMAN@Example.com", tags: ["VIP", "Delhi"], lifecycle: "customer", optInStatus: "opted_in", consentEvidence: "Signed form" }), P(tt.orgId)));
    expect(created.status).toBe(201);
    const c = created.body.contact as { id: string; phone: string; email: string; tags: { name: string }[]; optInStatus: string };
    expect(c.phone).toBe(`+91${local}`);
    expect(c.email).toBe("aman@example.com");
    expect(c.tags.map((x) => x.name).sort()).toEqual(["Delhi", "VIP"]);
    expect(c.optInStatus).toBe("opted_in");
    expect((await contacts.POST(post({ phone: `+91${local}` }), P(tt.orgId))).status).toBe(409);
    expect((await contacts.POST(post({ phone: "12" }), P(tt.orgId))).status).toBe(400);
    expect((await contacts.POST(post({ phone: uniqPhone(), email: "nope" }), P(tt.orgId))).status).toBe(400);
    await contacts.POST(post({ phone: uniqPhone(), name: "Neha Gupta", lifecycle: "lead", leadStatus: "qualified" }), P(tt.orgId));

    const byName = await json(await contacts.GET(req("/x?q=aman"), P(tt.orgId)));
    expect((byName.body.items as { id: string }[]).map((x) => x.id)).toEqual([c.id]);
    const byPhone = await json(await contacts.GET(req(`/x?q=${local.slice(-6)}`), P(tt.orgId)));
    expect((byPhone.body.items as { id: string }[]).map((x) => x.id)).toEqual([c.id]);
    const byEmail = await json(await contacts.GET(req("/x?q=example.com"), P(tt.orgId)));
    expect((byEmail.body.items as unknown[]).length).toBe(1);
    const leads = await json(await contacts.GET(req("/x?tab=leads&leadStatus=qualified"), P(tt.orgId)));
    expect((leads.body.items as { name: string }[]).map((x) => x.name)).toEqual(["Neha Gupta"]);
    expect(leads.body.counts).toMatchObject({ all: 2, customers: 1, leads: 1, opted_in: 1 });

    // Notes, tags, consent, custom fields, owner
    expect((await contactNotes.POST(post({ body: "Interested in Growth plan" }), P(tt.orgId, { id: c.id }))).status).toBe(201);
    expect((await contactTags.PUT(req("/x", { method: "PUT", body: { tags: ["VIP"] } }), P(tt.orgId, { id: c.id }))).status).toBe(200);
    expect((await contactConsent.POST(post({ status: "opted_out", evidence: "Asked on call" }), P(tt.orgId, { id: c.id }))).status).toBe(200);
    expect((await contact.PATCH(req("/x", { method: "PATCH", body: { customFields: { City: "Delhi", "Order size": "Large" }, ownerUserId: tt.agent1.id, leadStatus: "won" } }), P(tt.orgId, { id: c.id }))).status).toBe(200);
    const outsider = await makeUser();
    expect((await contact.PATCH(req("/x", { method: "PATCH", body: { ownerUserId: outsider.id } }), P(tt.orgId, { id: c.id }))).status).toBe(400);
    const detail = await json(await contact.GET(req("/x"), P(tt.orgId, { id: c.id })));
    expect(detail.body.contact).toMatchObject({ optInStatus: "opted_out", leadStatus: "won", customFields: { City: "Delhi", "Order size": "Large" }, owner: { id: tt.agent1.id } });
    expect((detail.body.notes as unknown[]).length).toBe(1);
    expect((detail.body.consents as { status: string }[]).map((x) => x.status)).toEqual(["opted_out", "opted_in"]);
  });

  it("agents can't delete, import or export; managers can", async () => {
    const tt = await makeTenant();
    actAs(tt.agent1);
    const c = await json(await contacts.POST(post({ phone: uniqPhone(), name: "Temp" }), P(tt.orgId)));
    const id = (c.body.contact as { id: string }).id;
    expect((await contact.DELETE(req("/x", { method: "DELETE" }), P(tt.orgId, { id }))).status).toBe(403);
    expect((await exportRoute.GET(req("/x"), P(tt.orgId))).status).toBe(403);
    const fd = new FormData();
    fd.set("file", new File(["phone\n+919876500000\n"], "c.csv", { type: "text/csv" }));
    expect((await importRoute.POST(new Request("http://localhost:3000/x", { method: "POST", headers: { host: "localhost:3000" }, body: fd }), P(tt.orgId))).status).toBe(403);
    actAs(tt.manager);
    expect((await contact.DELETE(req("/x", { method: "DELETE" }), P(tt.orgId, { id }))).status).toBe(200);
  });

  it("CSV import (create/update/skip, tags, consent) and export with formula-injection protection", async () => {
    const tt = await makeTenant();
    actAs(tt.manager);
    const existingPhone = uniqPhone();
    await contacts.POST(post({ phone: existingPhone, name: "Existing" }), P(tt.orgId));
    const p1 = `97${String(Date.now()).slice(-8)}`;
    const csv = [
      "Name,Phone,Email,Tags,Lead Status,Opt In",
      `"Sharma, Rahul",${p1},rahul@x.com,VIP;Punjab,qualified,yes`,
      `Existing Updated,${existingPhone},,Repeat,,no`,
      "Bad Phone,123,,,,",
      `Dup,${p1},,,,`,
      `=HYPERLINK("http://evil"),+919811111${String(n++).padStart(3, "0")},,,,`,
    ].join("\r\n");
    const fd = new FormData();
    fd.set("file", new File([csv], "contacts.csv", { type: "text/csv" }));
    const res = await json(await importRoute.POST(new Request("http://localhost:3000/x", { method: "POST", headers: { host: "localhost:3000" }, body: fd }), P(tt.orgId)));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ created: 2, updated: 1, skipped: 2 });
    expect((res.body.errors as { line: number; error: string }[]).map((e) => e.line)).toEqual([4, 5]);
    const rahul = await db.contact.findUniqueOrThrow({ where: { organizationId_phone: { organizationId: tt.orgId, phone: `+91${p1}` } }, include: { tags: { include: { tag: true } }, consents: true } });
    expect(rahul).toMatchObject({ name: "Sharma, Rahul", leadStatus: "qualified", source: "import", optInStatus: "opted_in" });
    expect(rahul.tags.map((x) => x.tag.name).sort()).toEqual(["Punjab", "VIP"]);
    expect((await db.contact.findUniqueOrThrow({ where: { organizationId_phone: { organizationId: tt.orgId, phone: existingPhone } } })).optInStatus).toBe("opted_out");

    const exp = await exportRoute.GET(req("/x?tab=all"), P(tt.orgId));
    expect(exp.status).toBe(200);
    expect(exp.headers.get("content-type")).toContain("text/csv");
    const text = await exp.text();
    expect(text).toContain('"Sharma, Rahul"');
    expect(text).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(text).not.toMatch(/(^|,)=HYPERLINK/m);
    expect(await db.auditLog.count({ where: { organizationId: tt.orgId, action: { in: ["contacts.imported", "contacts.exported"] } } })).toBe(2);
  });

  it("plan's monthly new-contact limit is enforced", async () => {
    const tt = await makeTenant({ maxContacts: 2 });
    actAs(tt.owner);
    expect((await contacts.POST(post({ phone: uniqPhone() }), P(tt.orgId))).status).toBe(201);
    expect((await contacts.POST(post({ phone: uniqPhone() }), P(tt.orgId))).status).toBe(201);
    const third = await json(await contacts.POST(post({ phone: uniqPhone() }), P(tt.orgId)));
    expect(third.status).toBe(409);
    expect(String(third.body.error)).toContain("new contacts per month");
  });
});

describe("tenant isolation", () => {
  it("Tenant B can't read or act on Tenant A's inbox, contacts or realtime stream", async () => {
    const a = await makeTenant();
    const b = await makeTenant();
    actAs(a.owner);
    const r = await inbound(a);
    const msgs = await json(await messages.GET(req("/x"), P(a.orgId, { cid: r.conversationId })));
    const firstMsg = (msgs.body.items as { id: string }[])[0].id;

    actAs(b.owner);
    // A's org path → 403
    expect((await convs.GET(req("/x"), P(a.orgId))).status).toBe(403);
    expect((await contacts.GET(req("/x"), P(a.orgId))).status).toBe(403);
    expect((await realtimeRoute.GET(req("/x"), P(a.orgId))).status).toBe(403);
    // B's own path with A's ids → 404, nothing changes
    expect((await conv.GET(req("/x"), P(b.orgId, { cid: r.conversationId }))).status).toBe(404);
    expect((await messages.GET(req("/x"), P(b.orgId, { cid: r.conversationId }))).status).toBe(404);
    expect((await messages.POST(post({ type: "text", body: "hi" }), P(b.orgId, { cid: r.conversationId }))).status).toBe(404);
    expect((await notes.POST(post({ body: "x" }), P(b.orgId, { cid: r.conversationId }))).status).toBe(404);
    expect((await assign.POST(post({ toUserId: b.owner.id }), P(b.orgId, { cid: r.conversationId }))).status).toBe(404);
    expect((await contact.GET(req("/x"), P(b.orgId, { id: r.contactId }))).status).toBe(404);
    expect((await contact.PATCH(req("/x", { method: "PATCH", body: { name: "Hacked" } }), P(b.orgId, { id: r.contactId }))).status).toBe(404);
    expect((await contact.DELETE(req("/x", { method: "DELETE" }), P(b.orgId, { id: r.contactId }))).status).toBe(404);
    expect((await demoStatus.POST(post({ messageId: firstMsg, status: "read" }), P(b.orgId))).status).toBe(404);
    expect((await demoInbound.POST(post({ whatsappAccountId: a.accountId, phone: uniqPhone(), body: "spoof" }), P(b.orgId))).status).toBe(400);
    // Same phone can exist independently in both tenants.
    expect((await contacts.POST(post({ phone: r.phone, name: "B's copy" }), P(b.orgId))).status).toBe(201);
    expect((await db.contact.findUniqueOrThrow({ where: { id: r.contactId } })).name).toBe("Rahul Sharma");
    const listB = await json(await convs.GET(req("/x"), P(b.orgId)));
    expect((listB.body.items as { id: string }[]).some((c) => c.id === r.conversationId)).toBe(false);
  });
});

describe("realtime (SSE)", () => {
  // Keeps one in-flight read across calls so a timed-out wait never drops a chunk.
  function sseReader(reader: ReadableStreamDefaultReader<Uint8Array>) {
    const dec = new TextDecoder();
    let pending: Promise<ReadableStreamReadResult<Uint8Array>> | null = null;
    return async (pattern: RegExp, ms = 1500) => {
      let buf = "";
      const deadline = Date.now() + ms;
      while (Date.now() < deadline) {
        pending ??= reader.read();
        const chunk = await Promise.race([pending, new Promise<null>((r) => setTimeout(() => r(null), Math.max(0, deadline - Date.now())))]);
        if (!chunk) break;
        pending = null;
        if (chunk.done) break;
        buf += dec.decode(chunk.value);
        if (pattern.test(buf)) return buf;
      }
      return buf;
    };
  }

  it("streams events; agents don't receive events for chats assigned to someone else", async () => {
    const tt = await makeTenant();
    actAs(tt.owner);
    const r = await inbound(tt);
    await assign.POST(post({ toUserId: tt.agent2.id }), P(tt.orgId, { cid: r.conversationId }));

    const ac = new AbortController();
    actAs(tt.agent1);
    const res = await realtimeRoute.GET(new Request("http://localhost:3000/x", { headers: { host: "localhost:3000" }, signal: ac.signal }), P(tt.orgId));
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const readUntil = sseReader(res.body!.getReader());
    expect(await readUntil(/event: ready/)).toContain("event: ready");

    actAs(tt.owner);
    await notes.POST(post({ body: "Private to agent two's chat" }), P(tt.orgId, { cid: r.conversationId }));
    const hidden = await readUntil(/message\.created/, 400);
    expect(hidden).not.toContain(r.conversationId);

    const other = await inbound(tt); // unassigned → visible to agent1
    const seen = await readUntil(new RegExp(`event: message\\.created\\ndata: [^\\n]*${other.conversationId}`));
    expect(seen).toContain("event: message.created");

    // Assigning the unassigned chat to someone else must tell agent1 so it leaves their list.
    await assign.POST(post({ toUserId: tt.agent2.id }), P(tt.orgId, { cid: other.conversationId }));
    const moved = await readUntil(new RegExp(`event: conversation\\.updated\\ndata: [^\\n]*${other.conversationId}`));
    expect(moved).toContain("event: conversation.updated");
    ac.abort();
  });
});

describe("real WhatsApp numbers (Meta mocked)", () => {
  it("sends through the Cloud API, receives via signed webhook, and applies delivery receipts", async () => {
    const tt = await makeTenant();
    actAs(tt.owner);
    const ids = { wabaId: `1${Date.now()}${n++}`, phoneNumberId: `2${Date.now()}${n++}` };
    const local = `9${String(Date.now()).slice(-9)}`;
    const token = `EAAG${randomBytes(40).toString("hex")}`;
    const secret = randomBytes(16).toString("hex");
    const calls: { url: string; method: string; body: string; auth: string | null }[] = [];
    let failNextSend = false;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = new URL(String(input));
      const method = (init?.method ?? "GET").toUpperCase();
      calls.push({ url: url.toString(), method, body: typeof init?.body === "string" ? init.body : "", auth: new Headers(init?.headers).get("authorization") });
      const reply = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s });
      const path = url.pathname.replace(/^\/v[\d.]+\//, "");
      if (path === `${ids.phoneNumberId}/messages`) {
        if (failNextSend) return reply({ error: { message: "Recipient phone number not in allowed list", code: 131030 } }, 400);
        return reply({ messages: [{ id: `wamid.OUT${n++}` }] });
      }
      if (path === `${ids.wabaId}/subscribed_apps`) return reply({ success: true });
      if (path === `${ids.wabaId}/phone_numbers`) return reply({ data: [{ id: ids.phoneNumberId }] });
      if (path === ids.wabaId) return reply({ id: ids.wabaId, name: "Real Biz" });
      if (path === ids.phoneNumberId) return reply({ id: ids.phoneNumberId, display_phone_number: `+91 ${local}`, verified_name: "Real Biz", quality_rating: "GREEN" });
      return reply({ error: { message: "unknown" } }, 404);
    });
    const conn = await json(await manualConnect.POST(post({ wabaId: ids.wabaId, phoneNumberId: ids.phoneNumberId, accessToken: token, appSecret: secret }), P(tt.orgId)));
    expect(conn.status).toBe(201);

    const customer = `91${String(Date.now()).slice(-10)}`;
    const raw = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [{ id: ids.wabaId, changes: [{ field: "messages", value: { metadata: { phone_number_id: ids.phoneNumberId }, contacts: [{ wa_id: customer, profile: { name: "Priya Singh" } }], messages: [{ id: `wamid.IN${n++}`, from: customer, type: "text", timestamp: String(Math.floor(Date.now() / 1000)), text: { body: "Please send details" } }] } }] }],
    });
    const sig = `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
    expect((await metaWebhook.POST(new Request("http://localhost:3000/api/webhooks/meta", { method: "POST", headers: { "x-hub-signature-256": sig }, body: raw }))).status).toBe(200);
    const c = await db.conversation.findFirstOrThrow({ where: { organizationId: tt.orgId, isDemo: false }, include: { contact: true } });
    expect(c.contact).toMatchObject({ name: "Priya Singh", phone: `+${customer}` });

    const sent = await json(await messages.POST(post({ type: "text", body: "Sure, sharing now" }), P(tt.orgId, { cid: c.id })));
    const m = sent.body.message as { id: string; status: string };
    expect(m.status).toBe("sent");
    const sendCall = calls.find((x) => x.url.endsWith(`${ids.phoneNumberId}/messages`))!;
    expect(sendCall.auth).toBe(`Bearer ${token}`);
    expect(JSON.parse(sendCall.body)).toMatchObject({ messaging_product: "whatsapp", to: customer, type: "text", text: { body: "Sure, sharing now" } });
    const wamid = (await db.message.findUniqueOrThrow({ where: { id: m.id } })).externalId!;

    const receipt = JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: ids.wabaId, changes: [{ field: "messages", value: { metadata: { phone_number_id: ids.phoneNumberId }, statuses: [{ id: wamid, status: "read", timestamp: String(Math.floor(Date.now() / 1000)), recipient_id: customer }] } }] }] });
    await metaWebhook.POST(new Request("http://localhost:3000/api/webhooks/meta", { method: "POST", headers: { "x-hub-signature-256": `sha256=${createHmac("sha256", secret).update(receipt).digest("hex")}` }, body: receipt }));
    expect((await db.message.findUniqueOrThrow({ where: { id: m.id } })).status).toBe("read");

    failNextSend = true;
    const failed = await json(await messages.POST(post({ type: "text", body: "Second" }), P(tt.orgId, { cid: c.id })));
    expect(failed.body.message).toMatchObject({ status: "failed", error: expect.stringContaining("not in allowed list") });
  });
});
