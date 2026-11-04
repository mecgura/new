import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/background", () => ({ runAfterResponse: vi.fn() }));

import { db } from "@/lib/db";
import { actAs, addMember, json, makeOrg, makePlan, makeUser, params, req } from "../helpers";
import * as demoConnect from "@/app/api/organizations/[orgId]/whatsapp/connect/demo/route";
import * as templates from "@/app/api/organizations/[orgId]/templates/route";
import * as submit from "@/app/api/organizations/[orgId]/templates/[tid]/submit/route";
import * as review from "@/app/api/organizations/[orgId]/templates/[tid]/review/route";
import * as campaigns from "@/app/api/organizations/[orgId]/campaigns/route";
import * as campaign from "@/app/api/organizations/[orgId]/campaigns/[cid]/route";
import * as campaignReview from "@/app/api/organizations/[orgId]/campaigns/[cid]/review/route";
import * as launch from "@/app/api/organizations/[orgId]/campaigns/[cid]/launch/route";
import * as insights from "@/app/api/organizations/[orgId]/campaigns/[cid]/insights/route";
import * as performance from "@/app/api/organizations/[orgId]/campaigns/performance/route";
import { processCampaign } from "@/services/campaigns/sender";
import { assignVariant, compare, explainError } from "@/lib/campaign-insights";

const post = (body: unknown) => req("/x", { method: "POST", body });
const patch = (body: unknown) => req("/x", { method: "PATCH", body });

describe("A/B maths", () => {
  it("assigns each person a stable arm close to the split", () => {
    const phones = Array.from({ length: 2000 }, (_, i) => `+9190000${String(i).padStart(5, "0")}`);
    const b = phones.filter((p) => assignVariant("camp1", p, 30) === "B").length;
    expect(b / phones.length).toBeGreaterThan(0.25);
    expect(b / phones.length).toBeLessThan(0.35);
    expect(phones.every((p) => assignVariant("camp1", p, 30) === assignVariant("camp1", p, 30))).toBe(true);
    expect(assignVariant("camp1", phones[0], 0)).toBe("A");
  });

  it("only calls a winner with enough people and a real difference", () => {
    expect(compare("reply rate", 2, 20, 6, 20).winner).toBeNull(); // too few people
    expect(compare("reply rate", 20, 200, 22, 200).winner).toBeNull(); // too close
    const v = compare("reply rate", 12, 150, 40, 150);
    expect(v).toMatchObject({ winner: "B", confident: true });
    expect(v.pValue).toBeLessThan(0.05);
    expect(explainError("(#131049) This message was not delivered to maintain healthy ecosystem engagement.").title).toContain("Meta limited marketing");
    expect(explainError("something odd").title).toBe("Other error");
  });
});

describe("A/B campaign end to end", () => {
  let orgId = "";
  let owner: Awaited<ReturnType<typeof makeUser>>;
  let accountId = "";
  let wabaId = "";
  const P = <E extends Record<string, string> = Record<never, string>>(extra?: E) => params({ orgId, ...(extra ?? ({} as E)) });

  async function approved(name: string, body: string) {
    const c = await json(await templates.POST(post({ wabaId, language: "en", name, category: "MARKETING", body, examples: { body: ["Priya"] } }), P()));
    expect(c.status).toBe(201);
    const tid = (c.body.template as { id: string }).id;
    await submit.POST(post({}), params({ orgId, tid }));
    await review.POST(post({ decision: "approved" }), params({ orgId, tid }));
    return tid;
  }

  beforeAll(async () => {
    const org = await makeOrg("AB Shop");
    orgId = org.id;
    owner = await makeUser({ name: "Owner" });
    await addMember(orgId, owner.id, "CLIENT_OWNER");
    const plan = await makePlan({ maxUsers: 5, maxWhatsAppNumbers: 2 });
    await db.plan.update({ where: { id: plan.id }, data: { maxContacts: 10_000, maxMonthlyMessages: -1 } });
    await db.subscription.create({ data: { organizationId: orgId, planId: plan.id, priceMonthly: plan.priceMonthly } });
    await db.organizationService.create({ data: { organizationId: orgId, service: "WHATSAPP_AUTOMATION", enabled: true } });
    actAs(owner);
    const d = await json(await demoConnect.POST(post({ businessName: "AB Shop" }), P()));
    accountId = (d.body.account as { id: string }).id;
    wabaId = (await db.whatsAppAccount.findUniqueOrThrow({ where: { id: accountId } })).wabaRecordId!;
    const base = Date.now().toString().slice(-5);
    await db.contact.createMany({ data: Array.from({ length: 300 }, (_, i) => ({ organizationId: orgId, phone: `+9193${base}${String(i).padStart(3, "0")}`, name: `Customer ${i}`, optInStatus: "opted_in" })) });
  });

  it("validates version B, splits the audience, sends each arm its own template and reports a winner with ROI", async () => {
    actAs(owner);
    const tA = await approved("offer_plain", "Hi {{1}}, our Diwali sale is on. Reply STOP to opt out.");
    const tB = await approved("offer_question", "Hi {{1}}, want 20% off this Diwali? Reply YES. Reply STOP to opt out.");
    const util = (await json(await templates.POST(post({ wabaId, language: "en", name: "order_note", category: "UTILITY", body: "Order {{1}} is ready.", examples: { body: ["123"] } }), P()))).body.template as { id: string };
    await submit.POST(post({}), params({ orgId, tid: util.id }));
    await review.POST(post({ decision: "approved" }), params({ orgId, tid: util.id }));

    const cid = ((await json(await campaigns.POST(post({ name: "Diwali A/B", whatsappAccountId: accountId }), P()))).body.campaign as { id: string }).id;
    const C = P({ cid });
    await campaign.PATCH(patch({ audience: { mode: "all" }, templateId: tA, variables: { "body.1": { source: "field", field: "first_name", key: "", fallback: "there" } } }), C);
    expect((await campaign.PATCH(patch({ abTemplateId: tA }), C)).status).toBe(400); // same as A
    expect((await campaign.PATCH(patch({ abTemplateId: util.id }), C)).status).toBe(400); // different category
    expect((await campaign.PATCH(patch({ abSplit: 70 }), C)).status).toBe(400);
    const set = await json(await campaign.PATCH(patch({ abTemplateId: tB, abSplit: 50 }), C));
    expect(set.body.campaign).toMatchObject({ ab: { split: 50, template: { id: tB } } });

    // Review fails until B's variables are filled.
    const r1 = await json(await campaignReview.POST(post({}), C));
    expect((r1.body.review as { checks: { key: string; status: string }[] }).checks.find((c) => c.key === "ab")?.status).toBe("fail");
    await campaign.PATCH(patch({ abVariables: { "body.1": { source: "field", field: "first_name", key: "", fallback: "there" } } }), C);
    const r2 = await json(await campaignReview.POST(post({}), C));
    expect((r2.body.review as { canSend: boolean }).canSend).toBe(true);
    expect((await launch.POST(post({ confirmConsent: true }), C)).status).toBe(200);

    const rows = await db.campaignRecipient.findMany({ where: { campaignId: cid } });
    const bCount = rows.filter((r) => r.variant === "B").length;
    expect(bCount).toBeGreaterThan(110);
    expect(bCount).toBeLessThan(190);
    await processCampaign(cid, 60_000);
    const msgs = await db.message.findMany({ where: { organizationId: orgId, direction: "outbound" }, select: { body: true, payload: true } });
    const viaB = msgs.filter((m) => m.body.includes("Reply YES"));
    expect(viaB.length).toBe(bCount);
    expect(viaB.every((m) => (JSON.parse(m.payload) as { variant?: string }).variant === "B")).toBe(true);

    // Outcomes: everyone delivered; B replies far more; two B repliers open deals, one is won.
    const now = new Date();
    await db.campaignRecipient.updateMany({ where: { campaignId: cid }, data: { deliveredAt: now, status: "delivered" } });
    const sentRows = await db.campaignRecipient.findMany({ where: { campaignId: cid }, orderBy: { phone: "asc" } });
    const A = sentRows.filter((r) => r.variant === "A");
    const B = sentRows.filter((r) => r.variant === "B");
    for (const r of [...A.slice(0, Math.round(A.length * 0.08)), ...B.slice(0, Math.round(B.length * 0.3))]) await db.campaignRecipient.update({ where: { id: r.id }, data: { repliedAt: now, readAt: now } });
    await db.campaignRecipient.update({ where: { id: A.at(-1)!.id }, data: { status: "failed", error: "(#131026) Message undeliverable." } });
    const stage = await db.pipelineStage.create({ data: { organizationId: orgId, name: "Won", kind: "won", probability: 100, position: 99 } });
    await db.deal.create({ data: { organizationId: orgId, contactId: B[0].contactId!, stageId: stage.id, title: "Diwali order", valuePaise: 500_000, status: "won", closedAt: new Date(now.getTime() + 60_000), createdAt: new Date(now.getTime() + 30_000) } });
    await db.purchase.create({ data: { organizationId: orgId, contactId: B[1].contactId!, amountPaise: 120_000, createdAt: new Date(now.getTime() + 60_000) } });

    const ins = await json(await insights.GET(req("/x"), C));
    expect(ins.status).toBe(200);
    const ab = ins.body.ab as { replyRate: { winner: string | null; confident: boolean }; a: { template: string }; b: { template: string; leads: number } };
    expect(ab.replyRate).toMatchObject({ winner: "B", confident: true });
    expect(ab.b).toMatchObject({ template: "offer_question", leads: 1 });
    const roi = ins.body.roi as { leads: number; wonDeals: number; purchases: number; revenueRupees: number; estimatedCostRupees: number };
    expect(roi).toMatchObject({ leads: 1, wonDeals: 1, purchases: 1, revenueRupees: 6200, estimatedCostRupees: 0 }); // demo number: no charges
    expect((ins.body.failures as { title: string }[])[0].title).toContain("Not on WhatsApp");
    expect((ins.body.recommendations as string[]).some((r) => r.includes("Keep version B"))).toBe(true);

    const perf = await json(await performance.GET(req("/x"), P()));
    expect((perf.body.campaigns as { id: string; abTest: boolean }[]).find((c) => c.id === cid)).toMatchObject({ abTest: true });
  });

  it("other workspaces can't read the insights", async () => {
    const stranger = await makeUser({ name: "Stranger" });
    const other = await makeOrg("Other AB");
    await addMember(other.id, stranger.id, "CLIENT_OWNER");
    const cid = (await db.campaign.findFirstOrThrow({ where: { organizationId: orgId } })).id;
    actAs(stranger);
    expect((await insights.GET(req("/x"), P({ cid }))).status).toBe(403);
    expect((await insights.GET(req("/x"), params({ orgId: other.id, cid }))).status).toBe(404);
  });
});
