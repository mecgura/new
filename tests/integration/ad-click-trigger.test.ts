import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/background", () => ({ runAfterResponse: vi.fn() }));

import { db } from "@/lib/db";
import { actAs, addMember, json, makeOrg, makePlan, makeUser, params, req } from "../helpers";
import * as demoConnect from "@/app/api/organizations/[orgId]/whatsapp/connect/demo/route";
import * as automations from "@/app/api/organizations/[orgId]/automations/route";
import * as automation from "@/app/api/organizations/[orgId]/automations/[aid]/route";
import * as publishRoute from "@/app/api/organizations/[orgId]/automations/[aid]/publish/route";
import * as adSources from "@/app/api/organizations/[orgId]/automations/ad-sources/route";
import { runDueAutomations } from "@/services/automations/engine";
import { receiveInbound } from "@/services/inbox/messaging";
import { defaultData, type FlowNode, type Graph, type NodeDataMap, type NodeType } from "@/lib/automations";

const P = <E extends Record<string, string> = Record<never, string>>(orgId: string, extra?: E) => params({ orgId, ...(extra ?? ({} as E)) });
const post = (body: unknown) => req("/x", { method: "POST", body });
let orgId = "";
let accountId = "";
let n = 0;
const phone = () => `+9199${String(Date.now()).slice(-6)}${String(n++).padStart(2, "0")}`;
const AD_A = "120200000000111";
const AD_B = "120200000000222";

async function drain() {
  for (let i = 0; i < 30; i++) {
    const r = await runDueAutomations(20_000);
    if (!r.ran && !r.scheduled) return;
  }
}
async function say(from: string, body: string, adId?: string, headline = "Diwali offer: website in 7 days") {
  const referral = adId ? { sourceType: "ad", sourceId: adId, sourceUrl: "https://fb.me/x", headline, body: "", ctwaClid: "x" } : undefined;
  const r = await receiveInbound(orgId, accountId, { externalId: `t.${randomUUID()}`, fromPhone: from, profileName: "Ravi", type: "text", body, at: new Date(), isDemo: true, ...(referral ? { referral } : {}) });
  await drain();
  return r!;
}
const sent = async (conversationId: string) => (await db.message.findMany({ where: { conversationId, direction: "outbound" }, orderBy: { createdAt: "asc" } })).map((m) => m.body);

const node = <T extends NodeType>(id: string, type: T, data: Partial<NodeDataMap[T]> = {}): FlowNode => ({ id, type, position: { x: 0, y: 0 }, data: { ...defaultData(type), ...data } as FlowNode["data"] });
const line = (...nodes: FlowNode[]): Graph => ({ nodes, edges: nodes.slice(1).map((x, i) => ({ id: `e${i}`, source: nodes[i].id, target: x.id, sourceHandle: null })) });

async function publish(name: string, graph: Graph) {
  const c = await json(await automations.POST(post({ name, whatsappAccountId: accountId }), P(orgId)));
  const aid = (c.body.automation as { id: string }).id;
  const r = await automation.PATCH(req("/x", { method: "PATCH", body: { graph } }), P(orgId, { aid }));
  expect(r.status).toBe(200);
  expect((await publishRoute.POST(post({}), P(orgId, { aid }))).status).toBe(200);
  return aid;
}

beforeAll(async () => {
  orgId = (await makeOrg("Ad Click")).id;
  const [owner, agent] = await Promise.all([makeUser({ name: "Owner" }), makeUser({ name: "Agent" })]);
  await addMember(orgId, owner.id, "CLIENT_OWNER");
  await addMember(orgId, agent.id, "AGENT");
  const plan = await makePlan({ maxUsers: 5, maxWhatsAppNumbers: 2 });
  await db.subscription.create({ data: { organizationId: orgId, planId: plan.id, priceMonthly: plan.priceMonthly } });
  await db.organizationService.create({ data: { organizationId: orgId, service: "WHATSAPP_AUTOMATION", enabled: true } });
  actAs(owner);
  const d = await json(await demoConnect.POST(post({ businessName: "Ad Click" }), P(orgId)));
  accountId = (d.body.account as { id: string }).id;

  await publish("Welcome", line(node("t", "trigger", { trigger: "new_contact", sources: ["whatsapp"] }), node("w", "message", { text: "General welcome", waitForReply: true, buttons: ["Yes", "No"], replyTimeoutMinutes: 60 }), node("e", "end")));
  await publish("Ad A flow", line(node("t", "trigger", { trigger: "ad_click", adIds: [AD_A] }), node("m", "message", { text: "Thanks for tapping “{{ad.headline}}”!" }), node("e", "end")));
});

describe("Ad click trigger", () => {
  it("a new customer from the chosen ad gets that ad's automation, not the general welcome", async () => {
    const c = await say(phone(), "Hi, tell me more", AD_A);
    expect(await sent(c.conversationId)).toEqual(["Thanks for tapping “Diwali offer: website in 7 days”!"]);
  });

  it("other ads and organic messages get the general welcome", async () => {
    const b = await say(phone(), "Hi", AD_B);
    expect(await sent(b.conversationId)).toEqual(["General welcome"]);
    const o = await say(phone(), "Hi");
    expect(await sent(o.conversationId)).toEqual(["General welcome"]);
  });

  it("an existing contact tapping the ad later switches to the ad's flow", async () => {
    const from = phone();
    const first = await say(from, "Hello");
    expect(await sent(first.conversationId)).toEqual(["General welcome"]);
    await say(from, "Saw your ad", AD_A);
    expect((await sent(first.conversationId)).at(-1)).toContain("Thanks for tapping");
    const runs = await db.automationExecution.findMany({ where: { contactId: first.contactId }, orderBy: { createdAt: "asc" } });
    expect(runs.map((r) => r.status)).toEqual(["stopped", "completed"]);
  });

  it("lists ads customers came from, with their headline, for the picker", async () => {
    const r = await json(await adSources.GET(req("/x"), P(orgId)));
    expect(r.status).toBe(200);
    const ads = r.body.ads as { adId: string; name: string; leads: number }[];
    expect(ads.find((a) => a.adId === AD_A)).toMatchObject({ name: "Diwali offer: website in 7 days" });
    expect(ads.find((a) => a.adId === AD_A)!.leads).toBeGreaterThanOrEqual(2);
  });

  it("rejects ad ids that aren't Meta ids", async () => {
    const c = await json(await automations.POST(post({ name: "Bad", whatsappAccountId: accountId }), P(orgId)));
    const aid = (c.body.automation as { id: string }).id;
    const g = line(node("t", "trigger", { trigger: "ad_click", adIds: ["<script>"] }), node("e", "end"));
    expect((await automation.PATCH(req("/x", { method: "PATCH", body: { graph: g } }), P(orgId, { aid }))).status).toBe(400);
  });
});
