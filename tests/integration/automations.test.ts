import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// Runs are driven explicitly (no background work racing assertions); DNS is stubbed for webhook steps.
vi.mock("@/lib/background", () => ({ runAfterResponse: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup: vi.fn(async (host: string) => [{ address: host === "internal.example.com" ? "10.0.0.5" : "93.184.216.34", family: 4 }]) }));

import { db } from "@/lib/db";
import { actAs, addMember, json, makeOrg, makePlan, makeUser, params, req } from "../helpers";
import * as demoConnect from "@/app/api/organizations/[orgId]/whatsapp/connect/demo/route";
import * as demoInbound from "@/app/api/organizations/[orgId]/inbox/demo/inbound/route";
import * as contactsRoute from "@/app/api/organizations/[orgId]/contacts/route";
import * as templates from "@/app/api/organizations/[orgId]/templates/route";
import * as submit from "@/app/api/organizations/[orgId]/templates/[tid]/submit/route";
import * as review from "@/app/api/organizations/[orgId]/templates/[tid]/review/route";
import * as automations from "@/app/api/organizations/[orgId]/automations/route";
import * as automation from "@/app/api/organizations/[orgId]/automations/[aid]/route";
import * as publishRoute from "@/app/api/organizations/[orgId]/automations/[aid]/publish/route";
import * as statusRoute from "@/app/api/organizations/[orgId]/automations/[aid]/status/route";
import * as duplicateRoute from "@/app/api/organizations/[orgId]/automations/[aid]/duplicate/route";
import * as testRoute from "@/app/api/organizations/[orgId]/automations/[aid]/test/route";
import * as executionsRoute from "@/app/api/organizations/[orgId]/automations/[aid]/executions/route";
import * as analyticsRoute from "@/app/api/organizations/[orgId]/automations/[aid]/analytics/route";
import * as versionRoute from "@/app/api/organizations/[orgId]/automations/[aid]/versions/[vid]/route";
import * as secretRoute from "@/app/api/organizations/[orgId]/automations/[aid]/webhook-secret/route";
import * as executionRoute from "@/app/api/organizations/[orgId]/automations/executions/[eid]/route";
import * as hookRoute from "@/app/api/automations/hooks/[aid]/route";
import { runDueAutomations, runExecution, MAX_RETRIES } from "@/services/automations/engine";
import { defaultData, demoWorkflow, type FlowEdge, type FlowNode, type Graph, type NodeDataMap, type NodeType } from "@/lib/automations";

type U = Awaited<ReturnType<typeof makeUser>>;
type Tenant = { orgId: string; owner: U; manager: U; agent: U; agent2: U; accountId: string; wabaId: string };
let n = 0;
const phone = () => `+9196${String(Date.now()).slice(-6)}${String(n++).padStart(2, "0")}`;
const P = <E extends Record<string, string> = Record<never, string>>(orgId: string, extra?: E) => params({ orgId, ...(extra ?? ({} as E)) });
const post = (body: unknown) => req("/x", { method: "POST", body });
const patch = (body: unknown) => req("/x", { method: "PATCH", body });

async function makeTenant(): Promise<Tenant> {
  const org = await makeOrg(`Auto ${n++}`);
  const [owner, manager, agent, agent2] = await Promise.all([makeUser({ name: "Owner" }), makeUser({ name: "Manager" }), makeUser({ name: "Sales Agent" }), makeUser({ name: "Busy Agent" })]);
  await addMember(org.id, owner.id, "CLIENT_OWNER");
  await addMember(org.id, manager.id, "MANAGER");
  await addMember(org.id, agent.id, "AGENT");
  await addMember(org.id, agent2.id, "AGENT");
  const plan = await makePlan({ maxUsers: 20, maxWhatsAppNumbers: 3 });
  await db.plan.update({ where: { id: plan.id }, data: { maxContacts: 10_000 } });
  await db.subscription.create({ data: { organizationId: org.id, planId: plan.id, priceMonthly: plan.priceMonthly } });
  await db.organizationService.create({ data: { organizationId: org.id, service: "WHATSAPP_AUTOMATION", enabled: true } });
  actAs(owner);
  const d = await json(await demoConnect.POST(post({ businessName: "Demo Agency" }), P(org.id)));
  const accountId = (d.body.account as { id: string }).id;
  const acct = await db.whatsAppAccount.findUniqueOrThrow({ where: { id: accountId } });
  return { orgId: org.id, owner, manager, agent, agent2, accountId, wabaId: acct.wabaRecordId! };
}

/** Runs everything that's due until nothing is left (delays/waits stay pending). */
async function drain() {
  for (let i = 0; i < 20; i++) {
    const r = await runDueAutomations(20_000);
    if (!r.ran && !r.scheduled) return;
  }
}
/** Makes pending delays / timeouts / retries due now. */
async function fastForward(executionId: string) {
  await db.automationExecution.update({ where: { id: executionId }, data: { nextRunAt: new Date(Date.now() - 1000) } });
}

const node = <T extends NodeType>(id: string, type: T, data: Partial<NodeDataMap[T]> = {}): FlowNode => ({ id, type, position: { x: 0, y: 0 }, data: { ...defaultData(type), ...data } as FlowNode["data"] });
const edge = (source: string, target: string, sourceHandle: string | null = null): FlowEdge => ({ id: `${source}-${sourceHandle ?? "n"}-${target}`, source, target, sourceHandle });

async function createPublished(t: Tenant, name: string, graph: Graph, opts: { activate?: boolean } = {}) {
  const c = await json(await automations.POST(post({ name, whatsappAccountId: t.accountId }), P(t.orgId)));
  expect(c.status).toBe(201);
  const aid = (c.body.automation as { id: string }).id;
  expect((await automation.PATCH(patch({ graph }), P(t.orgId, { aid }))).status).toBe(200);
  const pub = await json(await publishRoute.POST(post({ note: "v1" }), P(t.orgId, { aid })));
  expect(pub.status).toBe(200);
  if (opts.activate === false) await statusRoute.POST(post({ action: "deactivate" }), P(t.orgId, { aid }));
  return aid;
}

async function inbound(t: Tenant, body: string, from = phone(), name = "Priya Sharma") {
  const r = await json(await demoInbound.POST(post({ whatsappAccountId: t.accountId, phone: from, name, body }), P(t.orgId)));
  expect(r.status).toBe(201);
  return { ...(r.body as { contactId: string; conversationId: string }), phone: from };
}

const steps = async (executionId: string) => (await db.automationExecutionStep.findMany({ where: { executionId }, orderBy: { startedAt: "asc" } })).map((s) => `${s.nodeId}:${s.status}`);

afterEach(() => vi.restoreAllMocks());

describe("demo workflow: New Contact → Welcome → Delay → Ask Requirement → Condition → Assign Sales", () => {
  let t: Tenant;
  let aid = "";
  beforeAll(async () => {
    t = await makeTenant();
    actAs(t.owner);
    const c = await json(await automations.POST(post({ name: "Welcome new contacts", whatsappAccountId: t.accountId, start: "demo_welcome" }), P(t.orgId)));
    aid = (c.body.automation as { id: string }).id;
    expect((c.body.automation as { graph: Graph }).graph.nodes.map((x) => x.id)).toEqual(demoWorkflow().nodes.map((x) => x.id));
    const pub = await json(await publishRoute.POST(post({}), P(t.orgId, { aid })));
    expect(pub.status).toBe(200);
    expect(pub.body.automation).toMatchObject({ status: "active", currentVersion: 1, triggerType: "new_contact" });
    // Agent 2 already holds a chat, so "least busy" picks agent 1.
    const busy = await inbound(t, "hello");
    await db.conversation.update({ where: { id: busy.conversationId }, data: { assignedToUserId: t.agent2.id } });
    await db.automationExecution.deleteMany({ where: { automationId: aid } });
  });

  it("runs the whole flow and routes a buyer to sales", async () => {
    const c = await inbound(t, "Hi, I saw your ad");
    const ex = await db.automationExecution.findFirstOrThrow({ where: { automationId: aid, contactId: c.contactId } });
    expect(ex).toMatchObject({ status: "queued", triggerType: "new_contact", version: 1 });
    await drain();

    // Welcome sent, now pausing.
    let cur = await db.automationExecution.findUniqueOrThrow({ where: { id: ex.id } });
    expect(cur).toMatchObject({ status: "running", waitState: "delay", currentNodeId: "ask" });
    const welcome = await db.message.findFirstOrThrow({ where: { conversationId: c.conversationId, direction: "outbound" }, orderBy: { createdAt: "asc" } });
    expect(welcome.body).toBe("Hi Priya 👋 Welcome! Thanks for reaching out — we're glad you're here.");
    expect(JSON.parse(welcome.payload)).toMatchObject({ automationId: aid, executionId: ex.id });

    await fastForward(ex.id);
    await drain();
    cur = await db.automationExecution.findUniqueOrThrow({ where: { id: ex.id } });
    expect(cur).toMatchObject({ status: "running", waitState: "reply", currentNodeId: "check" });
    const ask = await db.message.findFirstOrThrow({ where: { conversationId: c.conversationId, type: "interactive" } });
    expect(JSON.parse(ask.payload).buttons.map((b: { title: string }) => b.title)).toEqual(["Website", "Marketing", "Just browsing"]);

    // Customer taps "Website": the waiting run resumes (no new runs start for this message).
    await inbound(t, "Website", c.phone);
    await drain();
    cur = await db.automationExecution.findUniqueOrThrow({ where: { id: ex.id } });
    expect(cur.status).toBe("completed");
    expect(await steps(ex.id)).toEqual(["trigger:completed", "welcome:completed", "wait:completed", "ask:waiting", "check:completed", "sales:completed", "tag_lead:completed", "done:completed"]);
    const conv = await db.conversation.findUniqueOrThrow({ where: { id: c.conversationId }, include: { contact: { include: { tags: { include: { tag: true } } } } } });
    expect(conv.assignedToUserId).toBe(t.agent.id);
    expect(conv.contact.tags.map((x) => x.tag.name)).toContain("Sales lead");
    expect(await db.notification.count({ where: { userId: t.agent.id, title: { contains: "New chat assigned" } } })).toBe(1);
    expect(await db.message.count({ where: { conversationId: c.conversationId, type: "system", body: { contains: "assigned this chat" } } })).toBe(1);
    expect(await db.automationExecution.count({ where: { automationId: aid, contactId: c.contactId } })).toBe(1);
  });

  it("takes the No path for browsers, and a reply timeout continues with an empty reply", async () => {
    const c = await inbound(t, "hey");
    const ex = await db.automationExecution.findFirstOrThrow({ where: { automationId: aid, contactId: c.contactId } });
    await drain();
    await fastForward(ex.id);
    await drain();
    await inbound(t, "Just browsing", c.phone);
    await drain();
    expect(await steps(ex.id)).toEqual(expect.arrayContaining(["check:completed", "browse:completed", "done2:completed"]));
    expect((await db.conversation.findUniqueOrThrow({ where: { id: c.conversationId } })).assignedToUserId).toBeNull();
    const checkStep = await db.automationExecutionStep.findFirstOrThrow({ where: { executionId: ex.id, nodeId: "check" } });
    expect(JSON.parse(checkStep.output)).toMatchObject({ result: "no" });

    const silent = await inbound(t, "hello?");
    const ex2 = await db.automationExecution.findFirstOrThrow({ where: { automationId: aid, contactId: silent.contactId } });
    await drain();
    await fastForward(ex2.id);
    await drain();
    await fastForward(ex2.id); // reply timeout
    await drain();
    expect((await db.automationExecution.findUniqueOrThrow({ where: { id: ex2.id } })).status).toBe("completed");
    expect(await steps(ex2.id)).toContain("browse:completed");
  });

  it("STOP stops waiting runs; analytics and logs reflect the runs", async () => {
    const c = await inbound(t, "hi there");
    const ex = await db.automationExecution.findFirstOrThrow({ where: { automationId: aid, contactId: c.contactId } });
    await drain();
    await inbound(t, "STOP", c.phone);
    expect(await db.automationExecution.findUniqueOrThrow({ where: { id: ex.id } })).toMatchObject({ status: "stopped", error: "Contact opted out." });

    const a = await json(await analyticsRoute.GET(req("/x"), P(t.orgId, { aid })));
    expect(a.body.totals).toMatchObject({ completed: 3, stopped: 1 });
    expect((a.body.nodes as Record<string, Record<string, number>>).sales).toMatchObject({ completed: 1 });
    const logs = await json(await executionsRoute.GET(req("/x?status=completed"), P(t.orgId, { aid })));
    expect(logs.body.total).toBe(3);
    const detail = await json(await executionRoute.GET(req("/x"), P(t.orgId, { eid: ex.id })));
    expect((detail.body.execution as { steps: { label: string }[] }).steps[1].label).toBe("Welcome message");
  });
});

describe("builder rules, versions and lifecycle", () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await makeTenant();
  });

  it("refuses to publish loops, disconnected or incomplete steps", async () => {
    actAs(t.manager);
    const c = await json(await automations.POST(post({ name: "Broken" }), P(t.orgId)));
    const aid = (c.body.automation as { id: string }).id;
    const loop: Graph = {
      nodes: [node("t", "trigger"), node("m", "message", { text: "Hi" }), node("d", "delay")],
      edges: [edge("t", "m"), edge("m", "d"), edge("d", "m")],
    };
    await automation.PATCH(patch({ graph: loop }), P(t.orgId, { aid }));
    const r = await json(await publishRoute.POST(post({}), P(t.orgId, { aid })));
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body.details)).toMatch(/loops back/);

    const loose: Graph = { nodes: [node("t", "trigger"), node("m", "message", { text: "" }), node("x", "end")], edges: [edge("t", "m")] };
    await automation.PATCH(patch({ graph: loose }), P(t.orgId, { aid }));
    const r2 = JSON.stringify((await json(await publishRoute.POST(post({}), P(t.orgId, { aid })))).body.details);
    expect(r2).toMatch(/Write the message/);
    expect(r2).toMatch(/isn't connected to the trigger/);
    // Malformed node data never reaches the engine.
    expect((await automation.PATCH(patch({ graph: { nodes: [{ id: "t", type: "trigger", position: { x: 0, y: 0 }, data: { trigger: "hack" } }], edges: [] } }), P(t.orgId, { aid }))).status).toBe(400);
    // Activation needs a published version.
    expect((await statusRoute.POST(post({ action: "activate" }), P(t.orgId, { aid }))).status).toBe(409);
  });

  it("versions, restore, duplicate, deactivate and delete", async () => {
    actAs(t.owner);
    const g1: Graph = { nodes: [node("t", "trigger", { trigger: "keyword", keywords: ["price"] }), node("m", "message", { text: "Our prices start at ₹999." })], edges: [edge("t", "m")] };
    const aid = await createPublished(t, "Pricing bot", g1);
    const g2: Graph = { ...g1, nodes: [g1.nodes[0], node("m", "message", { text: "New prices!" })] };
    await automation.PATCH(patch({ graph: g2 }), P(t.orgId, { aid }));
    // The draft changed but the live version didn't.
    const c = await inbound(t, "price");
    await drain();
    expect((await db.message.findFirstOrThrow({ where: { conversationId: c.conversationId, direction: "outbound" } })).body).toBe("Our prices start at ₹999.");
    await publishRoute.POST(post({ note: "new copy" }), P(t.orgId, { aid }));
    const detail = await json(await automation.GET(req("/x"), P(t.orgId, { aid })));
    const versions = (detail.body.automation as { versions: { id: string; version: number; live: boolean }[] }).versions;
    expect(versions.map((v) => [v.version, v.live])).toEqual([[2, true], [1, false]]);
    const restored = await json(await versionRoute.POST(post({}), P(t.orgId, { aid, vid: versions[1].id })));
    expect(((restored.body.automation as { graph: Graph }).graph.nodes[1].data as { text: string }).text).toBe("Our prices start at ₹999.");

    const dup = await json(await duplicateRoute.POST(post({}), P(t.orgId, { aid })));
    expect(dup.body.automation).toMatchObject({ name: "Pricing bot (copy)", status: "draft", published: false });

    await statusRoute.POST(post({ action: "deactivate" }), P(t.orgId, { aid }));
    const before = await db.automationExecution.count({ where: { automationId: aid } });
    await inbound(t, "price");
    expect(await db.automationExecution.count({ where: { automationId: aid } })).toBe(before);

    expect((await automation.DELETE(req("/x", { method: "DELETE" }), P(t.orgId, { aid }))).status).toBe(200);
    expect(await db.automationExecution.count({ where: { automationId: aid } })).toBe(0);
  });

  it("agents can view but not build; other workspaces can't see anything", async () => {
    actAs(t.owner);
    const aid = await createPublished(t, "Private", { nodes: [node("t", "trigger", { trigger: "keyword", keywords: ["hi"] }), node("e", "end")], edges: [edge("t", "e")] });
    actAs(t.agent);
    expect((await automations.GET(req("/x"), P(t.orgId))).status).toBe(200);
    expect((await automations.POST(post({ name: "x" }), P(t.orgId))).status).toBe(403);
    expect((await publishRoute.POST(post({}), P(t.orgId, { aid }))).status).toBe(403);

    const other = await makeTenant();
    actAs(other.owner);
    expect((await automations.GET(req("/x"), P(t.orgId))).status).toBe(403);
    expect((await automation.GET(req("/x"), P(other.orgId, { aid }))).status).toBe(404);
    expect((await executionsRoute.GET(req("/x"), P(other.orgId, { aid }))).status).toBe(404);
    // Foreign templates / members are rejected at publish.
    const tpl = await db.messageTemplate.create({ data: { organizationId: t.orgId, wabaRecordId: t.wabaId, name: "foreign_tpl", language: "en", category: "UTILITY", status: "approved", body: "Hello there friend" } });
    const c = await json(await automations.POST(post({ name: "Steal" }), P(other.orgId)));
    const oid = (c.body.automation as { id: string }).id;
    await automation.PATCH(patch({ graph: { nodes: [node("t", "trigger"), node("tp", "template", { templateId: tpl.id }), node("as", "assign", { mode: "user", userId: t.agent.id })], edges: [edge("t", "tp"), edge("tp", "as")] } }), P(other.orgId, { aid: oid }));
    const r = JSON.stringify((await json(await publishRoute.POST(post({}), P(other.orgId, { aid: oid })))).body.details);
    expect(r).toMatch(/no longer exists/);
    expect(r).toMatch(/isn't in this workspace/);
  });
});

describe("execution engine safety", () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await makeTenant();
  });

  it("automations triggering each other stop instead of looping forever", async () => {
    actAs(t.owner);
    const a = await createPublished(t, "A adds Y", { nodes: [node("t", "trigger", { trigger: "tag_added", tagName: "X" }), node("g", "tag", { tagName: "Y" }), node("r", "tag", { action: "remove", tagName: "X" })], edges: [edge("t", "g"), edge("g", "r")] });
    const b = await createPublished(t, "B adds X", { nodes: [node("t", "trigger", { trigger: "tag_added", tagName: "Y" }), node("g", "tag", { tagName: "X" }), node("r", "tag", { action: "remove", tagName: "Y" })], edges: [edge("t", "g"), edge("g", "r")] });
    const c = await json(await contactsRoute.POST(post({ phone: phone(), name: "Loop Test", tags: ["X"] }), P(t.orgId)));
    const cid = (c.body.contact as { id: string }).id;
    await drain();
    await drain();
    const runs = await db.automationExecution.findMany({ where: { contactId: cid } });
    // A → B, then B's "add X" is not allowed to re-trigger A (already in the chain).
    expect(runs.filter((r) => r.automationId === a)).toHaveLength(1);
    expect(runs.filter((r) => r.automationId === b)).toHaveLength(1);
    expect(runs.map((r) => [r.status, r.depth]).sort()).toEqual([["completed", 0], ["completed", 1]]);
  });

  it("retries temporary webhook failures with backoff, then succeeds; permanent errors fail fast", async () => {
    actAs(t.owner);
    const aid = await createPublished(t, "CRM sync", {
      nodes: [node("t", "trigger", { trigger: "keyword", keywords: ["sync"] }), node("w", "webhook", { url: "https://crm.example.com/hook", onError: "stop" }), node("e", "end")],
      edges: [edge("t", "w"), edge("w", "e")],
    });
    let status = 503;
    const calls: { headers: Headers; body: string }[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_u, init) => {
      calls.push({ headers: new Headers(init?.headers), body: String(init?.body) });
      return new Response(JSON.stringify({ ok: status === 200 }), { status });
    });
    const c = await inbound(t, "sync");
    const ex = await db.automationExecution.findFirstOrThrow({ where: { automationId: aid, contactId: c.contactId } });
    await drain();
    expect(await db.automationExecution.findUniqueOrThrow({ where: { id: ex.id } })).toMatchObject({ status: "running", waitState: "retry", attempts: 1 });
    await fastForward(ex.id);
    await drain();
    expect((await db.automationExecution.findUniqueOrThrow({ where: { id: ex.id } })).attempts).toBe(2);
    status = 200;
    await fastForward(ex.id);
    await drain();
    expect((await db.automationExecution.findUniqueOrThrow({ where: { id: ex.id } })).status).toBe("completed");
    expect(await steps(ex.id)).toEqual(["t:completed", "w:retrying", "w:retrying", "w:completed", "e:completed"]);
    // Same idempotency key on every attempt so the receiver can de-duplicate.
    expect(new Set(calls.map((x) => x.headers.get("x-mecgura-idempotency-key"))).size).toBe(1);
    expect(JSON.parse(calls[0].body)).toMatchObject({ contact: { phone: c.phone }, trigger: { type: "keyword", text: "sync" } });

    // 4xx is permanent; exhausting retries also fails.
    status = 400;
    const c2 = await inbound(t, "sync");
    const ex2 = await db.automationExecution.findFirstOrThrow({ where: { automationId: aid, contactId: c2.contactId } });
    await drain();
    expect(await db.automationExecution.findUniqueOrThrow({ where: { id: ex2.id } })).toMatchObject({ status: "failed", error: expect.stringContaining("HTTP 400") });
    status = 500;
    const c3 = await inbound(t, "sync");
    const ex3 = await db.automationExecution.findFirstOrThrow({ where: { automationId: aid, contactId: c3.contactId } });
    for (let i = 0; i <= MAX_RETRIES; i++) {
      await drain();
      await fastForward(ex3.id);
    }
    await drain();
    expect((await db.automationExecution.findUniqueOrThrow({ where: { id: ex3.id } })).status).toBe("failed");
    expect((await steps(ex3.id)).filter((s) => s === "w:retrying")).toHaveLength(MAX_RETRIES);

    // Manual retry resumes from the failed step only.
    status = 200;
    const rr = await json(await executionRoute.POST(post({ action: "retry" }), P(t.orgId, { eid: ex3.id })));
    expect(rr.body.execution).toMatchObject({ status: "running" });
    await runExecution(ex3.id);
    expect((await db.automationExecution.findUniqueOrThrow({ where: { id: ex3.id } })).status).toBe("completed");
    expect((await steps(ex3.id)).filter((s) => s === "t:completed")).toHaveLength(1);
  });

  it("blocks webhooks to internal networks (SSRF)", async () => {
    actAs(t.owner);
    const aid = await createPublished(t, "Internal", {
      nodes: [node("t", "trigger", { trigger: "keyword", keywords: ["internal"] }), node("w", "webhook", { url: "https://internal.example.com/x", onError: "stop" })],
      edges: [edge("t", "w")],
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const c = await inbound(t, "internal");
    await drain();
    const ex = await db.automationExecution.findFirstOrThrow({ where: { automationId: aid, contactId: c.contactId } });
    expect(ex).toMatchObject({ status: "failed", error: expect.stringContaining("Private or internal") });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("respects the 24-hour window, consent and AI configuration", async () => {
    actAs(t.owner);
    // Manually added contact: no inbound message, so the window is closed.
    const aid = await createPublished(t, "Welcome manual", { nodes: [node("t", "trigger", { trigger: "new_contact", sources: ["manual"] }), node("m", "message", { text: "Welcome!" })], edges: [edge("t", "m")] });
    const c = await json(await contactsRoute.POST(post({ phone: phone(), name: "Cold Lead", optInStatus: "opted_in" }), P(t.orgId)));
    await drain();
    const ex = await db.automationExecution.findFirstOrThrow({ where: { automationId: aid, contactId: (c.body.contact as { id: string }).id } });
    expect(ex).toMatchObject({ status: "failed", error: expect.stringContaining("24-hour window is closed") });

    // With an approved fallback template it sends the template instead.
    const tc = await json(await templates.POST(post({ wabaId: t.wabaId, name: "welcome_back", language: "en", category: "UTILITY", body: "Hi {{1}}, thanks for registering with us. Reply here anytime!", examples: { body: ["Priya"] } }), P(t.orgId)));
    const tid = (tc.body.template as { id: string }).id;
    await submit.POST(post({}), P(t.orgId, { tid }));
    await review.POST(post({ decision: "approved" }), P(t.orgId, { tid }));
    const g: Graph = { nodes: [node("t", "trigger", { trigger: "new_contact", sources: ["manual"] }), node("m", "message", { text: "Welcome!", fallbackTemplateId: tid })], edges: [edge("t", "m")] };
    await automation.PATCH(patch({ graph: g }), P(t.orgId, { aid }));
    await publishRoute.POST(post({}), P(t.orgId, { aid }));
    const c2 = await json(await contactsRoute.POST(post({ phone: phone(), name: "Warm Lead" }), P(t.orgId)));
    await drain();
    const ex2 = await db.automationExecution.findFirstOrThrow({ where: { automationId: aid, contactId: (c2.body.contact as { id: string }).id } });
    expect(ex2.status).toBe("completed");
    const sent = await db.message.findFirstOrThrow({ where: { type: "template", conversation: { contactId: (c2.body.contact as { id: string }).id } } });
    expect(sent.body).toBe("Hi Warm, thanks for registering with us. Reply here anytime!");

    // Opted-out contacts are never messaged.
    const c3 = await json(await contactsRoute.POST(post({ phone: phone(), name: "Gone", optInStatus: "opted_out" }), P(t.orgId)));
    await drain();
    expect(await db.automationExecution.findFirstOrThrow({ where: { automationId: aid, contactId: (c3.body.contact as { id: string }).id } })).toMatchObject({ status: "failed", error: expect.stringContaining("opted out") });

    // AI step without ANTHROPIC_API_KEY fails clearly; "continue" carries on.
    const prev = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    const ai = await createPublished(t, "AI helper", {
      nodes: [node("t", "trigger", { trigger: "keyword", keywords: ["ask ai"] }), node("a", "ai_response", { instructions: "Answer politely.", onError: "continue" }), node("g", "tag", { tagName: "AI tried" })],
      edges: [edge("t", "a"), edge("a", "g")],
    });
    const ci = await inbound(t, "ask ai");
    await drain();
    const exAi = await db.automationExecution.findFirstOrThrow({ where: { automationId: ai, contactId: ci.contactId } });
    expect(exAi.status).toBe("completed");
    const aiStep = await db.automationExecutionStep.findFirstOrThrow({ where: { executionId: exAi.id, nodeId: "a" } });
    expect(aiStep).toMatchObject({ status: "failed", error: expect.stringContaining("ANTHROPIC_API_KEY") });
    if (prev !== undefined) process.env.ANTHROPIC_API_KEY = prev;
  });

  it("test runs skip delays; runs can be stopped; one live run per contact", async () => {
    actAs(t.owner);
    const c = await json(await automations.POST(post({ name: "Drip" }), P(t.orgId)));
    const aid = (c.body.automation as { id: string }).id;
    const g: Graph = { nodes: [node("t", "trigger", { trigger: "keyword", keywords: ["drip"] }), node("d", "delay", { amount: 2, unit: "days" }), node("u", "update_contact", { field: "leadStatus", value: "contacted" })], edges: [edge("t", "d"), edge("d", "u")] };
    await automation.PATCH(patch({ graph: g }), P(t.orgId, { aid }));
    const ct = await inbound(t, "hello");
    const tr = await json(await testRoute.POST(post({ contactId: ct.contactId, skipDelays: true }), P(t.orgId, { aid })));
    expect(tr.status).toBe(201);
    await runExecution((tr.body as { executionId: string }).executionId);
    const testEx = await db.automationExecution.findUniqueOrThrow({ where: { id: (tr.body as { executionId: string }).executionId } });
    expect(testEx).toMatchObject({ status: "completed", isTest: true, version: 0 });
    expect(await steps(testEx.id)).toEqual(["t:completed", "d:skipped", "u:completed"]);
    expect((await db.contact.findUniqueOrThrow({ where: { id: ct.contactId } })).leadStatus).toBe("contacted");

    await publishRoute.POST(post({}), P(t.orgId, { aid }));
    await inbound(t, "drip", ct.phone);
    await inbound(t, "drip", ct.phone); // second keyword while the first run waits → no parallel run
    await drain();
    const live = await db.automationExecution.findMany({ where: { automationId: aid, isTest: false } });
    expect(live).toHaveLength(1);
    expect(live[0]).toMatchObject({ status: "running", waitState: "delay" });
    const stop = await json(await executionRoute.POST(post({ action: "stop" }), P(t.orgId, { eid: live[0].id })));
    expect(stop.body.execution).toMatchObject({ status: "stopped" });
    await fastForward(live[0].id);
    await drain();
    expect((await db.automationExecution.findUniqueOrThrow({ where: { id: live[0].id } })).status).toBe("stopped");
  });

  it("inbound webhook and schedule triggers", async () => {
    actAs(t.owner);
    const aid = await createPublished(t, "Lead form", {
      nodes: [node("t", "trigger", { trigger: "webhook" }), node("u", "update_contact", { field: "custom", key: "form", value: "website" }), node("g", "tag", { tagName: "Website lead" })],
      edges: [edge("t", "u"), edge("u", "g")],
    });
    const s = await json(await secretRoute.POST(post({}), P(t.orgId, { aid })));
    const secret = (s.body as { secret: string }).secret;
    expect(secret).toMatch(/^whk_/);
    expect((await db.automation.findUniqueOrThrow({ where: { id: aid } })).webhookSecretHash).not.toContain(secret);
    const hook = (auth: string, body: unknown) => hookRoute.POST(new Request("http://localhost/api/automations/hooks/x", { method: "POST", headers: { authorization: auth, "content-type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({ aid }) });
    expect((await hook("Bearer wrong", { phone: "9876501234" })).status).toBe(401);
    const ok = await hook(`Bearer ${secret}`, { phone: "9876501234", name: "Form Lead", data: { budget: "50k" } });
    expect(ok.status).toBe(202);
    await drain();
    const contact = await db.contact.findUniqueOrThrow({ where: { organizationId_phone: { organizationId: t.orgId, phone: "+919876501234" } }, include: { tags: { include: { tag: true } } } });
    expect(contact).toMatchObject({ name: "Form Lead", source: "api" });
    expect(JSON.parse(contact.customFields)).toMatchObject({ form: "website" });
    expect(contact.tags.map((x) => x.tag.name)).toContain("Website lead");

    const sched = await createPublished(t, "Daily nudge", {
      nodes: [node("t", "trigger", { trigger: "schedule", schedule: { frequency: "daily", time: "00:00", days: [], tagName: "Website lead" } }), node("u", "update_contact", { field: "leadStatus", value: "qualified" })],
      edges: [edge("t", "u")],
    });
    await drain();
    await drain(); // same day → not again
    const runs = await db.automationExecution.findMany({ where: { automationId: sched } });
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ status: "completed", contactId: contact.id, triggerType: "schedule" });
  });
});
