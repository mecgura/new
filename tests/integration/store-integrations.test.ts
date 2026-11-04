import { createHmac } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/background", () => ({ runAfterResponse: vi.fn() }));

import { db } from "@/lib/db";
import { actAs, addMember, json, makeOrg, makeUser, params, req } from "../helpers";
import * as listRoute from "@/app/api/organizations/[orgId]/integrations/route";
import * as oneRoute from "@/app/api/organizations/[orgId]/integrations/[iid]/route";
import * as hookRoute from "@/app/api/integrations/[provider]/[cid]/route";

type U = Awaited<ReturnType<typeof makeUser>>;
let orgId = "";
let owner: U, agent: U;
const SHOP_KEY = "shpss_test_signing_key_1234567890";
const post = (b: unknown) => req("/x", { method: "POST", body: b });
let n = 0;
const phone10 = () => `98${String(Date.now()).slice(-6)}${String(n++).padStart(2, "0")}`;

function hook(provider: string, cid: string, body: unknown, opts: { topic: string; secret: string; badSig?: boolean; raw?: string }) {
  const raw = opts.raw ?? JSON.stringify(body);
  const sig = createHmac("sha256", opts.badSig ? "wrong" : opts.secret).update(raw).digest("base64");
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (provider === "shopify") Object.assign(headers, { "x-shopify-hmac-sha256": sig, "x-shopify-topic": opts.topic });
  else Object.assign(headers, { "x-wc-webhook-signature": sig, "x-wc-webhook-topic": opts.topic });
  return hookRoute.POST(new Request("http://localhost:3000/api/integrations/x", { method: "POST", body: raw, headers }) as never, { params: Promise.resolve({ provider, cid }) });
}
const contactBy = (phone: string) => db.contact.findFirst({ where: { organizationId: orgId, phone }, include: { tags: { include: { tag: true } } } });

beforeAll(async () => {
  orgId = (await makeOrg("Store Biz")).id;
  [owner, agent] = await Promise.all([makeUser({ name: "Owner" }), makeUser({ name: "Agent" })]);
  await addMember(orgId, owner.id, "CLIENT_OWNER");
  await addMember(orgId, agent.id, "AGENT");
});

describe("store integrations", () => {
  let shopId = "";
  let wooId = "";
  let wooSecret = "";

  it("connects Shopify with its signing key and WooCommerce with a generated secret; agents can't", async () => {
    actAs(agent);
    expect((await listRoute.POST(post({ provider: "shopify", name: "x", secret: SHOP_KEY }), params({ orgId }))).status).toBe(403);
    actAs(owner);
    expect((await listRoute.POST(post({ provider: "shopify", name: "Shop" }), params({ orgId }))).status).toBe(400);
    const s = await json(await listRoute.POST(post({ provider: "shopify", name: "Kaur Boutique", secret: SHOP_KEY }), params({ orgId })));
    expect(s.status).toBe(201);
    expect(s.body.secret).toBeUndefined();
    shopId = (s.body.connection as { id: string }).id;
    expect((s.body.connection as { webhookUrl: string; settings: { customerTag: string } })).toMatchObject({ settings: { customerTag: "Shopify customer" } });
    expect((s.body.connection as { webhookUrl: string }).webhookUrl).toContain(`/api/integrations/shopify/${shopId}`);
    const w = await json(await listRoute.POST(post({ provider: "woocommerce", name: "Woo shop" }), params({ orgId })));
    wooId = (w.body.connection as { id: string }).id;
    wooSecret = w.body.secret as string;
    expect(wooSecret.length).toBeGreaterThan(20);
    // The secret is stored encrypted, never in plain text.
    expect((await db.integrationConnection.findUniqueOrThrow({ where: { id: wooId } })).encryptedSecret).not.toContain(wooSecret);
  });

  it("an abandoned checkout tags the cart; the order then records the purchase and swaps the tag — once", async () => {
    const p = phone10();
    const checkout = { token: `tok${p}`, phone: p, email: "simran@example.com", total_price: "1499.00", currency: "INR", abandoned_checkout_url: "https://shop.example/cart/recover/abc", customer: { first_name: "Simran", last_name: "Kaur" } };
    expect((await hook("shopify", shopId, checkout, { topic: "checkouts/create", secret: SHOP_KEY, badSig: true })).status).toBe(401);
    expect((await hook("shopify", "nope", checkout, { topic: "checkouts/create", secret: SHOP_KEY })).status).toBe(401);
    const c1 = await json(await hook("shopify", shopId, checkout, { topic: "checkouts/create", secret: SHOP_KEY }));
    expect(c1.body).toMatchObject({ status: "processed" });
    let contact = await contactBy(`+91${p}`);
    expect(contact).toMatchObject({ name: "Simran Kaur", email: "simran@example.com", source: "api", lifecycle: "lead", optInStatus: "unknown" });
    expect(contact!.tags.map((t) => t.tag.name)).toEqual(["Abandoned cart"]);
    expect(JSON.parse(contact!.customFields)).toMatchObject({ cart_url: "https://shop.example/cart/recover/abc", cart_total: "INR 1499" });
    // Later updates to the same checkout are ignored.
    expect((await json(await hook("shopify", shopId, checkout, { topic: "checkouts/update", secret: SHOP_KEY }))).body).toMatchObject({ status: "duplicate" });

    const order = { id: 5001 + n, name: "#1001", phone: `+91${p}`, email: "simran@example.com", total_price: "1499.00", currency: "INR", customer: { first_name: "Simran", last_name: "Kaur" } };
    const o = await json(await hook("shopify", shopId, order, { topic: "orders/create", secret: SHOP_KEY }));
    expect(o.body).toMatchObject({ status: "processed" });
    expect((await json(await hook("shopify", shopId, order, { topic: "orders/paid", secret: SHOP_KEY }))).body).toMatchObject({ status: "duplicate" });
    contact = await contactBy(`+91${p}`);
    expect(contact!.lifecycle).toBe("customer");
    expect(contact!.tags.map((t) => t.tag.name)).toEqual(["Shopify customer"]);
    const purchases = await db.purchase.findMany({ where: { contactId: contact!.id } });
    expect(purchases).toHaveLength(1);
    expect(purchases[0]).toMatchObject({ amountPaise: 149_900, note: "Shopify order #1001" });
  });

  it("skips orders without a phone and cancelled orders", async () => {
    const r = await json(await hook("shopify", shopId, { id: 9001, name: "#9", email: "x@example.com", total_price: "10" }, { topic: "orders/create", secret: SHOP_KEY }));
    expect(r.body).toMatchObject({ status: "skipped" });
    const c = await json(await hook("shopify", shopId, { id: 9002, phone: "9876500000", cancelled_at: "2026-11-01T00:00:00Z", total_price: "10" }, { topic: "orders/create", secret: SHOP_KEY }));
    expect(c.body).toMatchObject({ status: "skipped", detail: "Cancelled order" });
  });

  it("WooCommerce: answers the ping, waits for payment, then records the order", async () => {
    const ping = await hookRoute.POST(new Request("http://localhost:3000/x", { method: "POST", body: "webhook_id=12", headers: { "content-type": "application/x-www-form-urlencoded" } }) as never, { params: Promise.resolve({ provider: "woocommerce", cid: wooId }) });
    expect((await json(ping)).body).toMatchObject({ status: "ping" });
    const p = phone10();
    const pending = { id: 77 + n, number: "77", status: "pending", total: "850.00", currency: "INR", billing: { first_name: "Aman", last_name: "Gill", phone: p, email: "aman@example.com" } };
    expect((await json(await hook("woocommerce", wooId, pending, { topic: "order.created", secret: wooSecret }))).body).toMatchObject({ status: "skipped" });
    const paid = await json(await hook("woocommerce", wooId, { ...pending, status: "processing" }, { topic: "order.updated", secret: wooSecret }));
    expect(paid.body).toMatchObject({ status: "processed" });
    const contact = await contactBy(`+91${p}`);
    expect(contact!.tags.map((t) => t.tag.name)).toEqual(["WooCommerce customer"]);
    expect(await db.purchase.count({ where: { contactId: contact!.id } })).toBe(1);
  });

  it("a disabled connection ignores events; the list shows activity; other workspaces can't touch it", async () => {
    actAs(owner);
    await oneRoute.PATCH(req("/x", { method: "PATCH", body: { status: "disabled" } }), params({ orgId, iid: shopId }));
    expect((await json(await hook("shopify", shopId, { id: 1, phone: "9876511111", total_price: "1" }, { topic: "orders/create", secret: SHOP_KEY }))).body).toMatchObject({ status: "disabled" });
    const list = await json(await listRoute.GET(req("/x"), params({ orgId })));
    const shop = (list.body.connections as { id: string; eventCount: number; recent: unknown[] }[]).find((c) => c.id === shopId)!;
    expect(shop.eventCount).toBeGreaterThanOrEqual(4);
    expect(shop.recent.length).toBeGreaterThanOrEqual(2);

    const other = await makeOrg("Other store");
    const stranger = await makeUser({ name: "Stranger" });
    await addMember(other.id, stranger.id, "CLIENT_OWNER");
    actAs(stranger);
    expect((await oneRoute.DELETE(req("/x", { method: "DELETE" }), params({ orgId: other.id, iid: shopId }))).status).toBe(404);
    actAs(owner);
    expect((await oneRoute.DELETE(req("/x", { method: "DELETE" }), params({ orgId, iid: shopId }))).status).toBe(200);
  });
});
