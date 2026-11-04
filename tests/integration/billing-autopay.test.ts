import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";

vi.mock("@/lib/background", () => ({ runAfterResponse: vi.fn() }));

// A stand-in for the Razorpay SDK: records calls, never reaches the network.
const rz = vi.hoisted(() => {
  const calls: { plans: unknown[]; subs: unknown[]; cancels: string[] } = { plans: [], subs: [], cancels: [] };
  let n = 0;
  let failCreate: string | null = null;
  const fetched: Record<string, { status: string; paid_count: number; payment_method?: string }> = {};
  const client = {
    plans: { create: async (b: unknown) => (calls.plans.push(b), { id: `plan_${++n}` }) },
    subscriptions: {
      create: async (b: unknown) => {
        if (failCreate) throw { statusCode: 400, error: { description: failCreate } };
        calls.subs.push(b);
        return { id: `sub_${++n}`, status: "created", short_url: `https://rzp.io/i/${n}` };
      },
      cancel: async (id: string) => (calls.cancels.push(id), { id, status: "cancelled" }),
      fetch: async (id: string) => ({ id, ...(fetched[id] ?? { status: "active", paid_count: 0 }) }),
    },
  };
  return { calls, client, fetched, setFail: (m: string | null) => (failCreate = m) };
});
vi.mock("@/lib/razorpay", () => ({ getRazorpay: async () => ({ client: rz.client, keyId: "rzp_test_x", mode: "test" }), razorpaySecretConfigured: () => true }));

import { db } from "@/lib/db";
import { actAs, addMember, json, makeOrg, makeUser, params, req } from "../helpers";
import { resetRateLimits } from "@/lib/rate-limit";
import { addMonth, runBillingCycle, sendPaymentReminders } from "@/services/billing/billing";
import { chargeAmount } from "@/services/billing/autopay";
import * as autopayRoute from "@/app/api/organizations/[orgId]/billing/autopay/route";
import * as syncRoute from "@/app/api/organizations/[orgId]/billing/autopay/sync/route";
import * as cancelRoute from "@/app/api/organizations/[orgId]/billing/cancel/route";
import * as billingRoute from "@/app/api/organizations/[orgId]/billing/route";
import * as webhook from "@/app/api/webhooks/payments/[gateway]/route";
import * as adminList from "@/app/api/admin/billing/autopay/route";
import * as adminSync from "@/app/api/admin/billing/autopay/[id]/sync/route";

const SECRET = "whsec_test_autopay";
process.env.RAZORPAY_WEBHOOK_SECRET = SECRET;
process.env.RAZORPAY_KEY_SECRET = "key_secret_test";
const DAY = 86_400_000;
let n = 0;
let evt = 0;

async function workspace(o: { price?: number; interval?: "month" | "year"; periodEnd?: Date } = {}) {
  const org = await makeOrg(`Autopay ${n++}`);
  const owner = await makeUser({ name: "Owner" });
  await addMember(org.id, owner.id, "CLIENT_OWNER");
  const price = o.price ?? 349_900;
  const plan = await db.plan.create({ data: { name: `AP${n}`, slug: `ap-${Date.now().toString(36)}-${n++}`, priceMonthly: price, priceYearly: price * 10, maxUsers: 10, maxWhatsAppNumbers: 5 } });
  const now = new Date();
  const sub = await db.subscription.create({ data: { organizationId: org.id, planId: plan.id, priceMonthly: price, periodPrice: o.interval === "year" ? price * 10 : price, interval: o.interval ?? "month", billingMode: "invoiced", currentPeriodStart: now, currentPeriodEnd: o.periodEnd ?? new Date(now.getTime() + 20 * DAY) } });
  actAs(owner);
  return { orgId: org.id, owner, plan, sub, P: () => params({ orgId: org.id }) };
}

function hook(event: string, sub: Record<string, unknown>, payment?: Record<string, unknown>, eventId = `evt_${++evt}`) {
  const raw = JSON.stringify({ event, payload: { subscription: { entity: sub }, ...(payment ? { payment: { entity: payment } } : {}) } });
  const sig = createHmac("sha256", SECRET).update(raw).digest("hex");
  return webhook.POST(new Request("http://localhost/api/webhooks/payments/razorpay", { method: "POST", body: raw, headers: { "x-razorpay-signature": sig, "x-razorpay-event-id": eventId, "content-type": "application/json" } }), { params: Promise.resolve({ gateway: "razorpay" }) });
}

beforeEach(() => {
  resetRateLimits();
  rz.setFail(null);
});

describe("turning auto-pay on", () => {
  it("creates a Razorpay plan + subscription starting on the next billing date and returns the authorisation link", async () => {
    const w = await workspace();
    const r = await json(await autopayRoute.POST(req("/x", { method: "POST" }), w.P()));
    expect(r.status).toBe(201);
    const m = r.body.mandate as { status: string; authorizeUrl: string; amount: number };
    expect(m.status).toBe("created");
    expect(m.authorizeUrl).toMatch(/^https:\/\/rzp\.io\//);
    const total = await chargeAmount(w.sub); // plan price + tax at the configured rate
    expect(m.amount).toBe(total);
    const created = rz.calls.subs.at(-1) as { start_at: number; total_count: number; notes: { organization: string } };
    expect(created.start_at).toBe(Math.floor(w.sub.currentPeriodEnd!.getTime() / 1000));
    expect(created.notes.organization).toBe(w.orgId);
    expect((rz.calls.plans.at(-1) as { period: string; item: { amount: number } }).item.amount).toBe(total);

    // Asking again before authorising shows the same link; no second Razorpay subscription.
    const before = rz.calls.subs.length;
    const again = await json(await autopayRoute.POST(req("/x", { method: "POST" }), w.P()));
    expect((again.body.mandate as { authorizeUrl: string }).authorizeUrl).toBe(m.authorizeUrl);
    expect(rz.calls.subs.length).toBe(before);

    const ov = await json(await billingRoute.GET(req("/x"), w.P()));
    expect((ov.body as { autopay: { available: boolean; mandate: { status: string } } }).autopay.mandate.status).toBe("created");
  });

  it("shows Razorpay's own message when Subscriptions isn't enabled, and creates nothing", async () => {
    const w = await workspace();
    rz.setFail("The requested URL was not found on the server. Subscriptions feature is not enabled for this merchant.");
    const r = await json(await autopayRoute.POST(req("/x", { method: "POST" }), w.P()));
    expect(r.status).toBe(503);
    expect(String(r.body.error ?? r.body.message ?? JSON.stringify(r.body))).toMatch(/Subscriptions may not be enabled/);
    expect(await db.autopay.count({ where: { organizationId: w.orgId } })).toBe(0);
  });

  it("is refused for contracted plans and for agents", async () => {
    const w = await workspace();
    await db.subscription.update({ where: { id: w.sub.id }, data: { billingMode: "complimentary" } });
    expect((await autopayRoute.POST(req("/x", { method: "POST" }), w.P())).status).toBe(409);
    const agent = await makeUser({ name: "Agent" });
    await addMember(w.orgId, agent.id, "AGENT");
    actAs(agent);
    expect((await autopayRoute.POST(req("/x", { method: "POST" }), w.P())).status).toBe(403);
  });
});

describe("Razorpay webhooks", () => {
  it("rejects unsigned events", async () => {
    const raw = JSON.stringify({ event: "subscription.charged", payload: {} });
    const res = await webhook.POST(new Request("http://localhost/x", { method: "POST", body: raw, headers: { "x-razorpay-signature": "bad", "x-razorpay-event-id": "e1" } }), { params: Promise.resolve({ gateway: "razorpay" }) });
    expect(res.status).toBe(401);
  });

  it("authorised → charged pays the renewal invoice once; duplicates and replays change nothing", async () => {
    const w = await workspace({ periodEnd: new Date(Date.now() - 60_000) });
    const m = (await json(await autopayRoute.POST(req("/x", { method: "POST" }), w.P()))).body.mandate as { id: string };
    const a = await db.autopay.findUniqueOrThrow({ where: { id: m.id } });
    await json(await hook("subscription.authenticated", { id: a.gatewaySubId, status: "authenticated", payment_method: "upi" }));
    expect((await db.autopay.findUniqueOrThrow({ where: { id: a.id } })).method).toBe("upi");

    // The charge arrives before the scheduler issued the renewal invoice: it is created and paid.
    const pay = { id: "pay_AP1", amount: await chargeAmount(w.sub), currency: "INR", method: "upi" };
    const eventId = `evt_charge_${n}`;
    const r = await json(await hook("subscription.charged", { id: a.gatewaySubId, status: "active", paid_count: 1 }, pay, eventId));
    expect((r.body.results as { outcome: string }[])[0].outcome).toBe("paid");
    const paid = await db.invoice.findMany({ where: { organizationId: w.orgId, status: "paid", paidVia: "razorpay_autopay" } });
    expect(paid).toHaveLength(1);
    expect(paid[0].total).toBe(pay.amount);
    const after = await db.autopay.findUniqueOrThrow({ where: { id: a.id } });
    expect(after).toMatchObject({ status: "active", chargedCount: 1 });

    const dup = await json(await hook("subscription.charged", { id: a.gatewaySubId, status: "active", paid_count: 1 }, pay, eventId));
    expect((dup.body.results as { outcome: string }[])[0].outcome).toBe("duplicate");
    const replay = await json(await hook("subscription.charged", { id: a.gatewaySubId, status: "active", paid_count: 1 }, pay));
    expect((replay.body.results as { outcome: string }[])[0].outcome).toBe("duplicate_payment");
    expect(await db.invoice.count({ where: { organizationId: w.orgId, status: "paid" } })).toBe(1);
    expect(await db.auditLog.count({ where: { organizationId: w.orgId, action: "billing.invoice_paid" } })).toBe(1);
  });

  it("a wrong amount never pays the invoice and is flagged for the admin", async () => {
    const w = await workspace({ periodEnd: new Date(Date.now() - 60_000) });
    const m = (await json(await autopayRoute.POST(req("/x", { method: "POST" }), w.P()))).body.mandate as { id: string };
    const a = await db.autopay.findUniqueOrThrow({ where: { id: m.id } });
    const r = await json(await hook("subscription.charged", { id: a.gatewaySubId, status: "active", paid_count: 1 }, { id: "pay_bad", amount: 100, currency: "INR" }));
    expect((r.body.results as { outcome: string }[])[0].outcome).toBe("amount_mismatch");
    expect(await db.invoice.count({ where: { organizationId: w.orgId, status: "paid" } })).toBe(0);
    actAs(await makeUser({ role: "SUPER_ADMIN", name: "Admin" }));
    const list = await json(await adminList.GET(req("/x")));
    expect((list.body.problems as { gatewayPaymentId: string }[]).some((p) => p.gatewayPaymentId === "pay_bad")).toBe(true);
  });

  it("pending and halted are shown with the reason; overdue reminders still go out", async () => {
    const w = await workspace({ periodEnd: new Date(Date.now() - 60_000) });
    const m = (await json(await autopayRoute.POST(req("/x", { method: "POST" }), w.P()))).body.mandate as { id: string };
    const a = await db.autopay.findUniqueOrThrow({ where: { id: m.id } });
    await hook("subscription.pending", { id: a.gatewaySubId, status: "pending" }, { id: "pay_f1", amount: 349_900, currency: "INR", error_description: "Insufficient balance" });
    expect(await db.autopay.findUniqueOrThrow({ where: { id: a.id } })).toMatchObject({ status: "pending", lastFailureReason: "Insufficient balance" });
    await hook("subscription.halted", { id: a.gatewaySubId, status: "halted" });
    expect((await db.autopay.findUniqueOrThrow({ where: { id: a.id } })).status).toBe("halted");
    expect(await db.auditLog.count({ where: { organizationId: w.orgId, action: "billing.autopay_halted" } })).toBe(1);
    await runBillingCycle(new Date());
    const inv = await db.invoice.findFirstOrThrow({ where: { organizationId: w.orgId, status: "open" } });
    await db.invoice.update({ where: { id: inv.id }, data: { dueAt: new Date(Date.now() - 4 * DAY), remindersSent: 0 } });
    await sendPaymentReminders(new Date());
    expect((await db.invoice.findUniqueOrThrow({ where: { id: inv.id } })).remindersSent).toBeGreaterThanOrEqual(2);
  });
});

describe("changes and cancellation", () => {
  it("cancelling the plan cancels the mandate at Razorpay so nothing is charged", async () => {
    const w = await workspace();
    const m = (await json(await autopayRoute.POST(req("/x", { method: "POST" }), w.P()))).body.mandate as { id: string };
    const a = await db.autopay.findUniqueOrThrow({ where: { id: m.id } });
    await hook("subscription.authenticated", { id: a.gatewaySubId, status: "authenticated" });
    expect((await cancelRoute.POST(req("/x", { method: "POST" }), w.P())).status).toBe(200);
    expect(rz.calls.cancels).toContain(a.gatewaySubId);
    expect(await db.autopay.findUniqueOrThrow({ where: { id: a.id } })).toMatchObject({ status: "cancelled", endReason: "subscription_ended" });
    // A late "activated" event doesn't revive it.
    await hook("subscription.activated", { id: a.gatewaySubId, status: "active" });
    expect((await db.autopay.findUniqueOrThrow({ where: { id: a.id } })).status).toBe("cancelled");
  });

  it("a renewal keeps the mandate; turning it off cancels at Razorpay", async () => {
    const w = await workspace({ periodEnd: new Date(Date.now() - 60_000) });
    const m = (await json(await autopayRoute.POST(req("/x", { method: "POST" }), w.P()))).body.mandate as { id: string };
    const a = await db.autopay.findUniqueOrThrow({ where: { id: m.id } });
    await hook("subscription.activated", { id: a.gatewaySubId, status: "active" });
    await runBillingCycle(new Date());
    expect((await db.autopay.findUniqueOrThrow({ where: { id: a.id } })).status).toBe("active");
    expect((await autopayRoute.DELETE(req("/x", { method: "DELETE" }), w.P())).status).toBe(200);
    expect(rz.calls.cancels).toContain(a.gatewaySubId);
  });

  it("a trial converting to the same paid plan carries the mandate over; a different amount cancels it", async () => {
    const w = await workspace({ periodEnd: new Date(Date.now() - 60_000) });
    await db.subscription.update({ where: { id: w.sub.id }, data: { billingMode: "trial", trialEndsAt: new Date(Date.now() - 60_000) } });
    const m = (await json(await autopayRoute.POST(req("/x", { method: "POST" }), w.P()))).body.mandate as { id: string };
    await db.autopay.update({ where: { id: m.id }, data: { status: "authenticated" } });
    await runBillingCycle(new Date()); // trial → paid row
    const fresh = await db.subscription.findFirstOrThrow({ where: { organizationId: w.orgId, status: "active" } });
    expect(fresh.id).not.toBe(w.sub.id);
    expect(await db.autopay.findUniqueOrThrow({ where: { id: m.id } })).toMatchObject({ status: "authenticated", subscriptionId: fresh.id });

    // Admin moves the client to a pricier plan: the old mandate is cancelled, owners are asked to turn it on again.
    const { assignPlan } = await import("@/lib/services/clients");
    const admin = await makeUser({ role: "SUPER_ADMIN", name: "Admin" });
    const bigger = await db.plan.create({ data: { name: "Bigger", slug: `bigger-${Date.now()}`, priceMonthly: 749_900, maxUsers: 10, maxWhatsAppNumbers: 5 } });
    await assignPlan(admin.id, w.orgId, bigger.id, undefined, "invoiced");
    expect((await db.autopay.findUniqueOrThrow({ where: { id: m.id } })).endReason).toBe("plan_changed");
  });

  it("customer and admin sync read the status from Razorpay", async () => {
    const w = await workspace();
    const m = (await json(await autopayRoute.POST(req("/x", { method: "POST" }), w.P()))).body.mandate as { id: string };
    const a = await db.autopay.findUniqueOrThrow({ where: { id: m.id } });
    rz.fetched[a.gatewaySubId] = { status: "authenticated", paid_count: 0, payment_method: "card" };
    const s = await json(await syncRoute.POST(req("/x", { method: "POST" }), w.P()));
    expect(s.body.mandate).toMatchObject({ status: "authenticated", method: "card" });
    rz.fetched[a.gatewaySubId] = { status: "active", paid_count: 2 };
    actAs(await makeUser({ role: "SUPER_ADMIN", name: "Admin" }));
    const r = await json(await adminSync.POST(req("/x", { method: "POST" }), params({ id: a.id })));
    expect(r.body).toMatchObject({ providerStatus: "active", providerPaidCount: 2, recordedPaid: 0, mismatch: true });
  });
});

void addMonth;
