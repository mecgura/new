import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/background", () => ({ runAfterResponse: vi.fn() }));

import { db } from "@/lib/db";
import { actAs, addMember, json, makeOrg, makeUser, params, req } from "../helpers";
import { resetRateLimits } from "@/lib/rate-limit";
import { DEFAULT_ACTIONS, DEFAULT_HANDOFF, DEFAULT_KNOWLEDGE } from "@/lib/ai";
import { evaluate } from "@/services/ai/evals";
import { getStages, salesForecast } from "@/services/crm/deals";
import * as agentsRoute from "@/app/api/organizations/[orgId]/ai/agents/route";
import * as testsRoute from "@/app/api/organizations/[orgId]/ai/agents/[aid]/tests/route";
import * as testRoute from "@/app/api/organizations/[orgId]/ai/agents/[aid]/tests/[tid]/route";
import * as runRoute from "@/app/api/organizations/[orgId]/ai/agents/[aid]/tests/run/route";
import * as journeyRoute from "@/app/api/organizations/[orgId]/contacts/[id]/journey/route";
import * as forecastRoute from "@/app/api/organizations/[orgId]/deals/forecast/route";
import * as securityRoute from "@/app/api/admin/security/route";
import * as exportRoute from "@/app/api/organizations/[orgId]/data/export/route";
import * as deletionRoute from "@/app/api/organizations/[orgId]/data/deletion/route";
import * as decideRoute from "@/app/api/admin/data-requests/[id]/route";

const DAY = 86_400_000;
let n = 0;
async function workspace(name = `P3 ${n++}`) {
  const org = await makeOrg(name);
  const owner = await makeUser({ name: "Owner" });
  await addMember(org.id, owner.id, "CLIENT_OWNER");
  actAs(owner);
  const P = <T extends Record<string, string> = Record<never, string>>(extra?: T) => params({ orgId: org.id, ...(extra ?? ({} as T)) } as { orgId: string } & T);
  return { org, owner, P };
}
const contact = (organizationId: string, name = "Riya") => db.contact.create({ data: { organizationId, name, phone: `+9198${String(Date.now()).slice(-6)}${n++}` } });

beforeEach(() => {
  resetRateLimits();
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.OPENAI_API_KEY;
});

describe("AI agent automated tests", () => {
  it("evaluate(): must include / must not include / expected action", () => {
    const turn = { reply: "We are open 10am to 8pm, every day.", actions: [{ type: "qualify" as const, status: "contacted" as const, interest: "", reason: "" }], handoff: null };
    expect(evaluate({ mustInclude: "10AM\n8pm", mustNotInclude: "closed", expectAction: "qualify" }, turn)).toEqual([]);
    expect(evaluate({ mustInclude: "Sunday", mustNotInclude: "every day", expectAction: "transfer" }, turn)).toEqual(['Missing “Sunday”', 'Contains “every day”, which it must not', 'Expected the “transfer” action, got qualify']);
    expect(evaluate({ mustInclude: "", mustNotInclude: "", expectAction: "none" }, turn)).toEqual(["Expected no action, got qualify"]);
  });

  it("add, run in demo mode, see pass/fail; live needs a key; agents can't manage", async () => {
    const w = await workspace();
    await db.organizationService.create({ data: { organizationId: w.org.id, service: "AI_ASSISTANT", enabled: true } });
    const knowledge = { ...DEFAULT_KNOWLEDGE, faqs: [{ q: "What are your timings?", a: "We are open 10am to 8pm." }] };
    const a = await json(await agentsRoute.POST(req("/x", { method: "POST", body: { name: "Bot", instructions: "", knowledge, actions: DEFAULT_ACTIONS, handoff: DEFAULT_HANDOFF, accountIds: [] } }), w.P()));
    const aid = (a.body.agent as { id: string }).id;
    const c1 = await json(await testsRoute.POST(req("/x", { method: "POST", body: { name: "Timings", message: "What are your timings?", mustInclude: "10am" } }), w.P({ aid })));
    expect(c1.status).toBe(201);
    await testsRoute.POST(req("/x", { method: "POST", body: { name: "No discounts", message: "What are your timings?", mustNotInclude: "8pm" } }), w.P({ aid }));
    const run = await json(await runRoute.POST(req("/x", { method: "POST", body: { mode: "demo" } }), w.P({ aid })));
    expect(run.status).toBe(200);
    expect(run.body.summary).toMatchObject({ total: 2, passed: 1, failed: 1 });
    const failed = (run.body.cases as { name: string; lastStatus: string; lastReasons: string[] }[]).find((c) => c.name === "No discounts")!;
    expect(failed.lastStatus).toBe("fail");
    expect(failed.lastReasons[0]).toMatch(/8pm/);
    expect(await db.aiInteraction.count({ where: { agentId: aid, isTest: true } })).toBe(2);
    expect((await runRoute.POST(req("/x", { method: "POST", body: { mode: "live" } }), w.P({ aid }))).status).toBe(409);
    // Editing resets the result; deleting removes it.
    const id = (c1.body.case as { id: string }).id;
    const ed = await json(await testRoute.PUT(req("/x", { method: "PUT", body: { name: "Timings", message: "When do you open?", mustInclude: "10am" } }), w.P({ aid, tid: id })));
    expect((ed.body.case as { lastStatus: string }).lastStatus).toBe("");
    expect((await testRoute.DELETE(req("/x", { method: "DELETE" }), w.P({ aid, tid: id }))).status).toBe(200);
    const agent = await makeUser({ name: "Agent" });
    await addMember(w.org.id, agent.id, "AGENT");
    actAs(agent);
    expect((await testsRoute.GET(req("/x"), w.P({ aid }))).status).toBe(403);
  });
});

describe("customer journey", () => {
  it("builds stages and a timeline from real records, and is tenant-isolated", async () => {
    const w = await workspace();
    const c = await contact(w.org.id);
    await db.conversation.create({ data: { organizationId: w.org.id, contactId: c.id, channel: "whatsapp" } });
    const stages = await getStages(w.org.id);
    await db.deal.create({ data: { organizationId: w.org.id, contactId: c.id, stageId: stages[0].id, title: "Bridal package", valuePaise: 1_500_000, status: "won", closedAt: new Date() } });
    await db.purchase.create({ data: { organizationId: w.org.id, contactId: c.id, amountPaise: 80_000, note: "Facial" } });
    await db.reviewRequest.create({ data: { organizationId: w.org.id, contactId: c.id, token: `tok-${n++}-${Date.now()}`, rating: 5, ratedAt: new Date() } });
    const r = await json(await journeyRoute.GET(req("/x"), w.P({ id: c.id })));
    expect(r.status).toBe(200);
    expect(r.body.current).toBe("advocate");
    const reached = (r.body.stages as { stage: string; reachedAt: string | null }[]).filter((s) => s.reachedAt).map((s) => s.stage);
    expect(reached).toEqual(["acquired", "engaged", "opportunity", "customer", "advocate"]);
    expect(r.body.totals).toMatchObject({ deals: 1, purchases: 1, spendPaise: 1_580_000 });
    const kinds = (r.body.events as { kind: string }[]).map((e) => e.kind);
    expect(kinds).toEqual(expect.arrayContaining(["created", "conversation", "deal", "deal_won", "purchase", "review"]));

    const other = await workspace();
    expect((await journeyRoute.GET(req("/x"), other.P({ id: c.id }))).status).toBe(404);
  });
});

describe("sales forecast", () => {
  it("buckets open deals by expected close month with best case, weighted and history-based views", async () => {
    const w = await workspace();
    const stages = await getStages(w.org.id);
    const open = stages.find((s) => s.kind === "open" && s.probability > 0) ?? stages[0];
    const c = await contact(w.org.id);
    const now = new Date();
    const soon = new Date(now.getTime() + 2 * 3_600_000);
    await db.deal.create({ data: { organizationId: w.org.id, contactId: c.id, stageId: open.id, title: "A", valuePaise: 1_000_000, expectedCloseAt: soon } });
    await db.deal.create({ data: { organizationId: w.org.id, contactId: c.id, stageId: open.id, title: "Overdue", valuePaise: 500_000, expectedCloseAt: new Date(now.getTime() - 3 * DAY) } });
    await db.deal.create({ data: { organizationId: w.org.id, contactId: c.id, stageId: open.id, title: "Undated", valuePaise: 200_000 } });
    let f = await salesForecast(w.org.id, now);
    expect(f.months).toHaveLength(3);
    const thisMonth = f.months[0];
    // "soon" may fall into next month right at a month boundary; either way it is counted exactly once.
    const counted = f.months.reduce((a, m) => a + m.deals, 0);
    expect(counted).toBe(1);
    expect(thisMonth.deals + f.months[1].deals).toBe(1);
    const m = f.months.find((x) => x.deals)!;
    expect(m.bestCaseRupees).toBe(10_000);
    expect(m.weightedRupees).toBe((10_000 * open.probability) / 100);
    expect(m.historyRupees).toBeNull(); // fewer than 5 closed deals
    expect(f.overdue).toMatchObject({ deals: 1, bestCaseRupees: 5_000 });
    expect(f.noDate.deals).toBe(1);
    for (let i = 0; i < 5; i++) await db.deal.create({ data: { organizationId: w.org.id, contactId: c.id, stageId: open.id, title: `C${i}`, valuePaise: 100_000, status: i < 4 ? "won" : "lost", closedAt: new Date(now.getTime() - DAY) } });
    f = await salesForecast(w.org.id, now);
    expect(f.winRate180).toBe(80);
    expect(f.months.find((x) => x.deals)!.historyRupees).toBe(8_000);
    expect(f.history.at(-1)!.wonDeals).toBe(4);
    const r = await json(await forecastRoute.GET(req("/x"), w.P()));
    expect(r.status).toBe(200);
  });
});

describe("security dashboard", () => {
  it("flags an IP with 10+ failed sign-ins and is admin-only", async () => {
    const ip = `203.0.113.${(n++ % 200) + 1}`;
    for (let i = 0; i < 11; i++) await db.auditLog.create({ data: { action: "auth.login_failed", ip, metadata: JSON.stringify({ reason: "bad_password" }) } });
    actAs(await makeUser({ name: "Client" }));
    expect((await securityRoute.GET(req("/x"))).status).toBe(403);
    actAs(await makeUser({ role: "SUPER_ADMIN", name: "Admin" }));
    const r = await json(await securityRoute.GET(req("/x")));
    expect(r.status).toBe(200);
    const row = (r.body.topIps as { ip: string; failed24h: number; flagged: boolean }[]).find((x) => x.ip === ip)!;
    expect(row).toMatchObject({ failed24h: 11, flagged: true });
    expect((r.body.totals as { suspiciousIps: number }).suspiciousIps).toBeGreaterThanOrEqual(1);
    expect((r.body.failedSeries as unknown[]).length).toBe(14);
  });
});

describe("data export and workspace deletion", () => {
  it("owner downloads a JSON export without secrets; managers can't", async () => {
    const w = await workspace("Export Co");
    await contact(w.org.id, "Aman");
    await db.apiKey.create({ data: { organizationId: w.org.id, name: "k", prefix: "mk_live_x", keyHash: "SECRET_HASH_VALUE" } }).catch(() => null);
    const res = await exportRoute.GET(req("/x"), w.P());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toMatch(/attachment; filename="mecgura-.*-export-/);
    const text = await res.text();
    const body = JSON.parse(text) as { contacts: { name: string }[]; organization: { name: string } };
    expect(body.organization.name).toBe("Export Co");
    expect(body.contacts.map((c) => c.name)).toContain("Aman");
    expect(text).not.toContain("SECRET_HASH_VALUE");
    expect(await db.auditLog.count({ where: { organizationId: w.org.id, action: "workspace.exported" } })).toBe(1);
    const mgr = await makeUser({ name: "Mgr" });
    await addMember(w.org.id, mgr.id, "MANAGER");
    actAs(mgr);
    expect((await exportRoute.GET(req("/x"), w.P())).status).toBe(403);
  });

  it("request → cooling-off → admin deletes; the owner can cancel before", async () => {
    const w = await workspace("Leaving Co");
    expect((await deletionRoute.POST(req("/x", { method: "POST", body: { confirmName: "wrong" } }), w.P())).status).toBe(400);
    const r = await json(await deletionRoute.POST(req("/x", { method: "POST", body: { confirmName: "Leaving Co", reason: "closing shop" } }), w.P()));
    expect(r.status).toBe(201);
    expect((await deletionRoute.POST(req("/x", { method: "POST", body: { confirmName: "Leaving Co" } }), w.P())).status).toBe(409);
    expect((await deletionRoute.DELETE(req("/x", { method: "DELETE" }), w.P())).status).toBe(200);
    expect((await json(await deletionRoute.GET(req("/x"), w.P()))).body.request).toBeNull();
    const again = await json(await deletionRoute.POST(req("/x", { method: "POST", body: { confirmName: "Leaving Co" } }), w.P()));
    const id = (again.body.request as { id: string }).id;

    actAs(await makeUser({ role: "SUPER_ADMIN", name: "Admin" }));
    expect((await decideRoute.POST(req("/x", { method: "POST", body: { decision: "execute" } }), params({ id }))).status).toBe(409); // still cooling off
    await db.dataRequest.update({ where: { id }, data: { earliestAt: new Date(Date.now() - 1000) } });
    const done = await json(await decideRoute.POST(req("/x", { method: "POST", body: { decision: "execute", note: "verified by phone" } }), params({ id })));
    expect(done.body).toMatchObject({ status: "completed" });
    expect(await db.organization.findUnique({ where: { id: w.org.id } })).toBeNull();
    expect((await db.dataRequest.findUniqueOrThrow({ where: { id } })).status).toBe("completed");
  });
});
