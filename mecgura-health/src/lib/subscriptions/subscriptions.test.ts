import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { planInputSchema, normalizeFeatures, normalizeLimits, validatePlanKeys, priceFor, annualSavingMinor, limitText } from "./catalog";
import { dunningStep } from "./dunning";
import { formatNumber } from "./numbering";
import { addMonths, prorateUpgrade } from "./period";
import { razorpayProvider } from "./providers/razorpay";
import { ProviderError } from "./providers/types";
import { DEFAULT_POLICY, TRANSITIONS, STATUSES, accessFor, canTransition, isReadPermission, mergePolicy } from "./state";
import { computeInvoice, DEFAULT_TAX, mergeTax } from "./tax";
import { levelOf, usageWindowStart, violationsFor } from "@/lib/services/entitlements";
import { FEATURE_KEYS } from "@/lib/platform/features";

const D = (s: string) => new Date(s);
describe("state machine", () => {
  it("only documented transitions are allowed", () => {
    for (const a of STATUSES) for (const b of STATUSES) expect(canTransition(a, b)).toBe((TRANSITIONS[a] as readonly string[]).includes(b));
  });
  it("EXPIRED/CANCELLED cannot jump straight to ACTIVE or TRIAL; they must start a new payment", () => {
    for (const from of ["EXPIRED", "CANCELLED"]) { expect(canTransition(from, "ACTIVE")).toBe(false); expect(canTransition(from, "TRIAL")).toBe(false); expect(canTransition(from, "PENDING_PAYMENT")).toBe(true); }
    expect(canTransition("TRIAL", "ACTIVE")).toBe(true); expect(canTransition("ACTIVE", "TRIAL")).toBe(false); expect(canTransition("SUSPENDED", "ACTIVE")).toBe(true);
  });
  it("access follows policy; grace keeps full access by default, ended is read-only, unknown is blocked", () => {
    expect(accessFor("ACTIVE", DEFAULT_POLICY)).toBe("FULL"); expect(accessFor("PAST_DUE", DEFAULT_POLICY)).toBe("FULL"); expect(accessFor("SUSPENDED", DEFAULT_POLICY)).toBe("READ_ONLY");
    expect(accessFor("EXPIRED", DEFAULT_POLICY)).toBe("READ_ONLY"); expect(accessFor("PENDING_PAYMENT", DEFAULT_POLICY)).toBe("BLOCK"); expect(accessFor("???", DEFAULT_POLICY)).toBe("BLOCK");
    expect(accessFor("SUSPENDED", mergePolicy({ access: { suspended: "BLOCK" } as never }))).toBe("BLOCK");
  });
  it("policy merging ignores invalid values", () => { const p = mergePolicy({ graceDays: -3, access: { grace: "NOPE" } } as never); expect(p.graceDays).toBe(DEFAULT_POLICY.graceDays); expect(p.access.grace).toBe("FULL"); });
  it("read-only keeps viewing permissions and drops writing ones", () => {
    for (const p of ["patients.view", "billing.view", "reports.export", "clinic.view"]) expect(isReadPermission(p), p).toBe(true);
    for (const p of ["patients.create", "billing.collect", "appointments.update", "users.edit"]) expect(isReadPermission(p), p).toBe(false);
  });
});
describe("tax maths (integer minor units)", () => {
  const on = mergeTax({ enabled: true, rateBp: 1800, mode: "EXCLUSIVE", vendorStateCode: "03" });
  it("is off unless configured", () => { expect(computeInvoice([100000], 0, DEFAULT_TAX, null)).toMatchObject({ taxMinor: 0, totalMinor: 100000 }); expect(mergeTax({ enabled: true, rateBp: 0 }).enabled).toBe(false); });
  it("exclusive tax is added; intra-state splits into CGST+SGST that sum exactly", () => {
    const m = computeInvoice([99999], 0, on, "03"); expect(m.taxMinor).toBe(18000); expect(m.totalMinor).toBe(99999 + 18000);
    expect(m.taxLines.map((l) => l.name)).toEqual(["CGST", "SGST"]); expect(m.taxLines.reduce((a, l) => a + l.amountMinor, 0)).toBe(m.taxMinor); expect(m.placeOfSupply).toBe("INTRA_STATE");
    const odd = computeInvoice([101], 0, mergeTax({ enabled: true, rateBp: 1800, vendorStateCode: "03" }), "03"); expect(odd.taxLines.reduce((a, l) => a + l.amountMinor, 0)).toBe(odd.taxMinor);
  });
  it("inter-state is IGST; unknown state uses the plain tax name", () => {
    expect(computeInvoice([100000], 0, on, "27").taxLines.map((l) => l.name)).toEqual(["IGST"]); expect(computeInvoice([100000], 0, on, null).taxLines[0].name).toBe("GST");
  });
  it("inclusive tax is carved out of the price; total unchanged", () => {
    const m = computeInvoice([118000], 0, { ...on, mode: "INCLUSIVE" }, "27"); expect(m.totalMinor).toBe(118000); expect(m.taxMinor).toBe(18000);
  });
  it("discount never exceeds the subtotal; fractions are rejected", () => {
    expect(computeInvoice([1000], 5000, on, null).totalMinor).toBe(0); expect(() => computeInvoice([10.5], 0, on, null)).toThrow();
  });
});
describe("periods and proration", () => {
  it("adds months without overflowing month ends", () => { expect(addMonths(D("2026-01-31T00:00:00Z"), 1).toISOString().slice(0, 10)).toBe("2026-02-28"); expect(addMonths(D("2028-01-31T00:00:00Z"), 1).toISOString().slice(0, 10)).toBe("2028-02-29"); expect(addMonths(D("2026-11-15T00:00:00Z"), 3).toISOString().slice(0, 10)).toBe("2027-02-15"); });
  it("upgrade proration charges the price difference for the days left", () => {
    const r = prorateUpgrade({ oldPriceMinor: 300000, newPriceMinor: 600000, periodStart: D("2026-01-01T00:00:00Z"), periodEnd: D("2026-01-31T00:00:00Z"), now: D("2026-01-16T00:00:00Z") });
    expect(r).toMatchObject({ totalDays: 30, remainingDays: 15, creditMinor: 150000, chargeMinor: 300000, netMinor: 150000 });
    expect(prorateUpgrade({ oldPriceMinor: 300000, newPriceMinor: 600000, periodStart: D("2026-01-01T00:00:00Z"), periodEnd: D("2026-01-31T00:00:00Z"), now: D("2026-02-05T00:00:00Z") }).netMinor).toBe(0);
  });
  it("monthly usage windows restart on the monthly anniversary even for yearly periods", () => {
    const base = D("2026-01-15T10:00:00Z"); expect(usageWindowStart(base, D("2026-01-20T00:00:00Z"))).toEqual(base); expect(usageWindowStart(base, D("2026-03-14T00:00:00Z")).toISOString().slice(0, 10)).toBe("2026-02-15"); expect(usageWindowStart(base, D("2026-03-16T00:00:00Z")).toISOString().slice(0, 10)).toBe("2026-03-15");
  });
});
describe("numbering, dunning, limits, plans", () => {
  it("formats numbers", () => { expect(formatNumber("INV", 2026, 1)).toBe("MEC-INV-2026-000001"); expect(formatNumber("REC", 2027, 123456)).toBe("MEC-REC-2027-123456"); expect(formatNumber("RFD", 2026, 12)).toBe("MEC-RFD-2026-000012"); });
  it("dunning walks reminder → overdue → grace → grace ending → suspend", () => {
    const due = D("2026-02-01T00:00:00Z"); const p = DEFAULT_POLICY; const at = (days: number) => new Date(due.getTime() + days * 86_400_000);
    expect(dunningStep({ status: "ACTIVE", dueAt: due, now: at(-10), graceStart: null, policy: p })).toBe("NONE"); expect(dunningStep({ status: "ACTIVE", dueAt: due, now: at(-2), graceStart: null, policy: p })).toBe("REMINDER");
    expect(dunningStep({ status: "ACTIVE", dueAt: due, now: at(0.1), graceStart: null, policy: p })).toBe("OVERDUE"); expect(dunningStep({ status: "PAST_DUE", dueAt: due, now: at(1), graceStart: null, policy: p })).toBe("NONE");
    expect(dunningStep({ status: "PAST_DUE", dueAt: due, now: at(3), graceStart: null, policy: p })).toBe("GRACE");
    expect(dunningStep({ status: "GRACE", dueAt: due, now: at(5), graceStart: at(3), policy: p })).toBe("NONE"); expect(dunningStep({ status: "GRACE", dueAt: due, now: at(9.5), graceStart: at(3), policy: p })).toBe("GRACE_ENDING"); expect(dunningStep({ status: "GRACE", dueAt: due, now: at(10.1), graceStart: at(3), policy: p })).toBe("SUSPEND");
    expect(dunningStep({ status: "SUSPENDED", dueAt: due, now: at(40), graceStart: null, policy: p })).toBe("NONE");
  });
  it("usage levels warn at 80 / 90 / 100%", () => { expect(levelOf(79, 100)).toBe("ok"); expect(levelOf(80, 100)).toBe("warn80"); expect(levelOf(90, 100)).toBe("warn90"); expect(levelOf(100, 100)).toBe("full"); expect(levelOf(0, 0)).toBe("ok"); expect(levelOf(1, 0)).toBe("full"); });
  it("downgrade violations only count totals that no longer fit", () => {
    const rows = [{ key: "maxPatients", label: "Patients", unit: "patients", metered: true, mode: "LIMITED" as const, limit: 500, used: 300, percent: 60, level: "ok" as const, period: "stock" as const, description: "" }, { key: "maxAppointmentsPerMonth", label: "Appts", unit: "a", metered: true, mode: "LIMITED" as const, limit: 10, used: 9, percent: 90, level: "warn90" as const, period: "period" as const, description: "" }];
    expect(violationsFor({ maxPatients: { mode: "LIMITED", value: 100 }, maxAppointmentsPerMonth: { mode: "LIMITED", value: 1 } }, rows)).toEqual([{ key: "maxPatients", label: "Patients", used: 300, limit: 100, mode: "LIMITED" }]);
    expect(violationsFor({ maxPatients: { mode: "LIMITED", value: 300 } }, rows)).toEqual([]); expect(violationsFor({ maxPatients: { mode: "DISABLED" } }, rows)).toHaveLength(1);
  });
  it("plan input is validated (integer paise, bounds, slug, unknown keys)", () => {
    const ok = { name: "Starter", slug: "starter", monthlyPriceMinor: 99900, annualPriceMinor: 999000, features: {}, limits: {} };
    expect(planInputSchema.safeParse(ok).success).toBe(true);
    for (const bad of [{ monthlyPriceMinor: 99.5 }, { monthlyPriceMinor: -1 }, { slug: "Bad Slug" }, { trialDays: 500 }, { limits: { maxDoctors: { mode: "LIMITED", value: -4 } } }, { limits: { maxDoctors: { mode: "LIMITED" } } }]) expect(planInputSchema.safeParse({ ...ok, ...bad }).success, JSON.stringify(bad)).toBe(false);
    expect(validatePlanKeys({ features: { nope: true }, limits: {} })).toMatch(/Unknown feature/); expect(validatePlanKeys({ features: {}, limits: { nope: {} } })).toMatch(/Unknown limit/);
  });
  it("features and limits are explicit; features share the Phase 14 keys", () => {
    const f = normalizeFeatures({ patientPortal: true }); expect(Object.keys(f).sort()).toEqual([...FEATURE_KEYS].sort()); expect(f.patientPortal).toBe(true); expect(f.pharmacy).toBe(false);
    expect(normalizeLimits({}).maxDoctors).toEqual({ mode: "UNLIMITED" });
    expect(priceFor({ monthlyPriceMinor: 1, annualPriceMinor: 2 }, "YEARLY")).toBe(2); expect(annualSavingMinor({ monthlyPriceMinor: 1000, annualPriceMinor: 10000 })).toBe(2000); expect(annualSavingMinor({ monthlyPriceMinor: 1000, annualPriceMinor: 99999 })).toBe(0);
    expect(limitText({ mode: "UNLIMITED" })).toBe("Unlimited"); expect(limitText({ mode: "DISABLED" })).toBe("Not included"); expect(limitText({ mode: "LIMITED", value: 1500 }, "patients")).toBe("1,500 patients");
  });
});
describe("razorpay webhook signature", () => {
  const body = JSON.stringify({ event: "payment.captured", payload: { payment: { entity: { id: "pay_1", order_id: "o1", amount: 100, currency: "INR", notes: { invoice_id: "inv1" } } } } });
  const sig = (b: string, s: string) => createHmac("sha256", s).update(b).digest("hex");
  it("accepts only the exact HMAC of the raw body; fails closed without a secret", () => {
    const old = process.env.RAZORPAY_WEBHOOK_SECRET;
    try {
      process.env.RAZORPAY_WEBHOOK_SECRET = "whsec_test_123456";
      const h = (s: string) => new Headers({ "x-razorpay-signature": s, "x-razorpay-event-id": "evt_1" });
      expect(razorpayProvider.verifyWebhook(body, h(sig(body, "whsec_test_123456"))).ok).toBe(true);
      expect(razorpayProvider.verifyWebhook(body + " ", h(sig(body, "whsec_test_123456"))).ok).toBe(false);
      expect(razorpayProvider.verifyWebhook(body, h(sig(body, "other"))).ok).toBe(false); expect(razorpayProvider.verifyWebhook(body, new Headers()).ok).toBe(false);
      const ev = razorpayProvider.parseWebhook(body, h("x")); expect(ev).toMatchObject({ eventId: "evt_1", kind: "payment.success", providerPaymentId: "pay_1", invoiceRef: "inv1", amountMinor: 100 });
      delete process.env.RAZORPAY_WEBHOOK_SECRET; expect(razorpayProvider.verifyWebhook(body, h(sig(body, "")))).toMatchObject({ ok: false });
    } finally { if (old === undefined) delete process.env.RAZORPAY_WEBHOOK_SECRET; else process.env.RAZORPAY_WEBHOOK_SECRET = old; }
  });
  it("provider errors carry a code", () => { expect(new ProviderError("NOT_CONFIGURED", "x").code).toBe("NOT_CONFIGURED"); });
});
