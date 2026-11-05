import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";

// Replays a real Click-to-WhatsApp ad chat that went wrong: stale button taps, restarts, Hindi speaker, silent nights.
vi.mock("@/lib/background", () => ({ runAfterResponse: vi.fn() }));

import { db } from "@/lib/db";
import { actAs, addMember, json, makeOrg, makePlan, makeUser, params, req } from "../helpers";
import * as demoConnect from "@/app/api/organizations/[orgId]/whatsapp/connect/demo/route";
import * as automations from "@/app/api/organizations/[orgId]/automations/route";
import * as automation from "@/app/api/organizations/[orgId]/automations/[aid]/route";
import * as publishRoute from "@/app/api/organizations/[orgId]/automations/[aid]/publish/route";
import { runDueAutomations, looksLikeName, asksForOtherLanguage, LANG_HELP_REPLY } from "@/services/automations/engine";
import { receiveInbound } from "@/services/inbox/messaging";
import { AUTOMATION_LIBRARY } from "@/lib/automation-library";
import { renderText, type Graph, type TriggerData } from "@/lib/automations";

const P = <E extends Record<string, string> = Record<never, string>>(orgId: string, extra?: E) => params({ orgId, ...(extra ?? ({} as E)) });
const post = (body: unknown) => req("/x", { method: "POST", body });
let orgId = "";
let accountId = "";
let n = 0;
const phone = () => `+9197${String(Date.now()).slice(-6)}${String(n++).padStart(2, "0")}`;

async function drain() {
  for (let i = 0; i < 30; i++) {
    const r = await runDueAutomations(20_000);
    if (!r.ran && !r.scheduled) return;
  }
}
async function say(from: string, body: string, type: "text" | "button" = "text", name = "akash701426") {
  const r = await receiveInbound(orgId, accountId, { externalId: `t.${randomUUID()}`, fromPhone: from, profileName: name, type, body, at: new Date(), isDemo: true });
  await drain();
  return r!;
}
const outbound = async (conversationId: string) => (await db.message.findMany({ where: { conversationId, direction: "outbound" }, orderBy: { createdAt: "asc" } })).map((m) => m.body);
const runs = (contactId: string) => db.automationExecution.findMany({ where: { contactId }, orderBy: { createdAt: "asc" } });

/** The library flow, but started by any incoming message (the worst case for restart loops). */
function flow(variant: "library" | "old_timeout" = "library"): Graph {
  const g = AUTOMATION_LIBRARY.find((t) => t.id === "lead_qualification")!.graph();
  const t = g.nodes.find((x) => x.type === "trigger")!;
  t.data = { ...(t.data as TriggerData), trigger: "incoming_message" };
  if (variant === "old_timeout") {
    const e = g.edges.find((x) => x.source === "has_name" && x.sourceHandle === "no")!;
    e.target = "q_city";
    g.nodes = g.nodes.filter((x) => x.id !== "end_quiet");
  }
  return g;
}
async function publish(name: string, graph: Graph) {
  await db.automation.updateMany({ where: { organizationId: orgId }, data: { status: "inactive" } });
  const c = await json(await automations.POST(post({ name, whatsappAccountId: accountId }), P(orgId)));
  const aid = (c.body.automation as { id: string }).id;
  expect((await automation.PATCH(req("/x", { method: "PATCH", body: { graph } }), P(orgId, { aid }))).status).toBe(200);
  expect((await publishRoute.POST(post({}), P(orgId, { aid }))).status).toBe(200);
  return aid;
}

beforeAll(async () => {
  orgId = (await makeOrg("Lead Flow Fix")).id;
  const [owner, agent] = await Promise.all([makeUser({ name: "Owner" }), makeUser({ name: "Agent" })]);
  await addMember(orgId, owner.id, "CLIENT_OWNER");
  await addMember(orgId, agent.id, "AGENT");
  const plan = await makePlan({ maxUsers: 5, maxWhatsAppNumbers: 2 });
  await db.subscription.create({ data: { organizationId: orgId, planId: plan.id, priceMonthly: plan.priceMonthly } });
  await db.organizationService.create({ data: { organizationId: orgId, service: "WHATSAPP_AUTOMATION", enabled: true } });
  actAs(owner);
  const d = await json(await demoConnect.POST(post({ businessName: "Lead Flow Fix" }), P(orgId)));
  accountId = (d.body.account as { id: string }).id;
});

describe("lead qualification flow — real-chat fixes", () => {
  it("helpers: names, language requests, WhatsApp handles", () => {
    expect(looksLikeName("Aachal kumari")).toBe(true);
    expect(looksLikeName("Mujhe English nahin samajh a rahi aapki")).toBe(false);
    expect(looksLikeName("Price list")).toBe(false);
    expect(looksLikeName("akash701426")).toBe(false);
    expect(asksForOtherLanguage("Mujhe English nahin samajh a rahi aapki")).toBe(true);
    expect(asksForOtherLanguage("Mujhe English nahin aati")).toBe(true);
    expect(asksForOtherLanguage("Hindi me baat karo")).toBe(true);
    expect(asksForOtherLanguage("Ludhiana")).toBe(false);
    expect(renderText("Hi {{contact.first_name}}", { contact: { name: "akash701426", phone: "", email: "", customFields: {}, tags: [], leadStatus: "", source: "", optInStatus: "" } as never, reply: "", ai: "", trigger: "" })).toBe("Hi there");
  });

  it("ignores stale button taps and doesn't restart after finishing", async () => {
    const aid = await publish("Qualify", flow());
    const from = phone();
    const first = await say(from, "Hi");
    expect((await outbound(first.conversationId)).join(" ")).not.toContain("akash701426");
    await say(from, "Aachal kumari");
    await say(from, "Ludhiana");
    await say(from, "Price list", "button");
    await say(from, "Talk to team", "button"); // tapped on the old question — not the budget answer
    let [ex] = await runs(first.contactId);
    expect(ex).toMatchObject({ status: "running", waitState: "reply", currentNodeId: "s_budget" });
    await say(from, "Product / service", "button"); // also stale
    await say(from, "Under ₹10k", "button");
    await say(from, "Just exploring", "button");
    [ex] = await runs(first.contactId);
    expect(ex.status).toBe("completed");
    const contact = await db.contact.findUniqueOrThrow({ where: { id: first.contactId } });
    expect(contact.name).toBe("Aachal kumari");
    expect(JSON.parse(contact.customFields)).toMatchObject({ city: "Ludhiana", requirement: "Price list", budget: "Under ₹10k", timeline: "Just exploring" });

    // Their next message does not start the questions again.
    await say(from, "ok thanks");
    expect((await runs(first.contactId)).filter((r) => r.automationId === aid)).toHaveLength(1);
    const sent = await outbound(first.conversationId);
    expect(sent.filter((b) => b.startsWith("Namaste"))).toHaveLength(1);
  });

  it("hands a Hindi speaker to the team instead of saving the sentence as a name", async () => {
    const from = phone();
    const first = await say(from, "Hi");
    await say(from, "Mujhe English nahin samajh a rahi aapki");
    const [ex] = await runs(first.contactId);
    expect(ex.status).toBe("completed");
    const sent = await outbound(first.conversationId);
    expect(sent.at(-1)).toBe(LANG_HELP_REPLY);
    expect(sent.some((b) => b.includes("city"))).toBe(false);
    const conv = await db.conversation.findUniqueOrThrow({ where: { id: first.conversationId } });
    expect(conv.assignedToUserId).not.toBeNull();
    expect((await db.contact.findUniqueOrThrow({ where: { id: first.contactId } })).name).toBe("akash701426");
  });

  it("a silent customer is not sent more questions through the night", async () => {
    for (const variant of ["library", "old_timeout"] as const) {
      await publish(`Qualify ${variant}`, flow(variant));
      const from = phone();
      const first = await say(from, "Hi");
      for (let i = 0; i < 4; i++) {
        await db.automationExecution.updateMany({ where: { contactId: first.contactId, status: "running" }, data: { nextRunAt: new Date(Date.now() - 1000) } });
        await drain();
      }
      const [ex] = await runs(first.contactId);
      expect(ex.status, variant).toBe("completed");
      const questions = (await outbound(first.conversationId)).filter((b) => b.includes("?"));
      // library: only the name question; the old flow asked for the city once more, then stopped.
      expect(questions.length, variant).toBe(variant === "library" ? 1 : 2);
    }
  });
});
