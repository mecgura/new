import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Background work isn't needed here, but messaging imports it.
vi.mock("@/lib/background", () => ({ runAfterResponse: vi.fn() }));

import { createHmac } from "node:crypto";
import { db } from "@/lib/db";
import { actAs, addMember, json, makeOrg, makeUser, params, req } from "../helpers";
import { resetRateLimits } from "@/lib/rate-limit";
import { prorate, addMonth, taxOn, runBillingCycle } from "@/services/billing/billing";
import { assertBillingActive, billingState, getEntitlements } from "@/services/billing/entitlements";
import { assertWithinLimit, incrementUsage } from "@/lib/services/usage";
import { registerGateway, unregisterGateway } from "@/providers/payments/registry";
import { GatewayError, type PaymentGateway } from "@/providers/payments/types";
import * as adminPlans from "@/app/api/admin/plans/route";
import * as adminPlan from "@/app/api/admin/plans/[id]/route";
import * as adminAssign from "@/app/api/admin/organizations/[id]/plan/route";
import * as adminOverview from "@/app/api/admin/billing/overview/route";
import * as adminSettings from "@/app/api/admin/billing/settings/route";
import * as adminCycle from "@/app/api/admin/billing/cycle/route";
import * as adminInvoices from "@/app/api/admin/invoices/route";
import * as adminMarkPaid from "@/app/api/admin/invoices/[id]/mark-paid/route";
import * as adminVoid from "@/app/api/admin/invoices/[id]/void/route";
import * as adminPayments from "@/app/api/admin/payments/route";
import * as adminAnalytics from "@/app/api/admin/analytics/route";
import * as billingRoute from "@/app/api/organizations/[orgId]/billing/route";
import * as previewRoute from "@/app/api/organizations/[orgId]/billing/preview/route";
import * as changeRoute from "@/app/api/organizations/[orgId]/billing/change/route";
import * as cancelRoute from "@/app/api/organizations/[orgId]/billing/cancel/route";
import * as resumeRoute from "@/app/api/organizations/[orgId]/billing/resume/route";
import * as usageRoute from "@/app/api/organizations/[orgId]/billing/usage/route";
import * as invoicesRoute from "@/app/api/organizations/[orgId]/billing/invoices/route";
import * as invoiceRoute from "@/app/api/organizations/[orgId]/billing/invoices/[iid]/route";
import * as payRoute from "@/app/api/organizations/[orgId]/billing/invoices/[iid]/pay/route";
import * as confirmRoute from "@/app/api/organizations/[orgId]/billing/payments/[pid]/confirm/route";
import * as analyticsRoute from "@/app/api/organizations/[orgId]/analytics/route";
import * as paymentWebhook from "@/app/api/webhooks/payments/[gateway]/route";
import * as demoConnect from "@/app/api/organizations/[orgId]/whatsapp/connect/demo/route";
import * as demoInbound from "@/app/api/organizations/[orgId]/inbox/demo/inbound/route";
import * as demoStatus from "@/app/api/organizations/[orgId]/inbox/demo/status/route";
import * as messagesRoute from "@/app/api/organizations/[orgId]/inbox/conversations/[cid]/messages/route";
import * as contactsRoute from "@/app/api/organizations/[orgId]/contacts/route";
import * as keysRoute from "@/app/api/organizations/[orgId]/api-keys/route";
import * as hooksRoute from "@/app/api/organizations/[orgId]/webhooks/route";
import * as campaignsRoute from "@/app/api/organizations/[orgId]/campaigns/route";
import * as automationsRoute from "@/app/api/organizations/[orgId]/automations/route";
import * as flowsRoute from "@/app/api/organizations/[orgId]/flows/route";
import * as agentsRoute from "@/app/api/organizations/[orgId]/ai/agents/route";
import * as v1Numbers from "@/app/api/v1/numbers/route";
import { emitWebhook, invalidateWebhookCache } from "@/services/webhooks/delivery";

type U = Awaited<ReturnType<typeof makeUser>>;
type Tenant = { orgId: string; owner: U; manager: U; agent: U; accountId: string };
let n = 0;
const phone = () => `+9194${String(Date.now()).slice(-6)}${String(n++).padStart(2, "0")}`;
const P = <E extends Record<string, string> = Record<never, string>>(orgId: string, extra?: E) => params({ orgId, ...(extra ?? ({} as E)) });
const post = (body?: unknown) => req("/x", { method: "POST", body });
const patch = (body: unknown) => req("/x", { method: "PATCH", body });
const get = (path = "/x") => req(path);
const put = (body: unknown) => req("/x", { method: "PUT", body });

let admin: U;

/** Plans are created exactly like the admin does — through the API — so nothing about them is baked into the tests. */
async function adminPlan_(over: Record<string, unknown> = {}) {
  actAs(admin);
  const c = await json(await adminPlans.POST(post({ name: `Plan ${n}`, slug: `plan-${n++}-${Date.now().toString(36)}`, priceMonthly: 1000, maxUsers: 10, maxWhatsAppNumbers: 5, maxMonthlyMessages: 1000, maxContacts: 1000, maxCampaigns: 10, maxAutomations: 10, maxAiReplies: 100, maxApiRequests: 1000, ...over }), params({})));
  expect(c.status).toBe(201);
  return c.body.plan as { id: string; name: string; slug: string; priceMonthly: number };
}
async function editPlan(id: string, body: Record<string, unknown>) {
  actAs(admin);
  const r = await json(await adminPlan.PATCH(patch(body), params({ id })));
  expect(r.status).toBe(200);
}

async function makeTenant(planId?: string, billingMode: "complimentary" | "invoiced" = "complimentary"): Promise<Tenant> {
  const org = await makeOrg(`Bill ${n++}`);
  const [owner, manager, agent] = await Promise.all([makeUser({ name: "Owner" }), makeUser({ name: "Manager" }), makeUser({ name: "Agent" })]);
  await addMember(org.id, owner.id, "CLIENT_OWNER");
  await addMember(org.id, manager.id, "MANAGER");
  await addMember(org.id, agent.id, "AGENT");
  await db.organizationService.create({ data: { organizationId: org.id, service: "WHATSAPP_AUTOMATION", enabled: true } });
  if (planId) {
    actAs(admin);
    expect((await adminAssign.PUT(put({ planId, billingMode }), params({ id: org.id }))).status).toBe(200);
  }
  actAs(owner);
  const d = await json(await demoConnect.POST(post({ businessName: "Bill Store" }), P(org.id)));
  return { orgId: org.id, owner, manager, agent, accountId: (d.body.account as { id: string }).id };
}

const activePlanOf = async (orgId: string) => (await db.subscription.findFirstOrThrow({ where: { organizationId: orgId, status: "active" }, include: { plan: true } })).plan;
const inbound = async (t: Tenant, body: string, from = phone()) => {
  const r = await json(await demoInbound.POST(post({ whatsappAccountId: t.accountId, phone: from, name: "Cust", body }), P(t.orgId)));
  expect(r.status).toBe(201);
  return { ...(r.body as { conversationId: string; contactId: string }), phone: from };
};

// A test payment provider that behaves like a real one: signed webhooks, signed client returns.
const SECRET = "test-gateway-secret";
const sign = (body: string) => createHmac("sha256", SECRET).update(body).digest("hex");
let orderSeq = 0;
const testGateway: PaymentGateway = {
  id: "testpay",
  label: "TestPay",
  isConfigured: async () => true,
  createCheckout: async (r) => ({ kind: "client_sdk", gateway: "testpay", reference: `order_${orderSeq++}`, publicKey: "pk_test", amount: r.amount, currency: r.currency, name: "MECGURA", description: r.description, prefill: r.customer, mode: "test" }),
  parseWebhook: async (raw, headers) => {
    if (headers.get("x-sig") !== sign(raw)) throw new GatewayError("Invalid signature.", 401);
    const b = JSON.parse(raw) as { id: string; type: "payment.succeeded" | "payment.failed"; reference: string; paymentId: string; amount: number | null; reason?: string };
    return [{ eventId: b.id, type: b.type, reference: b.reference, paymentId: b.paymentId, amount: b.amount, currency: "INR", failureCode: b.reason ? "declined" : undefined, failureReason: b.reason }];
  },
  verifyClientReturn: async (data, reference) => {
    if (data.sig !== sign(`${reference}|${data.pay}`)) throw new GatewayError("Payment verification failed.");
    return { eventId: `client:${data.pay}`, type: "payment.succeeded", reference, paymentId: data.pay, amount: null, currency: null };
  },
};
const hook = (body: Record<string, unknown>, sig?: string) => {
  const raw = JSON.stringify(body);
  return paymentWebhook.POST(new Request("http://localhost:3000/api/webhooks/payments/testpay", { method: "POST", body: raw, headers: { "x-sig": sig ?? sign(raw), host: "localhost:3000" } }), params({ gateway: "testpay" }));
};

beforeAll(async () => {
  admin = await makeUser({ role: "SUPER_ADMIN", name: "Platform Admin" });
});
beforeEach(() => resetRateLimits());
afterEach(() => {
  unregisterGateway("testpay");
  vi.unstubAllEnvs();
});

// ---------------------------------------------------------------------------------------------
describe("plans are data, not code", () => {
  it("the admin edits every limit and feature; a partial edit changes only what it sends", async () => {
    const p = await adminPlan_({ name: "Enterprise-ish", maxUsers: -1, maxMonthlyMessages: -1, features: ["campaigns", "api"], maxAiReplies: 50 });
    const row = await db.plan.findUniqueOrThrow({ where: { id: p.id } });
    expect(row).toMatchObject({ priceMonthly: 100_000, maxUsers: -1, maxMonthlyMessages: -1, maxCampaigns: 10, maxAutomations: 10, maxAiReplies: 50, maxApiRequests: 1000 });
    expect(JSON.parse(row.features)).toEqual(["campaigns", "api"]);
    await editPlan(p.id, { name: "Renamed" });
    expect(await db.plan.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({ name: "Renamed", maxUsers: -1, maxAiReplies: 50, maxCampaigns: 10, priceMonthly: 100_000 });
    await editPlan(p.id, { maxCampaigns: 3, features: ["analytics"], priceMonthly: 2500.5 });
    const after = await db.plan.findUniqueOrThrow({ where: { id: p.id } });
    expect(after).toMatchObject({ maxCampaigns: 3, priceMonthly: 250_050, maxAiReplies: 50 });
    expect(JSON.parse(after.features)).toEqual(["analytics"]);
    actAs(admin);
    expect((await json(await adminPlan.PATCH(patch({ maxCampaigns: -5 }), params({ id: p.id })))).status).toBe(400);
    expect((await json(await adminPlan.PATCH(patch({ features: ["telepathy"] }), params({ id: p.id })))).status).toBe(400);
    // Only the platform admin edits plans.
    const owner = await makeUser();
    actAs(owner);
    expect((await adminPlans.POST(post({}), params({}))).status).toBe(403);
    expect((await adminPlan.PATCH(patch({ name: "x" }), params({ id: p.id }))).status).toBe(403);
  });

  it("limits take effect the moment the admin changes them (seats, numbers, contacts)", async () => {
    const plan = await adminPlan_({ maxUsers: 3, maxWhatsAppNumbers: 1, maxContacts: 2 });
    const t = await makeTenant(plan.id);
    // Seats: the tenant already has 3 members.
    await expect(assertWithinLimit(t.orgId, "users")).rejects.toThrow(/allows 3 team seats/);
    await editPlan(plan.id, { maxUsers: 4 });
    await expect(assertWithinLimit(t.orgId, "users")).resolves.toBeUndefined();
    await editPlan(plan.id, { maxUsers: -1 });
    await expect(assertWithinLimit(t.orgId, "users")).resolves.toBeUndefined();
    // Numbers.
    actAs(t.owner);
    const second = await json(await demoConnect.POST(post({ businessName: "Two" }), P(t.orgId)));
    expect(second.status).toBe(409);
    expect(String(second.body.error)).toMatch(/allows 1 WhatsApp number/);
    await editPlan(plan.id, { maxWhatsAppNumbers: 2 });
    expect((await demoConnect.POST(post({ businessName: "Two" }), P(t.orgId))).status).toBe(201);
    // New contacts per month.
    for (let i = 0; i < 2; i++) expect((await contactsRoute.POST(post({ phone: phone() }), P(t.orgId))).status).toBe(201);
    const over = await json(await contactsRoute.POST(post({ phone: phone() }), P(t.orgId)));
    expect(over.status).toBe(409);
    expect(String(over.body.error)).toMatch(/new contacts per month/);
    await editPlan(plan.id, { maxContacts: -1 });
    expect((await contactsRoute.POST(post({ phone: phone() }), P(t.orgId))).status).toBe(201);
  });

  it("features gate campaigns, automations, flows, AI agent, API keys, API calls, webhooks and analytics", async () => {
    const plan = await adminPlan_({ features: [] });
    const t = await makeTenant(plan.id);
    actAs(t.owner);
    const waba = (await db.whatsAppAccount.findUniqueOrThrow({ where: { id: t.accountId } })).wabaRecordId!;
    const denied = async (r: Promise<Response>) => {
      const res = await json(await r);
      expect(res.status).toBe(403);
      expect(String(res.body.error)).toMatch(/isn't included in your .* plan/);
    };
    await denied(campaignsRoute.POST(post({ name: "C", description: "", whatsappAccountId: t.accountId }), P(t.orgId)));
    await denied(automationsRoute.POST(post({ name: "A", whatsappAccountId: t.accountId }), P(t.orgId)));
    await denied(flowsRoute.POST(post({ name: "F", wabaId: waba, template: "lead" }), P(t.orgId)));
    await denied(agentsRoute.POST(post({ name: "AI" }), P(t.orgId)));
    await denied(keysRoute.POST(post({ name: "k", permissions: ["numbers:read"] }), P(t.orgId)));
    await denied(hooksRoute.POST(post({ url: "https://hooks.example.com/x", events: ["message.received"] }), P(t.orgId)));
    await denied(analyticsRoute.GET(get(), P(t.orgId)));
    // Turning features on is immediate.
    await editPlan(plan.id, { features: ["campaigns", "analytics", "api"] });
    actAs(t.owner);
    expect((await campaignsRoute.POST(post({ name: "C", description: "", whatsappAccountId: t.accountId }), P(t.orgId))).status).toBe(201);
    expect((await analyticsRoute.GET(get(), P(t.orgId))).status).toBe(200);
    const key = await json(await keysRoute.POST(post({ name: "k", permissions: ["numbers:read"] }), P(t.orgId)));
    expect(key.status).toBe(201);
    // An existing key stops working when the plan loses the API feature.
    const bearer = (k: string) => (v1Numbers.GET as unknown as (r: Request) => Promise<Response>)(req("/api/v1/numbers", { headers: { authorization: `Bearer ${k}`, "x-forwarded-for": "198.51.100.9" } }));
    expect((await bearer(key.body.secret as string)).status).toBe(200);
    await editPlan(plan.id, { features: ["campaigns", "analytics"] });
    const off = await bearer(key.body.secret as string);
    expect(off.status).toBe(403);
    expect((await off.json()).error).toMatch(/API access isn't included/);
  });

  it("monthly allowances: API requests and the campaign count follow the plan", async () => {
    const plan = await adminPlan_({ maxApiRequests: 2, maxCampaigns: 1 });
    const t = await makeTenant(plan.id);
    actAs(t.owner);
    const key = (await json(await keysRoute.POST(post({ name: "k", permissions: ["numbers:read"] }), P(t.orgId)))).body.secret as string;
    const call = async () => (await (v1Numbers.GET as unknown as (r: Request) => Promise<Response>)(req("/api/v1/numbers", { headers: { authorization: `Bearer ${key}`, "x-forwarded-for": "198.51.100.10" } }))).status;
    expect(await call()).toBe(200);
    expect(await call()).toBe(200);
    expect(await call()).toBe(429); // allowance used up
    await editPlan(plan.id, { maxApiRequests: -1 });
    expect(await call()).toBe(200);
    expect(await db.usageCounter.aggregate({ where: { organizationId: t.orgId, metric: "api_calls" }, _sum: { value: true } }).then((r) => r._sum.value)).toBeGreaterThanOrEqual(3);
  });
});

// ---------------------------------------------------------------------------------------------
describe("money math", () => {
  it("prorates by whole days, adds months safely and rounds tax to the paisa", () => {
    const start = new Date("2026-10-01T00:00:00Z");
    const end = new Date("2026-10-31T00:00:00Z");
    expect(prorate(30_000, start, end, start)).toBe(30_000);
    expect(prorate(30_000, start, end, new Date("2026-10-16T00:00:00Z"))).toBe(15_000);
    expect(prorate(30_000, start, end, end)).toBe(0);
    expect(prorate(30_000, start, end, new Date("2027-01-01T00:00:00Z"))).toBe(0);
    expect(addMonth(new Date("2026-01-31T00:00:00Z")).toISOString().slice(0, 10)).toBe("2026-02-28");
    expect(addMonth(new Date("2026-12-15T00:00:00Z")).toISOString().slice(0, 10)).toBe("2027-01-15");
    expect(taxOn(100_000, 1800)).toBe(18_000);
    expect(taxOn(333, 1800)).toBe(60);
  });
});

// ---------------------------------------------------------------------------------------------
describe("billing: upgrade, payment, downgrade, cancel", () => {
  let starter: { id: string; name: string };
  let growth: { id: string; name: string };
  beforeAll(async () => {
    actAs(admin);
    expect((await adminSettings.PUT(put({ taxPercent: 18, dueDays: 7, graceDays: 7, companyName: "MECGURA Pvt", companyAddress: "Ludhiana", taxId: "GSTIN123", supportEmail: "billing@mecgura.test", footer: "Thank you", paymentInstructions: "HDFC A/c 0000 IFSC TEST" }), params({}))).status).toBe(200);
    starter = await adminPlan_({ name: "Starter T", priceMonthly: 1000, maxUsers: 3, maxWhatsAppNumbers: 1 });
    growth = await adminPlan_({ name: "Growth T", priceMonthly: 3000, maxUsers: 10, maxWhatsAppNumbers: 3 });
  });

  it("permissions: owners manage billing, managers read it, agents see nothing", async () => {
    const t = await makeTenant(starter.id);
    actAs(t.manager);
    expect((await billingRoute.GET(get(), P(t.orgId))).status).toBe(200);
    expect((await changeRoute.POST(post({ planId: growth.id }), P(t.orgId))).status).toBe(403);
    expect((await cancelRoute.POST(post(), P(t.orgId))).status).toBe(403);
    expect((await invoicesRoute.GET(get(), P(t.orgId))).status).toBe(200);
    actAs(t.agent);
    expect((await billingRoute.GET(get(), P(t.orgId))).status).toBe(403);
    expect((await usageRoute.GET(get(), P(t.orgId))).status).toBe(403);
    actAs(t.owner);
    const o = await json(await billingRoute.GET(get(), P(t.orgId)));
    expect(o.body).toMatchObject({ paymentStatus: "not_billed", state: "ok", onlinePaymentsConnected: false });
    expect((o.body.subscription as { plan: { name: string } }).plan.name).toBe("Starter T");
    const rels = Object.fromEntries((o.body.plans as { id: string; relation: string }[]).map((p) => [p.id, p.relation]));
    expect(rels[starter.id]).toBe("current");
    expect(rels[growth.id]).toBe("upgrade");
  });

  it("an upgrade creates a real invoice and the plan only changes once it is paid — payment is never faked", async () => {
    const t = await makeTenant(starter.id);
    actAs(t.owner);
    const pv = await json(await previewRoute.GET(get(`/x?planId=${growth.id}`), P(t.orgId)));
    expect(pv.body.preview).toMatchObject({ direction: "upgrade", amount: 3000 * 100 > 0 ? 300_000 : 0, effective: "on_payment" });
    const ch = await json(await changeRoute.POST(post({ planId: growth.id }), P(t.orgId)));
    expect(ch.status).toBe(200);
    expect(ch.body.result).toBe("invoice");
    const inv = ch.body.invoice as { id: string; number: string; total: number; subtotal: number; taxAmount: number; status: string };
    expect(inv).toMatchObject({ status: "open", subtotal: 300_000, taxAmount: 54_000, total: 354_000 });
    expect(inv.number).toMatch(/^INV-\d{4}-\d{6}$/);
    expect((await activePlanOf(t.orgId)).id).toBe(starter.id); // unchanged until paid
    // Asking again returns the same invoice.
    const again = await json(await changeRoute.POST(post({ planId: growth.id }), P(t.orgId)));
    expect((again.body.invoice as { id: string }).id).toBe(inv.id);
    // No gateway is connected → paying online is refused honestly; nothing becomes paid.
    const pay = await json(await payRoute.POST(post({ gateway: "razorpay" }), P(t.orgId, { iid: inv.id })));
    expect(pay.status).toBe(409);
    expect(String(pay.body.error)).toMatch(/Online payments aren't connected/);
    expect((await db.invoice.findUniqueOrThrow({ where: { id: inv.id } })).status).toBe("open");
    expect(await db.payment.count({ where: { invoiceId: inv.id } })).toBe(0);
    expect((await activePlanOf(t.orgId)).id).toBe(starter.id);
    // Issuer + bill-to are snapshotted on the invoice.
    const detail = await json(await invoiceRoute.GET(get(), P(t.orgId, { iid: inv.id })));
    expect((detail.body.invoice as { issuer: { name: string; taxId: string } }).issuer).toMatchObject({ name: "MECGURA Pvt", taxId: "GSTIN123" });

    // Only the platform admin can record money received; the client can't mark itself paid.
    expect((await adminMarkPaid.POST(post({ reference: "UTR123456" }), params({ id: inv.id }))).status).toBe(403);
    actAs(admin);
    expect((await json(await adminMarkPaid.POST(post({ reference: "x" }), params({ id: inv.id })))).status).toBe(400);
    const paid = await json(await adminMarkPaid.POST(post({ reference: "UTR123456" }), params({ id: inv.id })));
    expect(paid.status).toBe(200);
    expect(paid.body.invoice).toMatchObject({ status: "paid", paidVia: "manual", paymentNote: "UTR123456" });
    const sub = await db.subscription.findFirstOrThrow({ where: { organizationId: t.orgId, status: "active" } });
    expect(sub).toMatchObject({ planId: growth.id, billingMode: "invoiced" });
    expect(sub.currentPeriodEnd).not.toBeNull();
    expect((await db.subscription.findFirstOrThrow({ where: { organizationId: t.orgId, planId: starter.id } })).endReason).toBe("replaced");
    expect((await json(await adminMarkPaid.POST(post({ reference: "UTR123456" }), params({ id: inv.id })))).status).toBe(409); // never applied twice
    expect(await db.notification.count({ where: { organizationId: t.orgId, title: { contains: "Payment received" } } })).toBeGreaterThan(0);
  });

  it("online payments: signed webhooks pay invoices once; bad signatures, wrong amounts and failures never do", async () => {
    registerGateway(testGateway);
    const t = await makeTenant(starter.id);
    actAs(t.owner);
    const inv = (await json(await changeRoute.POST(post({ planId: growth.id }), P(t.orgId)))).body.invoice as { id: string; total: number };
    const o = await json(await billingRoute.GET(get(), P(t.orgId)));
    expect(o.body.onlinePaymentsConnected).toBe(true);
    const start = await json(await payRoute.POST(post({ gateway: "testpay" }), P(t.orgId, { iid: inv.id })));
    expect(start.status).toBe(201);
    const checkout = start.body.checkout as { reference: string; paymentId: string; amount: number };
    expect(checkout.amount).toBe(inv.total);
    expect(await db.payment.findUniqueOrThrow({ where: { id: checkout.paymentId } })).toMatchObject({ status: "created", gateway: "testpay", invoiceId: inv.id });

    // Unsigned / mis-signed webhooks change nothing.
    const evt = (id: string, over: Record<string, unknown> = {}) => ({ id, type: "payment.succeeded", reference: checkout.reference, paymentId: `pay_${id}`, amount: inv.total, ...over });
    expect((await hook(evt("e0"), "bad")).status).toBe(401);
    expect((await db.invoice.findUniqueOrThrow({ where: { id: inv.id } })).status).toBe("open");
    // A failure leaves the invoice open and tells the owner.
    const failed = await json(await hook(evt("e1", { type: "payment.failed", reason: "Card declined" })));
    expect(failed.body).toMatchObject({ received: 1, results: [{ outcome: "failed" }] });
    expect(await db.payment.findUniqueOrThrow({ where: { id: checkout.paymentId } })).toMatchObject({ status: "failed", failureReason: "Card declined" });
    expect((await db.invoice.findUniqueOrThrow({ where: { id: inv.id } })).status).toBe("open");
    expect(await db.notification.count({ where: { organizationId: t.orgId, title: { contains: "Payment failed" } } })).toBe(1);
    const ov = await json(await billingRoute.GET(get(), P(t.orgId)));
    expect(ov.body.paymentStatus).toBe("failed");
    // Wrong amount is rejected even with a valid signature.
    const start2 = (await json(await payRoute.POST(post({ gateway: "testpay" }), P(t.orgId, { iid: inv.id })))).body.checkout as { reference: string };
    const mismatch = await json(await hook({ id: "e2", type: "payment.succeeded", reference: start2.reference, paymentId: "pay_e2", amount: 1 }));
    expect(mismatch.body).toMatchObject({ results: [{ outcome: "amount_mismatch" }] });
    expect((await db.invoice.findUniqueOrThrow({ where: { id: inv.id } })).status).toBe("open");
    // Unknown references are ignored.
    expect((await json(await hook({ id: "e3", type: "payment.succeeded", reference: "order_nope", paymentId: "p", amount: inv.total }))).body).toMatchObject({ results: [{ outcome: "unknown_reference" }] });
    // The real confirmation pays it, upgrades the plan, and a replay does nothing.
    const good = await json(await hook({ id: "e4", type: "payment.succeeded", reference: start2.reference, paymentId: "pay_e4", amount: inv.total }));
    expect(good.body).toMatchObject({ results: [{ outcome: "paid" }] });
    expect((await db.invoice.findUniqueOrThrow({ where: { id: inv.id } })).status).toBe("paid");
    expect((await activePlanOf(t.orgId)).id).toBe(growth.id);
    const replay = await json(await hook({ id: "e4", type: "payment.succeeded", reference: start2.reference, paymentId: "pay_e4", amount: inv.total }));
    expect(replay.body).toMatchObject({ results: [{ outcome: "duplicate" }] });
    expect(await db.subscription.count({ where: { organizationId: t.orgId, planId: growth.id } })).toBe(1);
    expect(await db.paymentEvent.count({ where: { gateway: "testpay", eventId: "e4" } })).toBe(1);
    expect((await json(await payRoute.POST(post({ gateway: "testpay" }), P(t.orgId, { iid: inv.id })))).status).toBe(409); // already paid
  });

  it("the browser's return is only believed after its signature is verified server-side", async () => {
    registerGateway(testGateway);
    const t = await makeTenant(starter.id);
    actAs(t.owner);
    const inv = (await json(await changeRoute.POST(post({ planId: growth.id }), P(t.orgId)))).body.invoice as { id: string };
    const co = (await json(await payRoute.POST(post({ gateway: "testpay" }), P(t.orgId, { iid: inv.id })))).body.checkout as { reference: string; paymentId: string };
    const forged = await json(await confirmRoute.POST(post({ data: { pay: "pay_x", sig: "forged" } }), P(t.orgId, { pid: co.paymentId })));
    expect(forged.status).toBe(400);
    expect((await db.invoice.findUniqueOrThrow({ where: { id: inv.id } })).status).toBe("open");
    const ok = await json(await confirmRoute.POST(post({ data: { pay: "pay_ok", sig: sign(`${co.reference}|pay_ok`) } }), P(t.orgId, { pid: co.paymentId })));
    expect(ok.status).toBe(200);
    expect(ok.body.invoice).toMatchObject({ status: "paid", paidVia: "testpay" });
    expect((await activePlanOf(t.orgId)).id).toBe(growth.id);
  });

  it("downgrades are checked against usage, scheduled for the period end, and can be undone", async () => {
    const t = await makeTenant(growth.id, "invoiced");
    const first = await db.invoice.findFirstOrThrow({ where: { organizationId: t.orgId } });
    actAs(admin);
    await adminMarkPaid.POST(post({ reference: "REF-ONE" }), params({ id: first.id }));
    actAs(t.owner);
    // Connect a second and third number, then try to drop to a 1-number plan.
    await demoConnect.POST(post({ businessName: "Two" }), P(t.orgId));
    const blocked = await json(await changeRoute.POST(post({ planId: starter.id }), P(t.orgId)));
    expect(blocked.status).toBe(409);
    expect(String(blocked.body.error)).toMatch(/2 WhatsApp numbers; Starter T allows 1/);
    const extra = await db.whatsAppAccount.findFirstOrThrow({ where: { organizationId: t.orgId, id: { not: t.accountId } } });
    await db.whatsAppAccount.update({ where: { id: extra.id }, data: { status: "disconnected" } });
    const ok = await json(await changeRoute.POST(post({ planId: starter.id }), P(t.orgId)));
    expect(ok.body.result).toBe("scheduled");
    expect((await activePlanOf(t.orgId)).id).toBe(growth.id); // still on Growth until the period ends
    const o = await json(await billingRoute.GET(get(), P(t.orgId)));
    expect((o.body.subscription as { pendingPlan: { name: string } }).pendingPlan.name).toBe("Starter T");
    expect((await json(await resumeRoute.POST(post(), P(t.orgId)))).status).toBe(200);
    expect((await db.subscription.findFirstOrThrow({ where: { organizationId: t.orgId, status: "active" } })).pendingPlanId).toBeNull();
    expect((await json(await resumeRoute.POST(post(), P(t.orgId)))).status).toBe(409);
    // Schedule again and let the period end: the plan changes and next month's invoice is for the lower price.
    await changeRoute.POST(post({ planId: starter.id }), P(t.orgId));
    const sub = await db.subscription.findFirstOrThrow({ where: { organizationId: t.orgId, status: "active" } });
    await db.subscription.update({ where: { id: sub.id }, data: { currentPeriodEnd: new Date(Date.now() - 1000) } });
    const cycle = await runBillingCycle();
    expect(cycle.downgraded).toBeGreaterThanOrEqual(1);
    expect((await activePlanOf(t.orgId)).id).toBe(starter.id);
    const renewal = await db.invoice.findFirstOrThrow({ where: { organizationId: t.orgId, kind: "renewal" } });
    expect(renewal).toMatchObject({ subtotal: 100_000, status: "open" });
  });

  it("cancel keeps access until the period ends, then sending stops until a plan is chosen and paid", async () => {
    const t = await makeTenant(growth.id, "invoiced");
    actAs(admin);
    const first = await db.invoice.findFirstOrThrow({ where: { organizationId: t.orgId } });
    await adminMarkPaid.POST(post({ reference: "REF-C" }), params({ id: first.id }));
    actAs(t.owner);
    const c = await json(await cancelRoute.POST(post(), P(t.orgId)));
    expect(c.body.result).toBe("scheduled");
    expect((await cancelRoute.POST(post(), P(t.orgId))).status).toBe(409);
    await expect(assertBillingActive(t.orgId)).resolves.toBeUndefined(); // still active
    expect((await json(await billingRoute.GET(get(), P(t.orgId)))).body.subscription).toMatchObject({ cancelAtPeriodEnd: true });
    // Changed their mind → resume, then cancel again.
    expect((await resumeRoute.POST(post(), P(t.orgId))).status).toBe(200);
    await cancelRoute.POST(post(), P(t.orgId));
    const sub = await db.subscription.findFirstOrThrow({ where: { organizationId: t.orgId, status: "active" } });
    await db.subscription.update({ where: { id: sub.id }, data: { currentPeriodEnd: new Date(Date.now() - 1000) } });
    expect((await runBillingCycle()).canceled).toBeGreaterThanOrEqual(1);
    expect(await billingState(t.orgId)).toMatchObject({ state: "blocked" });
    // Sending is refused with a clear reason; receiving still works.
    const cust = await inbound(t, "hello");
    actAs(t.owner);
    const send = await json(await messagesRoute.POST(post({ type: "text", body: "hi" }), P(t.orgId, { cid: cust.conversationId })));
    expect(send.status).toBe(409);
    expect(String(send.body.error)).toMatch(/cancelled/);
    // Subscribing again: invoice → paid → unblocked.
    const sel = await json(await changeRoute.POST(post({ planId: starter.id }), P(t.orgId)));
    expect(sel.body.result).toBe("invoice");
    actAs(admin);
    await adminMarkPaid.POST(post({ reference: "REF-D" }), params({ id: (sel.body.invoice as { id: string }).id }));
    expect(await billingState(t.orgId)).toMatchObject({ state: "ok" });
    actAs(t.owner);
    expect((await messagesRoute.POST(post({ type: "text", body: "welcome back" }), P(t.orgId, { cid: cust.conversationId }))).status).toBe(201);
  });

  it("complimentary (contracted) clients are never invoiced automatically; legacy rows start counting from now", async () => {
    const t = await makeTenant(starter.id); // complimentary
    const sub = await db.subscription.findFirstOrThrow({ where: { organizationId: t.orgId, status: "active" } });
    expect(sub).toMatchObject({ billingMode: "complimentary", currentPeriodEnd: null });
    await db.subscription.update({ where: { id: sub.id }, data: { currentPeriodStart: new Date(Date.now() - 90 * 86_400_000) } });
    await runBillingCycle();
    expect(await db.invoice.count({ where: { organizationId: t.orgId } })).toBe(0);
    // A legacy invoiced row without a period is initialised, not back-billed.
    const legacy = await makeTenant();
    const lp = await db.plan.findUniqueOrThrow({ where: { id: growth.id } });
    const row = await db.subscription.create({ data: { organizationId: legacy.orgId, planId: lp.id, priceMonthly: lp.priceMonthly, billingMode: "invoiced", startedAt: new Date(Date.now() - 200 * 86_400_000) } });
    const r = await runBillingCycle();
    expect(r.initialized).toBeGreaterThanOrEqual(1);
    expect(await db.invoice.count({ where: { organizationId: legacy.orgId } })).toBe(0);
    expect((await db.subscription.findUniqueOrThrow({ where: { id: row.id } })).currentPeriodEnd!.getTime()).toBeGreaterThan(Date.now());
  });

  it("renewals are invoiced once per period; overdue invoices warn, then block sending after the grace period", async () => {
    const t = await makeTenant(growth.id, "invoiced");
    actAs(admin);
    const first = await db.invoice.findFirstOrThrow({ where: { organizationId: t.orgId } });
    await adminMarkPaid.POST(post({ reference: "REF-R" }), params({ id: first.id }));
    const sub = await db.subscription.findFirstOrThrow({ where: { organizationId: t.orgId, status: "active" } });
    const periodEnd = new Date(Date.now() - 10 * 86_400_000);
    await db.subscription.update({ where: { id: sub.id }, data: { currentPeriodStart: new Date(periodEnd.getTime() - 30 * 86_400_000), currentPeriodEnd: periodEnd } });
    await runBillingCycle();
    await runBillingCycle(); // idempotent
    const renewals = await db.invoice.findMany({ where: { organizationId: t.orgId, kind: "renewal" } });
    expect(renewals).toHaveLength(1);
    expect(renewals[0]).toMatchObject({ subtotal: 300_000, total: 354_000, status: "open" });
    expect((await db.subscription.findUniqueOrThrow({ where: { id: sub.id } })).currentPeriodEnd!.getTime()).toBeGreaterThan(Date.now());
    // Due 7 days after the old period end → 3 days overdue now: warned, still sending.
    expect(renewals[0].dueAt.getTime()).toBeLessThan(Date.now());
    expect(await billingState(t.orgId)).toMatchObject({ state: "past_due" });
    expect(await db.notification.count({ where: { organizationId: t.orgId, title: { contains: "is overdue" } } })).toBe(1);
    await runBillingCycle();
    expect(await db.notification.count({ where: { organizationId: t.orgId, title: { contains: "is overdue" } } })).toBe(1); // only once
    actAs(t.owner);
    expect((await json(await billingRoute.GET(get(), P(t.orgId)))).body.paymentStatus).toBe("past_due");
    // Beyond the grace period sending is blocked; paying restores it.
    await db.invoice.update({ where: { id: renewals[0].id }, data: { dueAt: new Date(Date.now() - 20 * 86_400_000) } });
    expect(await billingState(t.orgId)).toMatchObject({ state: "blocked" });
    await expect(assertBillingActive(t.orgId)).rejects.toThrow(/overdue/);
    actAs(admin);
    await adminMarkPaid.POST(post({ reference: "REF-LATE" }), params({ id: renewals[0].id }));
    expect(await billingState(t.orgId)).toMatchObject({ state: "ok" });
  });

  it("admin can void an open invoice; voided invoices can't be paid", async () => {
    const t = await makeTenant(starter.id);
    actAs(t.owner);
    const inv = (await json(await changeRoute.POST(post({ planId: growth.id }), P(t.orgId)))).body.invoice as { id: string };
    actAs(admin);
    expect((await adminVoid.POST(post(), params({ id: inv.id }))).status).toBe(200);
    expect((await json(await adminMarkPaid.POST(post({ reference: "UTR9999" }), params({ id: inv.id })))).status).toBe(409);
    expect((await json(await adminVoid.POST(post(), params({ id: inv.id })))).status).toBe(409);
    expect((await activePlanOf(t.orgId)).id).toBe(starter.id);
  });

  it("tenant isolation: invoices and payments of one workspace are invisible and untouchable from another", async () => {
    registerGateway(testGateway);
    const a = await makeTenant(starter.id);
    const b = await makeTenant(starter.id);
    actAs(a.owner);
    const inv = (await json(await changeRoute.POST(post({ planId: growth.id }), P(a.orgId)))).body.invoice as { id: string };
    const co = (await json(await payRoute.POST(post({ gateway: "testpay" }), P(a.orgId, { iid: inv.id })))).body.checkout as { paymentId: string; reference: string };
    actAs(b.owner);
    expect((await json(await invoiceRoute.GET(get(), P(b.orgId, { iid: inv.id })))).status).toBe(404);
    expect((await invoiceRoute.GET(get(), P(a.orgId, { iid: inv.id }))).status).toBe(403);
    expect((await invoicesRoute.GET(get(), P(a.orgId))).status).toBe(403);
    expect((await json(await payRoute.POST(post({ gateway: "testpay" }), P(b.orgId, { iid: inv.id })))).status).toBe(404);
    expect((await json(await confirmRoute.POST(post({ data: { pay: "p", sig: sign(`${co.reference}|p`) } }), P(b.orgId, { pid: co.paymentId })))).status).toBe(404);
    expect((await changeRoute.POST(post({ planId: growth.id }), P(a.orgId))).status).toBe(403);
    expect((await billingRoute.GET(get(), P(a.orgId))).status).toBe(403);
    const mine = await json(await invoicesRoute.GET(get(), P(b.orgId)));
    expect(JSON.stringify(mine.body)).not.toContain(inv.id);
    expect((await db.invoice.findUniqueOrThrow({ where: { id: inv.id } })).status).toBe("open");
  });

  it("admin billing: revenue counts only collected money; failed payments, receivables and plans are reported", async () => {
    registerGateway(testGateway);
    actAs(admin);
    const before = (await json(await adminOverview.GET(get(), params({})))).body as { revenue: { thisMonth: number }; failedPayments: { count30d: number }; receivables: { openCount: number } };
    const t = await makeTenant(starter.id);
    actAs(t.owner);
    const inv = (await json(await changeRoute.POST(post({ planId: growth.id }), P(t.orgId)))).body.invoice as { id: string; total: number };
    const co = (await json(await payRoute.POST(post({ gateway: "testpay" }), P(t.orgId, { iid: inv.id })))).body.checkout as { reference: string };
    await hook({ id: `f-${n++}`, type: "payment.failed", reference: co.reference, paymentId: "pf", amount: inv.total, reason: "Insufficient funds" });
    actAs(admin);
    const mid = (await json(await adminOverview.GET(get(), params({})))).body as typeof before;
    expect(mid.revenue.thisMonth).toBe(before.revenue.thisMonth); // promised ≠ collected
    expect(mid.failedPayments.count30d).toBe(before.failedPayments.count30d + 1);
    expect(mid.receivables.openCount).toBe(before.receivables.openCount + 1);
    await adminMarkPaid.POST(post({ reference: "BANK-777" }), params({ id: inv.id }));
    const after = (await json(await adminOverview.GET(get(), params({})))).body as typeof before & { mrr: { contracted: number }; subscriptions: { active: number; invoiced: number }; activePlans: { name: string; subscriptions: number }[]; gateways: { connected: { id: string }[] } };
    expect(after.revenue.thisMonth).toBe(before.revenue.thisMonth + inv.total);
    expect(after.mrr.contracted).toBeGreaterThan(0);
    expect(after.subscriptions.active).toBeGreaterThan(0);
    expect(after.activePlans.find((p) => p.name === "Growth T")!.subscriptions).toBeGreaterThan(0);
    expect(after.gateways.connected.map((g) => g.id)).toContain("testpay");
    const list = await json(await adminInvoices.GET(get("/x?status=paid&q=" + encodeURIComponent("Bill")), params({})));
    expect((list.body.invoices as { id: string }[]).map((i) => i.id)).toContain(inv.id);
    const pays = await json(await adminPayments.GET(get("/x?status=failed"), params({})));
    expect((pays.body.payments as { reason: string }[]).some((p) => p.reason === "Insufficient funds")).toBe(true);
    // Admin-only.
    actAs(t.owner);
    for (const h of [adminOverview.GET, adminInvoices.GET, adminPayments.GET, adminAnalytics.GET, adminSettings.GET]) expect((await (h as unknown as (r: Request) => Promise<Response>)(get())).status).toBe(403);
    expect((await adminCycle.POST(post(), params({}))).status).toBe(403);
  });
});

// ---------------------------------------------------------------------------------------------
describe("usage tracking", () => {
  it("reports messages, contacts, campaigns, automation runs, AI, API requests, numbers and members against the plan", async () => {
    const plan = await adminPlan_({ maxUsers: 5, maxWhatsAppNumbers: 2, maxMonthlyMessages: 100, maxContacts: 50, maxCampaigns: 4, maxAutomations: 3, maxAiReplies: 20, maxApiRequests: 500 });
    const t = await makeTenant(plan.id);
    actAs(t.owner);
    await inbound(t, "hello");
    await incrementUsage(t.orgId, "messages_sent", 7);
    await incrementUsage(t.orgId, "ai_replies", 2);
    await incrementUsage(t.orgId, "api_calls", 11);
    await incrementUsage(t.orgId, "campaigns_launched", 1);
    const r = await json(await usageRoute.GET(get("/x?days=14"), P(t.orgId)));
    expect(r.status).toBe(200);
    const line = (k: string) => (r.body.lines as { key: string; used: number; limit: number | null }[]).find((l) => l.key === k)!;
    expect(line("messages")).toMatchObject({ used: 7, limit: 100 });
    expect(line("contacts")).toMatchObject({ used: 1, limit: 50 });
    expect(line("campaigns")).toMatchObject({ used: 1, limit: 4 });
    expect(line("ai_replies")).toMatchObject({ used: 2, limit: 20 });
    expect(line("api_requests")).toMatchObject({ used: 11, limit: 500 });
    expect(line("numbers")).toMatchObject({ used: 1, limit: 2 });
    expect(line("members")).toMatchObject({ used: 3, limit: 5 });
    expect(line("messages_received").used).toBe(0); // demo traffic isn't billable usage
    expect(line("automation_runs")).toBeDefined();
    expect(line("automations")).toMatchObject({ limit: 3 });
    expect((r.body.history as { metrics: Record<string, number[]> }).metrics.messages_sent.at(-1)).toBe(7);
    expect((r.body.plan as { id: string }).id).toBe(plan.id);
  });

  it("a workspace without a plan is unrestricted and shows no limits", async () => {
    const t = await makeTenant();
    const e = await getEntitlements(t.orgId);
    expect(e).toMatchObject({ hasPlan: false, limits: null, features: null, state: "none" });
    actAs(t.owner);
    const r = await json(await usageRoute.GET(get(), P(t.orgId)));
    expect((r.body.lines as { limit: number | null }[]).every((l) => l.limit === null)).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
describe("analytics", () => {
  let t: Tenant;
  let other: Tenant;
  beforeAll(async () => {
    const plan = await adminPlan_({});
    t = await makeTenant(plan.id);
    other = await makeTenant(plan.id);
    actAs(t.owner);
    // Customer A: asked, owner replied within a minute; delivered and read.
    const a = await inbound(t, "price?");
    const sent = await json(await messagesRoute.POST(post({ type: "text", body: "₹499" }), P(t.orgId, { cid: a.conversationId })));
    const mid = (sent.body.message as { id: string }).id;
    await demoStatus.POST(post({ messageId: mid, status: "delivered" }), P(t.orgId));
    await demoStatus.POST(post({ messageId: mid, status: "read" }), P(t.orgId));
    // Customer B: never answered. Customer C: answered, message failed.
    await inbound(t, "anyone there?");
    const c = await inbound(t, "hello");
    const s2 = await json(await messagesRoute.POST(post({ type: "text", body: "hi" }), P(t.orgId, { cid: c.conversationId })));
    await demoStatus.POST(post({ messageId: (s2.body.message as { id: string }).id, status: "failed" }), P(t.orgId));
    // Make timing deterministic: A's first reply took 60 s, C's took 10 minutes.
    const stamp = async (convId: string, inboundAt: number, replyAt: number) => {
      await db.message.updateMany({ where: { conversationId: convId, direction: "inbound" }, data: { createdAt: new Date(inboundAt) } });
      await db.message.updateMany({ where: { conversationId: convId, direction: "outbound" }, data: { createdAt: new Date(replyAt) } });
    };
    const now = Date.now() - 3_600_000;
    await stamp(a.conversationId, now, now + 60_000);
    await stamp(c.conversationId, now, now + 600_000);
    await db.contact.update({ where: { id: a.contactId }, data: { leadStatus: "won" } });
    // Another workspace's traffic must never show up here.
    actAs(other.owner);
    await inbound(other, "other tenant message");
  });

  it("messages, delivery/read, response rate, response time, leads and conversations are computed from real data", async () => {
    actAs(t.owner);
    const r = await json(await analyticsRoute.GET(get("/x?days=7"), P(t.orgId)));
    expect(r.status).toBe(200);
    const b = r.body as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- shape asserted field by field below
    expect(b.messages).toMatchObject({ inbound: 3, outbound: 2 });
    expect(b.messages.daily).toHaveLength(7);
    expect(b.delivery).toMatchObject({ read: 1, failed: 1, accepted: 1, deliveryRate: 100, readRate: 100, failureRate: 50 });
    expect(b.conversations).toMatchObject({ started: 3, openNow: 3, unassignedOpen: 3 });
    expect(b.response).toMatchObject({ conversationsWithCustomerMessage: 3, answered: 2, within5MinRate: 50 });
    expect(b.response.responseRate).toBeCloseTo(66.7, 1);
    expect(b.response.medianFirstResponseSec).toBe(330);
    expect(b.leads).toMatchObject({ created: 3, converted: 1, newContacts: 3 });
    expect(b.leads.pipeline.find((s: { stage: string }) => s.stage === "won").count).toBe(1);
    const owner = b.agents.team.find((a: { name: string }) => a.name === "Owner");
    expect(owner).toMatchObject({ replies: 2, answeredThreads: 2, within5MinRate: 50 });
    expect(JSON.stringify(b)).not.toContain("other tenant");
    // Another workspace sees only its own numbers.
    actAs(other.owner);
    const o = await json(await analyticsRoute.GET(get("/x?days=7"), P(other.orgId)));
    expect((o.body as { messages: { inbound: number } }).messages.inbound).toBe(1);
  });

  it("filters by number, refuses foreign numbers, and is limited to owners and managers", async () => {
    actAs(t.owner);
    const empty = await json(await analyticsRoute.GET(get(`/x?days=7&numberId=${t.accountId}`), P(t.orgId)));
    expect((empty.body as { messages: { inbound: number } }).messages.inbound).toBe(3);
    expect((await json(await analyticsRoute.GET(get(`/x?numberId=${other.accountId}`), P(t.orgId)))).status).toBe(404);
    expect((await analyticsRoute.GET(get("/x?days=500"), P(t.orgId))).status).toBe(400);
    actAs(t.manager);
    expect((await analyticsRoute.GET(get(), P(t.orgId))).status).toBe(200);
    actAs(t.agent);
    expect((await analyticsRoute.GET(get(), P(t.orgId))).status).toBe(403);
    actAs(other.owner);
    expect((await analyticsRoute.GET(get(), P(t.orgId))).status).toBe(403);
  });

  it("admin analytics reports client growth, revenue, usage and system health", async () => {
    actAs(admin);
    const r = await json(await adminAnalytics.GET(get("/x?days=14"), params({})));
    expect(r.status).toBe(200);
    const b = r.body as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- shape asserted below
    expect(b.clients.total).toBeGreaterThan(2);
    expect(b.clients.growth).toHaveLength(12);
    expect(b.clients.growth.at(-1).totalClients).toBe(b.clients.total);
    expect(b.clients.onboarding.connectedNumber).toBeGreaterThan(0);
    expect(b.revenue.byMonth).toHaveLength(12);
    expect(b.usage.series.messages_sent).toHaveLength(14);
    expect(b.system.platform.messages).toBeGreaterThan(0);
    expect(b.system.webhooks).toHaveProperty("successRate");
    expect(b.system.api).toHaveProperty("requests");
  });
});

// Keeps imports honest: emitWebhook/invalidateWebhookCache belong to the webhook feature gate checked above.
it("webhook events are not queued for workspaces whose plan lacks webhooks", async () => {
  const plan = await adminPlan_({ features: ["analytics"] });
  const t = await makeTenant(plan.id);
  await db.webhookEndpoint.create({ data: { organizationId: t.orgId, url: "https://hooks.example.com/x", events: JSON.stringify(["message.received"]), secretEnc: "x" } });
  invalidateWebhookCache();
  await emitWebhook(t.orgId, "message.received", { x: 1 });
  expect(await db.webhookDelivery.count({ where: { organizationId: t.orgId } })).toBe(0);
});
