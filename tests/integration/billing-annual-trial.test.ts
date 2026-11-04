import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/background", () => ({ runAfterResponse: vi.fn() }));

import { db } from "@/lib/db";
import { actAs, addMember, json, makeOrg, makeUser, params, req } from "../helpers";
import { resetRateLimits } from "@/lib/rate-limit";
import { addMonth, runBillingCycle, sendPaymentReminders } from "@/services/billing/billing";
import * as adminPlans from "@/app/api/admin/plans/route";
import * as billingRoute from "@/app/api/organizations/[orgId]/billing/route";
import * as previewRoute from "@/app/api/organizations/[orgId]/billing/preview/route";
import * as changeRoute from "@/app/api/organizations/[orgId]/billing/change/route";
import * as cancelRoute from "@/app/api/organizations/[orgId]/billing/cancel/route";

const DAY = 86_400_000;
let n = 0;
const post = (b: unknown) => req("/x", { method: "POST", body: b });

async function plan(o: { priceMonthly: number; priceYearly?: number; trialDays?: number }) {
  return db.plan.create({ data: { name: `P${n}`, slug: `p-annual-${Date.now().toString(36)}-${n++}`, priceMonthly: o.priceMonthly, priceYearly: o.priceYearly ?? 0, trialDays: o.trialDays ?? 0, maxUsers: 10, maxWhatsAppNumbers: 5 } });
}
async function workspace() {
  const org = await makeOrg(`Annual ${n++}`);
  const owner = await makeUser({ name: "Owner" });
  await addMember(org.id, owner.id, "CLIENT_OWNER");
  actAs(owner);
  return { orgId: org.id, owner, P: () => params({ orgId: org.id }) };
}
const activeSub = (orgId: string) => db.subscription.findFirstOrThrow({ where: { organizationId: orgId, status: "active" } });

beforeEach(() => resetRateLimits());

describe("plans with yearly price and trial", () => {
  it("admin sets a yearly price and trial days (rupees in, paise stored)", async () => {
    actAs(await makeUser({ role: "SUPER_ADMIN", name: "Admin" }));
    const r = await json(await adminPlans.POST(post({ name: "Growth Y", slug: `growth-y-${Date.now()}`, priceMonthly: 1999, priceYearly: 19990, trialDays: 14, maxUsers: 5, maxWhatsAppNumbers: 1, maxMonthlyMessages: 1000, maxContacts: 1000 })));
    expect(r.status).toBe(201);
    expect(r.body.plan).toMatchObject({ priceMonthly: 199_900, priceYearly: 1_999_000, trialDays: 14 });
  });
});

describe("yearly billing", () => {
  it("first yearly plan: one invoice for the year; paying starts a 12-month period with monthly-equivalent MRR", async () => {
    const w = await workspace();
    const p = await plan({ priceMonthly: 100_000, priceYearly: 1_000_000 });
    const pv = await json(await previewRoute.GET(req(`/x?planId=${p.id}&interval=year`), w.P()));
    expect(pv.body.preview).toMatchObject({ direction: "new", interval: "year", amount: 1_000_000 });
    const c = await json(await changeRoute.POST(post({ planId: p.id, interval: "year" }), w.P()));
    expect(c.body.result).toBe("invoice");
    const inv = await db.invoice.findFirstOrThrow({ where: { organizationId: w.orgId, status: "open" } });
    expect(inv).toMatchObject({ subtotal: 1_000_000, targetInterval: "year" });
    // Admin records the money (same path as a gateway confirmation).
    const { recordManualPayment } = await import("@/services/billing/billing");
    await recordManualPayment((await makeUser({ role: "SUPER_ADMIN" })).id, inv.id, { reference: "UTR123" });
    const sub = await activeSub(w.orgId);
    expect(sub).toMatchObject({ interval: "year", periodPrice: 1_000_000, priceMonthly: 83_333, billingMode: "invoiced" });
    expect(sub.currentPeriodEnd!.getTime()).toBe(addMonth(sub.currentPeriodStart!, 12).getTime());

    // Renewal a year later bills the yearly price again.
    await db.subscription.update({ where: { id: sub.id }, data: { currentPeriodEnd: new Date(Date.now() - 1000) } });
    await runBillingCycle();
    const renewal = await db.invoice.findFirstOrThrow({ where: { organizationId: w.orgId, kind: "renewal" } });
    expect(renewal.subtotal).toBe(1_000_000);
  });

  it("yearly → monthly waits for the end of the paid year; plans without a yearly price refuse it", async () => {
    const w = await workspace();
    const p = await plan({ priceMonthly: 100_000, priceYearly: 1_000_000 });
    const monthOnly = await plan({ priceMonthly: 50_000 });
    expect((await previewRoute.GET(req(`/x?planId=${monthOnly.id}&interval=year`), w.P())).status).toBe(400);
    const start = new Date();
    await db.subscription.create({ data: { organizationId: w.orgId, planId: p.id, priceMonthly: 83_333, interval: "year", periodPrice: 1_000_000, billingMode: "invoiced", currentPeriodStart: start, currentPeriodEnd: addMonth(start, 12) } });
    const pv = await json(await previewRoute.GET(req(`/x?planId=${p.id}&interval=month`), w.P()));
    expect(pv.body.preview).toMatchObject({ direction: "downgrade", effective: "period_end" });
    const c = await json(await changeRoute.POST(post({ planId: p.id, interval: "month" }), w.P()));
    expect(c.body.result).toBe("scheduled");
    expect(await activeSub(w.orgId)).toMatchObject({ pendingPlanId: p.id, pendingInterval: "month" });
  });

  it("monthly → yearly charges the year less the unused part of this month", async () => {
    const w = await workspace();
    const p = await plan({ priceMonthly: 100_000, priceYearly: 1_000_000 });
    const start = new Date(Date.now() - 15 * DAY);
    await db.subscription.create({ data: { organizationId: w.orgId, planId: p.id, priceMonthly: 100_000, interval: "month", periodPrice: 100_000, billingMode: "invoiced", currentPeriodStart: start, currentPeriodEnd: addMonth(start) } });
    const pv = await json(await previewRoute.GET(req(`/x?planId=${p.id}&interval=year`), w.P()));
    const preview = pv.body.preview as { direction: string; amount: number };
    expect(preview.direction).toBe("upgrade");
    expect(preview.amount).toBeGreaterThan(940_000);
    expect(preview.amount).toBeLessThan(960_000);
  });
});

describe("free trial", () => {
  it("starts without an invoice, reminds 3 days before, converts into the first paid period (once per workspace)", async () => {
    const w = await workspace();
    const p = await plan({ priceMonthly: 150_000, priceYearly: 1_500_000, trialDays: 14 });
    const ov = await json(await billingRoute.GET(req("/x"), w.P()));
    expect(ov.body.trialAvailable).toBe(true);
    const pv = await json(await previewRoute.GET(req(`/x?planId=${p.id}`), w.P()));
    expect(pv.body.preview).toMatchObject({ direction: "trial", amount: 0, firstCharge: 150_000 });
    const c = await json(await changeRoute.POST(post({ planId: p.id }), w.P()));
    expect(c.body.result).toBe("trial");
    let sub = await activeSub(w.orgId);
    expect(sub).toMatchObject({ billingMode: "trial", priceMonthly: 0, periodPrice: 150_000 });
    expect(await db.invoice.count({ where: { organizationId: w.orgId } })).toBe(0);

    // 2 days left → one reminder.
    await db.subscription.update({ where: { id: sub.id }, data: { currentPeriodEnd: new Date(Date.now() + 2 * DAY), trialEndsAt: new Date(Date.now() + 2 * DAY) } });
    await runBillingCycle();
    await runBillingCycle();
    expect(await db.notification.count({ where: { userId: w.owner.id, title: { contains: "free trial of" } } })).toBe(2); // "started" + one "ends on"

    // Trial over → paid row + first invoice.
    await db.subscription.update({ where: { id: sub.id }, data: { currentPeriodEnd: new Date(Date.now() - 1000) } });
    const r = await runBillingCycle();
    expect(r.trialsConverted).toBe(1);
    sub = await activeSub(w.orgId);
    expect(sub).toMatchObject({ billingMode: "invoiced", priceMonthly: 150_000, trialEndsAt: null });
    expect((await db.invoice.findFirstOrThrow({ where: { organizationId: w.orgId } })).subtotal).toBe(150_000);
    // No second trial.
    expect((await json(await billingRoute.GET(req("/x"), w.P()))).body.trialAvailable).toBe(false);
  });

  it("cancelling during the trial ends it with nothing to pay", async () => {
    const w = await workspace();
    const p = await plan({ priceMonthly: 150_000, trialDays: 7 });
    await changeRoute.POST(post({ planId: p.id }), w.P());
    expect((await json(await cancelRoute.POST(post({}), w.P()))).body).toMatchObject({ result: "scheduled" });
    const sub = await activeSub(w.orgId);
    await db.subscription.update({ where: { id: sub.id }, data: { currentPeriodEnd: new Date(Date.now() - 1000) } });
    await runBillingCycle();
    expect(await db.subscription.count({ where: { organizationId: w.orgId, status: "active" } })).toBe(0);
    expect(await db.invoice.count({ where: { organizationId: w.orgId } })).toBe(0);
  });
});

describe("payment reminders", () => {
  it("sends each reminder once: before due, overdue, +3 days, final", async () => {
    const w = await workspace();
    const { createInvoice } = await import("@/services/billing/billing");
    const inv = await createInvoice({ organizationId: w.orgId, kind: "renewal", description: "Plan", lines: [{ description: "Plan", amount: 100_000 }], dueAt: new Date(Date.now() + 2 * DAY) });
    const titles = async () => (await db.notification.findMany({ where: { userId: w.owner.id }, orderBy: { createdAt: "asc" } })).map((x) => x.title);
    await sendPaymentReminders();
    await sendPaymentReminders();
    expect((await titles()).filter((t) => t.includes("is due on"))).toHaveLength(1);
    await sendPaymentReminders(new Date(Date.now() + 2 * DAY + 1000));
    expect((await titles()).some((t) => t.includes("is overdue"))).toBe(true);
    // Jumping straight to a week late sends only the final reminder (no burst).
    await sendPaymentReminders(new Date(Date.now() + 9 * DAY + 1000));
    const all = await titles();
    expect(all.filter((t) => t.startsWith("Final reminder"))).toHaveLength(1);
    expect(all.filter((t) => t.startsWith("Reminder:"))).toHaveLength(0);
    expect((await db.invoice.findUniqueOrThrow({ where: { id: inv.id } })).remindersSent).toBe(4);
    await sendPaymentReminders(new Date(Date.now() + 20 * DAY));
    expect((await titles()).length).toBe(all.length);
    // Paid invoices get nothing.
    const paid = await createInvoice({ organizationId: w.orgId, kind: "renewal", description: "Plan", lines: [{ description: "Plan", amount: 100_000 }], dueAt: new Date(Date.now() - DAY) });
    await db.invoice.update({ where: { id: paid.id }, data: { status: "paid", paidAt: new Date() } });
    await sendPaymentReminders();
    expect((await db.invoice.findUniqueOrThrow({ where: { id: paid.id } })).remindersSent).toBe(0);
  });
});
