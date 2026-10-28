import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/background", () => ({ runAfterResponse: vi.fn() }));

import { db } from "@/lib/db";
import { encryptSecret } from "@/lib/crypto";
import { actAs, addMember, json, makeOrg, makePlan, makeUser, params, req } from "../helpers";
import * as pkgRoute from "@/app/api/organizations/[orgId]/package/route";
import * as buyRoute from "@/app/api/organizations/[orgId]/package/buy/route";
import * as adminOrgPkg from "@/app/api/admin/organizations/[id]/package/route";
import * as adminPkg from "@/app/api/admin/package/route";
import * as demoConnect from "@/app/api/organizations/[orgId]/whatsapp/connect/demo/route";
import * as contactsRoute from "@/app/api/organizations/[orgId]/contacts/route";
import * as templates from "@/app/api/organizations/[orgId]/templates/route";
import * as submit from "@/app/api/organizations/[orgId]/templates/[tid]/submit/route";
import * as review from "@/app/api/organizations/[orgId]/templates/[tid]/review/route";
import * as campaigns from "@/app/api/organizations/[orgId]/campaigns/route";
import * as campaign from "@/app/api/organizations/[orgId]/campaigns/[cid]/route";
import * as campaignReview from "@/app/api/organizations/[orgId]/campaigns/[cid]/review/route";
import * as launch from "@/app/api/organizations/[orgId]/campaigns/[cid]/launch/route";
import { setMetaBilling } from "@/services/billing/meta-billing";
import { creditWallet, getWallet } from "@/services/wallet";
import { assertCanAfford, chargeMessage } from "@/services/wallet-pricing";
import { packageStatus } from "@/services/billing/package";
import { processCampaign } from "@/services/campaigns/sender";

afterEach(() => vi.restoreAllMocks());

let n = 0;
const post = (body: unknown) => req("/x", { method: "POST", body });
async function client(opts: { marketing?: number; utility?: number; mode?: "package" | "client_pays" } = {}) {
  const admin = await makeUser({ role: "SUPER_ADMIN", name: "Admin" });
  const org = await makeOrg(`Pkg ${n++}`);
  const owner = await makeUser({ name: "Owner" });
  const agent = await makeUser({ name: "Agent" });
  await addMember(org.id, owner.id, "CLIENT_OWNER");
  await addMember(org.id, agent.id, "AGENT");
  const plan = await makePlan({ maxUsers: 10, maxWhatsAppNumbers: 3, priceMonthly: 500_000 });
  await db.plan.update({ where: { id: plan.id }, data: { includedMarketing: opts.marketing ?? 3, includedUtility: opts.utility ?? 2, maxContacts: 1000 } });
  await db.subscription.create({ data: { organizationId: org.id, planId: plan.id, priceMonthly: plan.priceMonthly } });
  await db.organizationService.create({ data: { organizationId: org.id, service: "WHATSAPP_AUTOMATION", enabled: true } });
  await setMetaBilling(org.id, { mode: opts.mode ?? "package" }, admin.id);
  return { admin, org, owner, agent };
}
const P = (orgId: string) => params({ orgId });

/** An accepted outbound template message, charged the way the inbox/campaign sender does after Meta accepts it. */
async function sent(orgId: string, category: "MARKETING" | "UTILITY" | "AUTHENTICATION" | null) {
  const contact = await db.contact.create({ data: { organizationId: orgId, phone: `+9198${String(Date.now()).slice(-6)}${n++}`, optInStatus: "opted_in" } });
  const acct = await db.whatsAppAccount.findFirst({ where: { organizationId: orgId } });
  const account = acct ?? (await db.whatsAppAccount.create({ data: { organizationId: orgId, displayName: "Shop", phoneNumber: `+9199${String(Date.now()).slice(-6)}${n++}`, status: "connected" } }));
  const conv = await db.conversation.create({ data: { organizationId: orgId, contactId: contact.id, whatsappAccountId: account.id } });
  const m = await db.message.create({
    data: { organizationId: orgId, conversationId: conv.id, direction: "outbound", type: category ? "template" : "text", body: "x", status: "sent", payload: JSON.stringify(category ? { category } : {}) },
  });
  return chargeMessage(m.id);
}

describe("message package", () => {
  it("counts template messages per bucket, refuses when used up, and leaves free replies alone", async () => {
    const c = await client({ marketing: 2, utility: 1 });
    await assertCanAfford(c.org.id, "marketing", 2);
    await expect(assertCanAfford(c.org.id, "marketing", 3)).rejects.toMatchObject({ status: 402 });
    await sent(c.org.id, "MARKETING");
    await sent(c.org.id, "MARKETING");
    await sent(c.org.id, "AUTHENTICATION"); // counts as utility
    await sent(c.org.id, null); // a reply inside 24h: not counted
    const s = await packageStatus(c.org.id);
    expect(s.active).toBe(true);
    expect(s.marketing).toMatchObject({ included: 2, used: 2, remaining: 0 });
    expect(s.utility).toMatchObject({ included: 1, used: 1, remaining: 0 });
    await expect(assertCanAfford(c.org.id, "marketing")).rejects.toThrow(/used up/);
    await expect(assertCanAfford(c.org.id, "utility")).rejects.toMatchObject({ status: 402 });
    await assertCanAfford(c.org.id, "service");

    // Owners get the 100% alert once.
    const alerts = await db.notification.findMany({ where: { userId: c.owner.id, organizationId: c.org.id } });
    expect(alerts.filter((a) => a.title.includes("marketing messages are used up"))).toHaveLength(1);
  });

  it("clients on other billing types are not limited or counted", async () => {
    const c = await client({ marketing: 0, mode: "client_pays" });
    await assertCanAfford(c.org.id, "marketing", 500);
    await sent(c.org.id, "MARKETING");
    const s = await packageStatus(c.org.id);
    expect(s.active).toBe(false);
    expect(s.marketing.used).toBe(0);
  });

  it("a top-up pack is bought from the wallet once per key, and its messages are used after the allowance", async () => {
    const c = await client({ marketing: 1 });
    actAs(c.owner);
    const g = await json(await pkgRoute.GET(req("/x"), P(c.org.id)));
    expect(g.status).toBe(200);
    expect((g.body.packs as { id: string }[]).map((p) => p.id)).toContain("mkt-1000");

    // Not enough in the wallet.
    expect((await buyRoute.POST(post({ packId: "mkt-1000", key: "k1-abcdefgh" }), P(c.org.id))).status).toBe(402);
    await creditWallet(c.org.id, { actorUserId: c.admin.id }, { amount: 200_000 });
    const b = await json(await buyRoute.POST(post({ packId: "mkt-1000", key: "k1-abcdefgh" }), P(c.org.id)));
    expect(b.status).toBe(200);
    expect((await buyRoute.POST(post({ packId: "mkt-1000", key: "k1-abcdefgh" }), P(c.org.id))).status).toBe(200); // double click
    expect((await getWallet(c.org.id)).balance).toBe(80_000);
    expect((await packageStatus(c.org.id)).marketing).toMatchObject({ credits: 1000, remaining: 1001 });

    await sent(c.org.id, "MARKETING"); // allowance
    await sent(c.org.id, "MARKETING"); // first top-up credit
    expect((await packageStatus(c.org.id)).marketing).toMatchObject({ used: 2, credits: 999, remaining: 999 });

    // Agents can't buy; unknown packs are refused.
    actAs(c.agent);
    expect((await buyRoute.POST(post({ packId: "mkt-1000", key: "k2-abcdefgh" }), P(c.org.id))).status).toBe(403);
    actAs(c.owner);
    expect((await buyRoute.POST(post({ packId: "nope", key: "k3-abcdefgh" }), P(c.org.id))).status).toBe(404);
  });

  it("Super Admin grants credits, edits packs and sees the margin report; clients can't", async () => {
    const c = await client({ marketing: 10 });
    actAs(c.owner);
    expect((await adminOrgPkg.POST(post({ marketing: 50 }), params({ id: c.org.id }))).status).toBe(403);
    expect((await adminPkg.GET(req("/x"), params({}))).status).toBe(403);

    actAs(c.admin);
    const g = await json(await adminOrgPkg.POST(post({ marketing: 50, utility: 20, note: "Diwali bonus" }), params({ id: c.org.id })));
    expect(g.status).toBe(200);
    expect((await packageStatus(c.org.id)).marketing.credits).toBe(50);
    await adminOrgPkg.POST(post({ marketing: -80 }), params({ id: c.org.id }));
    expect((await packageStatus(c.org.id)).marketing.credits).toBe(0);

    expect((await adminPkg.PUT(req("/x", { method: "PUT", body: { packs: [{ id: "BAD ID", bucket: "marketing", quantity: 1, priceRupees: 0 }] } }), params({}))).status).toBe(400);
    const packs = [{ id: "mkt-2000", bucket: "marketing", quantity: 2000, priceRupees: 2300 }];
    expect((await adminPkg.PUT(req("/x", { method: "PUT", body: { packs } }), params({}))).status).toBe(200);
    const r = await json(await adminPkg.GET(req("/x"), params({})));
    expect(r.body.packs).toEqual(packs);
    const row = (r.body.clients as { organizationId: string; price: number }[]).find((x) => x.organizationId === c.org.id);
    expect(row?.price).toBe(500_000);
    // Put the defaults back for other tests.
    await adminPkg.PUT(req("/x", { method: "PUT", body: { packs: [{ id: "mkt-1000", bucket: "marketing", quantity: 1000, priceRupees: 1200 }, { id: "mkt-5000", bucket: "marketing", quantity: 5000, priceRupees: 5500 }, { id: "utl-5000", bucket: "utility", quantity: 5000, priceRupees: 999 }] } }), params({}));
  });

  it("a campaign launch checks the package and sending pauses when it runs out", async () => {
    const c = await client({ marketing: 2 });
    actAs(c.owner);
    const d = await json(await demoConnect.POST(post({ businessName: "Demo Store" }), P(c.org.id)));
    const accountId = (d.body.account as { id: string }).id;
    const acct = await db.whatsAppAccount.findUniqueOrThrow({ where: { id: accountId } });
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await json(await contactsRoute.POST(post({ phone: `+9197${String(Date.now()).slice(-6)}${n++}`, name: `C${i}`, optInStatus: "opted_in" }), P(c.org.id)));
      ids.push((r.body.contact as { id: string }).id);
    }
    const t = await json(await templates.POST(post({ wabaId: acct.wabaRecordId, name: "pkg_offer", language: "en", category: "MARKETING", body: "Hi, our sale is live now. Reply STOP to unsubscribe.", buttons: [{ type: "QUICK_REPLY", text: "Stop promotions" }] }), P(c.org.id)));
    const tid = (t.body.template as { id: string }).id;
    await submit.POST(post({}), { params: Promise.resolve({ orgId: c.org.id, tid }) });
    await review.POST(post({ decision: "approved" }), { params: Promise.resolve({ orgId: c.org.id, tid }) });
    const cr = await json(await campaigns.POST(post({ name: "Sale", whatsappAccountId: accountId }), P(c.org.id)));
    const cid = (cr.body.campaign as { id: string }).id;
    const CP = { params: Promise.resolve({ orgId: c.org.id, cid }) };
    await campaign.PATCH(req("/x", { method: "PATCH", body: { audience: { mode: "contacts", contactIds: ids }, templateId: tid } }), CP);
    // Treat the number as live so the package applies (demo sends are free).
    await db.whatsAppAccount.update({ where: { id: accountId }, data: { isDemo: false, status: "connected", phoneNumberId: `pn${Date.now()}` } });
    if (acct.connectionId) await db.whatsAppConnection.update({ where: { id: acct.connectionId }, data: { isDemo: false, encryptedAccessToken: encryptSecret("EAAGtesttoken") } });
    const rv = await json(await campaignReview.POST(post({}), CP));
    expect(JSON.stringify(rv.body)).toMatch(/only 2 marketing messages are left/);
    expect((await launch.POST(post({ confirmConsent: true }), CP)).status).toBeGreaterThanOrEqual(400);

    // One extra credit lets it launch; then the credit is taken back so the live send runs out mid-way.
    actAs(c.admin);
    await adminOrgPkg.POST(post({ marketing: 1 }), params({ id: c.org.id }));
    actAs(c.owner);
    await campaignReview.POST(post({}), CP);
    expect((await launch.POST(post({ confirmConsent: true }), CP)).status).toBe(200);
    actAs(c.admin);
    await adminOrgPkg.POST(post({ marketing: -1 }), params({ id: c.org.id }));

    // Meta accepts every send.
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify({ messages: [{ id: `wamid.${Math.random().toString(36).slice(2)}` }] }), { status: 200, headers: { "content-type": "application/json" } }));
    const run = await processCampaign(cid, 10_000);
    expect(run.sent).toBe(2);
    expect(await db.campaign.findUniqueOrThrow({ where: { id: cid } })).toMatchObject({ status: "paused", statusReason: expect.stringContaining("package") });
    expect((await packageStatus(c.org.id)).marketing).toMatchObject({ used: 2, remaining: 0 });
  });
});
