import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/background", () => ({ runAfterResponse: vi.fn() }));

import { db } from "@/lib/db";
import { actAs, addMember, json, makeOrg, makePlan, makeUser, params, req } from "../helpers";
import * as demoConnect from "@/app/api/organizations/[orgId]/whatsapp/connect/demo/route";
import * as contactsRoute from "@/app/api/organizations/[orgId]/contacts/route";
import * as groups from "@/app/api/organizations/[orgId]/contacts/groups/route";
import * as pricing from "@/app/api/organizations/[orgId]/pricing/route";
import * as metaRates from "@/app/api/admin/meta-rates/route";
import * as metaBalance from "@/app/api/admin/meta-balance/route";
import { setSetting } from "@/lib/settings";
import { importContactsCsv } from "@/services/inbox/contacts";
import { DEFAULT_META_RATES, metaRateFor } from "@/services/meta-rates";

const post = (body: unknown) => req("/x", { method: "POST", body });
const P = (orgId: string) => params({ orgId });
let orgId: string;
let owner: Awaited<ReturnType<typeof makeUser>>;
let agent: Awaited<ReturnType<typeof makeUser>>;
let admin: Awaited<ReturnType<typeof makeUser>>;
const ids: string[] = [];

beforeAll(async () => {
  orgId = (await makeOrg("Group Shop")).id;
  [owner, agent, admin] = await Promise.all([makeUser({ name: "Owner" }), makeUser({ name: "Agent" }), makeUser({ role: "SUPER_ADMIN", name: "Admin" })]);
  await addMember(orgId, owner.id, "CLIENT_OWNER");
  await addMember(orgId, agent.id, "AGENT");
  const plan = await makePlan({ maxUsers: 5, maxWhatsAppNumbers: 2 });
  await db.plan.update({ where: { id: plan.id }, data: { maxContacts: 1000 } });
  await db.subscription.create({ data: { organizationId: orgId, planId: plan.id, priceMonthly: plan.priceMonthly } });
  await db.organizationService.create({ data: { organizationId: orgId, service: "WHATSAPP_AUTOMATION", enabled: true } });
  actAs(owner);
  for (let i = 0; i < 4; i++) {
    const r = await json(await contactsRoute.POST(post({ phone: `+9198110000${10 + i}`, name: `C${i}` }), P(orgId)));
    ids.push((r.body.contact as { id: string }).id);
  }
});

afterAll(async () => {
  // Shared database: leave the rate card and Meta funds as other test files expect.
  await setSetting("meta_rates", "");
  await setSetting("meta_funds", "");
});

describe("contact groups", () => {
  it("adds selected contacts to a new group, skips ones already in it, and removes them", async () => {
    actAs(agent); // agents can edit contacts
    const add = await json(await groups.POST(post({ ids: ids.slice(0, 3), group: "Diwali buyers", action: "add" }), P(orgId)));
    expect(add.status).toBe(200);
    expect(add.body.changed).toBe(3);
    expect((await json(await groups.POST(post({ ids, group: "Diwali buyers", action: "add" }), P(orgId)))).body.changed).toBe(1);
    const tag = await db.tag.findFirstOrThrow({ where: { organizationId: orgId, name: "Diwali buyers" } });
    expect(await db.contactTag.count({ where: { tagId: tag.id } })).toBe(4);
    expect((await json(await groups.POST(post({ ids: [ids[0]], group: "Diwali buyers", action: "remove" }), P(orgId)))).body.changed).toBe(1);
    expect(await db.contactTag.count({ where: { tagId: tag.id } })).toBe(3);
  });

  it("groups everything matching a filter only when the count still matches", async () => {
    actAs(owner);
    expect((await groups.POST(post({ filter: { tab: "all", q: "", tagId: "", leadStatus: "", ownerUserId: "" }, expectedCount: 99, group: "All", action: "add" }), P(orgId))).status).toBe(409);
    const ok = await json(await groups.POST(post({ filter: { tab: "all", q: "", tagId: "", leadStatus: "", ownerUserId: "" }, expectedCount: 4, group: "All", action: "add" }), P(orgId)));
    expect(ok.body.changed).toBe(4);
    expect((await groups.POST(post({ ids, group: " ", action: "add" }), P(orgId))).status).toBe(400);
  });

  it("an import can put everyone into a group", async () => {
    const r = await importContactsCsv({ organizationId: orgId, actorUserId: owner.id }, "name,phone\nA,+919811000020\nB,+919811000021", "csv", "Imported Oct");
    expect(r.created).toBe(2);
    const tag = await db.tag.findFirstOrThrow({ where: { organizationId: orgId, name: "Imported Oct" } });
    expect(await db.contactTag.count({ where: { tagId: tag.id } })).toBe(2);
  });
});

describe("prices before sending", () => {
  it("shows Meta's rate and MECGURA's fee per category to the workspace", async () => {
    actAs(owner);
    const r = await json(await pricing.GET(req("/x"), P(orgId)));
    expect(r.status).toBe(200);
    expect((r.body.meta as Record<string, number>).service).toBe(0);
    expect((r.body.meta as Record<string, number>).marketing).toBeGreaterThan((r.body.meta as Record<string, number>).utility);
    expect(metaRateFor(DEFAULT_META_RATES, "MARKETING")).toBe(DEFAULT_META_RATES.marketing);
    expect(metaRateFor(DEFAULT_META_RATES, "service")).toBe(0);
  });

  it("only the Super Admin edits Meta rates and the Meta balance", async () => {
    actAs(owner);
    expect((await metaRates.PUT(req("/x", { method: "PUT", body: { marketing: 1, utility: 1, authentication: 1 } }))).status).toBe(403);
    expect((await metaBalance.GET(req("/x"))).status).toBe(403);
    actAs(admin);
    expect((await metaRates.PUT(req("/x", { method: "PUT", body: { marketing: 100, utility: 10, authentication: 10 } }))).status).toBe(200);
  });
});

describe("Meta balance", () => {
  it("subtracts estimated spend on template messages since the first top-up", async () => {
    actAs(owner);
    const d = await json(await demoConnect.POST(post({ businessName: "Group Shop" }), P(orgId)));
    const accountId = (d.body.account as { id: string }).id;
    const acct = await db.whatsAppAccount.findUniqueOrThrow({ where: { id: accountId } });
    // Treat it as a live account for this test.
    await db.whatsAppBusinessAccount.update({ where: { id: acct.wabaRecordId! }, data: { isDemo: false } });
    const conv = await db.conversation.create({ data: { organizationId: orgId, contactId: ids[1], whatsappAccountId: accountId } });
    const msg = (category: string, status: string) => ({ organizationId: orgId, conversationId: conv.id, direction: "outbound", type: "template", body: "x", payload: JSON.stringify({ category }), status });
    await db.message.createMany({ data: [msg("MARKETING", "delivered"), msg("MARKETING", "read"), msg("UTILITY", "sent"), msg("MARKETING", "failed")] });

    actAs(admin);
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(Date.now() - 86_400_000));
    const r = await json(await metaBalance.POST(req("/x", { method: "POST", body: { wabaRecordId: acct.wabaRecordId, amount: 500, date: today, note: "UPI" } })));
    expect(r.status).toBe(201);
    const a = (r.body.accounts as { id: string; added: number; spent: number; remaining: number; thisMonth: { messages: Record<string, number> } }[]).find((x) => x.id === acct.wabaRecordId)!;
    // Rates set above: marketing ₹1.00 (100 paise), utility ₹0.10. 2 marketing + 1 utility; the failed one is free.
    expect(a.added).toBe(50_000);
    expect(a.spent).toBe(210);
    expect(a.remaining).toBe(49_790);
    expect(a.thisMonth.messages.MARKETING).toBe(2);

    expect((await metaBalance.POST(req("/x", { method: "POST", body: { wabaRecordId: acct.wabaRecordId, amount: -5, date: today } }))).status).toBe(400);
    const low = await json(await metaBalance.PUT(req("/x", { method: "PUT", body: { lowAlert: 1000 } })));
    expect((low.body.accounts as { id: string; low: boolean }[]).find((x) => x.id === acct.wabaRecordId)!.low).toBe(true);
  });
});
