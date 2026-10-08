import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { addDays, todayIn, zonedToUtc } from "@/lib/scheduling/time";
import { asTenant, ctxFor, makeUser, seedSystemData, uniq } from "@/test/helpers";
import type { RoleKey } from "@/lib/permissions";
import { clearAnalyticsCache } from "./analytics-core";
import { appointmentAnalytics, doctorAnalytics, followUpAnalytics, opdAnalytics, patientAnalytics } from "./analytics-people";
import { clinicalAnalytics, labAnalytics } from "./analytics-clinical";
import { billingAnalytics, communicationAnalytics, pharmacyAnalytics } from "./analytics-business";
import { clinicInsights, commandCenter, getAnalyticsSettings, operationsScorecard, platformAnalytics, updateAnalyticsSettings } from "./analytics-command";
import { deleteSchedule, exportReport, listSchedules, reportCatalog, reportKeys, runReport, saveSchedule } from "./analytics-reports";

process.env.ANALYTICS_CACHE_TTL_MS = "0";
const TZ = "Asia/Kolkata";
const code = (p: Promise<unknown>) => p.then(() => "ok", (e) => (e instanceof AppError ? e.code : `ERR:${e}`));
const text = async (p: ReturnType<typeof exportReport>) => (await p).chunks.map((c) => (typeof c === "string" ? c : "")).join("");
const TODAY = todayIn(TZ); const D1 = addDays(TODAY, -1); const D2 = addDays(TODAY, -2);
const at = (date: string, hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return zonedToUtc(date, h * 60 + m, TZ); };
const Q = { preset: "last7" };
let seq = 0; const n = () => ++seq;

type Ctx = ReturnType<typeof asTenant>;
interface T { id: string; ctx: Record<string, Ctx>; d1: string; d2: string; adminId: string; pat: string[]; appt: string[] }
const ROLES_USED: RoleKey[] = ["CLINIC_ADMIN", "DOCTOR", "RECEPTIONIST", "NURSE", "LAB_STAFF", "ACCOUNTANT", "PHARMACY_MANAGER", "PHARMACY_STAFF", "COMPOUNDER", "STAFF"];

async function mkTenant(label: string): Promise<T> {
  const t = await db.tenant.create({ data: { name: `Analytics ${label}`, slug: uniq(`an-${label}`).slice(0, 30), status: "ACTIVE", timezone: TZ } });
  const ctx: Record<string, Ctx> = {}; let d1 = ""; let d2 = ""; let adminId = "";
  for (const role of ROLES_USED) {
    const { user } = await makeUser(role, t.id); ctx[role] = asTenant({ ...ctxFor(user, role, t.id), tenant: { id: t.id, name: `Analytics ${label}`, timezone: TZ } as never });
    if (role === "DOCTOR") d1 = user.id; if (role === "CLINIC_ADMIN") adminId = user.id;
  }
  const doc2 = await makeUser("DOCTOR", t.id); d2 = doc2.user.id; ctx.DOCTOR2 = asTenant({ ...ctxFor(doc2.user, "DOCTOR", t.id), tenant: { id: t.id, name: `Analytics ${label}`, timezone: TZ } as never });
  const pt = await makeUser("PATIENT", null); ctx.PATIENT = asTenant({ ...ctxFor(pt.user, "PATIENT", t.id), tenant: { id: t.id, name: `Analytics ${label}`, timezone: TZ } as never });
  return { id: t.id, ctx, d1, d2, adminId, pat: [], appt: [] };
}

const longAgo = new Date(Date.now() - 90 * 86400000);
async function seedClinicA(t: T) {
  const mk = async (name: string, gender: string | null, extra: Record<string, unknown>, createdAt: Date) =>
    (await db.patient.create({ data: { tenantId: t.id, code: `${t.id.slice(-4)}-P${n()}`, name, gender, createdAt, ...extra } })).id;
  t.pat = [
    await mk("Old Man", "MALE", { dateOfBirth: new Date("1950-02-02T00:00:00Z"), city: "Delhi" }, longAgo),
    await mk("Teen Girl", "FEMALE", { dateOfBirth: new Date("2010-05-01T00:00:00Z"), city: "Delhi" }, longAgo),
    await mk("=cmd|' /C calc'!A0", "MALE", { dateOfBirth: new Date("1990-01-01T00:00:00Z"), city: "Delhi" }, new Date()),
    await mk("Baby Boy", "FEMALE", { dateOfBirth: new Date("2022-01-01T00:00:00Z"), city: "Pune" }, new Date()),
    await mk("Senior Lady", "OTHER", { ageYears: 70, city: "Pune" }, new Date()),
    await mk("No Details", null, {}, new Date()),
  ];
  const ap = async (doctor: string, status: string, patientId: string, extra: Record<string, unknown> = {}, date = D1, time = "09:00") => {
    const s = at(date, time); return (await db.appointment.create({ data: { tenantId: t.id, publicId: uniq("ap"), doctorUserId: doctor, patientId, type: "OPD", source: "RECEPTION", status, startsAt: s, endsAt: new Date(s.getTime() + 900000), ...extra } })).id;
  };
  const done = { confirmedAt: at(D1, "08:00"), checkedInAt: at(D1, "09:05"), startedAt: at(D1, "09:15"), completedAt: at(D1, "09:30") };
  t.appt = [
    await ap(t.d1, "COMPLETED", t.pat[0], done, D1, "09:00"), await ap(t.d1, "COMPLETED", t.pat[2], done, D1, "09:30"), await ap(t.d1, "COMPLETED", t.pat[3], done, D1, "10:00"),
    await ap(t.d1, "CANCELLED", t.pat[1], { cancelledAt: at(D1, "07:00"), cancellationReason: "Patient travelling" }, D1, "10:30"), await ap(t.d1, "NO_SHOW", t.pat[4], { noShowAt: at(D1, "12:00") }, D1, "11:00"),
    await ap(t.d2, "COMPLETED", t.pat[1], done, D1, "09:00"), await ap(t.d2, "CANCELLED", t.pat[5], { cancelledAt: at(D1, "07:00") }, D1, "09:30"), await ap(t.d2, "NO_SHOW", t.pat[5], { noShowAt: at(D1, "12:00") }, D1, "10:00"),
  ];
  await db.auditLog.create({ data: { tenantId: t.id, action: "appointment.rescheduled", entityType: "appointment", entityId: t.appt[0] } });
  // OPD: waits 10/20/30 min, one negative (excluded), one never called
  const visit = async (doctor: string, patientId: string, c: string, called: string | null, started: string | null, completed: string | null, status: string) =>
    (await db.opdVisit.create({ data: { tenantId: t.id, patientId, doctorUserId: doctor, tokenDate: D1, tokenNumber: n(), tokenLabel: `T${seq}`, publicToken: uniq("tok"), queueSeq: seq, status, checkedInAt: at(D1, c), calledAt: called ? at(D1, called) : null, startedAt: started ? at(D1, started) : null, completedAt: completed ? at(D1, completed) : null } })).id;
  const v = [
    await visit(t.d1, t.pat[0], "09:00", "09:10", "09:10", "09:25", "COMPLETED"), await visit(t.d1, t.pat[2], "09:30", "09:50", "09:50", "10:15", "COMPLETED"), await visit(t.d2, t.pat[1], "10:00", "10:30", "10:30", "10:35", "COMPLETED"),
    await visit(t.d2, t.pat[3], "11:00", "10:50", null, null, "COMPLETED"), await visit(t.d2, t.pat[4], "11:30", null, null, null, "WAITING"),
  ];
  // follow-ups
  const fu = (doctor: string | null, patientId: string, status: string, dueDate: string, extra: Record<string, unknown> = {}) => db.followUp.create({ data: { tenantId: t.id, followUpNumber: `FU-${t.id.slice(-4)}-${n()}`, patientId, doctorUserId: doctor, type: "CONSULTATION_FOLLOW_UP", title: "Follow up", dueDate, status, createdById: t.adminId, ...extra } });
  await fu(t.d1, t.pat[0], "COMPLETED", D1); await fu(t.d1, t.pat[2], "COMPLETED", D1); await fu(t.d1, t.pat[3], "CANCELLED", D1); await fu(t.d2, t.pat[1], "PENDING", D1); await fu(t.d2, t.pat[4], "NO_RESPONSE", D2); await fu(t.d1, t.pat[0], "PENDING", addDays(TODAY, -40));
  // consultations (+ diagnoses, prescriptions)
  const cons = async (vi: number, status: string, doctor: string, patientId: string, mins: number | null, followUp: boolean) => (await db.consultation.create({ data: { tenantId: t.id, number: `C-${t.id.slice(-4)}-${n()}`, patientId, doctorUserId: doctor, opdVisitId: v[vi], status, startedAt: at(D1, "10:00"), finalizedAt: mins ? new Date(at(D1, "10:00").getTime() + mins * 60000) : null, followUpRequired: followUp } })).id;
  const c1 = await cons(0, "FINALIZED", t.d1, t.pat[0], 20, true); const c2 = await cons(1, "FINALIZED", t.d1, t.pat[2], 40, false); await cons(2, "IN_PROGRESS", t.d2, t.pat[1], null, false);
  const dx = (cid: string, pid: string, name: string, code: string | null) => db.consultationDiagnosis.create({ data: { tenantId: t.id, consultationId: cid, patientId: pid, name, code, createdById: t.d1 } });
  await dx(c1, t.pat[0], "Hypertension", "I10"); await dx(c2, t.pat[2], "Hypertension", "I10"); await dx(c2, t.pat[2], "Fever", null);
  const rx = async (cid: string, pid: string, items: string[]) => { const p = await db.prescription.create({ data: { tenantId: t.id, consultationId: cid, patientId: pid, doctorUserId: t.d1, status: "FINALIZED" } }); let i = 0; for (const name of items) await db.prescriptionItem.create({ data: { tenantId: t.id, prescriptionId: p.id, position: i++, name } }); };
  await rx(c1, t.pat[0], ["Paracetamol", "Amoxicillin"]); await rx(c2, t.pat[2], ["Paracetamol"]);
  // lab
  const order = async (status: string, orderedAt: Date, tests: string[]) => { const o = await db.investigationOrder.create({ data: { tenantId: t.id, orderNumber: `LAB-${t.id.slice(-4)}-${n()}`, patientId: t.pat[0], doctorUserId: t.d1, createdById: t.d1, status, orderedAt } }); for (const x of tests) await db.investigationOrderItem.create({ data: { tenantId: t.id, investigationOrderId: o.id, testNameSnapshot: x, snapshot: "{}" } }); return o.id; };
  const o1 = await order("DOCTOR_REVIEWED", at(D1, "09:00"), ["CBC"]); const o2 = await order("REPORT_GENERATED", at(D2, "09:00"), ["CBC", "LFT"]); const o3 = await order("SAMPLE_COLLECTED", at(D1, "11:00"), ["LFT"]);
  const rep = (oid: string, releasedAt: Date) => db.labReport.create({ data: { tenantId: t.id, reportNumber: `R-${t.id.slice(-4)}-${n()}`, investigationOrderId: oid, patientId: t.pat[0], doctorUserId: t.d1, generatedById: t.d1, status: "RELEASED", releasedAt } });
  await rep(o1, at(D1, "14:00")); await rep(o2, at(D1, "10:00"));
  const smp = (oid: string, status: string, extra: Record<string, unknown> = {}) => db.sample.create({ data: { tenantId: t.id, sampleNumber: `S-${n()}`, barcodeToken: uniq("bc"), investigationOrderId: oid, sampleType: "Blood", collectedById: t.d1, status, collectedAt: at(D1, "09:20"), ...extra } });
  await smp(o1, "RECEIVED", { receivedAt: at(D1, "09:30") }); await smp(o2, "RECEIVED", { receivedAt: at(D2, "10:00") }); await smp(o3, "COLLECTED"); await smp(o3, "REJECTED", { rejectedAt: at(D1, "11:30") });
  // billing
  const inv = async (status: string, doctor: string, sub: number, disc: number, tax: number, total: number, collected: number, dueDate: string | null, itemType: string, patientId: string) => {
    const i = await db.invoice.create({ data: { tenantId: t.id, invoiceNumber: `INV-${t.id.slice(-4)}-${n()}`, patientId, doctorUserId: doctor, invoiceDate: D1, status, subtotalMinor: sub, discountMinor: disc, taxMinor: tax, totalMinor: total, collectedMinor: collected, dueMinor: Math.max(0, total - collected), dueDate, discountReason: disc ? "Senior citizen" : null, discountById: disc ? t.adminId : null, createdById: t.adminId } });
    if (status !== "CANCELLED") await db.invoiceItem.create({ data: { tenantId: t.id, invoiceId: i.id, position: 0, descriptionSnapshot: itemType === "CONSULTATION" ? "Consultation" : itemType === "INVESTIGATION" ? "CBC" : "Minor procedure", serviceTypeSnapshot: itemType, quantity: 1, unitPriceMinor: sub, lineSubtotalMinor: sub, lineTotalMinor: total } });
    return i.id;
  };
  const i1 = await inv("ISSUED", t.d1, 10000, 0, 0, 10000, 0, addDays(TODAY, -5), "CONSULTATION", t.pat[0]);
  const i2 = await inv("PAID", t.d1, 10000, 0, 1800, 11800, 11800, null, "INVESTIGATION", t.pat[2]);
  const i3 = await inv("PARTIALLY_PAID", t.d2, 22000, 2000, 0, 20000, 5000, addDays(TODAY, 10), "PROCEDURE", t.pat[1]);
  await inv("CANCELLED", t.d2, 5000, 0, 0, 5000, 0, null, "CONSULTATION", t.pat[3]);
  const pay = (invoiceId: string, patientId: string, amount: number, method: string, status: string) => db.payment.create({ data: { tenantId: t.id, invoiceId, patientId, paymentNumber: `PAY-${t.id.slice(-4)}-${n()}`, amountMinor: amount, method, status, paymentDate: D1, receivedById: t.adminId } });
  const p1 = await pay(i2, t.pat[2], 11800, "CASH", "SUCCESS"); await pay(i3, t.pat[1], 5000, "UPI", "SUCCESS"); await pay(i1, t.pat[0], 3000, "CASH", "FAILED");
  const rf = (status: string, amount: number, processed: boolean) => db.refund.create({ data: { tenantId: t.id, invoiceId: i2, paymentId: p1.id, refundNumber: `REF-${t.id.slice(-4)}-${n()}`, amountMinor: amount, reason: "Duplicate charge", method: "CASH", status, requestedById: t.adminId, processedAt: processed ? new Date() : null } });
  await rf("PROCESSED", 1000, true); await rf("REQUESTED", 500, false);
  // pharmacy
  const med = (name: string, reorder: number) => db.medicine.create({ data: { tenantId: t.id, medicineCode: `M${n()}`, genericName: name, reorderLevel: reorder, minimumStock: 0, createdById: t.adminId } });
  const [m1, m2, m3] = [await med("Paracetamol", 10), await med("Amoxicillin", 5), await med("Cetirizine", 2)];
  const batch = (medicineId: string, qty: number, expiry: string, price = 100) => db.medicineBatch.create({ data: { tenantId: t.id, medicineId, batchNumber: `B${n()}`, expiryDate: expiry, quantityAvailable: qty, quantityReceived: qty, purchasePriceMinor: price } });
  const b1 = await batch(m1.id, 5, addDays(TODAY, 400)); await batch(m2.id, 0, addDays(TODAY, 400)); await batch(m3.id, 50, addDays(TODAY, 500)); await batch(m3.id, 3, addDays(TODAY, -1)); await batch(m3.id, 2, addDays(TODAY, 30));
  await db.stockTransaction.create({ data: { tenantId: t.id, medicineId: m1.id, batchId: b1.id, type: "DAMAGE", quantity: -2, balanceAfter: 5, createdById: t.adminId } });
  // communication
  const msg = (channel: string, status: string, extra: Record<string, unknown> = {}) => db.communicationMessage.create({ data: { tenantId: t.id, channel, eventType: "appointment.reminder", recipient: "+919999900000", body: "SECRET BODY", dedupeKey: uniq("dk"), status, patientId: t.pat[0], ...extra } });
  const sent = at(D1, "08:00");
  await msg("WHATSAPP", "SENT", { sentAt: sent }); await msg("WHATSAPP", "DELIVERED", { sentAt: sent, deliveredAt: sent }); await msg("WHATSAPP", "READ", { sentAt: sent, deliveredAt: sent, readAt: sent }); await msg("WHATSAPP", "FAILED", { failedAt: sent, failureCode: "PROVIDER_ERR" });
  await msg("SMS", "SENT", { sentAt: sent }); await msg("SMS", "FAILED", { failedAt: sent, failureCode: "NO_BALANCE" }); await msg("EMAIL", "DELIVERED", { sentAt: sent, deliveredAt: sent });
  for (let i = 0; i < 3; i++) await db.notification.create({ data: { tenantId: t.id, userId: t.adminId, type: "TEST", title: "n", readAt: i === 0 ? new Date() : null } });
  await db.notification.create({ data: { tenantId: t.id, userId: t.adminId, type: "TEST", title: "critical", priority: "CRITICAL" } });
}

async function seedClinicB(t: T) {
  const p = await db.patient.create({ data: { tenantId: t.id, code: "BPAT-0001", name: "Bravo Patient", gender: "MALE", city: "Mumbai", createdAt: new Date() } });
  for (let i = 0; i < 4; i++) { const s = at(D1, "11:00"); await db.appointment.create({ data: { tenantId: t.id, publicId: uniq("bap"), doctorUserId: t.d1, patientId: p.id, type: "OPD", source: "WEBSITE", status: "COMPLETED", startsAt: s, endsAt: new Date(s.getTime() + 900000) } }); }
  await db.invoice.create({ data: { tenantId: t.id, invoiceNumber: "BINV-0001", patientId: p.id, doctorUserId: t.d1, invoiceDate: D1, status: "ISSUED", subtotalMinor: 999999, totalMinor: 999999, dueMinor: 999999, createdById: t.adminId } });
  await db.communicationMessage.create({ data: { tenantId: t.id, channel: "SMS", eventType: "x", recipient: "b", body: "b", dedupeKey: uniq("dk"), status: "SENT", sentAt: new Date() } });
  const m = await db.medicine.create({ data: { tenantId: t.id, medicineCode: "BM1", genericName: "BravoMed", reorderLevel: 1, minimumStock: 0, createdById: t.adminId } });
  await db.medicineBatch.create({ data: { tenantId: t.id, medicineId: m.id, batchNumber: "BB1", expiryDate: addDays(TODAY, 300), quantityAvailable: 10, quantityReceived: 10, purchasePriceMinor: 0 } });
}

let A: T, B: T, Z: T;
beforeAll(async () => { await seedSystemData(); A = await mkTenant("a"); B = await mkTenant("b"); Z = await mkTenant("zero"); await seedClinicA(A); await seedClinicB(B); });
const admin = () => A.ctx.CLINIC_ADMIN;

describe("patient analytics", () => {
  it("counts new vs returning with distinct patients, demographics and retention", async () => {
    const r = await patientAnalytics(admin(), Q);
    expect(r.totals.patients).toBe(6); expect(r.totals.newPatients).toBe(4); expect(r.basis).toMatch(/All registered/);
    expect(r.totals.seenInRange).toBe(5); // p0,p1,p2,p3,p4 seen via OPD/consultation/completed appointments (p5 only cancelled/no-show)
    expect(r.totals.seenNew + r.totals.seenReturning).toBe(5); expect(r.totals.seenReturning).toBe(2); expect(r.totals.seenNew).toBe(3);
    expect(r.gender.find((g) => g.key === "Male")?.count).toBe(2); expect(r.gender.find((g) => g.key === "Not recorded")?.count).toBe(1);
    const ag = Object.fromEntries(r.ageGroups.map((g) => [g.key, g.count])); expect(ag["76+"]).toBe(1); expect(ag["13–18"]).toBe(1); expect(ag["31–45"]).toBe(1); expect(ag["0–12"]).toBe(1); expect(ag["61–75"]).toBe(1); expect(ag["Not recorded"]).toBe(1);
    expect(r.locations[0]).toMatchObject({ key: "Delhi", count: 3 }); expect(r.retention.ratePct).toBeNull(); // nobody was seen in the previous period
    expect(r.newTrend.reduce((a, d) => a + d.value, 0)).toBe(4); expect(r.meta.timezone).toBe(TZ); expect(r.meta.range.days).toBe(7);
  });
  it("retention counts people seen in both periods exactly once", async () => {
    const r = await patientAnalytics(admin(), { preset: "custom", from: D1, to: D1 }); // previous = D2
    expect(r.retention.previousSeen).toBe(0);
    await db.opdVisit.create({ data: { tenantId: A.id, patientId: A.pat[0], doctorUserId: A.d1, tokenDate: D2, tokenNumber: 9001, tokenLabel: "R1", publicToken: uniq("t"), queueSeq: 9001, status: "COMPLETED", checkedInAt: at(D2, "09:00") } });
    await db.opdVisit.create({ data: { tenantId: A.id, patientId: A.pat[0], doctorUserId: A.d1, tokenDate: D2, tokenNumber: 9002, tokenLabel: "R2", publicToken: uniq("t"), queueSeq: 9002, status: "COMPLETED", checkedInAt: at(D2, "10:00") } });
    await db.opdVisit.create({ data: { tenantId: A.id, patientId: A.pat[5], doctorUserId: A.d1, tokenDate: D2, tokenNumber: 9003, tokenLabel: "R3", publicToken: uniq("t"), queueSeq: 9003, status: "COMPLETED", checkedInAt: at(D2, "10:00") } });
    const r2 = await patientAnalytics(admin(), { preset: "custom", from: D1, to: D1 });
    expect(r2.retention).toMatchObject({ previousSeen: 2, retained: 1, ratePct: 50 }); // pat0 twice in prev counts once; pat0 seen again on D1, pat5 not
    await db.opdVisit.deleteMany({ where: { tenantId: A.id, tokenNumber: { in: [9001, 9002, 9003] } } });
  });
  it("comparison shows N/A when the previous period was empty", async () => {
    const r = await patientAnalytics(admin(), { ...Q, compare: "1" });
    expect(r.totals.newComparison).toMatchObject({ current: 4, previous: 0, pctTenths: null, state: "na" }); expect(r.meta.previous).toBeTruthy();
  });
});

describe("appointment analytics", () => {
  it("statuses, rates with stated denominators, funnel, reasons and reschedules", async () => {
    const r = await appointmentAnalytics(admin(), Q);
    expect(r.totals).toMatchObject({ total: 8, completed: 4, cancelled: 2, noShow: 2, due: 6 });
    expect(r.rates.noShowPct).toBe(33.3); expect(r.rates.cancellationPct).toBe(25); expect(r.rates.reschedulePct).toBe(12.5); expect(r.rescheduled).toBe(1);
    expect(r.funnel.map((f) => [f.key, f.count])).toEqual([["REQUESTED", 8], ["CONFIRMED", 4], ["CHECKED_IN", 4], ["IN_CONSULTATION", 4], ["COMPLETED", 4]]);
    expect(r.funnel[1].pctOfRequested).toBe(50); expect(r.funnel[4].pctOfPrevious).toBe(100);
    expect(r.cancellationReasons).toMatchObject({ recorded: 1, notRecorded: 1 }); expect(r.cancellationReasons.items[0].key).toBe("patient travelling");
    expect(r.statuses.map((s) => s.key)).toContain("NO_SHOW"); expect(r.hourly.reduce((a, h) => a + h.count, 0)).toBe(8); expect(r.sources[0].count).toBe(8);
  });
  it("uses distinct data per clinic and the clinic's day boundaries", async () => {
    const b = await appointmentAnalytics(B.ctx.CLINIC_ADMIN, Q); expect(b.totals.total).toBe(4); expect(b.totals.completed).toBe(4);
    const edge = at(TODAY, "00:00"); // exactly local midnight belongs to TODAY, the minute before to yesterday
    const a1 = await db.appointment.create({ data: { tenantId: A.id, publicId: uniq("e"), doctorUserId: A.d1, type: "OPD", source: "RECEPTION", status: "CONFIRMED", startsAt: edge, endsAt: new Date(edge.getTime() + 900000) } });
    const a2 = await db.appointment.create({ data: { tenantId: A.id, publicId: uniq("e"), doctorUserId: A.d1, type: "OPD", source: "RECEPTION", status: "CONFIRMED", startsAt: new Date(edge.getTime() - 60000), endsAt: edge } });
    expect((await appointmentAnalytics(admin(), { preset: "today" })).totals.total).toBe(1);
    expect((await appointmentAnalytics(admin(), { preset: "yesterday" })).totals.total).toBe(9);
    await db.appointment.deleteMany({ where: { id: { in: [a1.id, a2.id] } } });
  });
  it("previous-period comparison is computed from the preceding window", async () => {
    const r = await appointmentAnalytics(admin(), { preset: "custom", from: D1, to: D1, compare: "true" });
    expect(r.comparison?.total).toMatchObject({ current: 8, previous: 0, state: "na" });
    const r2 = await appointmentAnalytics(admin(), { preset: "custom", from: D2, to: D1, compare: "true" }); expect(r2.meta.previous).toEqual({ from: addDays(D2, -2), to: addDays(D2, -1) });
  });
});

describe("live OPD analytics", () => {
  it("derives waiting and consultation time from timestamps; negatives and gaps are excluded", async () => {
    const r = await opdAnalytics(admin(), Q);
    expect(r.totals).toMatchObject({ visits: 5, completed: 4 }); expect(r.waiting).toMatchObject({ samples: 3, averageMin: 20, medianMin: 20, maxMin: 30, available: true });
    expect(r.consultation).toMatchObject({ samples: 3, averageMin: 15, medianMin: 15 }); expect(r.hourly.reduce((a, h) => a + h.count, 0)).toBe(5);
    expect(r.liveToday).toBeTruthy();
  });
  it("says 'Data unavailable' when no times exist", async () => {
    const r = await opdAnalytics(Z.ctx.CLINIC_ADMIN, Q); expect(r.waiting.available).toBe(false); expect(r.waiting.note).toMatch(/Data unavailable/); expect(r.waiting.averageMin).toBeNull();
  });
});

describe("follow-up analytics", () => {
  it("completion rate has an explicit denominator and the backlog is separate from the range", async () => {
    const r = await followUpAnalytics(admin(), Q);
    expect(r.totals).toMatchObject({ dueInPeriod: 4, created: 5, completed: 2, cancelled: 1 }); expect(r.completion).toMatchObject({ ratePct: 50, numerator: 2, denominator: 4 });
    expect(r.backlog.overdue).toBe(3); expect(r.completion.definition).toMatch(/excluding cancelled/);
  });
});

describe("doctor analytics", () => {
  it("admin sees every doctor as context; a doctor only ever sees their own row", async () => {
    const all = await doctorAnalytics(admin(), Q); expect(all.doctors.length).toBeGreaterThanOrEqual(2); expect(all.note).toMatch(/not a ranking/);
    const d1 = all.doctors.find((d) => d.doctorId === A.d1)!; expect(d1).toMatchObject({ appointments: 5, completed: 3, cancelled: 1, noShow: 1, finalizedConsultations: 2, labOrders: 3 });
    expect(d1.billedMinor).toBe(21800);
    const own = await doctorAnalytics(A.ctx.DOCTOR, { ...Q, doctorId: A.d2 }); // trying to look at the colleague
    expect(own.doctors).toHaveLength(1); expect(own.doctors[0].doctorId).toBe(A.d1); expect(own.doctors[0].billedMinor).toBeNull(); expect(own.meta.scope).toEqual({ doctorId: A.d1, own: true });
  });
});

describe("consultation / diagnosis / prescription analytics", () => {
  it("is descriptive, structured and doctor-scoped", async () => {
    const r = await clinicalAnalytics(admin(), Q);
    expect(r.consultations).toMatchObject({ total: 3, finalized: 2, inProgress: 1 }); expect(r.duration).toMatchObject({ samples: 2, averageMin: 30, medianMin: 30, maxMin: 40 });
    expect(r.followUpRequired).toMatchObject({ count: 1, ratePct: 50 }); expect(r.diagnoses.top[0]).toMatchObject({ key: "I10 · Hypertension", count: 2 }); expect(r.diagnoses.distinct).toBe(2);
    expect(r.prescriptions).toMatchObject({ finalized: 2, avgItems: 1.5 }); expect(r.prescriptions.topMedicines[0]).toMatchObject({ key: "paracetamol", count: 2 }); expect(r.note).toMatch(/Nothing here is a diagnosis/);
    const d2 = await clinicalAnalytics(A.ctx.DOCTOR2, Q); expect(d2.consultations.total).toBe(1); expect(d2.diagnoses.recorded).toBe(0);
  });
});

describe("lab analytics", () => {
  it("turnaround, rejection and pending are computed from timestamps", async () => {
    const r = await labAnalytics(admin(), Q);
    expect(r.totals).toMatchObject({ ordered: 3, samplesCollected: 4, samplesRejected: 1, reportsReleased: 2, pending: 1 });
    expect(r.turnaround.orderedToReleased).toMatchObject({ samples: 2, averageHours: 15, medianHours: 15, longestHours: 25 }); expect(r.rejection.ratePct).toBe(25); expect(r.rejection.reasons).toMatchObject({ recorded: 0, notRecorded: 1 });
    expect(r.turnaround.receivedToReleased.samples).toBe(2); expect(r.topTests[0]).toMatchObject({ key: "CBC", count: 2 }); expect(r.pendingByStatus[0].key).toBe("SAMPLE_COLLECTED");
  });
  it("never reports negative durations", async () => {
    const o = await db.investigationOrder.create({ data: { tenantId: A.id, orderNumber: uniq("neg"), patientId: A.pat[0], doctorUserId: A.d1, createdById: A.d1, status: "REPORT_GENERATED", orderedAt: at(D1, "15:00") } });
    await db.labReport.create({ data: { tenantId: A.id, reportNumber: uniq("nr"), investigationOrderId: o.id, patientId: A.pat[0], doctorUserId: A.d1, generatedById: A.d1, status: "RELEASED", releasedAt: at(D1, "12:00") } });
    const r = await labAnalytics(admin(), Q); expect(r.totals.reportsReleased).toBe(3); expect(r.turnaround.orderedToReleased.samples).toBe(2);
    await db.labReport.deleteMany({ where: { investigationOrderId: o.id } }); await db.investigationOrder.delete({ where: { id: o.id } });
  });
});

describe("billing analytics (money)", () => {
  it("matches hand-computed integer minor-unit totals with no double counting", async () => {
    const r = await billingAnalytics(admin(), Q);
    expect(r.totals).toMatchObject({ grossBilledMinor: 42000, discountsMinor: 2000, taxesMinor: 1800, netBilledMinor: 41800, collectedMinor: 16800, refundedMinor: 1000, netCollectedMinor: 15800, outstandingMinor: 25000, invoices: 3, cancelledInvoices: 1, cancelledValueMinor: 5000, partiallyPaid: 1, paid: 1, averageInvoiceMinor: 13933 });
    expect(r.totals.grossBilledMinor - r.totals.discountsMinor + r.totals.taxesMinor).toBe(r.totals.netBilledMinor);
    expect(r.paymentMethods).toEqual([{ key: "CASH", label: "Cash", amountMinor: 11800 }, { key: "UPI", label: "Upi", amountMinor: 5000 }]); // the FAILED 3000 payment is excluded
    expect(r.serviceRevenue.reduce((a, s) => a + s.amountMinor, 0)).toBe(41800); expect(r.serviceRevenueReconciles).toBe(true);
    expect(r.outstandingNow).toMatchObject({ totalMinor: 25000, invoices: 2, overdueInvoices: 1 }); expect(r.outstandingNow.aging.reduce((a, b) => a + b.amountMinor, 0)).toBe(25000);
    expect(r.refunds).toMatchObject({ requested: 2, processedMinor: 1000, processedCount: 1, ratePct: 6 }); expect(r.doctors).toHaveLength(2);
    expect(Number.isInteger(r.totals.averageInvoiceMinor)).toBe(true);
    const d = r.discounts as { available: boolean; invoices: number; totalMinor: number; pctOfGross: number; reasons: { key: string }[] }; expect(d).toMatchObject({ available: true, invoices: 1, totalMinor: 2000, pctOfGross: 4.8 }); expect(d.reasons[0].key).toBe("senior citizen");
    expect(r.billedTrend.reduce((a, x) => a + x.value, 0)).toBe(41800); expect(r.collectedTrend.reduce((a, x) => a + x.value, 0)).toBe(16800);
  });
  it("historical figures come from snapshots, so a later price change does not move them", async () => {
    await db.billingService.updateMany({ where: { tenantId: A.id }, data: { priceMinor: 1 } }).catch(() => undefined);
    expect((await billingAnalytics(admin(), Q)).totals.netBilledMinor).toBe(41800);
  });
  it("refunds are shown separately and never subtracted from billed", async () => {
    const r = await billingAnalytics(admin(), { preset: "custom", from: D1, to: D1 }); expect(r.totals.netBilledMinor).toBe(41800); expect(r.totals.netCollectedMinor).toBe(r.totals.collectedMinor - r.totals.refundedMinor);
  });
  it("tenant B's huge invoice never appears in clinic A", async () => {
    const b = await billingAnalytics(B.ctx.CLINIC_ADMIN, Q); expect(b.totals.netBilledMinor).toBe(999999); expect((await billingAnalytics(admin(), Q)).totals.netBilledMinor).toBe(41800);
  });
  it("zero data is zeros and N/A, not errors", async () => {
    const r = await billingAnalytics(Z.ctx.CLINIC_ADMIN, { ...Q, compare: "1" });
    expect(r.totals).toMatchObject({ netBilledMinor: 0, invoices: 0, averageInvoiceMinor: 0, outstandingMinor: 0 }); expect(r.refunds.ratePct).toBeNull(); expect((r.discounts as { pctOfGross: number | null }).pctOfGross).toBeNull(); expect(r.comparison?.netBilled).toMatchObject({ state: "na", reason: "insufficient-history", pctTenths: null }); // the clinic did not exist in the previous period
  });
});

describe("pharmacy analytics", () => {
  it("stock status, expiry, valuation and movements are real", async () => {
    const r = await pharmacyAnalytics(admin(), Q);
    expect(r.stock).toMatchObject({ activeMedicines: 3, inStock: 1, lowStock: 1, outOfStock: 1, expiredBatchesWithStock: 1, nearExpiryBatches: 1 });
    expect(r.stock.valuation).toMatchObject({ configured: true, valueMinor: 6000 }); expect(r.movements.damaged).toEqual({ entries: 1, units: 2 }); expect(r.lowStockList.map((x) => x.status).sort()).toEqual(["LOW_STOCK", "OUT_OF_STOCK"]);
  });
  it("says 'Stock valuation not configured' when no purchase prices exist, and stays inside the clinic", async () => {
    const b = await pharmacyAnalytics(B.ctx.CLINIC_ADMIN, Q); expect(b.stock.valuation).toMatchObject({ configured: false, valueMinor: null, method: "Stock valuation not configured" }); expect(b.stock.activeMedicines).toBe(1);
  });
});

describe("communication analytics", () => {
  it("per-channel states, unsupported metrics are 'not available', no contents", async () => {
    const r = await communicationAnalytics(admin(), Q);
    expect(r.totals).toMatchObject({ messages: 7, sent: 5, delivered: 3, failed: 2, failureRatePct: 28.6 });
    const ch = Object.fromEntries(r.channels.map((c) => [c.channel, c]));
    expect(ch.WHATSAPP).toMatchObject({ total: 4, sent: 3, delivered: 2, read: 1, failed: 1 }); expect(ch.SMS.read).toBeNull(); expect(ch.SMS.notes).toMatch(/not available/); expect(ch.EMAIL).toMatchObject({ sent: 1, delivered: 1, read: null });
    expect(ch.IN_APP).toMatchObject({ total: 4, sent: 4, read: 1, delivered: null, failed: null }); expect(r.failureCodes.map((f) => f.key).sort()).toEqual(["NO_BALANCE", "PROVIDER_ERR"]);
    expect(JSON.stringify(r)).not.toContain("SECRET BODY"); expect(JSON.stringify(r)).not.toContain("+919999900000");
    expect((await communicationAnalytics(admin(), { ...Q, channel: "SMS" })).totals.messages).toBe(2);
  });
});

describe("command center, insights and scorecard", () => {
  it("admin sees every KPI with comparisons and snapshots flagged", async () => {
    const r = await commandCenter(admin(), { ...Q, compare: "1" }); const k = Object.fromEntries(r.kpis.map((x) => [x.key, x]));
    for (const key of ["patients", "newPatients", "appointments", "completedVisits", "cancelled", "noShows", "revenue", "collected", "outstanding", "avgWaiting", "avgConsult", "followUpsDue", "pendingLab", "lowStock", "critical"]) expect(k[key], key).toBeTruthy();
    expect(k.appointments.value).toBe(8); expect(k.revenue.value).toBe(41800); expect(k.outstanding.value).toBe(25000); expect(k.outstanding.snapshot).toBe(true); expect(k.followUpsDue.value).toBe(3); expect(k.pendingLab.value).toBe(1); expect(k.lowStock.value).toBe(2);
    expect(k.avgWaiting.value).toBe(20); expect(k.critical.value).toBe(1); expect(k.appointments.comparison).toBeTruthy();
  });
  it("each role's command center shows only their own sections", async () => {
    const keys = async (c: Ctx) => (await commandCenter(c, Q)).kpis.map((x) => x.key);
    expect(await keys(A.ctx.ACCOUNTANT)).toEqual(expect.arrayContaining(["revenue", "collected", "outstanding"])); expect(await keys(A.ctx.ACCOUNTANT)).not.toContain("appointments"); expect(await keys(A.ctx.ACCOUNTANT)).not.toContain("patients");
    const doc = await keys(A.ctx.DOCTOR); expect(doc).toContain("appointments"); for (const hidden of ["revenue", "collected", "outstanding", "lowStock"]) expect(doc).not.toContain(hidden);
    const rec = await keys(A.ctx.RECEPTIONIST); expect(rec).toContain("appointments"); expect(rec).not.toContain("revenue"); expect(rec).not.toContain("pendingLab");
    expect(await keys(A.ctx.PHARMACY_MANAGER)).toContain("lowStock"); expect(await keys(A.ctx.PHARMACY_MANAGER)).not.toContain("revenue"); expect(await keys(A.ctx.LAB_STAFF)).toContain("pendingLab");
    const dk = Object.fromEntries((await commandCenter(A.ctx.DOCTOR2, Q)).kpis.map((x) => [x.key, x])); expect(dk.appointments.value).toBe(3);
  });
  it("insights are rule-based, threshold-configurable and limited to permitted domains", async () => {
    const i = await clinicInsights(admin(), Q); const keys = i.insights.map((x) => x.key);
    expect(keys).toEqual(expect.arrayContaining(["out-of-stock", "below-reorder", "expiring-batches", "expired-batches"])); expect(keys).not.toContain("no-show-rate"); expect(keys).not.toContain("overdue-followups"); // 3 overdue < threshold 5 // only 6 due < min sample 10
    expect(i.method).toMatch(/No AI/);
    await updateAnalyticsSettings(admin(), { minSample: 5, noShowRatePct: 30 });
    expect((await clinicInsights(admin(), Q)).insights.map((x) => x.key)).toContain("no-show-rate");
    await updateAnalyticsSettings(admin(), { overdueFollowUps: 3 }); const j = await clinicInsights(admin(), Q); expect(j.thresholds).toMatchObject({ minSample: 5, noShowRatePct: 30, overdueFollowUps: 3 }); expect(j.insights.map((x) => x.key)).toContain("overdue-followups");
    expect((await clinicInsights(A.ctx.ACCOUNTANT, Q)).insights.map((x) => x.key)).not.toContain("out-of-stock");
    expect((await clinicInsights(B.ctx.CLINIC_ADMIN, Q)).thresholds.minSample).toBe(10); // another clinic's settings are untouched
    await updateAnalyticsSettings(admin(), { minSample: 10, noShowRatePct: 15, overdueFollowUps: 5 });
  });
  it("threshold changes are validated, permissioned and audited", async () => {
    expect(await code(updateAnalyticsSettings(admin(), { noShowRatePct: 0 }))).toBe("VALIDATION_ERROR"); expect(await code(updateAnalyticsSettings(admin(), { bogus: 1 }))).toBe("VALIDATION_ERROR");
    expect(await code(updateAnalyticsSettings(A.ctx.ACCOUNTANT, { noShowRatePct: 20 }))).toBe("FORBIDDEN"); expect(await code(updateAnalyticsSettings(A.ctx.DOCTOR, { noShowRatePct: 20 }))).toBe("FORBIDDEN");
    expect((await getAnalyticsSettings(A.ctx.ACCOUNTANT)).canConfigure).toBe(false);
    expect(await db.auditLog.count({ where: { tenantId: A.id, action: "analytics.config_changed" } })).toBeGreaterThanOrEqual(2);
  });
  it("scorecard has individual metrics with definitions and no combined score", async () => {
    const s = await operationsScorecard(admin(), Q); expect(s.items.length).toBeGreaterThan(10); for (const i of s.items) expect(i.definition.length).toBeGreaterThan(5);
    expect(s.items.some((i) => /overall|score|index/i.test(`${i.key} ${i.label}`))).toBe(false); expect(s.note).toMatch(/no combined or overall score/); expect(s.items.find((x) => x.key === "noShowRate")?.value).toBe(33.3);
    const acct = await operationsScorecard(A.ctx.ACCOUNTANT, Q); expect(acct.items.every((i) => i.group === "Billing")).toBe(true);
  });
});

describe("RBAC: server-side, per domain", () => {
  const domains: [string, (c: Ctx) => Promise<unknown>][] = [
    ["patients", (c) => patientAnalytics(c, Q)], ["operations", (c) => appointmentAnalytics(c, Q)], ["clinical", (c) => clinicalAnalytics(c, Q)], ["financial", (c) => billingAnalytics(c, Q)],
    ["lab", (c) => labAnalytics(c, Q)], ["pharmacy", (c) => pharmacyAnalytics(c, Q)], ["communication", (c) => communicationAnalytics(c, Q)],
  ];
  const allowed: Record<string, string[]> = {
    CLINIC_ADMIN: ["patients", "operations", "clinical", "financial", "lab", "pharmacy", "communication"], DOCTOR: ["patients", "operations", "clinical", "lab"], RECEPTIONIST: ["patients", "operations"], NURSE: ["operations"],
    LAB_STAFF: ["lab"], ACCOUNTANT: ["financial"], PHARMACY_MANAGER: ["pharmacy"], PHARMACY_STAFF: [], COMPOUNDER: [], STAFF: [], PATIENT: [],
  };
  for (const [role, ok] of Object.entries(allowed)) it(`${role} can open exactly: ${ok.join(", ") || "nothing"}`, async () => {
    for (const [name, fn] of domains) expect(await code(fn(A.ctx[role])), `${role}/${name}`).toBe(ok.includes(name) ? "ok" : "FORBIDDEN");
    expect(await code(commandCenter(A.ctx[role], Q))).toBe(role === "PHARMACY_STAFF" || role === "COMPOUNDER" || role === "STAFF" || role === "PATIENT" ? "FORBIDDEN" : "ok");
  });
  it("explicit grants extend a role; a doctor with a financial grant sees only their own invoices", async () => {
    const { user } = await makeUser("DOCTOR", A.id, ["analytics.financial"]); const c = asTenant({ ...ctxFor(user, "DOCTOR", A.id, { grants: ["analytics.financial"] }), tenant: { id: A.id, name: "x", timezone: TZ } as never });
    const r = await billingAnalytics(c, Q); expect(r.totals.invoices).toBe(0); expect(r.meta.scope.own).toBe(true);
  });
  it("a platform user without a clinic, and a clinic admin, cannot read platform analytics", async () => {
    const sa = await makeUser("SUPER_ADMIN", null); const sctx = ctxFor(sa.user, "SUPER_ADMIN", null);
    const p = await platformAnalytics(sctx); expect(p.clinics).toBeGreaterThanOrEqual(3); expect(p.active).toBeGreaterThanOrEqual(3); expect(p.status).toBe("operational"); expect(Object.keys(p)).not.toContain("patients");
    expect(await code(platformAnalytics(admin()))).toBe("FORBIDDEN");
  });
});

describe("tenant isolation and IDOR", () => {
  it("a doctor id from another clinic is rejected, and a valid colleague id is honoured for admins only", async () => {
    expect(await code(appointmentAnalytics(admin(), { ...Q, doctorId: B.d1 }))).toBe("VALIDATION_ERROR");
    expect(await code(appointmentAnalytics(admin(), { ...Q, doctorId: A.adminId }))).toBe("VALIDATION_ERROR"); // not a doctor
    expect((await appointmentAnalytics(admin(), { ...Q, doctorId: A.d2 })).totals.total).toBe(3);
    expect((await appointmentAnalytics(A.ctx.DOCTOR, { ...Q, doctorId: A.d2 })).totals.total).toBe(5); // forced to own data
  });
  it("Clinic A never sees Clinic B (and vice-versa) in any domain or report", async () => {
    const dump = async (c: Ctx) => JSON.stringify([await patientAnalytics(c, Q), await appointmentAnalytics(c, Q), await billingAnalytics(c, Q), await labAnalytics(c, Q), await pharmacyAnalytics(c, Q), await communicationAnalytics(c, Q), await followUpAnalytics(c, Q), await commandCenter(c, Q)]);
    const a = await dump(admin()); expect(a).not.toContain("Mumbai"); expect(a).not.toContain("999999"); expect(a).not.toContain("BravoMed");
    const b = await dump(B.ctx.CLINIC_ADMIN); expect(b).not.toContain("Delhi"); expect(b).not.toContain("41800"); expect(b).not.toContain("Paracetamol");
    for (const key of reportKeys()) { const out = JSON.stringify((await runReport(admin(), key, Q)).rows); expect(out, key).not.toContain("BPAT-"); expect(out, key).not.toContain("BINV-"); expect(out, key).not.toContain("BravoMed"); }
    for (const key of reportKeys()) { const out = JSON.stringify((await runReport(B.ctx.CLINIC_ADMIN, key, Q)).rows); expect(out, key).not.toContain(A.id.slice(-4) + "-"); expect(out, key).not.toContain("Paracetamol"); }
  });
  it("scheduled reports belong to one clinic: no listing, no deleting across clinics", async () => {
    const s = await saveSchedule(admin(), { name: "Weekly appts", reportKey: "appointments", frequency: "WEEKLY", format: "CSV", preset: "last7" });
    expect((await listSchedules(admin())).schedules.map((x) => x.id)).toContain(s.id); expect((await listSchedules(B.ctx.CLINIC_ADMIN)).schedules).toHaveLength(0);
    expect(await code(deleteSchedule(B.ctx.CLINIC_ADMIN, s.id))).toBe("NOT_FOUND"); expect((await listSchedules(admin())).schedules).toHaveLength(1);
    expect(await code(saveSchedule(A.ctx.DOCTOR, { name: "x1", reportKey: "appointments", frequency: "DAILY" }))).toBe("FORBIDDEN");
    expect(await code(saveSchedule(admin(), { name: "bad", reportKey: "../etc/passwd", frequency: "DAILY" }))).toBe("NOT_FOUND"); expect(await code(saveSchedule(admin(), { name: "bad", reportKey: "appointments", frequency: "EVERY_SECOND" }))).toBe("VALIDATION_ERROR");
    expect(await code(saveSchedule(admin(), { name: "bad", reportKey: "appointments", frequency: "DAILY", preset: "custom" }))).toBe("VALIDATION_ERROR");
    expect((await listSchedules(admin())).delivery).toMatch(/nothing is sent/); expect(await deleteSchedule(admin(), s.id)).toEqual({ deleted: true });
  });
});

describe("Report Center", () => {
  it("lists only reports the viewer may open, grouped by category", async () => {
    const adm = reportCatalog(admin()); expect(adm.reports.map((r) => r.key).sort()).toEqual([...reportKeys()].sort()); expect(adm.categories).toEqual(["Clinical", "Operational", "Financial", "Patient", "Lab", "Pharmacy", "Communication"]);
    for (const r of adm.reports) { expect(r.description.length).toBeGreaterThan(10); expect(r.dataSource.length).toBeGreaterThan(2); }
    expect(reportCatalog(A.ctx.ACCOUNTANT).reports.every((r) => r.category === "Financial")).toBe(true); expect(reportCatalog(A.ctx.PHARMACY_MANAGER).reports.every((r) => r.category === "Pharmacy")).toBe(true);
    expect(reportCatalog(A.ctx.DOCTOR).reports.some((r) => r.category === "Financial")).toBe(false); expect(() => reportCatalog(A.ctx.STAFF)).toThrow();
  });
  it("every report runs for an admin with metadata, and an empty clinic returns empty rows, not errors", async () => {
    for (const key of reportKeys()) { const r = await runReport(admin(), key, Q); expect(r.columns.length, key).toBeGreaterThan(1); expect(r.meta.timezone).toBe(TZ); expect(r.meta.generatedBy).toBeTruthy(); expect(r.report.dataSource).toBeTruthy(); const z = await runReport(Z.ctx.CLINIC_ADMIN, key, Q); expect(z.rows, key).toEqual([]); }
  });
  it("report rows match the analytics numbers", async () => {
    expect((await runReport(admin(), "appointments", Q)).rows).toHaveLength(8); expect((await runReport(admin(), "appointments", { ...Q, status: "NO_SHOW" })).rows).toHaveLength(2); expect((await runReport(admin(), "appointments", { ...Q, doctorId: A.d2 })).rows).toHaveLength(3);
    const inv = (await runReport(admin(), "billing", Q)).rows as Record<string, string>[]; expect(inv).toHaveLength(4); expect(inv.filter((r) => r.status !== "Cancelled").reduce((a, r) => a + Math.round(Number(r.total) * 100), 0)).toBe(41800);
    expect((await runReport(admin(), "followups", { ...Q, status: "OVERDUE" })).rows).toHaveLength(2); expect((await runReport(admin(), "opd", Q)).rows).toHaveLength(5);
    const lab = (await runReport(admin(), "lab", Q)).rows as Record<string, unknown>[]; expect(lab).toHaveLength(3); expect(lab.map((r) => r.tatHours).sort()).toEqual([5, 25, null].sort()); expect((await runReport(admin(), "lab", { ...Q, status: "RELEASED" })).rows).toHaveLength(2);
    const stock = (await runReport(admin(), "pharmacy-stock", Q)).rows as Record<string, unknown>[]; expect(stock).toHaveLength(3); expect((await runReport(admin(), "pharmacy-stock", { ...Q, status: "OUT_OF_STOCK" })).rows).toHaveLength(1);
    expect((await runReport(admin(), "pharmacy-expiry", Q)).rows.map((r) => r.state).sort()).toEqual(["Expired", "Near expiry"]); expect((await runReport(admin(), "diagnoses", Q)).rows[0]).toMatchObject({ diagnosis: "Hypertension", count: 2 });
    expect((await runReport(admin(), "services", Q)).rows).toHaveLength(3); expect((await runReport(admin(), "communications", Q)).rows).toHaveLength(7);
  });
  it("communications report never contains recipients or message text", async () => {
    const r = await runReport(admin(), "communications", Q); expect(JSON.stringify(r)).not.toContain("SECRET BODY"); expect(JSON.stringify(r)).not.toContain("+9199999"); expect(r.columns.map((c) => c.key)).not.toEqual(expect.arrayContaining(["recipient", "body"]));
  });
  it("validates report keys and filters; unknown or foreign reports look the same as forbidden ones", async () => {
    expect(await code(runReport(admin(), "nope", Q))).toBe("NOT_FOUND"); expect(await code(runReport(admin(), "appointments", { ...Q, status: "BOGUS" }))).toBe("VALIDATION_ERROR"); expect(await code(runReport(admin(), "patients", { ...Q, type: "x" }))).toBe("VALIDATION_ERROR");
    expect(await code(runReport(admin(), "opd", { ...Q, channel: "SMS" }))).toBe("VALIDATION_ERROR"); expect(await code(runReport(admin(), "appointments", { preset: "custom", from: "2026-13-01", to: "2026-13-02" }))).toBe("VALIDATION_ERROR");
    expect(await code(runReport(A.ctx.DOCTOR, "billing", Q))).toBe("FORBIDDEN"); expect(await code(runReport(A.ctx.ACCOUNTANT, "appointments", Q))).toBe("FORBIDDEN"); expect(await code(runReport(A.ctx.PHARMACY_MANAGER, "communications", Q))).toBe("FORBIDDEN"); expect(await code(runReport(A.ctx.PATIENT, "appointments", Q))).toBe("FORBIDDEN");
  });
  it("doctors only get their own rows in every report", async () => {
    for (const key of ["appointments", "opd", "followups", "consultations", "lab"]) { const rows = (await runReport(A.ctx.DOCTOR2, key, Q)).rows as Record<string, unknown>[]; expect(rows.every((r) => !r.doctor || r.doctor === "DOCTOR user"), key).toBe(true); }
    expect((await runReport(A.ctx.DOCTOR, "appointments", { ...Q, doctorId: A.d2 })).rows).toHaveLength(5);
  });
});

describe("exports", () => {
  it("CSV carries report metadata, honours permissions, neutralises formulas and audits", async () => {
    const csv = await text(exportReport(admin(), "appointments", Q, "csv"));
    expect(csv).toMatch(/^Report,Appointments/); for (const m of ["Description,", "Data source,", "Date range,", "Generated at,", "Timezone,Asia/Kolkata", "Generated by,"]) expect(csv).toContain(m);
    expect(csv).toContain("Patient name"); expect(csv).toContain("'=cmd|' /C calc'!A0"); expect(csv).not.toMatch(/\n=cmd/);
    expect(await db.auditLog.count({ where: { tenantId: A.id, action: "analytics.report_exported", entityId: "appointments" } })).toBeGreaterThanOrEqual(1);
    const log = await db.auditLog.findFirst({ where: { tenantId: A.id, action: "analytics.report_exported" }, orderBy: { createdAt: "desc" } }); expect(log?.metadata).not.toContain("Old Man"); expect(log?.metadata).not.toContain("calc");
  });
  it("patient identity is removed for users without reports.export_patient", async () => {
    const { user } = await makeUser("DOCTOR", A.id); const doc = asTenant({ ...ctxFor(user, "DOCTOR", A.id), tenant: { id: A.id, name: "x", timezone: TZ } as never });
    const csv = await text(exportReport(doc, "appointments", Q, "csv")); expect(csv).not.toMatch(/Patient name,/); expect(csv).not.toContain("Old Man"); expect(csv).toContain("Patient ID"); expect(csv).toContain("Patient names and contact details are not included");
    const prev = await runReport(A.ctx.ACCOUNTANT, "billing", Q); expect(prev.identityIncluded).toBe(true); // may SEE identity (patients.identity) ...
    const acct = await text(exportReport(A.ctx.ACCOUNTANT, "billing", Q, "csv")); expect(acct).not.toMatch(/Patient name,/); // ... but not export it
  });
  it("export permissions: financial needs reports.export_financial, everyone needs reports.export", async () => {
    expect(await code(exportReport(A.ctx.DOCTOR, "billing", Q, "csv"))).toBe("FORBIDDEN"); expect(await code(exportReport(A.ctx.RECEPTIONIST, "appointments", Q, "csv"))).toBe("FORBIDDEN"); expect(await code(exportReport(A.ctx.NURSE, "appointments", Q, "csv"))).toBe("FORBIDDEN");
    expect(await code(exportReport(A.ctx.ACCOUNTANT, "billing", Q, "csv"))).toBe("ok"); expect(await code(exportReport(A.ctx.ACCOUNTANT, "consultations", Q, "csv"))).toBe("FORBIDDEN");
    expect(await code(exportReport(A.ctx.PHARMACY_MANAGER, "pharmacy-stock", Q, "csv"))).toBe("ok"); expect(await code(exportReport(A.ctx.PHARMACY_MANAGER, "billing", Q, "csv"))).toBe("FORBIDDEN");
    expect(await code(exportReport(A.ctx.LAB_STAFF, "lab", Q, "csv"))).toBe("FORBIDDEN"); expect(await code(exportReport(A.ctx.DOCTOR, "appointments", Q, "csv"))).toBe("ok"); expect(await code(exportReport(A.ctx.PATIENT, "appointments", Q, "csv"))).toBe("FORBIDDEN");
    const { user } = await makeUser("ACCOUNTANT", A.id); const noFin = asTenant({ ...ctxFor(user, "ACCOUNTANT", A.id), permissions: new Set([...A.ctx.ACCOUNTANT.permissions].filter((p) => p !== "reports.export_financial")) as never, tenant: { id: A.id, name: "x", timezone: TZ } as never });
    expect(await code(exportReport(noFin, "billing", Q, "csv"))).toBe("FORBIDDEN"); expect(await code(runReport(noFin, "billing", Q))).toBe("ok");
  });
  it("XLSX and printable PDF page are produced; unknown formats are rejected", async () => {
    const x = await exportReport(admin(), "billing", Q, "xlsx"); expect(x.contentType).toContain("spreadsheetml"); const bytes = x.chunks[0] as Uint8Array; expect(String.fromCharCode(bytes[0], bytes[1])).toBe("PK"); expect(x.filename).toMatch(/\.xlsx$/);
    const p = await exportReport(admin(), "billing", Q, "pdf"); expect(p.contentType).toContain("text/html"); expect(String(p.chunks[0])).toContain("Save as PDF"); expect(String(p.chunks[0])).not.toContain("<script");
    expect(await code(exportReport(admin(), "billing", Q, "exe"))).toBe("VALIDATION_ERROR");
  });
  it("money columns export as plain decimals from integer minor units", async () => {
    const csv = await text(exportReport(admin(), "billing", Q, "csv")); const lines = csv.split("\r\n"); const head = lines.findIndex((l) => l.startsWith("Invoice,")); const cols = lines[head].split(",");
    const row = lines.slice(head + 1).find((l) => l.includes("Partially paid"))!.split(","); expect(row[cols.indexOf("Gross billed")]).toBe("220.00"); expect(row[cols.indexOf("Discount")]).toBe("20.00"); expect(row[cols.indexOf("Net billed")]).toBe("200.00"); expect(row[cols.indexOf("Due")]).toBe("150.00");
  });
  it("generation and sensitive views are audited without personal data", async () => {
    await runReport(admin(), "lab", Q); await billingAnalytics(admin(), Q); await clinicalAnalytics(admin(), Q);
    for (const a of ["analytics.report_generated", "analytics.viewed"]) expect(await db.auditLog.count({ where: { tenantId: A.id, action: a } })).toBeGreaterThan(0);
    const rows = await db.auditLog.findMany({ where: { tenantId: A.id, action: { startsWith: "analytics." } }, select: { metadata: true } }); expect(JSON.stringify(rows)).not.toMatch(/Old Man|Hypertension|calc/);
  });
});

describe("caching", () => {
  it("is keyed by tenant, range, filters and role, and reports freshness", async () => {
    process.env.ANALYTICS_CACHE_TTL_MS = "60000"; clearAnalyticsCache();
    try {
      const first = await appointmentAnalytics(admin(), Q); expect(first.meta.cached).toBe(false);
      const again = await appointmentAnalytics(admin(), Q); expect(again.meta.cached).toBe(true); expect(again.meta.generatedAt).toBe(first.meta.generatedAt);
      expect((await appointmentAnalytics(admin(), { ...Q, refresh: "1" })).meta.cached).toBe(false);
      expect((await appointmentAnalytics(B.ctx.CLINIC_ADMIN, Q)).totals.total).toBe(4); // another tenant, same query: not served from A's cache
      expect((await appointmentAnalytics(A.ctx.DOCTOR, Q)).totals.total).toBe(5); // another role/scope: different key
      expect((await appointmentAnalytics(admin(), { ...Q, doctorId: A.d2 })).totals.total).toBe(3);
      expect((await appointmentAnalytics(admin(), { ...Q, preset: "last30" })).meta.range.days).toBe(30);
    } finally { process.env.ANALYTICS_CACHE_TTL_MS = "0"; clearAnalyticsCache(); }
  });
});

describe("cache never leaks per-user figures", () => {
  it("two admins of one clinic each get their own critical-alert count", async () => {
    process.env.ANALYTICS_CACHE_TTL_MS = "60000"; clearAnalyticsCache();
    try {
      const { user } = await makeUser("CLINIC_ADMIN", A.id); const other = asTenant({ ...ctxFor(user, "CLINIC_ADMIN", A.id), tenant: { id: A.id, name: "x", timezone: TZ } as never });
      const mine = await commandCenter(admin(), Q); const theirs = await commandCenter(other, Q);
      expect(mine.kpis.find((k) => k.key === "critical")?.value).toBe(1); expect(theirs.kpis.find((k) => k.key === "critical")?.value).toBe(0); expect((await commandCenter(admin(), Q)).meta.cached).toBe(true);
    } finally { process.env.ANALYTICS_CACHE_TTL_MS = "0"; clearAnalyticsCache(); }
  });
});

describe("zero data and scale", () => {
  it("an empty clinic returns well-formed zero results for every domain", async () => {
    const z = Z.ctx.CLINIC_ADMIN;
    const [p, a, o, f, d, c, l, b, ph, cm, cc, ins, sc] = await Promise.all([patientAnalytics(z, Q), appointmentAnalytics(z, Q), opdAnalytics(z, Q), followUpAnalytics(z, Q), doctorAnalytics(z, Q), clinicalAnalytics(z, Q), labAnalytics(z, Q), billingAnalytics(z, Q), pharmacyAnalytics(z, Q), communicationAnalytics(z, Q), commandCenter(z, Q), clinicInsights(z, Q), operationsScorecard(z, Q)]);
    expect(p.totals.patients).toBe(0); expect(p.retention.ratePct).toBeNull(); expect(a.rates.noShowPct).toBeNull(); expect(a.funnel.every((s) => s.count === 0)).toBe(true); expect(o.waiting.available).toBe(false); expect(f.completion.ratePct).toBeNull();
    expect(d.doctors.every((x) => x.appointments === 0)).toBe(true); expect(c.duration.available).toBe(false); expect(l.turnaround.orderedToReleased.averageHours).toBeNull(); expect(b.totals.netBilledMinor).toBe(0); expect(ph.stock.valuation.configured).toBe(false); expect(cm.totals.failureRatePct).toBeNull();
    expect(cc.kpis.find((k) => k.key === "revenue")?.value).toBe(0); expect(ins.insights).toEqual([]); expect(sc.items.length).toBeGreaterThan(5);
  });
  it("handles a large clinic quickly and exactly", async () => {
    const t = await mkTenant("large"); const doc = t.d1; const rows = []; const start = at(D1, "08:00").getTime();
    for (let i = 0; i < 6000; i++) rows.push({ tenantId: t.id, publicId: `L${t.id.slice(-5)}${i}`, doctorUserId: doc, type: "OPD", source: i % 2 ? "WEBSITE" : "RECEPTION", status: ["COMPLETED", "COMPLETED", "CANCELLED", "NO_SHOW", "COMPLETED"][i % 5], startsAt: new Date(start + (i % 600) * 60000), endsAt: new Date(start + (i % 600) * 60000 + 900000) });
    for (let i = 0; i < rows.length; i += 1000) await db.appointment.createMany({ data: rows.slice(i, i + 1000) });
    const t0 = Date.now(); const r = await appointmentAnalytics(t.ctx.CLINIC_ADMIN, { ...Q, compare: "1" }); const ms = Date.now() - t0;
    expect(r.totals).toMatchObject({ total: 6000, completed: 3600, cancelled: 1200, noShow: 1200 }); expect(r.rates.cancellationPct).toBe(20); expect(ms).toBeLessThan(4000);
    const csv = await exportReport(t.ctx.CLINIC_ADMIN, "appointments", Q, "csv"); expect(csv.chunks.length).toBeGreaterThan(5); expect(csv.chunks.join("").split("\r\n").length).toBeGreaterThan(6000);
  }, 60000);
});
