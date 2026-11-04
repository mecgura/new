import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/background", () => ({ runAfterResponse: vi.fn() }));

import { db } from "@/lib/db";
import { actAs, addMember, json, makeOrg, makePlan, makeUser, params, req } from "../helpers";
import * as demoConnect from "@/app/api/organizations/[orgId]/whatsapp/connect/demo/route";
import * as demoInbound from "@/app/api/organizations/[orgId]/inbox/demo/inbound/route";
import * as automations from "@/app/api/organizations/[orgId]/automations/route";
import * as automation from "@/app/api/organizations/[orgId]/automations/[aid]/route";
import * as publishRoute from "@/app/api/organizations/[orgId]/automations/[aid]/publish/route";
import * as analyticsRoute from "@/app/api/organizations/[orgId]/automations/[aid]/analytics/route";
import * as executionRoute from "@/app/api/organizations/[orgId]/automations/executions/[eid]/route";
import * as approvalsRoute from "@/app/api/organizations/[orgId]/automations/approvals/route";
import * as decideRoute from "@/app/api/organizations/[orgId]/automations/approvals/[apid]/route";
import { runDueAutomations } from "@/services/automations/engine";
import { defaultData, evaluateSwitch, validateGraph, type FlowEdge, type FlowNode, type Graph, type NodeDataMap, type NodeType } from "@/lib/automations";

type U = Awaited<ReturnType<typeof makeUser>>;
type Tenant = { orgId: string; owner: U; manager: U; agent: U; accountId: string };
let n = 0;
const phone = () => `+9195${String(Date.now()).slice(-6)}${String(n++).padStart(2, "0")}`;
const P = <E extends Record<string, string> = Record<never, string>>(orgId: string, extra?: E) => params({ orgId, ...(extra ?? ({} as E)) });
const post = (body: unknown) => req("/x", { method: "POST", body });
const patch = (body: unknown) => req("/x", { method: "PATCH", body });
const node = <T extends NodeType>(id: string, type: T, data: Partial<NodeDataMap[T]> & { label?: string } = {}): FlowNode => ({ id, type, position: { x: 0, y: 0 }, data: { ...defaultData(type), ...data } as FlowNode["data"] });
const edge = (source: string, target: string, sourceHandle: string | null = null): FlowEdge => ({ id: `${source}-${sourceHandle ?? "n"}-${target}`, source, target, sourceHandle });

async function makeTenant(): Promise<Tenant> {
  const org = await makeOrg(`Branch ${n++}`);
  const [owner, manager, agent] = await Promise.all([makeUser({ name: "Owner" }), makeUser({ name: "Manager" }), makeUser({ name: "Agent" })]);
  await addMember(org.id, owner.id, "CLIENT_OWNER");
  await addMember(org.id, manager.id, "MANAGER");
  await addMember(org.id, agent.id, "AGENT");
  const plan = await makePlan({ maxUsers: 20, maxWhatsAppNumbers: 3 });
  await db.plan.update({ where: { id: plan.id }, data: { maxContacts: 10_000 } });
  await db.subscription.create({ data: { organizationId: org.id, planId: plan.id, priceMonthly: plan.priceMonthly } });
  await db.organizationService.create({ data: { organizationId: org.id, service: "WHATSAPP_AUTOMATION", enabled: true } });
  actAs(owner);
  const d = await json(await demoConnect.POST(post({ businessName: "Branch Shop" }), P(org.id)));
  return { orgId: org.id, owner, manager, agent, accountId: (d.body.account as { id: string }).id };
}
async function drain() {
  for (let i = 0; i < 20; i++) {
    const r = await runDueAutomations(20_000);
    if (!r.ran && !r.scheduled) return;
  }
}
async function publish(t: Tenant, name: string, graph: Graph) {
  actAs(t.owner);
  const c = await json(await automations.POST(post({ name, whatsappAccountId: t.accountId }), P(t.orgId)));
  const aid = (c.body.automation as { id: string }).id;
  expect((await automation.PATCH(patch({ graph }), P(t.orgId, { aid }))).status).toBe(200);
  const pub = await json(await publishRoute.POST(post({}), P(t.orgId, { aid })));
  expect(pub.status).toBe(200);
  return aid;
}
async function inbound(t: Tenant, body: string, from = phone(), name = "Simran Kaur") {
  const r = await json(await demoInbound.POST(post({ whatsappAccountId: t.accountId, phone: from, name, body }), P(t.orgId)));
  expect(r.status).toBe(201);
  return r.body as { contactId: string; conversationId: string };
}
const tagsOf = async (contactId: string) => (await db.contactTag.findMany({ where: { contactId }, include: { tag: true } })).map((x) => x.tag.name);

afterEach(() => vi.restoreAllMocks());

describe("switch step", () => {
  it("picks the first matching case, else 'anything else'", () => {
    const d: NodeDataMap["switch"] = { field: "message", key: "", cases: [{ id: "a", label: "Price", operator: "contains", value: "price, rate" }, { id: "b", label: "Book", operator: "contains", value: "book" }] };
    const ctx = (message: string) => ({ message, contact: null, now: new Date() });
    expect(evaluateSwitch(d, ctx("What's the RATE?"))).toBe("a");
    expect(evaluateSwitch(d, ctx("book + price"))).toBe("a");
    expect(evaluateSwitch(d, ctx("I want to book"))).toBe("b");
    expect(evaluateSwitch(d, ctx("hello"))).toBe("default");
  });

  it("validates cases and outputs", () => {
    const g: Graph = { nodes: [node("t", "trigger"), node("s", "switch", { cases: [{ id: "a", label: "", operator: "contains", value: "" }] }), node("e", "end")], edges: [edge("t", "s"), edge("s", "e", "zzz")] };
    const msgs = validateGraph(g).errors.map((e) => e.message).join(" | ");
    expect(msgs).toContain("Every case needs a value");
    expect(msgs).toContain("Case names");
    expect(msgs).toContain("case that no longer exists");
  });

  let t: Tenant;
  beforeAll(async () => {
    t = await makeTenant();
  });

  it("routes live runs down different paths and reports the split", async () => {
    const sw = node("sw", "switch", { label: "What do they want?", field: "message", cases: [{ id: "c1", label: "Price", operator: "contains", value: "price, rate" }, { id: "c2", label: "Booking", operator: "contains", value: "book" }] });
    const g: Graph = {
      nodes: [node("t", "trigger", { trigger: "keyword", keywords: ["hi"], match: "starts_with" }), sw, node("tp", "tag", { tagName: "Price ask" }), node("tb", "tag", { tagName: "Booking" }), node("to", "tag", { tagName: "Other" })],
      edges: [edge("t", "sw"), edge("sw", "tp", "c1"), edge("sw", "tb", "c2"), edge("sw", "to", "default")],
    };
    const aid = await publish(t, "Switch demo", g);
    const a = await inbound(t, "hi, what's the price?");
    const b = await inbound(t, "hi I want to book");
    const c = await inbound(t, "hi there");
    await drain();
    expect(await tagsOf(a.contactId)).toEqual(["Price ask"]);
    expect(await tagsOf(b.contactId)).toEqual(["Booking"]);
    expect(await tagsOf(c.contactId)).toEqual(["Other"]);
    const an = await json(await analyticsRoute.GET(req("/x"), P(t.orgId, { aid })));
    expect(an.body.branches).toMatchObject({ sw: { c1: 1, c2: 1, default: 1 } });
  });
});

describe("approval step", () => {
  let t: Tenant;
  let aid = "";
  beforeAll(async () => {
    t = await makeTenant();
    const g: Graph = {
      nodes: [
        node("t", "trigger", { trigger: "keyword", keywords: ["discount"], match: "contains" }),
        node("ap", "approval", { label: "Discount OK?", question: "Give {{contact.name}} 10% off?", approvers: "managers", timeoutHours: 2, onTimeout: "rejected" }),
        node("yes", "message", { text: "Good news {{contact.first_name}}, 10% off is approved!" }),
        node("no", "tag", { tagName: "No discount" }),
      ],
      edges: [edge("t", "ap"), edge("ap", "yes", "approved"), edge("ap", "no", "rejected")],
    };
    aid = await publish(t, "Discount approval", g);
  });

  const pendingFor = async (contactId: string) => db.automationApproval.findFirstOrThrow({ where: { organizationId: t.orgId, contactId } });

  it("waits for a manager, then continues down the Approved path", async () => {
    const c = await inbound(t, "any discount for me?");
    await drain();
    const ap = await pendingFor(c.contactId);
    expect(ap).toMatchObject({ status: "pending", question: "Give Simran Kaur 10% off?" });
    const ex = await db.automationExecution.findUniqueOrThrow({ where: { id: ap.executionId } });
    expect(ex).toMatchObject({ status: "running", waitState: "approval", currentNodeId: "ap" });
    expect(await db.notification.count({ where: { userId: { in: [t.owner.id, t.manager.id] }, title: { contains: "Approval needed" } } })).toBe(2);
    expect(await db.notification.count({ where: { userId: t.agent.id, title: { contains: "Approval needed" } } })).toBe(0);

    actAs(t.agent);
    const list = await json(await approvalsRoute.GET(req("/x"), P(t.orgId)));
    expect((list.body.approvals as { id: string; canDecide: boolean }[]).find((x) => x.id === ap.id)?.canDecide).toBe(false);
    expect((await decideRoute.POST(post({ decision: "approved" }), P(t.orgId, { apid: ap.id }))).status).toBe(403);

    actAs(t.manager);
    const d = await json(await decideRoute.POST(post({ decision: "approved", note: "Loyal customer" }), P(t.orgId, { apid: ap.id })));
    expect(d.body.approval).toMatchObject({ status: "approved" });
    expect((await decideRoute.POST(post({ decision: "rejected" }), P(t.orgId, { apid: ap.id }))).status).toBe(409);
    await drain();
    expect((await db.automationExecution.findUniqueOrThrow({ where: { id: ap.executionId } })).status).toBe("completed");
    const sent = await db.message.findFirst({ where: { conversationId: c.conversationId, direction: "outbound" }, orderBy: { createdAt: "desc" } });
    expect(sent?.body).toBe("Good news Simran, 10% off is approved!");
  });

  it("rejection and timeout take the Rejected path", async () => {
    const r = await inbound(t, "discount please");
    const tmo = await inbound(t, "discount?");
    await drain();
    actAs(t.owner);
    await decideRoute.POST(post({ decision: "rejected" }), P(t.orgId, { apid: (await pendingFor(r.contactId)).id }));
    // Nobody answers the second one: the timeout counts as rejected.
    const late = await pendingFor(tmo.contactId);
    await db.automationApproval.update({ where: { id: late.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await db.automationExecution.update({ where: { id: late.executionId }, data: { nextRunAt: new Date(Date.now() - 1000) } });
    await drain();
    expect(await tagsOf(r.contactId)).toEqual(["No discount"]);
    expect(await tagsOf(tmo.contactId)).toEqual(["No discount"]);
    expect((await db.automationApproval.findUniqueOrThrow({ where: { id: late.id } })).status).toBe("expired");
    expect((await decideRoute.POST(post({ decision: "approved" }), P(t.orgId, { apid: late.id }))).status).toBe(409);

    const an = await json(await analyticsRoute.GET(req("/x"), P(t.orgId, { aid })));
    expect(an.body.branches).toMatchObject({ ap: { approved: 1, rejected: 2 } });
  });

  it("a stopped run cancels its request; other workspaces can't decide", async () => {
    const s = await inbound(t, "discount now");
    await drain();
    const ap = await pendingFor(s.contactId);
    actAs(t.owner);
    await executionRoute.POST(post({ action: "stop" }), P(t.orgId, { eid: ap.executionId }));
    const list = await json(await approvalsRoute.GET(req("/x"), P(t.orgId)));
    expect((list.body.approvals as { id: string }[]).some((x) => x.id === ap.id)).toBe(false);
    expect((await db.automationApproval.findUniqueOrThrow({ where: { id: ap.id } })).status).toBe("cancelled");

    const other = await makeTenant();
    actAs(other.owner);
    expect((await decideRoute.POST(post({ decision: "approved" }), P(other.orgId, { apid: ap.id }))).status).toBe(404);
  });
});
