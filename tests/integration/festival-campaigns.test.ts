import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/background", () => ({ runAfterResponse: vi.fn() }));

import { db } from "@/lib/db";
import { actAs, addMember, json, makeOrg, makePlan, makeUser, params, req } from "../helpers";
import * as demoConnect from "@/app/api/organizations/[orgId]/whatsapp/connect/demo/route";
import * as planner from "@/app/api/organizations/[orgId]/campaigns/festivals/route";
import * as submit from "@/app/api/organizations/[orgId]/templates/[tid]/submit/route";
import * as review from "@/app/api/organizations/[orgId]/templates/[tid]/review/route";
import { saveFestivals, type Festival } from "@/services/site/festivals";
import { festivalMorning, greetingBody, templateNameFor } from "@/services/campaigns/festival";

const post = (body: unknown) => req("/x", { method: "POST", body });
const P = <E extends Record<string, string> = Record<never, string>>(orgId: string, extra?: E) => params({ orgId, ...(extra ?? ({} as E)) });
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

let orgId: string;
let owner: Awaited<ReturnType<typeof makeUser>>;
let agent: Awaited<ReturnType<typeof makeUser>>;
let accountId: string;
let wabaId: string;
const fest: Festival = { id: "testfest-x", name: "Testival", emoji: "🪔", start: inDays(10), days: 1, greeting: "", offer: "", offerCode: "", effect: "fireworks", showOnSite: true, showToClients: true, hasPhoto: false };

beforeAll(async () => {
  const org = await makeOrg("Festival Shop");
  orgId = org.id;
  [owner, agent] = await Promise.all([makeUser({ name: "Owner" }), makeUser({ name: "Agent" })]);
  await addMember(orgId, owner.id, "CLIENT_OWNER");
  await addMember(orgId, agent.id, "AGENT");
  const plan = await makePlan({ maxUsers: 5, maxWhatsAppNumbers: 2 });
  await db.subscription.create({ data: { organizationId: orgId, planId: plan.id, priceMonthly: plan.priceMonthly } });
  await db.organizationService.create({ data: { organizationId: orgId, service: "WHATSAPP_AUTOMATION", enabled: true } });
  actAs(owner);
  const d = await json(await demoConnect.POST(post({ businessName: "Festival Shop" }), P(orgId)));
  accountId = (d.body.account as { id: string }).id;
  wabaId = (await db.whatsAppAccount.findUniqueOrThrow({ where: { id: accountId } })).wabaRecordId!;
  await saveFestivals({ enabled: true, festivals: [fest, { ...fest, id: "far-away-x", start: inDays(120) }] });
});

describe("festival campaigns", () => {
  it("builds a compliant greeting body", () => {
    const body = greetingBody(fest, "Sharma Sweets", "20% off till Sunday.");
    expect(body.startsWith("Hi {{1}},")).toBe(true);
    expect(body).toContain("20% off till Sunday.");
    expect(body.endsWith("Sharma Sweets")).toBe(true);
    expect(templateNameFor(fest)).toMatch(/^[a-z0-9_]+$/);
    expect(festivalMorning(fest).toISOString()).toBe(`${fest.start}T04:00:00.000Z`);
  });

  it("lists festivals in the next 60 days with this workspace's numbers", async () => {
    actAs(owner);
    const r = await json(await planner.GET(req("/x"), P(orgId)));
    expect(r.status).toBe(200);
    const list = r.body.festivals as { id: string; inDays: number }[];
    expect(list.map((f) => f.id)).toContain("testfest-x");
    expect(list.map((f) => f.id)).not.toContain("far-away-x");
    expect((r.body.numbers as unknown[]).length).toBe(1);
  });

  it("drafts the template, then a scheduled campaign that uses it once approved", async () => {
    actAs(owner);
    const t = await json(await planner.POST(post({ action: "template", festivalId: "testfest-x", wabaId, businessName: "Festival Shop", offer: "Free gift box." }), P(orgId)));
    expect(t.status).toBe(201);
    const tid = (t.body as { templateId: string }).templateId;
    const tpl = await db.messageTemplate.findUniqueOrThrow({ where: { id: tid } });
    expect(tpl).toMatchObject({ category: "MARKETING", status: "draft", name: templateNameFor(fest) });
    // Same festival again returns the same draft.
    expect(((await json(await planner.POST(post({ action: "template", festivalId: "testfest-x", wabaId }), P(orgId)))).body as { templateId: string }).templateId).toBe(tid);

    expect((await submit.POST(post({}), P(orgId, { tid }))).status).toBe(200);
    expect((await review.POST(post({ decision: "approved" }), P(orgId, { tid }))).status).toBe(200);

    const c = await json(await planner.POST(post({ action: "campaign", festivalId: "testfest-x", whatsappAccountId: accountId }), P(orgId)));
    expect(c.status).toBe(201);
    const camp = await db.campaign.findUniqueOrThrow({ where: { id: (c.body as { campaignId: string }).campaignId } });
    expect(camp).toMatchObject({ status: "draft", templateId: tid });
    expect(camp.scheduledAt?.toISOString()).toBe(`${fest.start}T04:00:00.000Z`);
    expect(JSON.parse(camp.audience).filters.consent).toEqual(["opted_in"]);
    expect(JSON.parse(camp.variables)["body.1"]).toMatchObject({ field: "first_name", fallback: "there" });

    const again = await json(await planner.POST(post({ action: "campaign", festivalId: "testfest-x", whatsappAccountId: accountId }), P(orgId)));
    expect((again.body as { campaignId: string }).campaignId).toBe(camp.id);
  });

  it("agents can look but not create; unknown festivals are refused", async () => {
    actAs(agent);
    expect((await planner.GET(req("/x"), P(orgId))).status).toBe(200);
    expect((await planner.POST(post({ action: "campaign", festivalId: "testfest-x", whatsappAccountId: accountId }), P(orgId))).status).toBe(403);
    actAs(owner);
    expect((await planner.POST(post({ action: "campaign", festivalId: "nope", whatsappAccountId: accountId }), P(orgId))).status).toBe(404);
  });
});
