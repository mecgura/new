import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/background", () => ({ runAfterResponse: vi.fn() }));

import { db } from "@/lib/db";
import { actAs, addMember, json, makeOrg, makePlan, makeUser, params, req } from "../helpers";
import * as demoConnect from "@/app/api/organizations/[orgId]/whatsapp/connect/demo/route";
import * as demoInbound from "@/app/api/organizations/[orgId]/inbox/demo/inbound/route";
import * as automations from "@/app/api/organizations/[orgId]/automations/route";
import * as automation from "@/app/api/organizations/[orgId]/automations/[aid]/route";
import * as publishRoute from "@/app/api/organizations/[orgId]/automations/[aid]/publish/route";
import * as testRoute from "@/app/api/organizations/[orgId]/automations/[aid]/test/route";
import { runDueAutomations } from "@/services/automations/engine";
import { defaultData, type FlowEdge, type FlowNode, type Graph, type NodeDataMap, type NodeType } from "@/lib/automations";

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
  const org = await makeOrg(`Subflow ${n++}`);
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

const component = (tag: string): Graph => ({
  nodes: [node("t", "trigger", { trigger: "subflow" }), node("tg", "tag", { tagName: tag }), node("lead", "update_contact", { field: "leadStatus", value: "qualified" })],
  edges: [edge("t", "tg"), edge("tg", "lead")],
});
async function unpublishedAutomation(t: Tenant, name: string) {
  actAs(t.owner);
  const c = await json(await automations.POST(post({ name, whatsappAccountId: t.accountId }), P(t.orgId)));
  return (c.body.automation as { id: string }).id;
}

describe("Run automation (sub-flows)", () => {
  let t: Tenant;
  let compId = "";
  beforeAll(async () => {
    t = await makeTenant();
    compId = await publish(t, "Qualify lead (component)", component("Qualified via component"));
  });

  it("a component never starts from events on its own", async () => {
    const c = await inbound(t, "hello there");
    await drain();
    expect(await db.automationExecution.count({ where: { automationId: compId, contactId: c.contactId } })).toBe(0);
  });

  it("waits for the sub-flow, then continues", async () => {
    const g: Graph = {
      nodes: [node("t", "trigger", { trigger: "keyword", keywords: ["price"], match: "contains" }), node("run", "run_automation", { automationId: compId, wait: true }), node("after", "tag", { tagName: "After component" })],
      edges: [edge("t", "run"), edge("run", "after")],
    };
    const parentId = await publish(t, "Price enquiry", g);
    const c = await inbound(t, "what is the price?");
    await drain();
    const parent = await db.automationExecution.findFirstOrThrow({ where: { automationId: parentId, contactId: c.contactId } });
    const child = await db.automationExecution.findFirstOrThrow({ where: { automationId: compId, contactId: c.contactId } });
    expect(child).toMatchObject({ status: "completed", depth: 1 });
    expect(JSON.parse(child.triggerData)).toMatchObject({ type: "subflow", from: "Price enquiry" });
    expect(parent.status).toBe("completed");
    const tags = await tagsOf(c.contactId);
    expect(tags.sort()).toEqual(["After component", "Qualified via component"]);
    expect((await db.contact.findUniqueOrThrow({ where: { id: c.contactId } })).leadStatus).toBe("qualified");
  });

  it("without waiting it starts the sub-flow and moves on; a failed sub-flow fails the waiting step", async () => {
    // A component that fails (webhook to an internal address is refused).
    const bad = await publish(t, "Broken component", { nodes: [node("t", "trigger", { trigger: "subflow" }), node("w", "webhook", { url: "https://internal.example.com/x", onError: "stop" })], edges: [edge("t", "w")] });
    const g: Graph = {
      nodes: [node("t", "trigger", { trigger: "keyword", keywords: ["broken"], match: "contains" }), node("run", "run_automation", { automationId: bad, wait: true, onError: "continue" }), node("after", "tag", { tagName: "Continued after failure" })],
      edges: [edge("t", "run"), edge("run", "after")],
    };
    const pid = await publish(t, "Uses broken", g);
    const c = await inbound(t, "this is broken");
    await drain();
    const steps = await db.automationExecutionStep.findMany({ where: { execution: { automationId: pid, contactId: c.contactId }, nodeId: "run" }, orderBy: { startedAt: "asc" } });
    expect(steps.at(-1)).toMatchObject({ status: "failed" });
    expect(steps.at(-1)!.error).toContain("sub-flow failed");
    expect(await tagsOf(c.contactId)).toEqual(["Continued after failure"]);
  });

  it("refuses loops, unpublished targets and too-deep nesting at publish time or run time", async () => {
    actAs(t.owner);
    // Self
    const self = await unpublishedAutomation(t, "Self caller");
    await automation.PATCH(patch({ graph: { nodes: [node("t", "trigger", { trigger: "keyword", keywords: ["x"] }), node("run", "run_automation", { automationId: self })], edges: [edge("t", "run")] } }), P(t.orgId, { aid: self }));
    const r1 = JSON.stringify((await json(await publishRoute.POST(post({}), P(t.orgId, { aid: self })))).body.details);
    expect(r1).toContain("can't run itself");
    // Unpublished target
    const draft = await unpublishedAutomation(t, "Draft component");
    const caller = await unpublishedAutomation(t, "Calls draft");
    await automation.PATCH(patch({ graph: { nodes: [node("t", "trigger", { trigger: "keyword", keywords: ["y"] }), node("run", "run_automation", { automationId: draft })], edges: [edge("t", "run")] } }), P(t.orgId, { aid: caller }));
    expect(JSON.stringify((await json(await publishRoute.POST(post({}), P(t.orgId, { aid: caller })))).body.details)).toContain("Publish “Draft component” first");
    // A → B → A loop is stopped at run time (B can't run A, which is already in the chain).
    const a = await publish(t, "Loop A", { nodes: [node("t", "trigger", { trigger: "keyword", keywords: ["loopy"] }), node("tg", "tag", { tagName: "A ran" })], edges: [edge("t", "tg")] });
    const b = await publish(t, "Loop B", { nodes: [node("t", "trigger", { trigger: "subflow" }), node("run", "run_automation", { automationId: a, wait: false, onError: "stop" })], edges: [edge("t", "run")] });
    await automation.PATCH(patch({ graph: { nodes: [node("t", "trigger", { trigger: "keyword", keywords: ["loopy"] }), node("run", "run_automation", { automationId: b, wait: true })], edges: [edge("t", "run")] } }), P(t.orgId, { aid: a }));
    expect((await publishRoute.POST(post({}), P(t.orgId, { aid: a }))).status).toBe(200);
    const c = await inbound(t, "loopy");
    await drain();
    const bRun = await db.automationExecution.findFirstOrThrow({ where: { automationId: b, contactId: c.contactId } });
    expect(bRun.status).toBe("failed");
    expect(bRun.error).toContain("can't run itself");
    expect(await db.automationExecution.count({ where: { automationId: a, contactId: c.contactId } })).toBe(1); // A never re-entered
  });

  it("test runs skip the sub-flow instead of starting a real run", async () => {
    const g: Graph = { nodes: [node("t", "trigger", { trigger: "keyword", keywords: ["zzz"] }), node("run", "run_automation", { automationId: compId })], edges: [edge("t", "run")] };
    const aid = await publish(t, "Test me", g);
    const c = await inbound(t, "hello again");
    const before = await db.automationExecution.count({ where: { automationId: compId } });
    const tr = await json(await testRoute.POST(post({ contactId: c.contactId, skipDelays: true }), P(t.orgId, { aid })));
    expect(tr.status).toBe(201);
    await drain();
    const { runExecution } = await import("@/services/automations/engine");
    await runExecution((tr.body as { executionId: string }).executionId);
    const step = await db.automationExecutionStep.findFirstOrThrow({ where: { executionId: (tr.body as { executionId: string }).executionId, nodeId: "run" } });
    expect(step.status).toBe("skipped");
    expect(await db.automationExecution.count({ where: { automationId: compId } })).toBe(before);
  });
});
