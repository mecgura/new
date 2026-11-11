import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { addDays, todayIn, zonedToUtc } from "@/lib/scheduling/time";
import { allocate, computeInvoice, deriveInvoiceStatus, formatMoney, mulDivRound, moneyToMinor, percentToBp } from "@/lib/billing/money";
import { renderInvoice, renderReceipt, renderRefundReceipt, renderStatement } from "@/lib/billing/billing-html";
import { asTenant, ctxFor, makeUser, seedSystemData, uniq } from "@/test/helpers";
import type { RoleKey } from "@/lib/permissions";
import { createStaffAppointment } from "./appointments";
import { addTax, listServices, listTaxes, saveService, setTaxActive, updateBillingSettings, getBillingSettings } from "./billing-master";
import { autoBill, billingStatusFor, cancelInvoice, createInvoice, createInvoiceFromSource, getInvoice, issueInvoice, listInvoices, previewInvoice, updateDraft } from "./billing-invoices";
import { cancelPayment, closeSession, currentSession, listPayments, listRefunds, openSession, recordPayment, refundAction, requestRefund } from "./billing-payments";
import { billingDashboard, collectionReport, exportReport, financialReport } from "./billing-reports";
import { billingTimeline, invoiceDocument, patientBilling, receiptDocument, recordDocAccess, refundReceiptDocument, statementDocument } from "./billing-docs";
import { consultationAction, getConsultation, patchConsultation, startConsultation } from "./consultation";
import { createInvestigationOrder } from "./lab-orders";
import { saveInvestigation } from "./lab-master";
import { registerVisit } from "./opd";
import { registerPatient } from "./patient-crm";
import { saveSchedule } from "./schedule";
import { createFollowUp, linkAppointment } from "./followups";

const TZ = "Asia/Kolkata";
const code = (p: Promise<unknown>) => p.then(() => "ok", (e) => (e instanceof AppError ? e.code : `ERR:${e}`));
type Ctx = ReturnType<typeof asTenant>;
interface T { id: string; admin: Ctx; accountant: Ctx; recep: Ctx; doctor: Ctx; doctor2: Ctx; nurse: Ctx; lab: Ctx; superAdmin: Ctx; recepId: string; doctorId: string; accId: string; adminId: string; svc: Record<string, string>; tax: string; invId: string }
const today = () => todayIn(TZ);
const slotAt = (date: string, hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return zonedToUtc(date, h * 60 + m, TZ).toISOString(); };
let keyN = 0; const key = () => `idem-${Date.now().toString(36)}-${++keyN}-xxxx`;

async function mkTenant(label: string): Promise<T> {
  const t = await db.tenant.create({ data: { name: `Bill Clinic ${label}`, slug: uniq(`bl-${label}`).slice(0, 30), status: "ACTIVE", address: "1 Test Road", city: "Testville", contactPhone: "+911234500000" } });
  const mk = async (role: RoleKey) => { const { user } = await makeUser(role, t.id); const b = ctxFor(user, role, t.id); return { user, ctx: asTenant({ ...b, tenant: { ...b.tenant!, name: `Bill Clinic ${label}`, timezone: TZ, address: "1 Test Road", city: "Testville", contactPhone: "+911234500000", logoUrl: null, brand: { primary: "#0e7c86", secondary: "#000", accent: "#000" }, state: null, pincode: null, contactEmail: null, legalName: null } as never }) }; };
  const [a, ac, r, d, d2, n, l] = [await mk("CLINIC_ADMIN"), await mk("ACCOUNTANT"), await mk("RECEPTIONIST"), await mk("DOCTOR"), await mk("DOCTOR"), await mk("NURSE"), await mk("LAB_STAFF")];
  const sa = await makeUser("SUPER_ADMIN", null);
  const sched = { slotMinutes: 15, bufferMinutes: 0, onlineBooking: false, advanceDays: 60, minNoticeMinutes: 0, windows: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, start: "09:00", end: "17:00" })) };
  await saveSchedule(a.ctx, d.user.id, sched);
  const tax = await addTax(a.ctx, { name: "GST 18", rateBp: 1800, type: "GST" });
  const inv = await saveInvestigation(a.ctx, null, { testCode: "CBC", testName: "CBC", category: "Pathology", sampleType: "Blood", parameters: [{ name: "Hb", resultType: "NUMERIC" }] });
  const s = async (serviceCode: string, serviceName: string, type: string, priceMinor: number, extra: Record<string, unknown> = {}) => (await saveService(a.ctx, null, { serviceCode, serviceName, type, priceMinor, ...extra })).id;
  const svc = { CONS: await s("CONS-001", "Consultation", "CONSULTATION", 50000), FOLLOW: await s("FOLLOW-001", "Follow-up", "FOLLOW_UP", 30000), LAB: await s("LAB-001", "CBC", "INVESTIGATION", 30000, { taxId: tax.id, investigationId: inv.id }), PROC: await s("PROC-001", "Dressing", "PROCEDURE", 100000, { taxId: tax.id }), NODISC: await s("DOC-001", "Certificate", "DOCUMENT", 20000, { discountEligible: false }) };
  await updateBillingSettings(a.ctx, base({ discountRules: { RECEPTIONIST: { maxPercentBp: 500 }, CLINIC_ADMIN: { maxPercentBp: 2000 }, ACCOUNTANT: { maxPercentBp: 1000, maxFixedMinor: 5000 } }, defaultConsultationServiceId: svc.CONS, defaultFollowUpServiceId: svc.FOLLOW }));
  return { id: t.id, admin: a.ctx, accountant: ac.ctx, recep: r.ctx, doctor: d.ctx, doctor2: d2.ctx, nurse: n.ctx, lab: l.ctx, superAdmin: asTenant({ ...ctxFor(sa.user, "SUPER_ADMIN", t.id), viewingAs: true }), recepId: r.user.id, doctorId: d.user.id, accId: ac.user.id, adminId: a.user.id, svc, tax: tax.id, invId: inv.id };
}
const base = (over: Record<string, unknown> = {}) => ({ currency: "INR", invoicePrefix: "INV", receiptPrefix: "REC", paymentPrefix: "PAY", refundPrefix: "REF", taxMode: "EXCLUSIVE", paymentMethods: ["CASH", "UPI", "CARD", "BANK_TRANSFER", "CHEQUE", "OTHER"], discountRules: {}, dueDays: 7, autoBillConsultation: false, autoBillInvestigation: false, autoBillFollowUp: false, allowOverpayment: false, refundSelfApproval: false, useCashierSessions: false, ...over });
let phoneN = 0;
async function patient(t: T, name = "Bill Patient") { return (await registerPatient(t.recep, { name, phone: `94${String(60000000 + ++phoneN * 19).slice(0, 8)}`, allowDuplicate: true, dateOfBirth: "1980-03-03", gender: "MALE" })).id as string; }
async function settings(t: T, over: Record<string, unknown>) { const cur = await getBillingSettings(t.admin); const { canConfigure, gateway, ...rest } = cur; void canConfigure; void gateway; await updateBillingSettings(t.admin, { ...rest, ...over }); }
const draft = async (t: T, items: Record<string, unknown>[], extra: Record<string, unknown> = {}, who: Ctx = t.recep, pid?: string) => createInvoice(who, { patientId: pid ?? (await patient(t)), items, ...extra }) as Promise<{ id: string; invoiceNumber: string }>;
const issued = async (t: T, items: Record<string, unknown>[] = [{ serviceId: t.svc.CONS }], extra: Record<string, unknown> = {}, pid?: string) => { const d = await draft(t, items, extra, t.recep, pid); await issueInvoice(t.recep, d.id); return d; };
const pay = (who: Ctx, invoiceId: string, amountMinor: number, over: Record<string, unknown> = {}) => recordPayment(who, invoiceId, { amountMinor, method: "CASH", idempotencyKey: key(), ...over });
const consult = async (t: T, doctor: Ctx = t.doctor) => {
  await db.opdVisit.updateMany({ where: { tenantId: t.id, doctorUserId: doctor.user.id, status: { in: ["CALLED", "IN_CONSULTATION"] } }, data: { status: "COMPLETED" } });
  const pid = await patient(t, "Consult Bill Patient"); const v = await registerVisit(t.recep, { patient: { patientId: pid, viaProfile: true }, doctorUserId: doctor.user.id }); const c = await startConsultation(doctor, v.id);
  return { patientId: pid, id: c.id };
};

let A: T, B: T;
beforeAll(async () => { await seedSystemData(); A = await mkTenant("a"); B = await mkTenant("b"); });

describe("money maths (23, 5–6)", () => {
  it("rounds half away from zero with integers and splits exactly", () => {
    expect(mulDivRound(1, 1, 2)).toBe(1); expect(mulDivRound(5, 1, 3)).toBe(2); expect(mulDivRound(2, 1, 3)).toBe(1); expect(mulDivRound(1999, 1800, 10000)).toBe(360);
    const parts = allocate(101, [1, 1, 1]); expect(parts.reduce((a, b) => a + b, 0)).toBe(101); expect(parts).toEqual([34, 34, 33]);
    expect(allocate(5, [0, 0])).toEqual([0, 0]); expect(allocate(10, [3, 0, 7]).reduce((a, b) => a + b, 0)).toBe(10);
  });
  it("exclusive and inclusive tax, item and invoice discounts", () => {
    const r = computeInvoice([{ quantity: 2, unitPriceMinor: 50000, taxRateBp: 1800 }], { type: "PERCENT", value: 1000 }, "EXCLUSIVE");
    expect(r).toMatchObject({ subtotalMinor: 100000, discountMinor: 10000, taxMinor: 16200, totalMinor: 106200 });
    const i = computeInvoice([{ quantity: 1, unitPriceMinor: 11800, taxRateBp: 1800 }], null, "INCLUSIVE");
    expect(i).toMatchObject({ subtotalMinor: 11800, taxMinor: 1800, totalMinor: 11800 });
    const mix = computeInvoice([{ quantity: 1, unitPriceMinor: 10000, taxRateBp: 0, discount: { type: "FIXED", value: 1000 } }, { quantity: 3, unitPriceMinor: 3333, taxRateBp: 500, discountEligible: false }], { type: "FIXED", value: 999 }, "EXCLUSIVE");
    expect(mix.discountMinor).toBe(1000 + 999); expect(mix.lines[1].invoiceDiscountMinor).toBe(0); expect(mix.lines[0].invoiceDiscountMinor).toBe(999);
    expect(mix.totalMinor).toBe(mix.subtotalMinor - mix.discountMinor + mix.taxMinor);
  });
  it("refuses impossible amounts", () => {
    expect(() => computeInvoice([{ quantity: 1, unitPriceMinor: 100, taxRateBp: 0, discount: { type: "FIXED", value: 200 } }], null, "EXCLUSIVE")).toThrow();
    expect(() => computeInvoice([{ quantity: 1, unitPriceMinor: 100, taxRateBp: 0 }], { type: "PERCENT", value: 10001 }, "EXCLUSIVE")).toThrow();
    expect(() => computeInvoice([{ quantity: 0, unitPriceMinor: 100, taxRateBp: 0 }], null, "EXCLUSIVE")).toThrow();
    expect(() => computeInvoice([{ quantity: 999, unitPriceMinor: 2_000_000_000, taxRateBp: 0 }], null, "EXCLUSIVE")).toThrow();
    expect(() => computeInvoice([{ quantity: 1, unitPriceMinor: 0.5 as number, taxRateBp: 0 }], null, "EXCLUSIVE")).toThrow();
  });
  it("money text conversion never uses floats; status derives from money", () => {
    expect(moneyToMinor("1,250.50")).toBe(125050); expect(moneyToMinor("0.1")).toBe(10); expect(moneyToMinor("19.999")).toBeNull(); expect(moneyToMinor("-1")).toBeNull(); expect(moneyToMinor("abc")).toBeNull();
    expect(percentToBp("2.5")).toBe(250); expect(percentToBp("5%")).toBe(500); expect(percentToBp("x")).toBeNull();
    expect(formatMoney(125050, "INR")).toBe("₹1,250.50");
    const s = (c: number, r: number) => deriveInvoiceStatus({ totalMinor: 1000, collectedMinor: c, refundedMinor: r });
    expect([s(0, 0), s(400, 0), s(1000, 0), s(1000, 300), s(1000, 1000)]).toEqual(["ISSUED", "PARTIALLY_PAID", "PAID", "PARTIALLY_REFUNDED", "REFUNDED"]);
  });
});

describe("service master, taxes and settings (1, 8–12, 24, 58)", () => {
  it("clinic admin configures services; codes are unique per clinic; others can't", async () => {
    expect(await code(saveService(A.recep, null, { serviceCode: "X1", serviceName: "Nope", type: "OTHER", priceMinor: 100 }))).toBe("FORBIDDEN");
    expect(await code(saveService(A.accountant, null, { serviceCode: "X1", serviceName: "Nope", type: "OTHER", priceMinor: 100 }))).toBe("FORBIDDEN");
    expect(await code(saveService(A.admin, null, { serviceCode: "cons-001", serviceName: "Dup", type: "OTHER", priceMinor: 100 }))).toBe("CONFLICT");
    expect(await code(saveService(B.admin, null, { serviceCode: "CONS-001", serviceName: "B dup", type: "CONSULTATION", priceMinor: 70000 }))).toBe("CONFLICT"); // unique per clinic, so B has its own CONS-001
    expect(await code(saveService(B.admin, null, { serviceCode: "B-ONLY", serviceName: "B only", type: "OTHER", priceMinor: 100 }))).toBe("ok");
    expect(await code(saveService(A.admin, null, { serviceCode: "NEG", serviceName: "Negative", type: "OTHER", priceMinor: -5 }))).toBe("VALIDATION_ERROR");
    expect(await code(saveService(A.admin, null, { serviceCode: "BADTYPE", serviceName: "Bad type", type: "MAGIC", priceMinor: 5 }))).toBe("VALIDATION_ERROR");
    expect(await code(saveService(A.admin, null, { serviceCode: "FTAX", serviceName: "Foreign tax", type: "OTHER", priceMinor: 5, taxId: B.tax }))).toBe("VALIDATION_ERROR");
    const list = (await listServices(A.recep, {})).services;
    expect(list.find((s) => s.serviceCode === "CONS-001")).toMatchObject({ priceMinor: 50000, type: "CONSULTATION" });
    expect(list.find((s) => s.serviceCode === "LAB-001")).toMatchObject({ taxRateBp: 1800, investigationId: A.invId });
    expect((await listServices(B.recep, {})).services.map((s) => s.id)).not.toContain(A.svc.CONS);
    expect(await code(listServices(A.nurse, {}))).toBe("FORBIDDEN"); expect(await code(listServices(A.superAdmin, {}))).toBe("FORBIDDEN");
  });
  it("taxes are configurable and tenant-scoped", async () => {
    expect(await code(addTax(A.recep, { name: "X", rateBp: 100 }))).toBe("FORBIDDEN");
    expect(await code(addTax(A.admin, { name: "GST 18", rateBp: 1800 }))).toBe("CONFLICT");
    expect(await code(addTax(A.admin, { name: "Too high", rateBp: 20000 }))).toBe("VALIDATION_ERROR");
    expect((await listTaxes(B.accountant)).taxes.map((t) => t.id)).not.toContain(A.tax);
  });
  it("settings: prefixes, methods and gateway honesty; audited; admin only", async () => {
    expect(await code(updateBillingSettings(A.recep, base()))).toBe("FORBIDDEN");
    expect(await code(updateBillingSettings(A.admin, base({ paymentMethods: ["CASH", "ONLINE"] })))).toBe("VALIDATION_ERROR");
    expect(await code(updateBillingSettings(A.admin, base({ invoicePrefix: "1bad" })))).toBe("VALIDATION_ERROR");
    expect(await code(updateBillingSettings(A.admin, base({ defaultConsultationServiceId: B.svc.CONS })))).toBe("VALIDATION_ERROR");
    expect((await getBillingSettings(A.recep)).gateway).toEqual({ configured: false, message: "Payment gateway not configured." });
    expect(await db.auditLog.count({ where: { tenantId: A.id, action: "billing.config_changed" } })).toBeGreaterThan(0);
  });
});

describe("invoices (2–3, 15–16, 18–20, 65)", () => {
  it("creates a draft with a clinic-scoped number and server-computed snapshot lines", async () => {
    const pid = await patient(A);
    const r = await createInvoice(A.recep, { patientId: pid, items: [{ serviceId: A.svc.CONS, unitPriceMinor: 1 }, { serviceId: A.svc.LAB, quantity: 2 }, { description: "Registration fee", unitPriceMinor: 10000 }] }) as { id: string; invoiceNumber: string };
    expect(r.invoiceNumber).toMatch(/^INV-\d{4}-\d{6}$/);
    const d = await getInvoice(A.recep, r.id);
    expect(d.status).toBe("DRAFT");
    expect(d.items.map((i) => [i.description, i.quantity, i.unitPriceMinor, i.taxMinor, i.lineTotalMinor])).toEqual([["Consultation", 1, 50000, 0, 50000], ["CBC", 2, 30000, 10800, 70800], ["Registration fee", 1, 10000, 0, 10000]]); // client price for a catalogue service is ignored
    expect(d).toMatchObject({ subtotalMinor: 120000, taxMinor: 10800, totalMinor: 130800, discountMinor: 0, dueMinor: 0 });
    const b1 = await draft(B, [{ serviceId: B.svc.CONS }], {}, B.recep);
    expect(b1.invoiceNumber).toMatch(/^INV-\d{4}-000001$/);
    expect((await draft(A, [{ serviceId: A.svc.CONS }])).invoiceNumber).not.toBe(r.invoiceNumber);
  });
  it("validates patients, services, links and amounts", async () => {
    const pid = await patient(A);
    expect(await code(createInvoice(A.recep, { patientId: await patient(B), items: [{ serviceId: A.svc.CONS }] }))).toBe("NOT_FOUND");
    expect(await code(createInvoice(A.recep, { patientId: pid, items: [{ serviceId: B.svc.CONS }] }))).toBe("VALIDATION_ERROR");
    expect(await code(createInvoice(A.recep, { patientId: pid, items: [] }))).toBe("VALIDATION_ERROR");
    expect(await code(createInvoice(A.recep, { patientId: pid, items: [{ description: "x1", unitPriceMinor: -1 }] }))).toBe("VALIDATION_ERROR");
    expect(await code(createInvoice(A.recep, { patientId: pid, items: [{ serviceId: A.svc.CONS, quantity: 0 }] }))).toBe("VALIDATION_ERROR");
    const c = await consult(A);
    expect(await code(createInvoice(A.recep, { patientId: pid, consultationId: c.id, items: [{ serviceId: A.svc.CONS }] }))).toBe("VALIDATION_ERROR"); // consultation belongs to another patient
    expect(await code(createInvoice(A.nurse, { patientId: pid, items: [{ serviceId: A.svc.CONS }] }))).toBe("FORBIDDEN");
    expect(await code(createInvoice(A.superAdmin, { patientId: pid, items: [{ serviceId: A.svc.CONS }] }))).toBe("FORBIDDEN");
    await db.patient.update({ where: { id: pid }, data: { status: "ARCHIVED" } });
    expect(await code(createInvoice(A.recep, { patientId: pid, items: [{ serviceId: A.svc.CONS }] }))).toBe("CONFLICT");
  });
  it("drafts can be edited; issuing freezes the invoice; historical invoices never change with the price list", async () => {
    const d = await draft(A, [{ serviceId: A.svc.CONS }]); const pid = (await getInvoice(A.recep, d.id)).patient!.id;
    await updateDraft(A.recep, d.id, { patientId: pid, items: [{ serviceId: A.svc.CONS, quantity: 2 }] });
    expect((await getInvoice(A.recep, d.id)).totalMinor).toBe(100000);
    expect(await code(updateDraft(A.recep, d.id, { patientId: await patient(A), items: [{ serviceId: A.svc.CONS }] }))).toBe("VALIDATION_ERROR");
    expect(await code(updateDraft(A.nurse, d.id, { patientId: pid, items: [{ serviceId: A.svc.CONS }] }))).toBe("FORBIDDEN");
    await issueInvoice(A.recep, d.id);
    const after = await getInvoice(A.recep, d.id);
    expect(after).toMatchObject({ status: "ISSUED", dueMinor: 100000, dueDate: addDays(today(), 7) });
    expect(await code(updateDraft(A.recep, d.id, { patientId: pid, items: [{ serviceId: A.svc.CONS }] }))).toBe("CONFLICT");
    expect(await code(issueInvoice(A.recep, d.id))).toBe("CONFLICT");
    await saveService(A.admin, A.svc.CONS, { serviceCode: "CONS-001", serviceName: "Consultation (new name)", type: "CONSULTATION", priceMinor: 90000 });
    const still = await getInvoice(A.recep, d.id);
    expect(still.items[0]).toMatchObject({ description: "Consultation", unitPriceMinor: 50000 }); expect(still.totalMinor).toBe(100000);
    await saveService(A.admin, A.svc.CONS, { serviceCode: "CONS-001", serviceName: "Consultation", type: "CONSULTATION", priceMinor: 50000 });
    const e = await draft(A, [{ serviceId: A.svc.CONS }]);
    expect(await code(updateDraft(A.recep, e.id, { patientId: pid, items: [{ serviceId: A.svc.CONS }] }))).toBe("VALIDATION_ERROR");
  });
  it("a zero-total invoice can't be issued; the invoice number never changes", async () => {
    const free = await draft(A, [{ description: "Free item", unitPriceMinor: 0 }]);
    expect(await code(issueInvoice(A.recep, free.id))).toBe("VALIDATION_ERROR");
    const d = await draft(A, [{ serviceId: A.svc.CONS }]); const n = (await getInvoice(A.recep, d.id)).invoiceNumber; await issueInvoice(A.recep, d.id);
    expect((await getInvoice(A.recep, d.id)).invoiceNumber).toBe(n);
  });
  it("preview is computed by the server and uses the same rules", async () => {
    const p = await previewInvoice(A.recep, { patientId: "x", items: [{ serviceId: A.svc.PROC, quantity: 1 }] });
    expect(p).toMatchObject({ subtotalMinor: 100000, taxMinor: 18000, totalMinor: 118000, currency: "INR" });
  });
});

describe("discounts and tax (4–6, 21–25, 65)", () => {
  it("nobody discounts without a rule; limits per role; a reason is required; ineligible services are excluded", async () => {
    const pid = await patient(A);
    expect(await code(createInvoice(A.nurse, { patientId: pid, items: [{ serviceId: A.svc.CONS }], discount: { type: "PERCENT", value: 100 }, discountReason: "x1" }))).toBe("FORBIDDEN");
    expect(await code(createInvoice(A.recep, { patientId: pid, items: [{ serviceId: A.svc.CONS }], discount: { type: "PERCENT", value: 500 }, discountReason: "Staff relative" }))).toBe("ok");
    expect(await code(createInvoice(A.recep, { patientId: pid, items: [{ serviceId: A.svc.CONS }], discount: { type: "PERCENT", value: 501 }, discountReason: "Too much" }))).toBe("VALIDATION_ERROR");
    expect(await code(createInvoice(A.recep, { patientId: pid, items: [{ serviceId: A.svc.CONS }], discount: { type: "PERCENT", value: 500 } }))).toBe("VALIDATION_ERROR");
    expect(await code(createInvoice(A.accountant, { patientId: pid, items: [{ serviceId: A.svc.PROC }], discount: { type: "FIXED", value: 6000 }, discountReason: "Cap test" }))).toBe("VALIDATION_ERROR"); // fixed cap 5000
    expect(await code(createInvoice(A.admin, { patientId: pid, items: [{ serviceId: A.svc.CONS }], discount: { type: "PERCENT", value: 2000 }, discountReason: "Charity" }))).toBe("ok");
    expect(await code(createInvoice(A.admin, { patientId: pid, items: [{ serviceId: A.svc.CONS }], discount: { type: "PERCENT", value: 2100 }, discountReason: "Too much" }))).toBe("VALIDATION_ERROR");
    const nd = await createInvoice(A.admin, { patientId: pid, items: [{ serviceId: A.svc.NODISC }], discount: { type: "PERCENT", value: 1000 }, discountReason: "Not eligible" }) as { id: string };
    expect((await getInvoice(A.admin, nd.id)).discountMinor).toBe(0); // a service marked "not discount eligible" never gets a discount
  });
  it("percentage and fixed, invoice-level and item-level, with audit", async () => {
    const d = await draft(A, [{ serviceId: A.svc.CONS, discount: { type: "FIXED", value: 1000 } }, { serviceId: A.svc.PROC }], { discount: { type: "PERCENT", value: 500 }, discountReason: "Loyalty" }, A.admin);
    const v = await getInvoice(A.admin, d.id);
    expect(v.subtotalMinor).toBe(150000); expect(v.discountMinor).toBe(1000 + Math.round(((50000 - 1000) + 100000) * 0.05)); expect(v.discountReason).toBe("Loyalty"); expect(v.discountBy).toBeTruthy();
    expect(v.totalMinor).toBe(v.subtotalMinor - v.discountMinor + v.taxMinor);
    const logs = await db.auditLog.findMany({ where: { tenantId: A.id, entityId: d.id, action: "billing.discount_applied" } });
    expect(logs).toHaveLength(1); expect(JSON.parse(logs[0].metadata!).reason).toBe("Loyalty");
    // editing someone else's discount without changing it isn't blocked or re-audited
    const pid = v.patient!.id;
    await updateDraft(A.recep, d.id, { patientId: pid, items: [{ serviceId: A.svc.CONS, discount: { type: "FIXED", value: 1000 } }, { serviceId: A.svc.PROC }], discount: { type: "PERCENT", value: 500 }, discountReason: "Loyalty", notes: "note" });
    expect(await db.auditLog.count({ where: { tenantId: A.id, entityId: d.id, action: "billing.discount_applied" } })).toBe(1);
    expect(await code(updateDraft(A.recep, d.id, { patientId: pid, items: [{ serviceId: A.svc.CONS }, { serviceId: A.svc.PROC }], discount: { type: "PERCENT", value: 1500 }, discountReason: "More" }))).toBe("VALIDATION_ERROR");
  });
  it("tax follows clinic configuration and is snapshotted on the invoice", async () => {
    const e = await issued(A, [{ serviceId: A.svc.PROC }]);
    expect(await getInvoice(A.recep, e.id)).toMatchObject({ taxMode: "EXCLUSIVE", taxMinor: 18000, totalMinor: 118000 });
    await settings(A, { taxMode: "INCLUSIVE" });
    const inc = await issued(A, [{ serviceId: A.svc.PROC }]);
    expect(await getInvoice(A.recep, inc.id)).toMatchObject({ taxMode: "INCLUSIVE", subtotalMinor: 100000, totalMinor: 100000, taxMinor: 15254 });
    await settings(A, { taxMode: "EXCLUSIVE" });
    await db.billingTax.update({ where: { id: A.tax }, data: { rateBp: 500 } });
    expect(await getInvoice(A.recep, e.id)).toMatchObject({ taxMinor: 18000, totalMinor: 118000 }); // old invoices keep their tax
    expect((await getInvoice(A.recep, e.id)).items[0]).toMatchObject({ taxRateBp: 1800, taxName: "GST 18" });
    await db.billingTax.update({ where: { id: A.tax }, data: { rateBp: 1800 } });
    await setTaxActive(A.admin, A.tax, false);
    expect((await previewInvoice(A.recep, { patientId: "x", items: [{ serviceId: A.svc.PROC }] })).taxMinor).toBe(0);
    await setTaxActive(A.admin, A.tax, true);
  });
});

describe("payments, receipts and balances (7–13, 22, 24, 29–33)", () => {
  it("partial, multiple and full payments move the status and balances", async () => {
    const inv = await issued(A, [{ serviceId: A.svc.CONS }, { serviceId: A.svc.CONS }]); // 1000.00
    const p1 = await pay(A.recep, inv.id, 50000, { method: "CASH" }) as { id: string; paymentNumber: string; receiptNumber: string };
    expect(p1.paymentNumber).toMatch(/^PAY-\d{4}-\d{6}$/); expect(p1.receiptNumber).toMatch(/^REC-\d{4}-\d{6}$/);
    expect(await getInvoice(A.recep, inv.id)).toMatchObject({ status: "PARTIALLY_PAID", collectedMinor: 50000, dueMinor: 50000, paidMinor: 50000 });
    await pay(A.accountant, inv.id, 20000, { method: "UPI", transactionReference: `UPI-${key()}` });
    expect((await getInvoice(A.recep, inv.id)).dueMinor).toBe(30000);
    await pay(A.recep, inv.id, 30000, { method: "CARD", transactionReference: `CARD-${key()}` });
    const d = await getInvoice(A.recep, inv.id);
    expect(d).toMatchObject({ status: "PAID", dueMinor: 0, collectedMinor: 100000 }); expect(d.payments).toHaveLength(3);
    expect(await code(pay(A.recep, inv.id, 100))).toBe("CONFLICT"); // paid invoices take no more money
  });
  it("rejects over-payment, bad amounts, drafts, future dates and unconfigured or online methods", async () => {
    const inv = await issued(A);
    expect(await code(pay(A.recep, inv.id, 50001))).toBe("VALIDATION_ERROR");
    for (const a of [0, -5]) expect(await code(pay(A.recep, inv.id, a))).toBe("VALIDATION_ERROR");
    expect(await code(recordPayment(A.recep, inv.id, { amountMinor: 1.5, method: "CASH", idempotencyKey: key() }))).toBe("VALIDATION_ERROR");
    expect(await code(recordPayment(A.recep, inv.id, { amountMinor: 100, method: "CASH" }))).toBe("VALIDATION_ERROR");
    expect(await code(pay(A.recep, inv.id, 100, { method: "ONLINE" }))).toBe("VALIDATION_ERROR");
    expect(await code(pay(A.recep, inv.id, 100, { method: "BITCOIN" }))).toBe("VALIDATION_ERROR");
    expect(await code(pay(A.recep, inv.id, 100, { paymentDate: addDays(today(), 3) }))).toBe("VALIDATION_ERROR");
    const dr = await draft(A, [{ serviceId: A.svc.CONS }]);
    expect(await code(pay(A.recep, dr.id, 100))).toBe("CONFLICT");
    await settings(A, { paymentMethods: ["CASH"] });
    expect(await code(pay(A.recep, inv.id, 100, { method: "UPI" }))).toBe("VALIDATION_ERROR");
    await settings(A, { paymentMethods: ["CASH", "UPI", "CARD", "BANK_TRANSFER", "CHEQUE", "OTHER"] });
    await settings(A, { allowOverpayment: true });
    expect(await code(pay(A.recep, inv.id, 60000))).toBe("ok");
    expect((await getInvoice(A.recep, inv.id)).dueMinor).toBe(0);
    await settings(A, { allowOverpayment: false });
  });
  it("the same request or transaction reference can't be recorded twice", async () => {
    const inv = await issued(A); const k = key();
    const a = await recordPayment(A.recep, inv.id, { amountMinor: 10000, method: "CASH", idempotencyKey: k }) as { id: string; duplicate: boolean };
    const b = await recordPayment(A.recep, inv.id, { amountMinor: 10000, method: "CASH", idempotencyKey: k }) as { id: string; duplicate: boolean };
    expect(b).toMatchObject({ id: a.id, duplicate: true }); expect((await getInvoice(A.recep, inv.id)).collectedMinor).toBe(10000);
    const ref = `REF-${key()}`;
    await pay(A.recep, inv.id, 1000, { method: "UPI", transactionReference: ref });
    expect(await code(pay(A.recep, inv.id, 1000, { method: "UPI", transactionReference: ref }))).toBe("CONFLICT");
    const other = await issued(A);
    expect(await code(recordPayment(A.recep, other.id, { amountMinor: 100, method: "CASH", idempotencyKey: k }))).toBe("CONFLICT");
  });
  it("concurrent payments can never over-allocate an invoice", async () => {
    const inv = await issued(A, [{ serviceId: A.svc.CONS }]); // 500.00
    const rs = await Promise.all(Array.from({ length: 6 }, () => code(pay(A.recep, inv.id, 20000))));
    const ok = rs.filter((r) => r === "ok").length;
    const d = await getInvoice(A.recep, inv.id);
    expect(d.collectedMinor).toBe(ok * 20000); expect(d.collectedMinor).toBeLessThanOrEqual(50000); expect(ok).toBeGreaterThanOrEqual(1); expect(ok).toBeLessThanOrEqual(2);
    expect(d.payments).toHaveLength(ok); expect(new Set(d.payments.map((p) => p.paymentNumber)).size).toBe(ok);
  });
  it("who may take payments", async () => {
    const inv = await issued(A);
    for (const w of [A.doctor, A.nurse, A.lab, A.superAdmin]) expect(await code(pay(w, inv.id, 100))).toBe("FORBIDDEN");
    expect(await code(pay(B.recep, inv.id, 100))).toBe("NOT_FOUND");
    expect(await code(pay(A.admin, inv.id, 100))).toBe("ok");
  });
  it("receipts are clinic branded, escaped, private and show the remaining balance", async () => {
    const pid = await patient(A, `<script>alert(1)</script> Patient`);
    const inv = await issued(A, [{ serviceId: A.svc.CONS }], {}, pid);
    const p = await pay(A.recep, inv.id, 30000, { method: "UPI", transactionReference: `UTR-${key()}`, notes: "private-note" }) as { id: string };
    const doc = await receiptDocument(A.recep, p.id);
    const { body } = renderReceipt(doc);
    expect(body).toContain("Bill Clinic a"); expect(body).toContain("&lt;script&gt;"); expect(body).not.toContain("<script>"); expect(body.toLowerCase()).not.toContain("mecgura"); expect(body).toContain("₹200.00"); expect(body).not.toContain("private-note");
    expect(doc).toMatchObject({ balanceMinor: 20000, amountMinor: 30000 });
    expect(renderInvoice(await invoiceDocument(A.recep, inv.id)).body).toContain("Payments");
    for (const w of [A.doctor, A.nurse, A.lab, A.superAdmin]) { expect(await code(receiptDocument(w, p.id))).toBe("FORBIDDEN"); expect(await code(invoiceDocument(w, inv.id))).toBe("FORBIDDEN"); }
    expect(await code(receiptDocument(B.admin, p.id))).toBe("NOT_FOUND"); expect(await code(invoiceDocument(B.admin, inv.id))).toBe("NOT_FOUND");
    const dr = await draft(A, [{ serviceId: A.svc.CONS }]); expect(await code(invoiceDocument(A.recep, dr.id))).toBe("CONFLICT");
    await recordDocAccess(A.recep, "receipt", p.id, "PRINTED");
    expect(await db.auditLog.count({ where: { tenantId: A.id, entityId: p.id, action: "billing.document_printed" } })).toBe(1);
    expect(await db.auditLog.count({ where: { tenantId: A.id, entityId: p.id, action: "billing.payment_recorded" } })).toBe(1);
    expect(JSON.stringify(await db.auditLog.findMany({ where: { tenantId: A.id, entityId: p.id } }))).not.toContain("private-note");
  });
  it("cancelling a payment re-opens the balance; refunded payments can't be cancelled", async () => {
    const inv = await issued(A); const p = await pay(A.recep, inv.id, 50000) as { id: string };
    expect(await code(cancelPayment(A.recep, p.id, { reason: "typo" }))).toBe("FORBIDDEN");
    await cancelPayment(A.accountant, p.id, { reason: "Entered twice" });
    expect(await getInvoice(A.recep, inv.id)).toMatchObject({ status: "ISSUED", collectedMinor: 0, dueMinor: 50000 });
    expect(await code(cancelPayment(A.accountant, p.id, { reason: "again" }))).toBe("CONFLICT");
    expect(await code(receiptDocument(A.recep, p.id))).toBe("CONFLICT");
    expect((await listPayments(A.recep, { status: "CANCELLED" })).rows.some((r) => r.id === p.id)).toBe(true);
  });
  it("cashier sessions (optional): cash needs an open session, closing computes the expected cash", async () => {
    expect((await currentSession(A.recep)).enabled).toBe(false);
    expect(await code(openSession(A.recep, { openingMinor: 1000 }))).toBe("CONFLICT");
    await settings(A, { useCashierSessions: true });
    const inv = await issued(A);
    expect(await code(pay(A.recep, inv.id, 1000, { method: "CASH" }))).toBe("CONFLICT");
    expect(await code(pay(A.recep, inv.id, 1000, { method: "UPI", transactionReference: `U-${key()}` }))).toBe("ok");
    await openSession(A.recep, { openingMinor: 10000 });
    expect(await code(openSession(A.recep, { openingMinor: 0 }))).toBe("CONFLICT");
    await pay(A.recep, inv.id, 5000, { method: "CASH" });
    expect(await code(closeSession(A.recep, {}))).toBe("VALIDATION_ERROR");
    expect(await closeSession(A.recep, { closingMinor: 14000 })).toEqual({ expectedMinor: 15000, closingMinor: 14000, differenceMinor: -1000 });
    expect((await currentSession(A.recep)).session).toBeNull();
    await settings(A, { useCashierSessions: false });
  });
});

describe("refunds (14–17, 37–41)", () => {
  async function paid(t: T, amount = 100000) { const inv = await issued(t, [{ serviceId: t.svc.PROC }], {}); void amount; const p = await pay(t.recep, inv.id, 118000) as { id: string }; return { inv, p }; }
  it("request → approve → process updates payment, invoice and receipts", async () => {
    const { inv, p } = await paid(A);
    const rq = await requestRefund(A.recep, { paymentId: p.id, amountMinor: 18000, reason: "Service not provided" }) as { id: string; refundNumber: string };
    expect(rq.refundNumber).toMatch(/^REF-\d{4}-\d{6}$/);
    expect(await getInvoice(A.recep, inv.id)).toMatchObject({ status: "PAID", collectedMinor: 118000, refundedMinor: 0 }); // nothing moves on request
    expect(await code(refundAction(A.recep, rq.id, { action: "approve" }))).toBe("FORBIDDEN");
    expect(await code(refundAction(A.accountant, rq.id, { action: "process" }))).toBe("CONFLICT"); // not approved yet
    expect(await code(refundAction(A.accountant, rq.id, { action: "approve" }))).toBe("FORBIDDEN"); // approving is an admin power
    expect(await code(refundAction(A.admin, rq.id, { action: "approve" }))).toBe("ok");
    expect(await code(refundAction(A.admin, rq.id, { action: "approve" }))).toBe("CONFLICT");
    expect(await code(refundAction(A.recep, rq.id, { action: "process" }))).toBe("FORBIDDEN");
    expect(await code(refundAction(A.accountant, rq.id, { action: "process", reference: "bank-ref-1" }))).toBe("ok");
    expect(await code(refundAction(A.accountant, rq.id, { action: "process" }))).toBe("CONFLICT");
    const d = await getInvoice(A.recep, inv.id);
    expect(d).toMatchObject({ status: "PARTIALLY_REFUNDED", collectedMinor: 118000, refundedMinor: 18000, paidMinor: 100000, dueMinor: 0 });
    expect(d.payments[0]).toMatchObject({ status: "PARTIALLY_REFUNDED", refundedMinor: 18000, refundableMinor: 100000 });
    const doc = await refundReceiptDocument(A.recep, rq.id);
    expect(renderRefundReceipt(doc).body).toContain("₹180.00");
    expect(await code(receiptDocument(A.recep, p.id))).toBe("ok");
    // refund the rest → REFUNDED
    const rq2 = await requestRefund(A.recep, { paymentId: p.id, amountMinor: 100000, reason: "Rest" }) as { id: string };
    await refundAction(A.admin, rq2.id, { action: "approve" }); await refundAction(A.admin, rq2.id, { action: "process" });
    expect(await getInvoice(A.recep, inv.id)).toMatchObject({ status: "REFUNDED", paidMinor: 0 });
    expect((await db.payment.findUniqueOrThrow({ where: { id: p.id } })).status).toBe("REFUNDED");
    for (const a of ["REFUND_REQUESTED", "REFUND_APPROVED", "REFUND_PROCESSED"]) expect(await db.auditLog.count({ where: { tenantId: A.id, entityId: rq.id, action: `billing.${a.toLowerCase()}` } })).toBe(1);
  });
  it("limits: never above the payment, never twice, no self-approval unless configured, rejects and cancels", async () => {
    const { inv, p } = await paid(A);
    expect(await code(requestRefund(A.recep, { paymentId: p.id, amountMinor: 118001, reason: "Too much" }))).toBe("VALIDATION_ERROR");
    for (const a of [0, -1]) expect(await code(requestRefund(A.recep, { paymentId: p.id, amountMinor: a, reason: "Bad" }))).toBe("VALIDATION_ERROR");
    expect(await code(requestRefund(A.recep, { paymentId: p.id, amountMinor: 100, reason: "" }))).toBe("VALIDATION_ERROR");
    const r1 = await requestRefund(A.recep, { paymentId: p.id, amountMinor: 100000, reason: "Part" }) as { id: string };
    expect(await code(requestRefund(A.recep, { paymentId: p.id, amountMinor: 20000, reason: "Too much in total" }))).toBe("VALIDATION_ERROR");
    expect(await code(requestRefund(A.doctor, { paymentId: p.id, amountMinor: 100, reason: "Doctor" }))).toBe("FORBIDDEN");
    expect(await code(requestRefund(B.recep, { paymentId: p.id, amountMinor: 100, reason: "Foreign" }))).toBe("NOT_FOUND");
    const adminReq = await requestRefund(A.admin, { paymentId: p.id, amountMinor: 1000, reason: "Admin asks" }) as { id: string };
    expect(await code(refundAction(A.admin, adminReq.id, { action: "approve" }))).toBe("FORBIDDEN"); // can't approve own
    await settings(A, { refundSelfApproval: true });
    expect(await code(refundAction(A.admin, adminReq.id, { action: "approve" }))).toBe("ok");
    await settings(A, { refundSelfApproval: false });
    expect(await code(refundAction(A.admin, r1.id, { action: "reject" }))).toBe("VALIDATION_ERROR");
    expect(await code(refundAction(A.admin, r1.id, { action: "reject", reason: "Not valid" }))).toBe("ok");
    expect(await code(refundAction(A.admin, r1.id, { action: "approve" }))).toBe("CONFLICT");
    expect(await code(refundAction(A.recep, adminReq.id, { action: "cancel" }))).toBe("FORBIDDEN");
    expect(await code(refundAction(A.admin, adminReq.id, { action: "cancel" }))).toBe("ok");
    expect(await code(cancelInvoice(A.accountant, inv.id, { reason: "paid invoice" }))).toBe("CONFLICT");
    expect(await code(refundReceiptDocument(A.recep, r1.id))).toBe("CONFLICT");
    expect((await listRefunds(A.recep, { status: "REJECTED" })).rows.some((r) => r.id === r1.id)).toBe(true);
  });
  it("concurrent processing of the same approved refund happens once", async () => {
    const { inv, p } = await paid(A);
    const r = await requestRefund(A.recep, { paymentId: p.id, amountMinor: 50000, reason: "Race" }) as { id: string };
    await refundAction(A.admin, r.id, { action: "approve" });
    const rs = await Promise.all([code(refundAction(A.accountant, r.id, { action: "process" })), code(refundAction(A.admin, r.id, { action: "process" })), code(refundAction(A.accountant, r.id, { action: "process" }))]);
    expect(rs.filter((x) => x === "ok")).toHaveLength(1);
    expect((await getInvoice(A.recep, inv.id)).refundedMinor).toBe(50000);
  });
  it("refunds are tenant isolated", async () => {
    const { p } = await paid(A);
    const r = await requestRefund(A.recep, { paymentId: p.id, amountMinor: 100, reason: "Iso" }) as { id: string };
    for (const w of [B.admin, B.accountant]) { expect(await code(refundAction(w, r.id, { action: "approve" }))).toBe("NOT_FOUND"); expect(await code(refundAction(w, r.id, { action: "process" }))).toBe("NOT_FOUND"); }
    expect((await listRefunds(B.admin, {})).rows.some((x) => x.id === r.id)).toBe(false);
  });
});

describe("cancellation, outstanding, overdue (18, 42–43)", () => {
  it("drafts cancel freely; issued invoices need finance rights and no payments", async () => {
    const d = await draft(A, [{ serviceId: A.svc.CONS }]);
    expect(await code(cancelInvoice(A.recep, d.id, {}))).toBe("VALIDATION_ERROR");
    expect(await code(cancelInvoice(A.recep, d.id, { reason: "Entered by mistake" }))).toBe("ok");
    expect(await code(cancelInvoice(A.recep, d.id, { reason: "again" }))).toBe("CONFLICT");
    expect(await code(issueInvoice(A.recep, d.id))).toBe("CONFLICT");
    const i = await issued(A);
    expect(await code(cancelInvoice(A.recep, i.id, { reason: "no rights" }))).toBe("FORBIDDEN");
    await pay(A.recep, i.id, 100);
    expect(await code(cancelInvoice(A.accountant, i.id, { reason: "has payment" }))).toBe("CONFLICT");
    const j = await issued(A);
    expect(await code(cancelInvoice(A.accountant, j.id, { reason: "Wrong patient" }))).toBe("ok");
    expect(await getInvoice(A.recep, j.id)).toMatchObject({ status: "CANCELLED", dueMinor: 0 });
    expect(await code(pay(A.recep, j.id, 100))).toBe("CONFLICT");
    expect(renderInvoice(await invoiceDocument(A.recep, j.id)).body).toContain("CANCELLED");
  });
  it("outstanding and overdue are computed from due dates and real balances", async () => {
    const o = await issued(A, [{ serviceId: A.svc.CONS }], { dueDate: addDays(today(), -3) });
    const f = await issued(A, [{ serviceId: A.svc.CONS }], { dueDate: addDays(today(), 10) });
    await pay(A.recep, f.id, 50000);
    const out = await listInvoices(A.recep, { outstanding: true });
    expect(out.rows.find((r) => r.id === o.id)).toMatchObject({ displayStatus: "OVERDUE", dueMinor: 50000, status: "ISSUED" });
    expect(out.rows.some((r) => r.id === f.id)).toBe(false); // fully paid → not outstanding
    expect((await listInvoices(A.recep, { status: "OVERDUE" })).rows.map((r) => r.id)).toContain(o.id);
    expect((await listInvoices(A.recep, { status: "OVERDUE" })).rows.every((r) => r.displayStatus === "OVERDUE")).toBe(true);
    const s = await statementDocument(A.recep, (await getInvoice(A.recep, o.id)).patient!.id);
    expect(s.invoices).toHaveLength(1); expect(renderStatement(s).body).toContain("Total outstanding");
    expect(await code(statementDocument(B.admin, (await getInvoice(A.recep, o.id)).patient!.id))).toBe("NOT_FOUND");
  });
  it("search, filters and pagination are server-side", async () => {
    const pid = await patient(A, "Findable Fiona");
    const inv = await issued(A, [{ serviceId: A.svc.LAB }], {}, pid);
    const ref = `FIND-${key()}`; const p = await pay(A.recep, inv.id, 10000, { method: "UPI", transactionReference: ref }) as { id: string };
    const rec = (await db.payment.findUniqueOrThrow({ where: { id: p.id } })).receiptNumber!;
    for (const q of ["Findable", inv.invoiceNumber, ref, rec]) expect((await listInvoices(A.recep, { q })).rows.map((r) => r.id)).toContain(inv.id);
    expect((await listInvoices(A.recep, { q: "Findable", method: "CARD" })).rows).toHaveLength(0);
    expect((await listInvoices(A.recep, { q: "Findable", serviceId: A.svc.LAB })).rows).toHaveLength(1);
    expect((await listInvoices(A.recep, { q: "Findable", serviceId: A.svc.CONS })).rows).toHaveLength(0);
    expect((await listPayments(A.recep, { q: ref })).rows).toHaveLength(1);
    for (let i = 0; i < 21; i++) await draft(A, [{ serviceId: A.svc.CONS }]);
    const p1 = await listInvoices(A.admin, { page: 1 }); const p2 = await listInvoices(A.admin, { page: 2 });
    expect(p1.rows.length).toBe(20); expect(p2.rows.length).toBeGreaterThan(0); expect(p1.rows.some((r) => p2.rows.map((x) => x.id).includes(r.id))).toBe(false);
    expect((await listInvoices(B.admin, { q: "Findable" })).rows).toHaveLength(0);
  });
});

describe("access control and tenant isolation (19–21)", () => {
  it("clinic B can't read or change anything of clinic A", async () => {
    const inv = await issued(A); const p = await pay(A.recep, inv.id, 1000) as { id: string };
    for (const w of [B.admin, B.accountant, B.recep]) {
      expect(await code(getInvoice(w, inv.id))).toBe("NOT_FOUND"); expect(await code(issueInvoice(w, inv.id))).toBe("NOT_FOUND"); expect(await code(cancelInvoice(w, inv.id, { reason: "attack" }))).toBe("NOT_FOUND");
      expect(await code(pay(w, inv.id, 100))).toBe("NOT_FOUND"); expect(["NOT_FOUND", "FORBIDDEN"]).toContain(await code(cancelPayment(w, p.id, { reason: "attack" })));
    }
    expect((await listInvoices(B.admin, {})).rows.map((r) => r.id)).not.toContain(inv.id);
    expect((await listPayments(B.admin, {})).rows.map((r) => r.id)).not.toContain(p.id);
    expect(await code(createInvoice(B.recep, { patientId: (await getInvoice(A.recep, inv.id)).patient!.id, items: [{ serviceId: B.svc.CONS }] }))).toBe("NOT_FOUND");
    expect(await code(patientBilling(B.admin, (await getInvoice(A.recep, inv.id)).patient!.id))).toBe("NOT_FOUND");
    expect((await billingDashboard(B.admin)).recent.every((r) => r.invoiceId !== inv.id)).toBe(true);
    expect((await financialReport(B.admin, { from: addDays(today(), -1), to: today() })).summary.invoiceCount).toBe((await db.invoice.count({ where: { tenantId: B.id, status: { in: ["ISSUED", "PARTIALLY_PAID", "PAID", "REFUNDED", "PARTIALLY_REFUNDED"] }, invoiceDate: { gte: addDays(today(), -1), lte: today() } } })));
  });
  it("roles: doctors see only their own consultation billing status; nurse/lab/platform admin nothing", async () => {
    const c = await consult(A);
    const d = await createInvoice(A.recep, { patientId: c.patientId, consultationId: c.id, items: [{ serviceId: A.svc.CONS }] }) as { id: string };
    await issueInvoice(A.recep, d.id);
    expect(await billingStatusFor(A.doctor, "consultation", c.id)).toMatchObject({ status: "UNPAID", invoiceId: null });
    expect((await billingStatusFor(A.doctor2, "consultation", c.id)).status).toBe("NOT_BILLED");
    expect(await code(getInvoice(A.doctor, d.id))).toBe("ok"); expect(await code(getInvoice(A.doctor2, d.id))).toBe("NOT_FOUND");
    expect((await getInvoice(A.doctor, d.id)).patient).toBeNull(); expect((await getInvoice(A.doctor, d.id)).can.collect).toBe(false);
    expect(await code(listInvoices(A.doctor, {}))).toBe("ok"); expect((await listInvoices(A.doctor, {})).rows.every((r) => r.patient === null)).toBe(true);
    for (const w of [A.doctor]) { expect(await code(billingDashboard(w))).toBe("FORBIDDEN"); expect(await code(invoiceDocument(w, d.id))).toBe("FORBIDDEN"); expect(await code(listPayments(w, {}))).toBe("FORBIDDEN"); }
    for (const w of [A.nurse, A.lab, A.superAdmin]) { expect(await code(listInvoices(w, {}))).toBe("FORBIDDEN"); expect(await code(billingStatusFor(w, "consultation", c.id))).toBe("FORBIDDEN"); expect(await code(billingDashboard(w))).toBe("FORBIDDEN"); }
    expect(await code(financialReport(A.recep, {}))).toBe("FORBIDDEN"); // reports are finance staff
    expect(await code(exportReport(A.recep, "collection", {}))).toBe("FORBIDDEN");
  });
});

describe("dashboard, reports and export (29–30, 52–56)", () => {
  it("dashboard numbers equal the database; cancelled payments and drafts are excluded; refunds are separate", async () => {
    const before = await billingDashboard(A.admin);
    const inv = await issued(A, [{ serviceId: A.svc.CONS }]);
    const p1 = await pay(A.recep, inv.id, 20000, { method: "CASH" }) as { id: string }; const p2 = await pay(A.recep, inv.id, 10000, { method: "UPI", transactionReference: `D-${key()}` }) as { id: string };
    await cancelPayment(A.accountant, p2.id, { reason: "Wrong entry" });
    await draft(A, [{ serviceId: A.svc.CONS }]);
    const after = await billingDashboard(A.admin);
    expect(after.todaysRevenue - before.todaysRevenue).toBe(50000);
    expect(after.todaysCollections - before.todaysCollections).toBe(20000);
    expect(after.pendingMinor - before.pendingMinor).toBe(30000);
    expect(after.invoicesToday - before.invoicesToday).toBe(2); expect(after.outstandingInvoices - before.outstandingInvoices).toBe(1);
    const open = await db.invoice.findMany({ where: { tenantId: A.id, status: { in: ["ISSUED", "PARTIALLY_PAID"] }, dueMinor: { gt: 0 } } });
    expect(after.pendingMinor).toBe(open.reduce((a, i) => a + i.dueMinor, 0));
    const rq = await requestRefund(A.recep, { paymentId: p1.id, amountMinor: 5000, reason: "Dashboard" }) as { id: string };
    await refundAction(A.admin, rq.id, { action: "approve" }); await refundAction(A.accountant, rq.id, { action: "process" });
    const fin = await billingDashboard(A.admin);
    expect(fin.refundsToday - after.refundsToday).toBe(5000); expect(fin.todaysCollections).toBe(after.todaysCollections);
    expect(after.recent.some((r) => r.id === p1.id)).toBe(true);
    expect((await billingDashboard(B.admin)).todaysCollections).toBe((await db.payment.findMany({ where: { tenantId: B.id, paymentDate: today() } })).reduce((a, p) => a + p.amountMinor, 0));
  });
  it("collection report by method with a date range; net = collected − refunded", async () => {
    const inv = await issued(A, [{ serviceId: A.svc.CONS }]);
    await pay(A.recep, inv.id, 10000, { method: "CHEQUE" });
    const r = await collectionReport(A.accountant, { from: today(), to: today() });
    const rows = await db.payment.findMany({ where: { tenantId: A.id, paymentDate: today(), status: { in: ["SUCCESS", "PARTIALLY_REFUNDED", "REFUNDED"] } } });
    expect(r.totalCollected).toBe(rows.reduce((a, p) => a + p.amountMinor, 0));
    expect(r.methods.find((m) => m.method === "CHEQUE")!.collectedMinor).toBe(rows.filter((p) => p.method === "CHEQUE").reduce((a, p) => a + p.amountMinor, 0));
    expect(r.netMinor).toBe(r.totalCollected - r.totalRefunded);
    expect((await collectionReport(A.accountant, { from: today(), to: today(), method: "CHEQUE" })).totalCollected).toBe(r.methods.find((m) => m.method === "CHEQUE")!.collectedMinor);
    expect(await code(collectionReport(A.accountant, { from: addDays(today(), 1), to: today() }))).toBe("VALIDATION_ERROR");
    expect(await code(collectionReport(A.accountant, { from: addDays(today(), -400), to: today() }))).toBe("VALIDATION_ERROR");
  });
  it("financial summary, outstanding, refund and service-wise reports use real rows; filters work", async () => {
    const rep = await financialReport(A.admin, { from: today(), to: today() });
    const billed = await db.invoice.findMany({ where: { tenantId: A.id, invoiceDate: today(), status: { in: ["ISSUED", "PARTIALLY_PAID", "PAID", "REFUNDED", "PARTIALLY_REFUNDED"] } } });
    expect(rep.summary.grossBilledMinor).toBe(billed.reduce((a, i) => a + i.totalMinor, 0)); expect(rep.summary.invoiceCount).toBe(billed.length);
    expect(rep.summary.netCollectionMinor).toBe(rep.summary.collectedMinor - rep.summary.refundedMinor);
    const lines = await db.invoiceItem.findMany({ where: { tenantId: A.id, invoice: { is: { invoiceDate: today(), status: { in: ["ISSUED", "PARTIALLY_PAID", "PAID", "REFUNDED", "PARTIALLY_REFUNDED"] } } } } });
    expect(rep.services.reduce((a, s) => a + s.totalMinor, 0)).toBe(lines.reduce((a, l) => a + l.lineTotalMinor, 0));
    const onlyLab = await financialReport(A.admin, { from: today(), to: today(), serviceId: A.svc.LAB });
    expect(onlyLab.services.every((s) => s.code === "LAB-001")).toBe(true);
    expect(rep.outstanding.every((o) => o.dueMinor > 0)).toBe(true);
    expect((await financialReport(A.admin, { from: today(), to: today(), doctorId: A.doctorId })).summary.invoiceCount).toBe(billed.filter((i) => i.doctorUserId === A.doctorId).length);
  });
  it("CSV export: finance rights only, audited, safe against formula injection, no clinical data", async () => {
    await expect(exportReport(A.recep, "outstanding", {})).rejects.toBeInstanceOf(AppError);
    const pid = await patient(A, "=cmd|' /C calc'!A0");
    await issued(A, [{ description: "=HYPERLINK(\"http://x\")", unitPriceMinor: 1000 }], {}, pid);
    const svcCsv = await exportReport(A.accountant, "services", { from: today(), to: today() });
    expect(svcCsv.csv).toContain("'=HYPERLINK"); expect(svcCsv.csv).not.toMatch(/\n=HYPERLINK/);
    expect(svcCsv.filename).toMatch(/^services-/);
    expect((await exportReport(A.admin, "outstanding", { from: today(), to: today() })).csv.split("\r\n")[0]).toBe("Invoice,Patient ID,Invoice date,Due date,Total,Due,Overdue");
    expect(await code(exportReport(A.accountant, "unknown", {}))).toBe("VALIDATION_ERROR");
    expect(await db.auditLog.count({ where: { tenantId: A.id, action: "billing.exported" } })).toBeGreaterThanOrEqual(2);
  });
});

describe("clinical integration and Patient 360 (25–28)", () => {
  it("billing status appears on consultation, appointment, investigation and follow-up without touching clinical flow", async () => {
    const c = await consult(A);
    expect((await billingStatusFor(A.recep, "consultation", c.id)).status).toBe("NOT_BILLED");
    const f = await createInvoiceFromSource(A.recep, { kind: "consultation", id: c.id }) as { id: string; existing: boolean };
    expect((await billingStatusFor(A.recep, "consultation", c.id)).status).toBe("DRAFT");
    expect(await createInvoiceFromSource(A.recep, { kind: "consultation", id: c.id })).toMatchObject({ id: f.id, existing: true }); // no duplicate
    const d = await getInvoice(A.recep, f.id);
    expect(d.items[0]).toMatchObject({ description: "Consultation", unitPriceMinor: 50000 }); expect((await getInvoice(A.admin, f.id)).links.consultationId).toBe(c.id); expect(d.doctorUserId).toBe(A.doctorId);
    await issueInvoice(A.recep, f.id);
    expect((await billingStatusFor(A.recep, "consultation", c.id)).status).toBe("UNPAID");
    await pay(A.recep, f.id, 20000); expect((await billingStatusFor(A.recep, "consultation", c.id)).status).toBe("PARTIALLY_PAID");
    await pay(A.recep, f.id, 30000); expect((await billingStatusFor(A.recep, "consultation", c.id))).toMatchObject({ status: "PAID", dueMinor: 0 });
    // the consultation is still fully workable while unpaid or paid (financial and clinical workflows are separate)
    const cur = await getConsultation(A.doctor, c.id); await patchConsultation(A.doctor, c.id, { rev: cur.rev, clinicalNotes: "n" }); await consultationAction(A.doctor, c.id, { action: "review" });
    expect(JSON.stringify(await getInvoice(A.recep, f.id))).not.toMatch(/clinicalNotes|diagnos/i);
    // appointment
    const pid = await patient(A);
    const appt = await createStaffAppointment(A.recep, { doctorUserId: A.doctorId, startsAt: slotAt(addDays(today(), 4), "10:00"), type: "FOLLOW_UP", patient: { patientId: pid, viaProfile: true } });
    expect((await billingStatusFor(A.recep, "appointment", appt.id)).status).toBe("NOT_BILLED");
    const ai = await createInvoiceFromSource(A.recep, { kind: "appointment", id: appt.id }) as { id: string };
    expect((await getInvoice(A.recep, ai.id)).items[0]).toMatchObject({ description: "Follow-up", unitPriceMinor: 30000, sourceType: "FOLLOW_UP" }); // follow-up price from configuration
    expect((await billingStatusFor(A.recep, "appointment", appt.id)).status).toBe("DRAFT");
  });
  it("investigation billing uses the investigation prices and never blocks the lab", async () => {
    const c = await consult(A);
    const o = await createInvestigationOrder(A.doctor, c.id, { investigationIds: [A.invId], priority: "NORMAL" }) as { id: string };
    expect((await billingStatusFor(A.accountant, "investigation", o.id)).status).toBe("NOT_BILLED");
    const inv = await createInvoiceFromSource(A.accountant, { kind: "investigation", id: o.id }) as { id: string; skipped: string[] };
    expect(await getInvoice(A.accountant, inv.id)).toMatchObject({ totalMinor: 35400, taxMinor: 5400 });
    expect((await db.investigationOrder.findUniqueOrThrow({ where: { id: o.id } })).status).toBe("ORDERED"); // still orderable/workable, no payment gate
    const other = await createInvestigationOrder(A.doctor, c.id, { investigationIds: [(await saveInvestigation(A.admin, null, { testCode: "UNPRICED", testName: "Unpriced test", category: "Pathology" })).id], priority: "NORMAL" }) as { id: string };
    expect(await code(createInvoiceFromSource(A.accountant, { kind: "investigation", id: other.id }))).toBe("VALIDATION_ERROR"); // not in the price list
  });
  it("automatic draft invoices exist only when the clinic switches them on, and are never issued or paid", async () => {
    const c0 = await consult(A);
    expect(await db.invoice.count({ where: { tenantId: A.id, consultationId: c0.id } })).toBe(0);
    await autoBill(A.doctor, "consultation", c0.id);
    expect(await db.invoice.count({ where: { tenantId: A.id, consultationId: c0.id } })).toBe(0); // off by default
    await settings(A, { autoBillConsultation: true, autoBillInvestigation: true, autoBillFollowUp: true });
    const c = await consult(A);
    const cur = await getConsultation(A.doctor, c.id);
    await patchConsultation(A.doctor, c.id, { rev: cur.rev, chiefComplaints: [{ text: "Cough" }], clinicalNotes: "n" });
    await consultationAction(A.doctor, c.id, { action: "review" }); await consultationAction(A.doctor, c.id, { action: "finalize", confirm: true });
    const rows = await db.invoice.findMany({ where: { tenantId: A.id, consultationId: c.id } });
    expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({ status: "DRAFT", collectedMinor: 0, totalMinor: 50000 }); expect(rows[0].issuedAt).toBeNull();
    await autoBill(A.doctor, "consultation", c.id); expect(await db.invoice.count({ where: { tenantId: A.id, consultationId: c.id } })).toBe(1); // idempotent
    const o = await createInvestigationOrder(A.doctor, c.id, { investigationIds: [A.invId], priority: "NORMAL" }) as { id: string };
    expect(await db.invoice.count({ where: { tenantId: A.id, investigationOrderId: o.id, status: "DRAFT" } })).toBe(1);
    const pid = await patient(A);
    const fu = await createFollowUp(A.recep, { patientId: pid, title: "Come back", afterDays: 3 }) as { id: string };
    const ap = await createStaffAppointment(A.recep, { doctorUserId: A.doctorId, startsAt: slotAt(addDays(today(), 5), "11:00"), type: "FOLLOW_UP", patient: { patientId: pid, viaProfile: true }, followUpId: fu.id });
    void ap; void linkAppointment;
    const fi = await db.invoice.findMany({ where: { tenantId: A.id, followUpId: fu.id } });
    expect(fi).toHaveLength(1); expect(fi[0]).toMatchObject({ status: "DRAFT", totalMinor: 30000 });
    await settings(A, { autoBillConsultation: false, autoBillInvestigation: false, autoBillFollowUp: false });
  });
  it("Patient 360 shows invoices, payments, receipts, refunds and outstanding; timeline events carry no clinical text", async () => {
    const pid = await patient(A, "Timeline Billing");
    const inv = await issued(A, [{ serviceId: A.svc.CONS }], {}, pid); const p = await pay(A.recep, inv.id, 20000) as { id: string };
    const rq = await requestRefund(A.recep, { paymentId: p.id, amountMinor: 5000, reason: "Overcharged" }) as { id: string };
    await refundAction(A.admin, rq.id, { action: "approve" }); await refundAction(A.accountant, rq.id, { action: "process" });
    const b = await patientBilling(A.recep, pid);
    expect(b.outstandingMinor).toBe(30000); expect(b.invoices).toHaveLength(1); expect(b.payments[0]).toMatchObject({ amountMinor: 20000 }); expect(b.refunds[0]).toMatchObject({ status: "PROCESSED", amountMinor: 5000 });
    const tl = await billingTimeline(A.recep, pid);
    expect(tl.map((e) => e.type)).toEqual(expect.arrayContaining(["INVOICE_CREATED", "INVOICE_ISSUED", "PAYMENT_RECEIVED", "REFUND_REQUESTED", "REFUND_PROCESSED"]));
    expect(JSON.stringify(tl)).not.toContain("Overcharged");
    expect(await billingTimeline(A.nurse, pid)).toEqual([]); expect(await billingTimeline(B.admin, pid)).toEqual([]); expect(await billingTimeline(A.superAdmin, pid)).toEqual([]);
    expect(await code(patientBilling(A.doctor, pid))).toBe("FORBIDDEN");
    const rows = await db.auditLog.findMany({ where: { tenantId: A.id, entityId: { in: [inv.id, p.id, rq.id] } } });
    expect(rows.map((r) => r.action)).toEqual(expect.arrayContaining(["billing.invoice_created", "billing.invoice_issued", "billing.payment_recorded", "billing.refund_requested", "billing.refund_approved", "billing.refund_processed"]));
  });
});
