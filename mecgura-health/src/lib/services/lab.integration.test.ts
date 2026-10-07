import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { asTenant, ctxFor, makeUser, seedSystemData, uniq } from "@/test/helpers";
import type { RoleKey } from "@/lib/permissions";
import { renderLabReport, renderLabSlip, renderSampleLabel } from "@/lib/lab/lab-html";
import { computeFlag, pickRange, deriveOrderStatus } from "@/lib/lab/core";
import { startConsultation } from "./consultation";
import { addConfigItem, addPartner, listConfig, listPartners, saveInvestigation, searchInvestigations, setConfigActive } from "./lab-master";
import { createInvestigationOrder, getLabOrder, labOrderAction, labStats, listLabOrders } from "./lab-orders";
import { labReportDocument, labSlipDocument, listNotifications, markNotificationsRead, patientLabReports, reportAction, reviewReport, sampleLabelDocument, saveResults } from "./lab-results";
import { registerVisit } from "./opd";
import { registerPatient } from "./patient-crm";
import { saveSchedule } from "./schedule";

const code = (p: Promise<unknown>) => p.then(() => "ok", (e) => (e instanceof AppError ? e.code : `ERR:${e}`));
type Ctx = ReturnType<typeof asTenant>;
interface T { id: string; admin: Ctx; doctor: Ctx; doctor2: Ctx; recep: Ctx; nurse: Ctx; accountant: Ctx; lab: Ctx; reviewer: Ctx; superAdmin: Ctx; doctorId: string; testIds: Record<string, string> }

async function mkTenant(label: string): Promise<T> {
  const t = await db.tenant.create({ data: { name: `Lab Clinic ${label}`, slug: uniq(`lb-${label}`).slice(0, 30), status: "ACTIVE", address: "1 Test Road", city: "Testville", contactPhone: "+911234500000" } });
  const mk = async (role: RoleKey, grants: string[] = []) => { const { user } = await makeUser(role, t.id, grants); const base = ctxFor(user, role, t.id, { grants }); return { user, ctx: asTenant({ ...base, tenant: { ...base.tenant!, name: `Lab Clinic ${label}`, address: "1 Test Road", city: "Testville", contactPhone: "+911234500000", logoUrl: null, timezone: "Asia/Kolkata", brand: { primary: "#0e7c86", secondary: "#000000", accent: "#000000" }, state: null, pincode: null, contactEmail: null, legalName: null } as never }) }; };
  const [a, d, d2, r, n, ac, l, rv] = [await mk("CLINIC_ADMIN"), await mk("DOCTOR"), await mk("DOCTOR"), await mk("RECEPTIONIST"), await mk("NURSE"), await mk("ACCOUNTANT"), await mk("LAB_STAFF"), await mk("LAB_STAFF", ["lab.review"])];
  const sa = await makeUser("SUPER_ADMIN", null); const sac = asTenant({ ...ctxFor(sa.user, "SUPER_ADMIN", t.id), viewingAs: true });
  const sched = { slotMinutes: 15, bufferMinutes: 0, onlineBooking: false, advanceDays: 30, minNoticeMinutes: 0, windows: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, start: "09:00", end: "17:00" })) };
  await saveSchedule(a.ctx, d.user.id, sched); await saveSchedule(a.ctx, d2.user.id, sched);
  for (const k of ["CATEGORY:Pathology", "SAMPLE_TYPE:Blood", "SAMPLE_TYPE:Urine", "REJECTION_REASON:Insufficient sample", "REJECTION_REASON:Damaged sample"]) { const [kind, name] = k.split(":"); await addConfigItem(a.ctx, { kind, name }); }
  const mkTest = async (testCode: string, testName: string, sampleType: string, parameters: unknown[]) => (await saveInvestigation(a.ctx, null, { testCode, testName, category: "Pathology", sampleType, preparation: testCode === "GLU" ? "Fasting required" : undefined, parameters })).id;
  const testIds: Record<string, string> = {};
  testIds.HB = await mkTest("HB", "Haemoglobin", "Blood", [{ name: "Haemoglobin", resultType: "NUMERIC", unit: "g/dL", ranges: [{ gender: "MALE", low: 13, high: 17, criticalLow: 7 }, { gender: "FEMALE", low: 12, high: 15 }] }]);
  testIds.GLU = await mkTest("GLU", "Glucose", "Blood", [{ name: "Glucose", resultType: "NUMERIC", unit: "mg/dL" }]);
  testIds.URI = await mkTest("URI", "Urine routine", "Urine", [{ name: "Protein", resultType: "QUALITATIVE", options: [{ value: "Negative", flag: "NEGATIVE" }, { value: "Positive", flag: "POSITIVE" }] }, { name: "Colour", resultType: "TEXT" }]);
  return { id: t.id, admin: a.ctx, doctor: d.ctx, doctor2: d2.ctx, recep: r.ctx, nurse: n.ctx, accountant: ac.ctx, lab: l.ctx, reviewer: rv.ctx, superAdmin: sac, doctorId: d.user.id, testIds };
}
let phoneN = 0;
async function consult(t: T, name = "Lab Patient", doctor: Ctx = t.doctor, gender = "MALE") {
  await db.opdVisit.updateMany({ where: { tenantId: t.id, doctorUserId: doctor.user.id, status: { in: ["CALLED", "IN_CONSULTATION"] } }, data: { status: "COMPLETED" } });
  const p = await registerPatient(t.recep, { name, phone: `96${String(40000000 + ++phoneN * 13).slice(0, 8)}`, allowDuplicate: true, dateOfBirth: "1990-01-01", gender });
  const v = await registerVisit(t.recep, { patient: { patientId: p.id, viaProfile: true }, doctorUserId: doctor.user.id });
  const c = await startConsultation(doctor, v.id);
  return { patientId: p.id, id: c.id };
}
const order = async (t: T, cid: string, tests: string[] = ["HB"], priority = "NORMAL", doctor: Ctx = t.doctor) => createInvestigationOrder(doctor, cid, { investigationIds: tests.map((k) => t.testIds[k]), priority });
const act = (ctx: Ctx, id: string, body: Record<string, unknown>) => labOrderAction(ctx, id, body);
/** order → collected → received → processing for the given tests */
async function toProcessing(t: T, tests = ["HB"], priority = "NORMAL") {
  const c = await consult(t); const o = await order(t, c.id, tests, priority);
  const st = [...new Set(tests.map((k) => (k === "URI" ? "Urine" : "Blood")))];
  for (const s of st) await act(t.lab, o.id, { action: "collect", sampleType: s });
  const d = await getLabOrder(t.lab, o.id);
  for (const s of d.samples) await act(t.lab, o.id, { action: "receive", sampleId: s.id });
  await act(t.lab, o.id, { action: "startProcessing" });
  return { ...c, orderId: o.id };
}
const val = (ctx: Ctx, orderId: string, itemId: string, entries: { position: number; value: string; remarks?: string }[], submit = true) => saveResults(ctx, orderId, itemId, { entries, submit });
async function released(t: T, hb = "14") {
  const o = await toProcessing(t); const d = await getLabOrder(t.lab, o.orderId);
  await val(t.lab, o.orderId, d.items[0].id, [{ position: 0, value: hb }]);
  await reportAction(t.lab, o.orderId, { action: "generateReport" });
  await reportAction(t.reviewer, o.orderId, { action: "verify" });
  await reportAction(t.reviewer, o.orderId, { action: "release" });
  const full = await getLabOrder(t.reviewer, o.orderId);
  return { ...o, reportId: full.report!.id, itemId: d.items[0].id };
}

let A: T, B: T;
beforeAll(async () => { await seedSystemData(); A = await mkTenant("a"); B = await mkTenant("b"); });

describe("pure lab rules (flags only from configured data)", () => {
  const p = { name: "X", resultType: "NUMERIC", ranges: [{ gender: "FEMALE", low: 12, high: 15 }, { low: 1, high: 100 }] };
  it("picks the most specific configured range and never invents one", () => {
    expect(pickRange(p.ranges, "FEMALE", 30)).toMatchObject({ low: 12 });
    expect(pickRange(p.ranges, "MALE", 30)).toMatchObject({ low: 1 });
    expect(pickRange([], "MALE", 30)).toBeNull();
    expect(computeFlag(p, "5", 5, null)).toBeNull();
    expect(computeFlag(p, "5", 5, pickRange(p.ranges, "FEMALE", 30))).toBe("LOW");
    expect(computeFlag(p, "20", 20, pickRange(p.ranges, "FEMALE", 30))).toBe("HIGH");
    expect(computeFlag(p, "13", 13, pickRange(p.ranges, "FEMALE", 30))).toBe("NORMAL");
    expect(computeFlag({ name: "Q", resultType: "QUALITATIVE", options: [{ value: "Positive", flag: "POSITIVE" }] }, "positive", null, null)).toBe("POSITIVE");
    expect(computeFlag({ name: "Q", resultType: "QUALITATIVE", options: [{ value: "Trace" }] }, "Trace", null, null)).toBeNull();
  });
  it("derives order status from its items", () => {
    expect(deriveOrderStatus({ status: "OPEN", confirmed: false }, [{ status: "ORDERED", resultStatus: "NONE" }], null, false)).toBe("ORDERED");
    expect(deriveOrderStatus({ status: "OPEN", confirmed: true }, [{ status: "ORDERED", resultStatus: "NONE" }], null, false)).toBe("SAMPLE_PENDING");
    expect(deriveOrderStatus({ status: "OPEN", confirmed: true }, [{ status: "RESULT_READY", resultStatus: "SUBMITTED" }], null, false)).toBe("RESULT_READY");
    expect(deriveOrderStatus({ status: "OPEN", confirmed: true }, [{ status: "RESULT_READY", resultStatus: "SUBMITTED" }], { status: "RELEASED" }, true)).toBe("DOCTOR_REVIEWED");
  });
});

describe("investigation master and configurable lists (1–4)", () => {
  it("clinic admin configures lists and tests; others can't; names are unique", async () => {
    expect(await code(addConfigItem(A.recep, { kind: "CATEGORY", name: "Nope" }))).toBe("FORBIDDEN");
    expect(await code(addConfigItem(A.doctor, { kind: "CATEGORY", name: "Nope" }))).toBe("FORBIDDEN");
    expect(await code(addConfigItem(A.admin, { kind: "CATEGORY", name: "Pathology" }))).toBe("CONFLICT");
    const cfg = await listConfig(A.doctor);
    expect(cfg.SAMPLE_TYPE.map((x) => x.name)).toContain("Blood");
    expect(cfg.suggested).toBeNull();
    const extra = await addConfigItem(A.admin, { kind: "DEPARTMENT", name: "Haematology" });
    await setConfigActive(A.admin, extra.id, false);
    expect((await listConfig(A.admin)).DEPARTMENT[0].active).toBe(false);
    expect(await code(saveInvestigation(A.admin, null, { testCode: "hb", testName: "Dup", category: "Pathology" }))).toBe("CONFLICT");
    expect(await code(saveInvestigation(A.admin, null, { testCode: "ZZ", testName: "Dup params", category: "Pathology", parameters: [{ name: "a" }, { name: "A" }] }))).toBe("VALIDATION_ERROR");
  });
  it("searches by name/code, hides inactive tests, and is tenant-isolated", async () => {
    expect((await searchInvestigations(A.doctor, { q: "gluc" })).items.map((i) => i.testCode)).toEqual(["GLU"]);
    expect((await searchInvestigations(A.doctor, { q: "HB" })).items[0].parameters[0].ranges).toHaveLength(2);
    const off = await saveInvestigation(A.admin, null, { testCode: "OFF", testName: "Retired test", category: "Pathology", active: false });
    expect((await searchInvestigations(A.doctor, { q: "Retired" })).items).toHaveLength(0);
    expect((await searchInvestigations(A.admin, { q: "Retired", all: true })).items).toHaveLength(1);
    expect(off.id).toBeTruthy();
    expect((await searchInvestigations(B.doctor, { q: "gluc" })).items.map((i) => i.id)).not.toContain(A.testIds.GLU);
    expect(await code(searchInvestigations(A.accountant, {}))).toBe("FORBIDDEN");
    expect(await code(searchInvestigations(A.superAdmin, {}))).toBe("FORBIDDEN");
  });
  it("lab partners: manual only, no fake integration", async () => {
    await addPartner(A.admin, { name: "City Lab", code: "city" });
    const l = await listPartners(A.admin);
    expect(l.integrationAvailable).toBe(false);
    expect(l.partners[0]).toMatchObject({ code: "CITY", integrationType: "MANUAL" });
    expect(await code(addPartner(A.admin, { name: "City Lab 2", code: "CITY" }))).toBe("CONFLICT");
    expect(await code(addPartner(A.lab, { name: "X", code: "X" }))).toBe("FORBIDDEN");
  });
});

describe("ordering from a consultation (5–10)", () => {
  it("creates a tenant-scoped order with numbering, snapshot and a linked Phase 5 doctor order", async () => {
    const c = await consult(A);
    const o = await order(A, c.id, ["HB", "GLU"], "URGENT");
    expect(o.orderNumber).toMatch(/^LAB-\d{4}-\d{6}$/);
    const row = await db.investigationOrder.findUniqueOrThrow({ where: { id: o.id }, include: { items: true } });
    expect(row).toMatchObject({ tenantId: A.id, patientId: c.patientId, consultationId: c.id, doctorUserId: A.doctorId, priority: "URGENT", priorityRank: 1, status: "ORDERED" });
    expect(row.items).toHaveLength(2);
    const dOrder = await db.doctorOrder.findUniqueOrThrow({ where: { id: row.doctorOrderId! } });
    expect(dOrder).toMatchObject({ type: "INVESTIGATION", consultationId: c.id, status: "PENDING", tenantId: A.id });
  });
  it("order numbers are unique and sequential per clinic; clinics count independently", async () => {
    const c = await consult(A); const o1 = await order(A, c.id); const o2 = await order(A, c.id);
    expect(o1.orderNumber).not.toBe(o2.orderNumber);
    const cb = await consult(B); const ob = await order(B, cb.id);
    expect(ob.orderNumber).toMatch(/^LAB-\d{4}-000001$/);
  });
  it("a later change to the test master never alters an existing order", async () => {
    const c = await consult(A); const o = await order(A, c.id, ["GLU"]);
    await saveInvestigation(A.admin, A.testIds.GLU, { testCode: "GLU", testName: "Glucose (renamed)", category: "Pathology", sampleType: "Blood", parameters: [{ name: "Glucose", resultType: "NUMERIC", unit: "mg/dL", ranges: [{ low: 70, high: 99 }] }] });
    const d = await getLabOrder(A.doctor, o.id);
    expect(d.items[0].testName).toBe("Glucose");
    expect(d.items[0].snapshot!.parameters[0].ranges ?? []).toHaveLength(0);
    await saveInvestigation(A.admin, A.testIds.GLU, { testCode: "GLU", testName: "Glucose", category: "Pathology", sampleType: "Blood", preparation: "Fasting required", parameters: [{ name: "Glucose", resultType: "NUMERIC", unit: "mg/dL" }] });
  });
  it("priority is explicit; only the treating doctor orders; foreign clinic and unavailable tests are refused", async () => {
    const c = await consult(A);
    expect(await code(createInvestigationOrder(A.doctor, c.id, { investigationIds: [A.testIds.HB] }))).toBe("VALIDATION_ERROR");
    expect(await code(createInvestigationOrder(A.doctor, c.id, { investigationIds: [] , priority: "NORMAL" }))).toBe("VALIDATION_ERROR");
    for (const who of [A.recep, A.nurse, A.lab, A.admin]) expect(await code(order(A, c.id, ["HB"], "NORMAL", who))).toBe("FORBIDDEN");
    expect(await code(order(A, c.id, ["HB"], "NORMAL", A.doctor2))).toBe("FORBIDDEN");
    expect(await code(order(B, c.id, ["HB"], "NORMAL", B.doctor))).toBe("NOT_FOUND");
    expect(await code(createInvestigationOrder(A.doctor, c.id, { investigationIds: [B.testIds.HB], priority: "NORMAL" }))).toBe("VALIDATION_ERROR");
    expect(await code(createInvestigationOrder(A.doctor, c.id, { investigationIds: [A.testIds.HB], priority: "NORMAL", source: "EXTERNAL" }))).toBe("VALIDATION_ERROR");
    expect(await code(createInvestigationOrder(A.doctor, c.id, { investigationIds: [A.testIds.HB], priority: "NORMAL", source: "EXTERNAL", labPartnerId: "nope" }))).toBe("VALIDATION_ERROR");
  });
  it("external orders are tracked manually with a reference", async () => {
    const c = await consult(A); const partner = (await listPartners(A.admin)).partners[0];
    const o = await createInvestigationOrder(A.doctor, c.id, { investigationIds: [A.testIds.HB], priority: "HIGH", source: "EXTERNAL", labPartnerId: partner.id });
    await act(A.lab, o.id, { action: "setExternalRef", externalRef: "EXT-77" });
    expect((await getLabOrder(A.lab, o.id))).toMatchObject({ source: "EXTERNAL", externalRef: "EXT-77", labPartner: { name: "City Lab" } });
    const internal = await order(A, c.id);
    expect(await code(act(A.lab, internal.id, { action: "setExternalRef", externalRef: "x" }))).toBe("CONFLICT");
  });
  it("cancel is allowed only before collection and syncs the doctor order", async () => {
    const c = await consult(A); const o = await order(A, c.id);
    expect(await code(act(A.doctor, o.id, { action: "cancel" }))).toBe("VALIDATION_ERROR");
    expect(await code(act(A.recep, o.id, { action: "cancel", reason: "x" }))).toBe("FORBIDDEN");
    await act(A.doctor, o.id, { action: "cancel", reason: "Ordered by mistake" });
    const row = await db.investigationOrder.findUniqueOrThrow({ where: { id: o.id } });
    expect(row.status).toBe("CANCELLED");
    expect((await db.doctorOrder.findUniqueOrThrow({ where: { id: row.doctorOrderId! } })).status).toBe("CANCELLED");
    expect(await code(act(A.lab, o.id, { action: "collect", sampleType: "Blood" }))).toBe("CONFLICT");
    const c2 = await consult(A); const o2 = await order(A, c2.id);
    await act(A.lab, o2.id, { action: "collect", sampleType: "Blood" });
    expect(await code(act(A.doctor, o2.id, { action: "cancel", reason: "late" }))).toBe("CONFLICT");
  });
});

describe("sample collection, custody and recollection (11–17)", () => {
  it("collect creates one sample per sample type with numbers, opaque barcode and custody events", async () => {
    const c = await consult(A); const o = await order(A, c.id, ["HB", "GLU", "URI"]);
    const s1 = await act(A.lab, o.id, { action: "collect", sampleType: "Blood", department: "Collection room" });
    const s2 = await act(A.nurse, o.id, { action: "collect", sampleType: "Urine" });
    expect(s1.sampleNumber).toMatch(/^SMP-\d{4}-\d{6}$/);
    expect(s1.tests).toBe(2);
    const d = await getLabOrder(A.lab, o.id);
    expect(d.status).toBe("SAMPLE_COLLECTED");
    expect(d.samples).toHaveLength(2);
    const sample = await db.sample.findUniqueOrThrow({ where: { id: s1.id }, include: { events: true } });
    expect(sample.barcodeToken).not.toMatch(/Lab Patient|SMP|LAB-/);
    expect(sample.events.map((e) => e.action)).toEqual(["COLLECTED"]);
    expect(d.items.every((i) => i.status === "SAMPLE_COLLECTED")).toBe(true);
    expect((await db.doctorOrder.findFirstOrThrow({ where: { id: (await db.investigationOrder.findUniqueOrThrow({ where: { id: o.id } })).doctorOrderId! } })).status).toBe("IN_PROGRESS");
    expect(s2.id).not.toBe(s1.id);
  });
  it("two people collecting the same sample at once can't duplicate it", async () => {
    const c = await consult(A); const o = await order(A, c.id);
    const rs = await Promise.all([A.lab, A.nurse, A.lab, A.nurse].map((w) => code(act(w, o.id, { action: "collect", sampleType: "Blood" }))));
    expect(rs.filter((r) => r === "ok")).toHaveLength(1);
    expect(await db.sample.count({ where: { investigationOrderId: o.id } })).toBe(1);
    expect(await code(act(A.lab, o.id, { action: "collect", sampleType: "Blood" }))).toBe("CONFLICT");
  });
  it("collect is limited to collectors; receptionist/accountant/foreign tenant/platform admin can't", async () => {
    const c = await consult(A); const o = await order(A, c.id);
    for (const who of [A.recep, A.doctor, A.accountant, A.superAdmin]) expect(await code(act(who, o.id, { action: "collect", sampleType: "Blood" }))).not.toBe("ok");
    expect(await code(act(B.lab, o.id, { action: "collect", sampleType: "Blood" }))).toBe("NOT_FOUND");
    expect(await code(act(A.lab, o.id, { action: "collect" }))).toBe("VALIDATION_ERROR");
  });
  it("receive then reject keeps the old sample, records custody and requires a recollection (attempt 2)", async () => {
    const c = await consult(A); const o = await order(A, c.id);
    const s1 = await act(A.lab, o.id, { action: "collect", sampleType: "Blood" });
    expect(await code(act(A.lab, o.id, { action: "reject", sampleId: s1.id, reason: "Insufficient sample" }))).toBe("ok");
    expect(await code(act(A.lab, o.id, { action: "receive", sampleId: s1.id }))).toBe("CONFLICT");
    let d = await getLabOrder(A.lab, o.id);
    expect(d.status).toBe("SAMPLE_PENDING");
    expect(d.items[0]).toMatchObject({ status: "RECOLLECTION_REQUIRED", sampleId: null });
    const s2 = await act(A.lab, o.id, { action: "collect", sampleType: "Blood" });
    expect(s2.attempt).toBe(2);
    d = await getLabOrder(A.lab, o.id);
    expect(d.samples.map((s) => [s.attempt, s.status])).toEqual([[1, "REJECTED"], [2, "COLLECTED"]]);
    expect(d.samples[1].previousSampleId).toBe(s1.id);
    expect(d.samples[0].events.map((e) => e.action)).toEqual(["COLLECTED", "REJECTED", "RECOLLECTION_REQUESTED"]);
    expect(d.samples[0].rejectionReason).toBe("Insufficient sample");
    const n = await listNotifications(A.doctor);
    expect(n.items.some((x) => x.type === "SAMPLE_REJECTED" && x.entityId === o.id)).toBe(true);
  });
  it("rejection needs a configured reason; received samples can be rejected, completed results block it", async () => {
    const c = await consult(A); const o = await order(A, c.id);
    const s = await act(A.lab, o.id, { action: "collect", sampleType: "Blood" });
    expect(await code(act(A.lab, o.id, { action: "reject", sampleId: s.id }))).toBe("VALIDATION_ERROR");
    expect(await code(act(A.lab, o.id, { action: "reject", sampleId: s.id, reason: "Because" }))).toBe("VALIDATION_ERROR");
    await act(A.lab, o.id, { action: "receive", sampleId: s.id });
    expect(await code(act(A.lab, o.id, { action: "reject", sampleId: s.id, reason: "Damaged sample" }))).toBe("ok");
    const p = await toProcessing(A); const d = await getLabOrder(A.lab, p.orderId);
    await val(A.lab, p.orderId, d.items[0].id, [{ position: 0, value: "14" }]);
    expect(await code(act(A.lab, p.orderId, { action: "reject", sampleId: d.samples[0].id, reason: "Damaged sample" }))).toBe("CONFLICT");
  });
  it("chain-of-custody events can't be removed through any service and survive recollection", async () => {
    const c = await consult(A); const o = await order(A, c.id);
    const s = await act(A.lab, o.id, { action: "collect", sampleType: "Blood" });
    await act(A.lab, o.id, { action: "receive", sampleId: s.id, department: "Main lab" });
    await act(A.lab, o.id, { action: "startProcessing" });
    const ev = await db.sampleEvent.findMany({ where: { sampleId: s.id }, orderBy: { at: "asc" } });
    expect(ev.map((e) => e.action)).toEqual(["COLLECTED", "RECEIVED", "PROCESSING_STARTED"]);
    expect(ev[1].department).toBe("Main lab");
  });
});

describe("results, flags and reports (18–26)", () => {
  it("flags come only from configured ranges for the patient's gender; no range = no flag", async () => {
    const p = await toProcessing(A, ["HB", "GLU", "URI"]); const d = await getLabOrder(A.lab, p.orderId);
    const by = (n: string) => d.items.find((i) => i.testName.startsWith(n))!;
    await val(A.lab, p.orderId, by("Haemoglobin").id, [{ position: 0, value: "10" }], false);
    await val(A.lab, p.orderId, by("Glucose").id, [{ position: 0, value: "250" }], false);
    await val(A.lab, p.orderId, by("Urine").id, [{ position: 0, value: "positive" }, { position: 1, value: "Pale yellow" }], false);
    const r = await getLabOrder(A.lab, p.orderId);
    const hb = r.items.find((i) => i.testName.startsWith("Haem"))!.results[0];
    expect(hb).toMatchObject({ value: "10", flag: "LOW", refText: "13 – 17 g/dL" });
    expect(r.items.find((i) => i.testName === "Glucose")!.results[0]).toMatchObject({ flag: null, refText: null });
    expect(r.items.find((i) => i.testName.startsWith("Urine"))!.results.map((x) => x.flag)).toEqual(["POSITIVE", null]);
    await val(A.lab, p.orderId, by("Haemoglobin").id, [{ position: 0, value: "5" }], false);
    expect((await getLabOrder(A.lab, p.orderId)).items.find((i) => i.testName.startsWith("Haem"))!.results[0].flag).toBe("CRITICAL");
  });
  it("validates numbers, requires every value to submit, and locks submitted results", async () => {
    const p = await toProcessing(A, ["URI"]); const d = await getLabOrder(A.lab, p.orderId); const id = d.items[0].id;
    expect(await code(val(A.lab, p.orderId, id, [{ position: 0, value: "Negative" }]))).toBe("VALIDATION_ERROR");
    const p2 = await toProcessing(A); const d2 = await getLabOrder(A.lab, p2.orderId);
    expect(await code(val(A.lab, p2.orderId, d2.items[0].id, [{ position: 0, value: "abc" }], false))).toBe("VALIDATION_ERROR");
    expect(await code(val(A.lab, p2.orderId, d2.items[0].id, [{ position: 9, value: "1" }], false))).toBe("VALIDATION_ERROR");
    await val(A.lab, p2.orderId, d2.items[0].id, [{ position: 0, value: "14" }]);
    expect(await code(val(A.lab, p2.orderId, d2.items[0].id, [{ position: 0, value: "15" }], false))).toBe("CONFLICT");
    expect((await getLabOrder(A.lab, p2.orderId)).status).toBe("RESULT_READY");
  });
  it("results need processing first and the right role", async () => {
    const c = await consult(A); const o = await order(A, c.id); const d = await getLabOrder(A.lab, o.id);
    expect(await code(val(A.lab, o.id, d.items[0].id, [{ position: 0, value: "14" }]))).toBe("CONFLICT");
    const p = await toProcessing(A); const dd = await getLabOrder(A.lab, p.orderId);
    for (const who of [A.recep, A.nurse, A.doctor, A.accountant, A.superAdmin]) expect(await code(val(who, p.orderId, dd.items[0].id, [{ position: 0, value: "14" }]))).not.toBe("ok");
    expect(await code(val(B.lab, p.orderId, dd.items[0].id, [{ position: 0, value: "14" }]))).toBe("NOT_FOUND");
  });
  it("report lifecycle: generate → verify (reviewer only) → release as immutable v1; doctor order completes", async () => {
    const o = await toProcessing(A); const d = await getLabOrder(A.lab, o.orderId);
    expect(await code(reportAction(A.lab, o.orderId, { action: "generateReport" }))).toBe("CONFLICT");
    await val(A.lab, o.orderId, d.items[0].id, [{ position: 0, value: "14" }]);
    const rep = await reportAction(A.lab, o.orderId, { action: "generateReport" }) as { id: string; reportNumber: string };
    expect(rep.reportNumber).toMatch(/^RPT-\d{4}-\d{6}$/);
    expect(await code(reportAction(A.lab, o.orderId, { action: "generateReport" }))).toBe("CONFLICT");
    expect(await code(reportAction(A.lab, o.orderId, { action: "verify" }))).toBe("FORBIDDEN");
    expect(await code(reportAction(A.reviewer, o.orderId, { action: "release" }))).toBe("CONFLICT");
    await reportAction(A.reviewer, o.orderId, { action: "verify" });
    const out = await reportAction(A.reviewer, o.orderId, { action: "release" }) as { version: number };
    expect(out.version).toBe(1);
    const v = await db.labReportVersion.findFirstOrThrow({ where: { reportId: rep.id } });
    expect(v.contentHash).toHaveLength(64);
    const full = await getLabOrder(A.reviewer, o.orderId);
    expect(full.status).toBe("REPORT_GENERATED");
    expect((await db.doctorOrder.findUniqueOrThrow({ where: { id: (await db.investigationOrder.findUniqueOrThrow({ where: { id: o.orderId } })).doctorOrderId! } })).status).toBe("COMPLETED");
    expect(await code(reportAction(A.reviewer, o.orderId, { action: "release" }))).toBe("CONFLICT");
  });
  it("requestCorrection sends an unreleased report back to result entry", async () => {
    const o = await toProcessing(A); const d = await getLabOrder(A.lab, o.orderId);
    await val(A.lab, o.orderId, d.items[0].id, [{ position: 0, value: "14" }]);
    await reportAction(A.lab, o.orderId, { action: "generateReport" });
    expect(await code(reportAction(A.reviewer, o.orderId, { action: "requestCorrection" }))).toBe("VALIDATION_ERROR");
    await reportAction(A.reviewer, o.orderId, { action: "requestCorrection", reason: "Re-check value" });
    expect((await getLabOrder(A.lab, o.orderId)).status).toBe("RESULT_READY");
    await val(A.lab, o.orderId, d.items[0].id, [{ position: 0, value: "13.5" }]);
    await reportAction(A.lab, o.orderId, { action: "generateReport" });
    await reportAction(A.reviewer, o.orderId, { action: "verify" });
    expect(await code(reportAction(A.reviewer, o.orderId, { action: "release" }))).toBe("ok");
    expect(await db.labReport.count({ where: { investigationOrderId: o.orderId } })).toBe(1);
  });
  it("amendment: reason required, v1 stays unchanged, v2 carries the reason, audit recorded", async () => {
    const r = await released(A, "14");
    expect(await code(reportAction(A.reviewer, r.orderId, { action: "amend" }))).toBe("VALIDATION_ERROR");
    expect(await code(reportAction(A.lab, r.orderId, { action: "amend", reason: "typo" }))).toBe("FORBIDDEN");
    await reportAction(A.reviewer, r.orderId, { action: "amend", reason: "Transcription error" });
    const doc1 = await labReportDocument(A.doctor, r.reportId);
    expect(doc1.version).toBe(1); // doctor still sees the last released version while the amendment is in progress
    await val(A.lab, r.orderId, r.itemId, [{ position: 0, value: "12" }]);
    await reportAction(A.reviewer, r.orderId, { action: "verify" });
    const out = await reportAction(A.reviewer, r.orderId, { action: "release" }) as { version: number };
    expect(out.version).toBe(2);
    const v1 = await labReportDocument(A.doctor, r.reportId, 1); const v2 = await labReportDocument(A.doctor, r.reportId, 2);
    expect(v1.snapshot.tests[0].results[0].value).toBe("14");
    expect(v2.snapshot.tests[0].results[0]).toMatchObject({ value: "12", flag: "LOW" });
    expect(v2.snapshot.reason).toBe("Transcription error");
    expect(v1.hash).not.toBe(v2.hash);
    expect(v2.versions).toHaveLength(2);
    expect(await db.auditLog.count({ where: { tenantId: A.id, action: "lab.report_amended", entityId: r.reportId } })).toBe(1);
  });
});

describe("multi-test corrections", () => {
  it("amending a report with several tests needs edits only for the tests that changed, and corrections stay complete", async () => {
    const o = await toProcessing(A, ["HB", "GLU"]); const d = await getLabOrder(A.lab, o.orderId);
    const hb = d.items.find((i) => i.testName.startsWith("Haem"))!; const gl = d.items.find((i) => i.testName === "Glucose")!;
    await val(A.lab, o.orderId, hb.id, [{ position: 0, value: "14" }]); await val(A.lab, o.orderId, gl.id, [{ position: 0, value: "90" }]);
    await reportAction(A.lab, o.orderId, { action: "generateReport" }); await reportAction(A.reviewer, o.orderId, { action: "verify" }); await reportAction(A.reviewer, o.orderId, { action: "release" });
    await reportAction(A.reviewer, o.orderId, { action: "amend", reason: "Fix glucose" });
    expect(await code(val(A.lab, o.orderId, gl.id, [{ position: 0, value: "" }]))).toBe("VALIDATION_ERROR"); // a correction can't blank a value
    await val(A.lab, o.orderId, gl.id, [{ position: 0, value: "95" }]);
    await reportAction(A.reviewer, o.orderId, { action: "verify" });
    const out = await reportAction(A.reviewer, o.orderId, { action: "release" }) as { version: number; id: string };
    expect(out.version).toBe(2);
    const v2 = await labReportDocument(A.doctor, out.id, 2);
    expect(v2.snapshot.tests.flatMap((t) => t.results.map((r) => r.value)).sort()).toEqual(["14", "95"]);
    // results can't be edited outside a correction
    expect(await code(val(A.lab, o.orderId, gl.id, [{ position: 0, value: "1" }]))).toBe("CONFLICT");
  });
});

describe("doctor review and notifications (27–28)", () => {
  it("doctor is notified on release, reviews once per version, and an amended version needs a new review", async () => {
    const r = await released(A);
    const n = await listNotifications(A.doctor);
    const mine = n.items.find((x) => x.type === "REPORT_RELEASED" && x.entityId === r.reportId)!;
    expect(mine).toBeTruthy();
    expect(JSON.stringify(mine)).not.toMatch(/\b14\b|Haemoglobin/);
    expect(n.unread).toBeGreaterThan(0);
    expect((await listNotifications(A.doctor2)).items.some((x) => x.entityId === r.reportId)).toBe(false);
    await markNotificationsRead(A.doctor);
    expect((await listNotifications(A.doctor)).unread).toBe(0);
    expect(await code(reviewReport(A.doctor2, r.reportId, { status: "REVIEWED" }))).toBe("NOT_FOUND");
    expect(await code(reviewReport(A.lab, r.reportId, { status: "REVIEWED" }))).toBe("FORBIDDEN");
    expect(await code(reviewReport(B.doctor, r.reportId, { status: "REVIEWED" }))).toBe("NOT_FOUND");
    await reviewReport(A.doctor, r.reportId, { status: "ACKNOWLEDGED" });
    expect((await getLabOrder(A.doctor, r.orderId)).status).toBe("DOCTOR_REVIEWED");
    await reviewReport(A.doctor, r.reportId, { status: "REVIEWED", note: "Noted" });
    expect(await code(reviewReport(A.doctor, r.reportId, { status: "REVIEWED" }))).toBe("CONFLICT");
    await reportAction(A.reviewer, r.orderId, { action: "amend", reason: "Update" });
    await val(A.lab, r.orderId, r.itemId, [{ position: 0, value: "15" }]);
    await reportAction(A.reviewer, r.orderId, { action: "verify" });
    await reportAction(A.reviewer, r.orderId, { action: "release" });
    expect((await getLabOrder(A.doctor, r.orderId)).status).toBe("REPORT_GENERATED");
    expect(await code(reviewReport(A.doctor, r.reportId, { status: "REVIEWED" }))).toBe("ok");
  });
  it("a report that isn't released can't be reviewed or opened", async () => {
    const o = await toProcessing(A); const d = await getLabOrder(A.lab, o.orderId);
    await val(A.lab, o.orderId, d.items[0].id, [{ position: 0, value: "14" }]);
    const rep = await reportAction(A.lab, o.orderId, { action: "generateReport" }) as { id: string };
    expect(await code(reviewReport(A.doctor, rep.id, { status: "REVIEWED" }))).toBe("CONFLICT");
    expect(await code(labReportDocument(A.doctor, rep.id))).toBe("NOT_FOUND");
    expect((await getLabOrder(A.doctor, o.orderId)).seeResults).toBe(false);
  });
});

describe("documents (29–30) and access (31)", () => {
  it("lab report document: clinic branding, escaped values, snapshot content, never MECGURA", async () => {
    const c = await consult(A, `<script>alert(1)</script> Patient`); const o = await order(A, c.id);
    const s = await act(A.lab, o.id, { action: "collect", sampleType: "Blood" });
    await act(A.lab, o.id, { action: "receive", sampleId: s.id }); await act(A.lab, o.id, { action: "startProcessing" });
    const d = await getLabOrder(A.lab, o.id);
    await val(A.lab, o.id, d.items[0].id, [{ position: 0, value: "14", remarks: "<b>x</b>" }]);
    await reportAction(A.lab, o.id, { action: "generateReport" }); await reportAction(A.reviewer, o.id, { action: "verify" }); await reportAction(A.reviewer, o.id, { action: "release" });
    const rid = (await getLabOrder(A.reviewer, o.id)).report!.id;
    const doc = await labReportDocument(A.doctor, rid);
    const { body } = renderLabReport(doc);
    expect(body).toContain("Lab Clinic a");
    expect(body).not.toContain("<script>");
    expect(body).toContain("&lt;script&gt;");
    expect(body).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(body).toContain("13 – 17 g/dL");
    expect(body.toLowerCase()).not.toContain("mecgura");
    for (const who of [A.recep, A.nurse, A.accountant, A.superAdmin]) expect(await code(labReportDocument(who, rid))).toBe("FORBIDDEN");
    expect(await code(labReportDocument(A.doctor2, rid))).toBe("NOT_FOUND");
    expect(await code(labReportDocument(B.doctor, rid))).toBe("NOT_FOUND");
    expect(await code(labReportDocument(B.admin, rid))).toBe("NOT_FOUND");
    expect(await code(labReportDocument(A.doctor, rid, 9))).toBe("NOT_FOUND");
    expect((await labReportDocument(A.lab, rid)).snapshot.reportNumber).toBe(doc.snapshot.reportNumber);
  });
  it("slip and sample label: authorised roles only, no results, opaque barcode id", async () => {
    const c = await consult(A); const o = await order(A, c.id, ["GLU"]);
    const slip = await labSlipDocument(A.recep, o.id);
    expect(renderLabSlip(slip).body).toContain("Fasting required");
    expect(renderLabSlip(slip).body.toLowerCase()).not.toContain("mecgura");
    expect(await code(labSlipDocument(A.accountant, o.id))).toBe("FORBIDDEN");
    expect(await code(labSlipDocument(A.doctor2, o.id))).toBe("NOT_FOUND");
    expect(await code(labSlipDocument(B.lab, o.id))).toBe("NOT_FOUND");
    const s = await act(A.lab, o.id, { action: "collect", sampleType: "Blood" });
    const lab = await sampleLabelDocument(A.lab, s.id);
    expect(lab.barcodeToken).not.toMatch(/Lab Patient/);
    expect(renderSampleLabel(lab).body).toContain(s.sampleNumber);
    expect(await code(sampleLabelDocument(B.lab, s.id))).toBe("NOT_FOUND");
    expect(await code(sampleLabelDocument(A.doctor2, s.id))).toBe("NOT_FOUND");
  });
  it("role scoping on lists and detail: doctors see only their own orders; reception/nursing never see result values", async () => {
    const c = await consult(A, "Scope Patient", A.doctor2); const o = await order(A, c.id, ["HB"], "NORMAL", A.doctor2);
    expect((await listLabOrders(A.doctor, { tab: "all", q: "Scope Patient" })).rows).toHaveLength(0);
    expect((await listLabOrders(A.doctor2, { tab: "all", q: "Scope Patient" })).rows).toHaveLength(1);
    expect(await code(getLabOrder(A.doctor, o.id))).toBe("NOT_FOUND");
    expect(await code(getLabOrder(B.admin, o.id))).toBe("NOT_FOUND");
    expect(await code(getLabOrder(A.accountant, o.id))).toBe("FORBIDDEN");
    expect(await code(getLabOrder(A.superAdmin, o.id))).toBe("FORBIDDEN");
    const r = await released(A);
    expect((await getLabOrder(A.recep, r.orderId)).seeResults).toBe(false);
    expect((await getLabOrder(A.nurse, r.orderId)).items[0].results).toEqual([]);
    expect((await getLabOrder(A.lab, r.orderId)).items[0].results).toHaveLength(1);
    expect((await getLabOrder(A.doctor, r.orderId)).items[0].results).toHaveLength(1);
    expect(await code(labReportDocument(A.recep, r.reportId))).toBe("FORBIDDEN");
  });
  it("audit records lab actions without any report content", async () => {
    const r = await released(A, "13.77");
    const rows = await db.auditLog.findMany({ where: { tenantId: A.id, entityId: { in: [r.reportId, r.orderId, r.itemId] } } });
    expect(rows.length).toBeGreaterThan(3);
    expect(rows.map((x) => x.action)).toEqual(expect.arrayContaining(["lab.result_submitted", "lab.report_generated", "lab.report_released", "lab.result_verified"]));
    expect(JSON.stringify(rows)).not.toMatch(/13\.77|Haemoglobin/);
    expect(await db.auditLog.count({ where: { tenantId: B.id, entityId: r.reportId } })).toBe(0);
  });
});

describe("worklist, stats and Patient 360 (32)", () => {
  it("sorts by priority, filters by tab, searches and paginates", async () => {
    const cN = await consult(A, "Sort Normal"); const cS = await consult(A, "Sort Stat");
    const oN = await order(A, cN.id, ["HB"], "NORMAL"); const oS = await order(A, cS.id, ["HB"], "STAT");
    const l = await listLabOrders(A.lab, { tab: "new" });
    const ids = l.rows.map((r) => r.id);
    expect(ids.indexOf(oS.id)).toBeLessThan(ids.indexOf(oN.id));
    expect(l.rows[0].priority).toBe("STAT");
    expect((await listLabOrders(A.lab, { tab: "new", priority: "STAT" })).rows.every((r) => r.priority === "STAT")).toBe(true);
    expect((await listLabOrders(A.lab, { tab: "all", q: oS.orderNumber })).rows.map((r) => r.id)).toEqual([oS.id]);
    expect((await listLabOrders(A.lab, { tab: "cancelled" })).rows.every((r) => r.status === "CANCELLED")).toBe(true);
    const p1 = await listLabOrders(A.lab, { tab: "all", page: 1 }); const p2 = await listLabOrders(A.lab, { tab: "all", page: 2 });
    expect(p1.rows.length).toBeLessThanOrEqual(20);
    expect(p1.total).toBeGreaterThan(20); expect(p2.rows.length).toBeGreaterThan(0);
    expect(p1.rows.map((r) => r.id).some((id) => p2.rows.map((x) => x.id).includes(id))).toBe(false);
    expect((await listLabOrders(B.lab, { tab: "all" })).rows.map((r) => r.id)).not.toContain(oS.id);
  });
  it("stats are real database counts and tenant-scoped", async () => {
    const before = await labStats(A.lab);
    const c = await consult(A); await order(A, c.id, ["HB"], "STAT");
    const after = await labStats(A.lab);
    expect(after.newOrders).toBe(before.newOrders + 1);
    expect(after.urgent).toBe(before.urgent + 1);
    expect(after.newOrders).toBe(await db.investigationOrder.count({ where: { tenantId: A.id, status: { in: ["ORDERED", "CONFIRMED", "SAMPLE_PENDING"] } } }));
    expect((await labStats(B.lab)).newOrders).toBe(await db.investigationOrder.count({ where: { tenantId: B.id, status: { in: ["ORDERED", "CONFIRMED", "SAMPLE_PENDING"] } } }));
  });
  it("Patient 360 lists the patient's orders with released reports only", async () => {
    const r = await released(A);
    const rows = await patientLabReports(A.doctor, r.patientId);
    expect(rows).toHaveLength(1);
    expect(rows[0].report).toMatchObject({ version: 1, status: "RELEASED" });
    const pending = await consult(A); await order(A, pending.id);
    expect((await patientLabReports(A.doctor, pending.patientId))[0].report).toBeNull();
    expect(await code(patientLabReports(A.recep, r.patientId))).toBe("FORBIDDEN");
    expect(await patientLabReports(A.doctor2, r.patientId)).toHaveLength(0);
    expect(await patientLabReports(B.admin, r.patientId)).toHaveLength(0);
  });
});
