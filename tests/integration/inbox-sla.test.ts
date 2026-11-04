import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/background", () => ({ runAfterResponse: vi.fn() }));

import { db } from "@/lib/db";
import { actAs, addMember, json, makeOrg, makePlan, makeUser, params, req } from "../helpers";
import * as demoConnect from "@/app/api/organizations/[orgId]/whatsapp/connect/demo/route";
import * as listRoute from "@/app/api/organizations/[orgId]/inbox/conversations/route";
import * as convRoute from "@/app/api/organizations/[orgId]/inbox/conversations/[cid]/route";
import * as messagesRoute from "@/app/api/organizations/[orgId]/inbox/conversations/[cid]/messages/route";
import * as presenceRoute from "@/app/api/organizations/[orgId]/inbox/conversations/[cid]/presence/route";
import * as exportRoute from "@/app/api/organizations/[orgId]/inbox/conversations/[cid]/export/route";
import * as supervisorRoute from "@/app/api/organizations/[orgId]/inbox/supervisor/route";
import * as slaRoute from "@/app/api/organizations/[orgId]/inbox/sla/route";
import { receiveInbound } from "@/services/inbox/messaging";
import { checkInboxBreaches, DEFAULT_INBOX_SLA } from "@/services/inbox/sla";

type U = Awaited<ReturnType<typeof makeUser>>;
let orgId = "";
let accountId = "";
let owner: U, manager: U, agent: U, agent2: U;
let seq = 0;
const post = (b: unknown) => req("/x", { method: "POST", body: b });
const C = (cid: string) => params({ orgId, cid });
const inbound = (phone: string, body: string) => receiveInbound(orgId, accountId, { externalId: `wamid.sla.${Date.now()}.${seq++}`, fromPhone: phone, profileName: "Simran", type: "text", body, at: new Date(), isDemo: true });

beforeAll(async () => {
  orgId = (await makeOrg("SLA Shop")).id;
  [owner, manager, agent, agent2] = await Promise.all([makeUser({ name: "Owner" }), makeUser({ name: "Manager" }), makeUser({ name: "Aman" }), makeUser({ name: "Neha" })]);
  await addMember(orgId, owner.id, "CLIENT_OWNER");
  await addMember(orgId, manager.id, "MANAGER");
  await addMember(orgId, agent.id, "AGENT");
  await addMember(orgId, agent2.id, "AGENT");
  const plan = await makePlan({ maxUsers: 10, maxWhatsAppNumbers: 2 });
  await db.subscription.create({ data: { organizationId: orgId, planId: plan.id, priceMonthly: plan.priceMonthly } });
  await db.organizationService.create({ data: { organizationId: orgId, service: "WHATSAPP_AUTOMATION", enabled: true } });
  actAs(owner);
  accountId = ((await json(await demoConnect.POST(post({ businessName: "SLA Shop" }), params({ orgId })))).body.account as { id: string }).id;
});

describe("inbox service levels", () => {
  it("a customer message starts the clock, shows under Waiting, and a reply stops it and logs the wait", async () => {
    const r = await inbound("+919811500001", "Is the shop open today?");
    const cid = r!.conversationId;
    expect((await db.conversation.findUniqueOrThrow({ where: { id: cid } })).waitingSince).not.toBeNull();
    // A second message doesn't restart the clock.
    const first = (await db.conversation.findUniqueOrThrow({ where: { id: cid } })).waitingSince!;
    await inbound("+919811500001", "Hello?");
    expect((await db.conversation.findUniqueOrThrow({ where: { id: cid } })).waitingSince!.getTime()).toBe(first.getTime());

    actAs(owner);
    const list = await json(await listRoute.GET(req("/x?tab=waiting"), params({ orgId })));
    expect((list.body.items as { id: string; waitingSince: string | null }[]).find((c) => c.id === cid)?.waitingSince).toBeTruthy();
    expect((await messagesRoute.POST(post({ type: "text", body: "Yes, open till 9 pm!" }), C(cid))).status).toBe(201);
    expect((await db.conversation.findUniqueOrThrow({ where: { id: cid } })).waitingSince).toBeNull();
    const logged = await db.inboxResponse.findFirstOrThrow({ where: { conversationId: cid } });
    expect(logged).toMatchObject({ userId: owner.id, kind: "human", breached: false });
  });

  it("past the target: alerts the assignee and managers once, and can move the chat to a less busy teammate", async () => {
    actAs(agent);
    expect((await slaRoute.PUT(req("/x", { method: "PUT", body: DEFAULT_INBOX_SLA }), params({ orgId }))).status).toBe(403);
    actAs(owner);
    expect((await slaRoute.PUT(req("/x", { method: "PUT", body: { ...DEFAULT_INBOX_SLA, firstResponseMinutes: 10, reassignAfterMinutes: 30 } }), params({ orgId }))).status).toBe(200);
    const r = await inbound("+919811500002", "Price of bridal package?");
    const cid = r!.conversationId;
    await db.conversation.update({ where: { id: cid }, data: { assignedToUserId: agent.id, waitingSince: new Date(Date.now() - 12 * 60_000) } });
    // Agent Aman already has other open chats, so Neha is less busy.
    await db.conversation.create({ data: { organizationId: orgId, contactId: (await db.contact.create({ data: { organizationId: orgId, phone: "+919811500099", name: "Other" } })).id, whatsappAccountId: accountId, assignedToUserId: agent.id, isDemo: true } });
    await db.organizationMember.updateMany({ where: { organizationId: orgId }, data: { agentStatus: "online" } });

    // checkInboxBreaches skips demo chats in real life; mark this one live for the test.
    await db.conversation.update({ where: { id: cid }, data: { isDemo: false } });
    expect(await checkInboxBreaches()).toBeGreaterThanOrEqual(1);
    await checkInboxBreaches();
    expect(await db.notification.count({ where: { userId: agent.id, title: { contains: "waiting 12 min" } } })).toBe(1);
    expect(await db.notification.count({ where: { userId: manager.id, title: { contains: "waiting 12 min" } } })).toBe(1);
    expect((await db.conversation.findUniqueOrThrow({ where: { id: cid } })).assignedToUserId).toBe(agent.id);

    await db.conversation.update({ where: { id: cid }, data: { waitingSince: new Date(Date.now() - 35 * 60_000) } });
    await checkInboxBreaches();
    expect((await db.conversation.findUniqueOrThrow({ where: { id: cid } })).assignedToUserId).toBe(agent2.id);

    const sup = await json(await supervisorRoute.GET(req("/x"), params({ orgId })));
    expect(sup.body).toMatchObject({ targetMinutes: 10 });
    expect((sup.body.waiting as { id: string; breached: boolean }[]).find((w) => w.id === cid)).toMatchObject({ breached: true });
    actAs(agent);
    expect((await supervisorRoute.GET(req("/x"), params({ orgId }))).status).toBe(403);
  });

  it("closing a chat asks “How did we do?”; the tap is recorded and nobody replies to it", async () => {
    actAs(owner);
    await slaRoute.PUT(req("/x", { method: "PUT", body: { ...DEFAULT_INBOX_SLA, csat: true } }), params({ orgId }));
    const r = await inbound("+919811500003", "Thanks, got my order");
    const cid = r!.conversationId;
    await db.conversation.update({ where: { id: cid }, data: { assignedToUserId: agent.id } });
    expect((await convRoute.PATCH(req("/x", { method: "PATCH", body: { status: "closed" } }), C(cid))).status).toBe(200);
    const survey = await db.csatSurvey.findFirstOrThrow({ where: { conversationId: cid } });
    expect(survey).toMatchObject({ agentUserId: agent.id, rating: null });
    const q = await db.message.findFirstOrThrow({ where: { conversationId: cid, direction: "outbound" }, orderBy: { createdAt: "desc" } });
    expect(q.type).toBe("interactive");

    const before = await db.message.count({ where: { conversationId: cid } });
    await inbound("+919811500003", "😊 Great");
    expect((await db.csatSurvey.findUniqueOrThrow({ where: { id: survey.id } })).rating).toBe(3);
    expect(await db.message.count({ where: { conversationId: cid } })).toBe(before + 1); // just the customer's tap
    const sup = await json(await supervisorRoute.GET(req("/x"), params({ orgId })));
    expect((sup.body.agents as { userId: string; csat: { greatPct: number | null } }[]).find((a) => a.userId === agent.id)?.csat.greatPct).toBe(100);
  });

  it("warns when a teammate has the same chat open; transcripts are for owners and managers", async () => {
    const r = await inbound("+919811500004", "Need help");
    const cid = r!.conversationId;
    actAs(manager);
    expect((await json(await presenceRoute.POST(post({ typing: true }), C(cid)))).body.others).toEqual([]);
    actAs(owner);
    const seen = await json(await presenceRoute.POST(post({}), C(cid)));
    expect(seen.body.others).toEqual([{ userId: manager.id, name: "Manager", typing: true }]);

    const t = await exportRoute.GET(req("/x"), C(cid));
    expect(t.headers.get("content-type")).toContain("text/plain");
    expect(await t.text()).toContain("Need help");
    actAs(agent);
    expect((await exportRoute.GET(req("/x"), C(cid))).status).toBe(403);

    const other = await makeOrg("Other SLA");
    const stranger = await makeUser({ name: "Stranger" });
    await addMember(other.id, stranger.id, "CLIENT_OWNER");
    actAs(stranger);
    expect((await presenceRoute.POST(post({}), params({ orgId: other.id, cid }))).status).toBe(404);
    expect((await exportRoute.GET(req("/x"), params({ orgId: other.id, cid }))).status).toBe(404);
  });
});
