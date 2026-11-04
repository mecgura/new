import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/background", () => ({ runAfterResponse: vi.fn() }));

import { db } from "@/lib/db";
import { actAs, addMember, json, makeOrg, makeUser, params, req } from "../helpers";
import * as dealsRoute from "@/app/api/organizations/[orgId]/deals/route";
import * as dealRoute from "@/app/api/organizations/[orgId]/deals/[id]/route";
import * as statsRoute from "@/app/api/organizations/[orgId]/deals/stats/route";
import * as stagesRoute from "@/app/api/organizations/[orgId]/deals/stages/route";
import * as scoringRoute from "@/app/api/organizations/[orgId]/deals/scoring/route";
import { DEFAULT_SCORING, scoreContact } from "@/lib/lead-scoring";

type U = Awaited<ReturnType<typeof makeUser>>;
let orgId: string;
let otherOrg: string;
let owner: U, agent: U, outsider: U;
let contactId: string;

function P(): { params: Promise<{ orgId: string }> };
function P(extra: { id: string }): { params: Promise<{ orgId: string; id: string }> };
function P(extra: { id?: string } = {}) {
  return params({ orgId, ...extra } as { orgId: string; id: string });
}
const body = (method: string, b: unknown) => req("/x", { method, body: b });

beforeAll(async () => {
  orgId = (await makeOrg("Deals Shop")).id;
  otherOrg = (await makeOrg("Other Shop")).id;
  [owner, agent, outsider] = await Promise.all([makeUser({ name: "Owner" }), makeUser({ name: "Agent Aman" }), makeUser({ name: "Outsider" })]);
  await addMember(orgId, owner.id, "CLIENT_OWNER");
  await addMember(orgId, agent.id, "AGENT");
  await addMember(otherOrg, outsider.id, "CLIENT_OWNER");
  contactId = (await db.contact.create({ data: { organizationId: orgId, phone: `+9198${Date.now().toString().slice(-8)}`, name: "Simran", email: "s@x.in", optInStatus: "opted_in", lastInboundAt: new Date() } })).id;
});

describe("deals pipeline", () => {
  it("creates the default stages once, even when opened twice at the same time", async () => {
    actAs(owner);
    const [a, b] = await Promise.all([stagesRoute.GET(req("/x"), P()), stagesRoute.GET(req("/x"), P())]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    const stages = await db.pipelineStage.findMany({ where: { organizationId: orgId }, orderBy: { position: "asc" } });
    expect(stages.map((s) => s.name)).toEqual(["New", "Contacted", "Qualified", "Proposal sent", "Negotiation", "Won", "Lost"]);
  });

  it("an agent creates a deal, moves it, adds a note; winning makes the contact a customer", async () => {
    actAs(agent);
    expect((await dealsRoute.POST(body("POST", { contactId: "nope", title: "X" }), P())).status).toBe(400);
    const c = await json(await dealsRoute.POST(body("POST", { contactId, title: "Bridal package", valueRupees: 25000, expectedCloseAt: "2026-12-01" }), P()));
    expect(c.status).toBe(201);
    const deal = c.body.deal as { id: string; owner: { id: string }; stage: { name: string }; valueRupees: number };
    expect(deal).toMatchObject({ valueRupees: 25000, stage: { name: "New" }, owner: { id: agent.id } });

    const stages = await db.pipelineStage.findMany({ where: { organizationId: orgId }, orderBy: { position: "asc" } });
    const proposal = stages.find((s) => s.name === "Proposal sent")!;
    const won = stages.find((s) => s.kind === "won")!;
    const moved = await json(await dealRoute.PATCH(body("PATCH", { stageId: proposal.id, note: "Sent quote on WhatsApp", valueRupees: 30000 }), P({ id: deal.id })));
    expect(moved.status).toBe(200);
    const kinds = (moved.body.deal as { activities: { kind: string }[] }).activities.map((a) => a.kind);
    expect(kinds).toEqual(expect.arrayContaining(["created", "stage", "value", "note"]));

    // Board and forecast: 30,000 at 60%.
    const board = await json(await dealsRoute.GET(req("/x"), P()));
    const col = (board.body.stages as { id: string; deals: { id: string; heat: string }[]; valueRupees: number }[]).find((s) => s.id === proposal.id)!;
    expect(col.deals.map((d) => d.id)).toContain(deal.id);
    expect(col.valueRupees).toBe(30000);
    const stats = await json(await statsRoute.GET(req("/x"), P()));
    expect(stats.body).toMatchObject({ openDeals: 1, openRupees: 30000, forecastRupees: 18000 });

    await dealRoute.PATCH(body("PATCH", { stageId: won.id }), P({ id: deal.id }));
    const contact = await db.contact.findUniqueOrThrow({ where: { id: contactId } });
    expect(contact).toMatchObject({ lifecycle: "customer", leadStatus: "won" });
    const after = await json(await statsRoute.GET(req("/x"), P()));
    expect(after.body).toMatchObject({ openDeals: 0, wonThisMonth: 1, wonRupeesThisMonth: 30000, winRate90: 100 });
    expect((after.body.people as { userId: string; wonRupees: number }[])[0]).toMatchObject({ userId: agent.id, wonRupees: 30000 });

    // Agents can't delete deals or change the pipeline.
    expect((await dealRoute.DELETE(req("/x", { method: "DELETE" }), P({ id: deal.id }))).status).toBe(403);
    expect((await scoringRoute.PUT(body("PUT", DEFAULT_SCORING), P())).status).toBe(403);
  });

  it("losing needs no other open deal to mark the contact lost, and keeps the reason", async () => {
    actAs(owner);
    const p2 = (await db.contact.create({ data: { organizationId: orgId, phone: `+9197${Date.now().toString().slice(-8)}`, name: "Rohit" } })).id;
    const d = (await json(await dealsRoute.POST(body("POST", { contactId: p2, title: "Website", valueRupees: 9000 }), P()))).body.deal as { id: string };
    const lost = (await db.pipelineStage.findFirstOrThrow({ where: { organizationId: orgId, kind: "lost" } })).id;
    const r = await json(await dealRoute.PATCH(body("PATCH", { stageId: lost, lostReason: "Price too high" }), P({ id: d.id })));
    expect(r.body.deal).toMatchObject({ status: "lost", lostReason: "Price too high" });
    expect((await db.contact.findUniqueOrThrow({ where: { id: p2 } })).leadStatus).toBe("lost");
    expect((await dealRoute.DELETE(req("/x", { method: "DELETE" }), P({ id: d.id }))).status).toBe(200);
  });

  it("stages: rename and reorder, can't remove one that still has deals, needs exactly one Won and Lost", async () => {
    actAs(owner);
    const stages = (await json(await stagesRoute.GET(req("/x"), P()))).body.stages as { id: string; name: string; color: string; probability: number; kind: string }[];
    const rows = stages.map(({ id, name, color, probability, kind }) => ({ id, name, color, probability, kind }));
    // Swap the first two and rename.
    const swapped = [{ ...rows[1], name: "Called" }, rows[0], ...rows.slice(2)];
    const s = await json(await stagesRoute.PUT(body("PUT", { stages: swapped }), P()));
    expect(s.status).toBe(200);
    expect((s.body.stages as { name: string }[]).slice(0, 2).map((x) => x.name)).toEqual(["Called", "New"]);
    expect((await stagesRoute.PUT(body("PUT", { stages: swapped.filter((x) => x.kind !== "won") }), P())).status).toBe(400);
    // The Won stage holds the won deal: removing it (and adding a new Won) is refused.
    const withoutWon = [...swapped.filter((x) => x.kind !== "won"), { name: "Closed", color: "emerald", probability: 100, kind: "won" }];
    expect((await stagesRoute.PUT(body("PUT", { stages: withoutWon }), P())).status).toBe(409);
    const added = await json(await stagesRoute.PUT(body("PUT", { stages: [...swapped.slice(0, 2), { name: "Site visit", color: "sky", probability: 50, kind: "open" }, ...swapped.slice(2)] }), P()));
    expect((added.body.stages as { name: string }[])[2].name).toBe("Site visit");
  });

  it("lead scoring: rules add up, thresholds decide Hot/Warm/Cold, and bad rules are refused", async () => {
    const now = Date.now();
    const hot = scoreContact({ tags: ["hot lead"], leadStatus: "proposal", source: "whatsapp", optInStatus: "opted_in", email: "", lastInboundAt: new Date(now - 3_600_000), openDealPaise: 0 }, DEFAULT_SCORING, now);
    expect(hot.heat).toBe("hot");
    expect(hot.score).toBe(95);
    const cold = scoreContact({ tags: [], leadStatus: "new", source: "import", optInStatus: "unknown", email: "", lastInboundAt: null, openDealPaise: 0 }, DEFAULT_SCORING, now);
    expect(cold).toMatchObject({ score: 0, heat: "cold" });

    actAs(owner);
    expect((await scoringRoute.PUT(body("PUT", { rules: [{ signal: "tag", value: "", points: 10 }], hot: 60, warm: 30 }), P())).status).toBe(400);
    expect((await scoringRoute.PUT(body("PUT", { rules: [], hot: 30, warm: 40 }), P())).status).toBe(400);
    const ok = await json(await scoringRoute.PUT(body("PUT", { rules: [{ signal: "opted_in", value: "", points: 50 }], hot: 50, warm: 20 }), P()));
    expect(ok.status).toBe(200);
    const d = (await json(await dealsRoute.POST(body("POST", { contactId, title: "Repeat order", valueRupees: 5000 }), P()))).body.deal as { id: string };
    const detail = await json(await dealRoute.GET(req("/x"), P({ id: d.id })));
    expect(detail.body.deal).toMatchObject({ score: { score: 50, heat: "hot" } });
  });

  it("another workspace can't see or touch these deals", async () => {
    actAs(owner);
    const d = (await json(await dealsRoute.POST(body("POST", { contactId, title: "Private deal" }), P()))).body.deal as { id: string };
    actAs(outsider);
    expect((await dealRoute.GET(req("/x"), P({ id: d.id }))).status).toBe(403);
    expect((await dealRoute.GET(req("/x"), params({ orgId: otherOrg, id: d.id }))).status).toBe(404);
    expect((await dealRoute.PATCH(body("PATCH", { title: "hacked" }), params({ orgId: otherOrg, id: d.id }))).status).toBe(404);
    // Their own contact list can't be used to attach a deal to our contact.
    expect((await dealsRoute.POST(body("POST", { contactId, title: "Steal" }), params({ orgId: otherOrg }))).status).toBe(400);
  });
});
