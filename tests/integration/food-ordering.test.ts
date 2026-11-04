import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";

vi.mock("@/lib/background", () => ({ runAfterResponse: vi.fn() }));

import { db } from "@/lib/db";
import { actAs, addMember, json, makeOrg, makePlan, makeUser, params, req } from "../helpers";
import { resetRateLimits } from "@/lib/rate-limit";
import * as demoConnect from "@/app/api/organizations/[orgId]/whatsapp/connect/demo/route";
import * as settingsRoute from "@/app/api/organizations/[orgId]/food/settings/route";
import * as menuRoute from "@/app/api/organizations/[orgId]/food/menu/route";
import * as menuItemRoute from "@/app/api/organizations/[orgId]/food/menu/[id]/route";
import * as spotsRoute from "@/app/api/organizations/[orgId]/food/spots/route";
import * as qrRoute from "@/app/api/organizations/[orgId]/food/spots/[id]/qr/route";
import * as ordersRoute from "@/app/api/organizations/[orgId]/food/orders/route";
import * as orderRoute from "@/app/api/organizations/[orgId]/food/orders/[id]/route";
import * as paidRoute from "@/app/api/organizations/[orgId]/food/orders/[id]/paid/route";
import * as reportRoute from "@/app/api/organizations/[orgId]/food/report/route";
import * as draftRoute from "@/app/api/food-menu/[org]/[code]/order/route";
import * as webhook from "@/app/api/webhooks/food/[orgId]/route";
import { receiveInbound } from "@/services/inbox/messaging";
import { publicMenu } from "@/services/food/food";

type U = Awaited<ReturnType<typeof makeUser>>;
let seq = 0;
const post = (b: unknown) => req("/x", { method: "POST", body: b });
const put = (b: unknown) => req("/x", { method: "PUT", body: b });

async function venue(opts: { service?: boolean } = {}) {
  const org = await makeOrg(`Hill Resort ${seq++}`);
  const owner = await makeUser({ name: "Owner" });
  const chef = await makeUser({ name: "Chef" });
  await addMember(org.id, owner.id, "CLIENT_OWNER");
  await addMember(org.id, chef.id, "AGENT");
  const plan = await makePlan({ maxUsers: 10, maxWhatsAppNumbers: 2 });
  await db.subscription.create({ data: { organizationId: org.id, planId: plan.id, priceMonthly: plan.priceMonthly } });
  await db.organizationService.create({ data: { organizationId: org.id, service: "WHATSAPP_AUTOMATION", enabled: true } });
  if (opts.service !== false) await db.organizationService.create({ data: { organizationId: org.id, service: "FOOD_ORDERING", enabled: true } });
  actAs(owner);
  const d = await json(await demoConnect.POST(post({ businessName: "Hill Resort" }), params({ orgId: org.id })));
  const accountId = (d.body.account as { id: string }).id;
  const slug = (await db.organization.findUniqueOrThrow({ where: { id: org.id } })).slug;
  const P = <E extends Record<string, string> = Record<never, string>>(extra?: E) => params({ orgId: org.id, ...(extra ?? ({} as E)) });
  return { orgId: org.id, slug, owner, chef, accountId, P };
}

async function setUp(v: Awaited<ReturnType<typeof venue>>, settings: Record<string, unknown> = {}) {
  actAs(v.owner);
  const s = await json(await settingsRoute.PUT(put({ whatsappAccountId: v.accountId, venueName: "Hill View Dining", taxPercent: 5, paymentModes: ["room_bill", "counter"], ...settings }), v.P()));
  expect(s.status).toBe(200);
  const paneer = await json(await menuRoute.POST(post({ category: "Starters", name: "Paneer Tikka", priceRupees: 320 }), v.P()));
  const dal = await json(await menuRoute.POST(post({ category: "Main course", name: "Dal Makhani", priceRupees: 280 }), v.P()));
  expect(paneer.status).toBe(201);
  const spots = await json(await spotsRoute.POST(post({ kind: "room", prefix: "Room", from: 201, to: 205 }), v.P()));
  expect(spots.body.added).toBe(5);
  const room = (spots.body.spots as { id: string; code: string; label: string; url: string }[]).find((x) => x.label === "Room 204")!;
  return { paneer: (paneer.body.item as { id: string }).id, dal: (dal.body.item as { id: string }).id, room };
}

const inbound = (v: { orgId: string; accountId: string }, phone: string, body: string) =>
  receiveInbound(v.orgId, v.accountId, { externalId: `wamid.food.${Date.now()}.${seq++}`, fromPhone: phone, profileName: "Riya", type: "text", body, at: new Date(), isDemo: true });
const draft = (slug: string, code: string, body: unknown) => draftRoute.POST(post(body), params({ org: slug, code }));

afterEach(() => {
  vi.restoreAllMocks();
  resetRateLimits();
});

describe("food ordering", () => {
  it("is a separate service: off → 403, and the public menu is not shown", async () => {
    const v = await venue({ service: false });
    actAs(v.owner);
    expect((await menuRoute.GET(req("/x"), v.P())).status).toBe(403);
    expect(await publicMenu(v.slug, "room-204")).toBeNull();
  });

  it("menu → QR → order on WhatsApp → kitchen updates the guest at every step → report", async () => {
    const v = await venue();
    const { paneer, dal, room } = await setUp(v);
    expect(room.url).toMatch(new RegExp(`/menu/${v.slug}/${room.code}$`));
    const qr = await qrRoute.GET(req("/x"), v.P({ id: room.id }));
    expect(qr.headers.get("content-type")).toBe("image/png");

    const menu = await publicMenu(v.slug, room.code);
    expect(menu).toMatchObject({ venue: "Hill View Dining", open: true, paymentModes: ["room_bill", "counter"] });
    expect(menu!.items.map((i) => i.name).sort()).toEqual(["Dal Makhani", "Paneer Tikka"]);

    // Bad payment option / unknown dish are refused.
    expect((await draft(v.slug, room.code, { items: [{ itemId: paneer, qty: 1 }], paymentMode: "pay_now" })).status).toBe(400);
    expect((await draft(v.slug, room.code, { items: [{ itemId: "nope", qty: 1 }], paymentMode: "counter" })).status).toBe(409);

    const d = await json(await draft(v.slug, room.code, { items: [{ itemId: paneer, qty: 2 }, { itemId: dal, qty: 1 }], paymentMode: "room_bill", note: "Less spicy" }));
    expect(d.status).toBe(201);
    const code = d.body.code as string;
    expect(d.body.totalPaise).toBe(Math.round((2 * 32_000 + 28_000) * 1.05)); // 5% tax
    expect(String(d.body.whatsappUrl)).toContain(encodeURIComponent(`Confirm my order ${code}`));
    // A draft isn't on the kitchen screen until the guest confirms on WhatsApp.
    actAs(v.chef);
    expect(((await json(await ordersRoute.GET(req("/x"), v.P()))).body.orders as unknown[]).length).toBe(0);

    const phone = `+9198${String(Date.now()).slice(-8)}`;
    await inbound(v, phone, `Confirm my order ${code} (Room 204)`);
    const live = (await json(await ordersRoute.GET(req("/x"), v.P()))).body.orders as { id: string; number: number; status: string; paymentStatus: string; spotLabel: string; note: string }[];
    expect(live).toHaveLength(1);
    expect(live[0]).toMatchObject({ status: "placed", paymentStatus: "unpaid", spotLabel: "Room 204", note: "Less spicy" });
    const order = await db.foodOrder.findUniqueOrThrow({ where: { id: live[0].id } });
    const thread = () => db.message.findMany({ where: { conversationId: order.conversationId!, direction: "outbound" }, orderBy: { createdAt: "asc" } });
    expect((await thread())[0].body).toContain(`Order #${order.number} for Room 204 is received`);
    expect((await thread())[0].body).toContain("added to your room bill");

    // Sending the code again just says it's already confirmed.
    await inbound(v, phone, code);
    expect((await thread()).at(-1)!.body).toContain("already confirmed");

    // Kitchen: invalid jump refused, then each step messages the guest.
    expect((await orderRoute.POST(post({ to: "delivered" }), v.P({ id: order.id }))).status).toBe(409);
    for (const to of ["accepted", "ready", "delivered"]) {
      const r = await json(await orderRoute.POST(post({ to }), v.P({ id: order.id })));
      expect(r.status).toBe(200);
      expect(r.body.guestUpdate).toBe("sent");
    }
    const bodies = (await thread()).map((m) => m.body).join("\n");
    expect(bodies).toContain("accepted");
    expect(bodies).toContain("is ready and on its way to Room 204");
    expect(bodies).toContain("delivered");
    expect((await json(await paidRoute.POST(post({}), v.P({ id: order.id })))).body.order).toMatchObject({ paymentStatus: "paid" });

    // Chef (agent) runs the kitchen and marks dishes sold out, but can't change settings or the menu.
    expect((await settingsRoute.GET(req("/x"), v.P())).status).toBe(403);
    expect((await menuRoute.POST(post({ name: "X", priceRupees: 1 }), v.P())).status).toBe(403);
    expect((await menuItemRoute.PATCH(req("/x", { method: "PATCH", body: { available: false } }), v.P({ id: dal }))).status).toBe(200);
    expect((await publicMenu(v.slug, room.code))!.items.map((i) => i.name)).toEqual(["Paneer Tikka"]);

    actAs(v.owner);
    const rep = await json(await reportRoute.GET(req("/x?days=1"), v.P()));
    expect(rep.body).toMatchObject({ orders: 1, cancelled: 0, revenuePaise: order.totalPaise, paidPaise: order.totalPaise });
    expect((rep.body.topItems as { name: string; qty: number }[])[0]).toMatchObject({ name: "Paneer Tikka", qty: 2 });
  });

  it("pay now: payment link on the client's own Razorpay, signed webhook marks it paid once", async () => {
    const v = await venue();
    actAs(v.owner);
    // Pay now needs the keys.
    expect((await settingsRoute.PUT(put({ paymentModes: ["pay_now"] }), v.P())).status).toBe(400);
    const { paneer, room } = await setUp(v, { paymentModes: ["pay_now", "counter"], razorpayKeyId: "rzp_test_abc123", razorpayKeySecret: "sk_secret_value", webhookSecret: "whsec_food" });
    const s = await json(await settingsRoute.GET(req("/x"), v.P()));
    expect(JSON.stringify(s.body)).not.toContain("sk_secret_value");
    expect(s.body.settings).toMatchObject({ hasKeySecret: true, hasWebhookSecret: true });

    const calls: { url: string; auth: string; body: Record<string, unknown> }[] = [];
    const realFetch = globalThis.fetch;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input instanceof URL ? input.toString() : input);
      if (!url.startsWith("https://api.razorpay.com/")) return realFetch(input, init);
      calls.push({ url, auth: String((init?.headers as Record<string, string>).authorization), body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify({ id: "plink_123", short_url: "https://rzp.io/i/food123" }), { status: 200 });
    });
    const d = await json(await draft(v.slug, room.code, { items: [{ itemId: paneer, qty: 1 }], paymentMode: "pay_now" }));
    await inbound(v, `+9197${String(Date.now()).slice(-8)}`, `Confirm my order ${d.body.code}`);
    const order = await db.foodOrder.findUniqueOrThrow({ where: { code: d.body.code as string } });
    expect(order).toMatchObject({ status: "placed", paymentStatus: "pending", paymentLinkId: "plink_123" });
    expect(calls[0].auth).toBe(`Basic ${Buffer.from("rzp_test_abc123:sk_secret_value").toString("base64")}`);
    expect(calls[0].body).toMatchObject({ amount: order.totalPaise, reference_id: order.id });
    const msgs = await db.message.findMany({ where: { conversationId: order.conversationId! } });
    expect(msgs.some((m) => m.body.includes("https://rzp.io/i/food123"))).toBe(true);

    const raw = JSON.stringify({ event: "payment_link.paid", payload: { payment_link: { entity: { id: "plink_123", reference_id: order.id, amount_paid: order.totalPaise, status: "paid" } } } });
    const hook = (sig: string, eventId: string) => webhook.POST(new Request("http://localhost/x", { method: "POST", body: raw, headers: { "x-razorpay-signature": sig, "x-razorpay-event-id": eventId } }), { params: Promise.resolve({ orgId: v.orgId }) });
    expect((await hook("bad", "evt_f1")).status).toBe(401);
    const good = createHmac("sha256", "whsec_food").update(raw).digest("hex");
    expect(await (await hook(good, "evt_f2")).json()).toEqual({ result: "paid" });
    expect(await (await hook(good, "evt_f2")).json()).toEqual({ result: "duplicate" });
    expect((await db.foodOrder.findUniqueOrThrow({ where: { id: order.id } })).paymentStatus).toBe("paid");
  });

  it("isolation: one venue's codes and orders don't reach another", async () => {
    const a = await venue();
    const b = await venue();
    const { paneer, room } = await setUp(a);
    const d = await json(await draft(a.slug, room.code, { items: [{ itemId: paneer, qty: 1 }], paymentMode: "counter" }));
    // The code sent to venue B's number does nothing there.
    await inbound(b, `+9196${String(Date.now()).slice(-8)}`, `Confirm my order ${d.body.code}`);
    expect((await db.foodOrder.findUniqueOrThrow({ where: { code: d.body.code as string } })).status).toBe("draft");
    actAs(b.owner);
    const order = await db.foodOrder.findUniqueOrThrow({ where: { code: d.body.code as string } });
    expect((await orderRoute.POST(post({ to: "accepted" }), b.P({ id: order.id }))).status).toBe(404);
  });
});

void ({} as U);
