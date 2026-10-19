import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { encryptSecret } from "@/lib/crypto";
import { actAs, addMember, json, makeOrg, makePlan, makeUser, params, req } from "../helpers";
import * as adminPrices from "@/app/api/admin/wallet-prices/route";
import * as clientPrices from "@/app/api/admin/organizations/[id]/wallet/prices/route";
import * as clientWallet from "@/app/api/organizations/[orgId]/wallet/route";
import * as sendRoute from "@/app/api/organizations/[orgId]/inbox/conversations/[cid]/messages/route";
import { creditWallet, getWallet } from "@/services/wallet";
import { assertCanAfford, categoryOfMessage, chargeMessage, getPriceCard } from "@/services/wallet-pricing";

afterEach(() => {
  vi.restoreAllMocks();
});

let n = 0;
async function tenant(opts: { demo?: boolean } = {}) {
  const admin = await makeUser({ role: "SUPER_ADMIN", name: "Admin" });
  const org = await makeOrg(`Fee ${n++}`);
  const owner = await makeUser({ name: "Owner" });
  await addMember(org.id, owner.id, "CLIENT_OWNER");
  const plan = await makePlan({ maxUsers: 10, maxWhatsAppNumbers: 3 });
  await db.subscription.create({ data: { organizationId: org.id, planId: plan.id, priceMonthly: plan.priceMonthly } });
  await db.organizationService.create({ data: { organizationId: org.id, service: "WHATSAPP_AUTOMATION", enabled: true } });
  const conn = await db.whatsAppConnection.create({ data: { organizationId: org.id, method: "manual", status: "active", encryptedAccessToken: encryptSecret("EAAGtesttoken"), isDemo: Boolean(opts.demo) } });
  const phone = `+9199${String(Date.now()).slice(-7)}${n}`;
  const account = await db.whatsAppAccount.create({
    data: { organizationId: org.id, displayName: "Shop", phoneNumber: phone, status: opts.demo ? "demo" : "connected", isDemo: Boolean(opts.demo), phoneNumberId: `pn${n}${Date.now()}`, connectionId: conn.id },
  });
  const contact = await db.contact.create({ data: { organizationId: org.id, phone: `+9198${String(Date.now()).slice(-7)}${n}`, name: "Customer", optInStatus: "opted_in" } });
  const conv = await db.conversation.create({ data: { organizationId: org.id, contactId: contact.id, whatsappAccountId: account.id, lastInboundAt: new Date(), isDemo: Boolean(opts.demo) } });
  return { admin, org, owner, account, contact, conv };
}

const outbound = (t: Awaited<ReturnType<typeof tenant>>, over: Record<string, unknown> = {}) =>
  db.message.create({ data: { organizationId: t.org.id, conversationId: t.conv.id, direction: "outbound", type: "text", body: "hi", status: "sent", ...over } });
const setDefault = (body: Record<string, unknown>) => adminPrices.PUT(req("/x", { method: "PUT", body }), params({}));

describe("message fee price card", () => {
  it("defaults apply to every client, a client override wins, null goes back to the default", async () => {
    const a = await tenant();
    const b = await tenant();
    actAs(a.admin);
    expect((await setDefault({ marketing: 1.5, service: 0.25 })).status).toBe(200);
    expect((await getPriceCard(a.org.id)).effective).toEqual({ marketing: 150, utility: 0, authentication: 0, service: 25 });
    const o = await json(await clientPrices.PUT(req("/x", { method: "PUT", body: { marketing: 2 } }), params({ id: a.org.id })));
    expect(o.status).toBe(200);
    expect((await getPriceCard(a.org.id)).effective.marketing).toBe(200);
    expect((await getPriceCard(b.org.id)).effective.marketing).toBe(150);
    await clientPrices.PUT(req("/x", { method: "PUT", body: { marketing: null } }), params({ id: a.org.id }));
    expect((await getPriceCard(a.org.id)).effective.marketing).toBe(150);
    await setDefault({ marketing: null, service: null });
  });

  it("rejects negative, fractional-paise and absurd prices; only a Super Admin can set them", async () => {
    const t = await tenant();
    actAs(t.admin);
    for (const marketing of [-1, 0.001, 20_000]) expect((await setDefault({ marketing })).status, String(marketing)).toBe(400);
    actAs(t.owner);
    expect((await setDefault({ marketing: 1 })).status).toBe(403);
    expect((await clientPrices.PUT(req("/x", { method: "PUT", body: { marketing: 1 } }), params({ id: t.org.id }))).status).toBe(403);
  });

  it("clients see their effective prices read-only", async () => {
    const t = await tenant();
    actAs(t.admin);
    await clientPrices.PUT(req("/x", { method: "PUT", body: { utility: 0.4 } }), params({ id: t.org.id }));
    actAs(t.owner);
    const r = await json(await clientWallet.GET(req("/x"), params({ orgId: t.org.id })));
    expect((r.body.prices as { utility: number }).utility).toBe(40);
  });
});

describe("categories", () => {
  it("template messages use their Meta category, everything else is a service message", () => {
    expect(categoryOfMessage("template", JSON.stringify({ category: "UTILITY" }))).toBe("utility");
    expect(categoryOfMessage("template", { category: "AUTHENTICATION" })).toBe("authentication");
    expect(categoryOfMessage("template", "not json")).toBe("marketing");
    expect(categoryOfMessage("text", {})).toBe("service");
    expect(categoryOfMessage("interactive", {})).toBe("service");
  });
});

describe("charging", () => {
  it("charges an accepted message once, by category, and records it in the ledger", async () => {
    const t = await tenant();
    actAs(t.admin);
    await clientPrices.PUT(req("/x", { method: "PUT", body: { service: 1, marketing: 5 } }), params({ id: t.org.id }));
    await creditWallet(t.org.id, { actorUserId: t.admin.id }, { amount: 10_000 });

    const text = await outbound(t);
    expect(await chargeMessage(text.id)).toBe("charged");
    expect(await chargeMessage(text.id)).toBe("charged"); // replay: same entry, not a second charge
    expect((await getWallet(t.org.id)).balance).toBe(9_900);
    const entry = await db.walletEntry.findFirstOrThrow({ where: { organizationId: t.org.id, reason: "usage" } });
    expect(entry).toMatchObject({ direction: "debit", amount: 100, reference: text.id, note: "service message" });

    const tpl = await outbound(t, { type: "template", payload: JSON.stringify({ category: "MARKETING" }) });
    expect(await chargeMessage(tpl.id)).toBe("charged");
    expect((await getWallet(t.org.id)).balance).toBe(9_400);
    expect(await db.auditLog.count({ where: { organizationId: t.org.id, action: "wallet.debited" } })).toBe(0); // usage is not audited per message
  });

  it("free categories, demo messages and inbound messages cost nothing", async () => {
    const t = await tenant();
    actAs(t.admin);
    await clientPrices.PUT(req("/x", { method: "PUT", body: { marketing: 5 } }), params({ id: t.org.id }));
    await creditWallet(t.org.id, { actorUserId: t.admin.id }, { amount: 1_000 });
    expect(await chargeMessage((await outbound(t)).id)).toBe("free"); // service has no price
    expect(await chargeMessage((await outbound(t, { type: "template", payload: JSON.stringify({ category: "MARKETING" }), isDemo: true })).id)).toBe("free");
    expect(await chargeMessage((await outbound(t, { direction: "inbound", type: "template", payload: JSON.stringify({ category: "MARKETING" }) })).id)).toBe("free");
    expect((await getWallet(t.org.id)).balance).toBe(1_000);
  });

  it("when the balance ran out after the send, the fee stays unpaid and the wallet never goes negative", async () => {
    const t = await tenant();
    actAs(t.admin);
    await clientPrices.PUT(req("/x", { method: "PUT", body: { service: 2 } }), params({ id: t.org.id }));
    await creditWallet(t.org.id, { actorUserId: t.admin.id }, { amount: 250 });
    expect(await chargeMessage((await outbound(t)).id)).toBe("charged"); // 250 - 200
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await chargeMessage((await outbound(t)).id)).toBe("unpaid");
    expect((await getWallet(t.org.id)).balance).toBe(50); // 50 < 200: not collected, never negative
  });

  it("assertCanAfford refuses with HTTP 402 when the wallet can't cover the messages; free prices always pass", async () => {
    const t = await tenant();
    actAs(t.admin);
    await assertCanAfford(t.org.id, "marketing", 1000); // no price → free
    await clientPrices.PUT(req("/x", { method: "PUT", body: { marketing: 1 } }), params({ id: t.org.id }));
    await creditWallet(t.org.id, { actorUserId: t.admin.id }, { amount: 250 });
    await assertCanAfford(t.org.id, "marketing", 2);
    await expect(assertCanAfford(t.org.id, "marketing", 3)).rejects.toMatchObject({ status: 402 });
  });
});

describe("sending from the inbox", () => {
  function mockMetaSend() {
    return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = new URL(String(input));
      if (url.hostname !== "graph.facebook.com") throw new Error(`unexpected fetch ${url}`);
      return new Response(JSON.stringify({ messages: [{ id: `wamid.${Math.random().toString(36).slice(2)}` }] }), { status: 200, headers: { "content-type": "application/json" } });
    });
  }
  const send = (t: Awaited<ReturnType<typeof tenant>>, body: unknown) => sendRoute.POST(req("/x", { method: "POST", body }), params({ orgId: t.org.id, cid: t.conv.id }));

  it("with a price and an empty wallet the message is refused (402) before anything is created or sent", async () => {
    const t = await tenant();
    actAs(t.admin);
    await clientPrices.PUT(req("/x", { method: "PUT", body: { service: 1 } }), params({ id: t.org.id }));
    const fetchSpy = mockMetaSend();
    actAs(t.owner);
    const r = await json(await send(t, { type: "text", body: "hello" }));
    expect(r.status).toBe(402);
    expect(String(r.body.error)).toMatch(/Wallet balance is too low/);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await db.message.count({ where: { conversationId: t.conv.id } })).toBe(0);
  });

  it("with credit the message goes out and exactly one fee is taken; without a price nothing is taken", async () => {
    const t = await tenant();
    actAs(t.admin);
    await clientPrices.PUT(req("/x", { method: "PUT", body: { service: 1 } }), params({ id: t.org.id }));
    await creditWallet(t.org.id, { actorUserId: t.admin.id }, { amount: 500 });
    mockMetaSend();
    actAs(t.owner);
    const r = await json(await send(t, { type: "text", body: "hello" }));
    expect(r.status).toBe(201);
    expect((await getWallet(t.org.id)).balance).toBe(400);

    actAs(t.admin);
    await clientPrices.PUT(req("/x", { method: "PUT", body: { service: null } }), params({ id: t.org.id }));
    actAs(t.owner);
    expect((await json(await send(t, { type: "text", body: "again" }))).status).toBe(201);
    expect((await getWallet(t.org.id)).balance).toBe(400);
  });

  it("a failed send (Meta rejects) is not charged", async () => {
    const t = await tenant();
    actAs(t.admin);
    await clientPrices.PUT(req("/x", { method: "PUT", body: { service: 1 } }), params({ id: t.org.id }));
    await creditWallet(t.org.id, { actorUserId: t.admin.id }, { amount: 500 });
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify({ error: { message: "Recipient not on WhatsApp", code: 131026 } }), { status: 400, headers: { "content-type": "application/json" } }));
    actAs(t.owner);
    await send(t, { type: "text", body: "hello" });
    expect((await getWallet(t.org.id)).balance).toBe(500);
  });
});
