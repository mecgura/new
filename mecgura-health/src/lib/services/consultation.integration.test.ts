import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { asTenant, ctxFor, makeUser, seedSystemData, uniq } from "@/test/helpers";
import type { RoleKey } from "@/lib/permissions";
import { renderPrescription, prescriptionHtmlFile } from "@/lib/clinical/prescription-html";
import { addDiagnosis, addVitals, consultationAction, consultationContext, getConsultation, listConsultations, listTemplates, patchConsultation, removeDiagnosis, saveTemplate, startConsultation, updateDiagnosis } from "./consultation";
import { createOrder, listOrders, updateOrderStatus } from "./orders";
import { addMedicine, searchMedicines } from "./medicines";
import { patientTimeline, registerPatient } from "./patient-crm";
import { prescriptionAction, prescriptionDocument, prescriptionSummary, recordPrescriptionAccess, savePrescriptionDraft } from "./prescription";
import { registerVisit, queueSnapshot } from "./opd";
import { saveSchedule } from "./schedule";
import { createRecord } from "./patient-records";

const code = (p: Promise<unknown>) => p.then(() => "ok", (e) => (e instanceof AppError ? e.code : `ERR:${e}`));
type Ctx = ReturnType<typeof asTenant>;
interface T { id: string; admin: Ctx; doctor: Ctx; doctor2: Ctx; recep: Ctx; nurse: Ctx; compounder: Ctx; accountant: Ctx; lab: Ctx; superAdmin: Ctx; doctorId: string; doctor2Id: string; nurseId: string; compounderId: string }

async function mkTenant(label: string): Promise<T> {
  const t = await db.tenant.create({ data: { name: `Clinic ${label}`, slug: uniq(`cn-${label}`).slice(0, 30), status: "ACTIVE", address: "1 Test Road", city: "Testville", contactPhone: "+911234500000" } });
  const mk = async (role: RoleKey) => { const { user } = await makeUser(role, t.id); return { user, ctx: asTenant({ ...ctxFor(user, role, t.id), tenant: { ...ctxFor(user, role, t.id).tenant!, name: `Clinic ${label}`, address: "1 Test Road", city: "Testville", contactPhone: "+911234500000", logoUrl: null, timezone: "Asia/Kolkata", brand: { primary: "#0e7c86", secondary: "#000000", accent: "#000000" }, state: null, pincode: null, contactEmail: null, legalName: null } as never }) }; };
  const [a, d, d2, r, n, c, ac, l] = [await mk("CLINIC_ADMIN"), await mk("DOCTOR"), await mk("DOCTOR"), await mk("RECEPTIONIST"), await mk("NURSE"), await mk("COMPOUNDER"), await mk("ACCOUNTANT"), await mk("LAB_STAFF")];
  const sa = await makeUser("SUPER_ADMIN", null); const sac = asTenant({ ...ctxFor(sa.user, "SUPER_ADMIN", t.id), viewingAs: true });
  const sched = { slotMinutes: 15, bufferMinutes: 0, onlineBooking: false, advanceDays: 30, minNoticeMinutes: 0, windows: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, start: "09:00", end: "17:00" })) };
  await saveSchedule(a.ctx, d.user.id, sched); await saveSchedule(a.ctx, d2.user.id, sched);
  await db.doctorProfile.upsert({ where: { userId: d.user.id }, update: { qualification: "MBBS (test)", specialization: "General practice (test)", registrationNumber: "TEST-REG-1" }, create: { tenantId: t.id, userId: d.user.id, qualification: "MBBS (test)", specialization: "General practice (test)", registrationNumber: "TEST-REG-1" } });
  return { id: t.id, admin: a.ctx, doctor: d.ctx, doctor2: d2.ctx, recep: r.ctx, nurse: n.ctx, compounder: c.ctx, accountant: ac.ctx, lab: l.ctx, superAdmin: sac, doctorId: d.user.id, doctor2Id: d2.user.id, nurseId: n.user.id, compounderId: c.user.id };
}
let phoneN = 0;
async function visit(t: T, doctorUserId = t.doctorId) {
  // the queue allows one patient with a doctor at a time (Phase 3 rule): park whoever the previous test left in the room
  await db.opdVisit.updateMany({ where: { tenantId: t.id, doctorUserId, status: { in: ["CALLED", "IN_CONSULTATION"] } }, data: { status: "COMPLETED" } });
  const p = await registerPatient(t.recep, { name: "Consult Patient", phone: `97${String(30000000 + ++phoneN * 11).slice(0, 8)}`, allowDuplicate: true, dateOfBirth: "1990-01-01", gender: "MALE" });
  const v = await registerVisit(t.recep, { patient: { patientId: p.id, viaProfile: true }, doctorUserId });
  return { patientId: p.id, visitId: v.id, token: v.token };
}
async function startC(t: T, doctor: Ctx = t.doctor) { const v = await visit(t, doctor.user.id); const c = await startConsultation(doctor, v.visitId); return { ...v, id: c.id }; }
const med = (over: Record<string, unknown> = {}) => ({ name: "Paracetamol (test entry)", strength: "500 mg", dose: "1 tablet", frequency: "Twice daily", morning: true, night: true, foodTiming: "AFTER_FOOD", durationDays: 3, instructions: "Take with water", ...over });
async function readyToFinalize(t: T, c: { id: string }, withRx = true) {
  const cur = await getConsultation(t.doctor, c.id);
  await patchConsultation(t.doctor, c.id, { rev: cur.rev, chiefComplaints: [{ text: "Cough", duration: "5 days" }], clinicalNotes: "Test note" });
  if (withRx) await savePrescriptionDraft(t.doctor, c.id, { items: [med()] });
  await consultationAction(t.doctor, c.id, { action: "review" });
}

let A: T, B: T;
beforeAll(async () => { await seedSystemData(); A = await mkTenant("a"); B = await mkTenant("b"); });

describe("start consultation from Live OPD (1–3, 22)", () => {
  it("opens a consultation linked to the right tenant, patient, doctor and visit, and moves the queue", async () => {
    const v = await visit(A);
    const r = await startConsultation(A.doctor, v.visitId);
    expect(r.existing).toBe(false);
    const row = await db.consultation.findUniqueOrThrow({ where: { id: r.id } });
    expect(row).toMatchObject({ tenantId: A.id, patientId: v.patientId, doctorUserId: A.doctorId, opdVisitId: v.visitId, status: "IN_PROGRESS" });
    expect(row.number).toMatch(/^CONS-\d{4}-\d{6}$/);
    expect((await db.opdVisit.findUniqueOrThrow({ where: { id: v.visitId } })).status).toBe("IN_CONSULTATION");
  });
  it("is idempotent: starting twice (or in two tabs) never creates a second consultation", async () => {
    const v = await visit(A);
    const results = await Promise.all(Array.from({ length: 6 }, () => startConsultation(A.doctor, v.visitId)));
    expect(new Set(results.map((r) => r.id)).size).toBe(1);
    expect(await db.consultation.count({ where: { opdVisitId: v.visitId } })).toBe(1);
  });
  it("consultation numbers are unique per clinic and never reuse a database id", async () => {
    const nums = [];
    for (let i = 0; i < 3; i++) { const c = await startC(A); nums.push((await db.consultation.findUniqueOrThrow({ where: { id: c.id } })).number); await consultationAction(A.doctor, c.id, { action: "cancel" }); await db.opdVisit.update({ where: { id: c.visitId }, data: { status: "COMPLETED" } }); }
    expect(new Set(nums).size).toBe(3);
  });
  it("only the visit's own doctor starts it; other roles and clinics can't", async () => {
    const v = await visit(A);
    expect(await code(startConsultation(A.doctor2, v.visitId))).toBe("FORBIDDEN");
    for (const who of [A.recep, A.nurse, A.compounder, A.admin, A.accountant]) expect(await code(startConsultation(who, v.visitId))).toBe("FORBIDDEN");
    expect(await code(startConsultation(B.doctor, v.visitId))).toBe("NOT_FOUND");
    expect(await code(startConsultation(A.superAdmin, v.visitId))).toBe("FORBIDDEN");
  });
  it("refuses completed, cancelled and parked visits", async () => {
    const v = await visit(A); await db.opdVisit.update({ where: { id: v.visitId }, data: { status: "COMPLETED" } });
    expect(await code(startConsultation(A.doctor, v.visitId))).toBe("CONFLICT");
    const w = await visit(A); await db.opdVisit.update({ where: { id: w.visitId }, data: { status: "ON_HOLD" } });
    expect(await code(startConsultation(A.doctor, w.visitId))).toBe("CONFLICT");
  });
  it("the queue shows the consultation link after start", async () => {
    const c = await startC(A);
    const snap = await queueSnapshot(A.doctor); if (snap.notModified) throw new Error();
    expect(snap.visits.find((x) => x.id === c.visitId)).toBeTruthy();
  });
});

describe("vitals, notes, diagnosis (4–6)", () => {
  let C: { id: string; patientId: string };
  beforeAll(async () => { C = await startC(A); });
  it("saves vitals with BMI, by the doctor and by nursing staff; rejects bad values", async () => {
    const r = await addVitals(A.doctor, C.id, { systolic: 128, diastolic: 82, pulse: 76, temperature: 98.4, spo2: 98, weightKg: 73, heightCm: 180 });
    expect(r.bmi).toBe(22.5);
    await addVitals(A.nurse, C.id, { pulse: 80, painScore: 2 });
    const view = await getConsultation(A.doctor, C.id);
    expect(view.vitals.length).toBe(2); expect(view.vitals.some((v: { recordedBy: string }) => v.recordedBy)).toBe(true);
    for (const bad of [{ systolic: 80, diastolic: 120 }, { systolic: 120 }, { spo2: 140 }, { temperature: 20 }, {}, { pulse: "abc" }]) expect(await code(addVitals(A.doctor, C.id, bad))).toBe("VALIDATION_ERROR");
    expect(await code(addVitals(A.recep, C.id, { pulse: 70 }))).toBe("FORBIDDEN");
    expect(await code(addVitals(A.doctor2, C.id, { pulse: 70 }))).toBe("FORBIDDEN");
    expect(await code(addVitals(B.nurse, C.id, { pulse: 70 }))).toBe("NOT_FOUND");
  });
  it("saves complaints, symptoms, history, examination, assessment, advice and follow-up; autosave uses revisions", async () => {
    let cur = await getConsultation(A.doctor, C.id);
    const r1 = await patchConsultation(A.doctor, C.id, { rev: cur.rev, chiefComplaints: [{ text: "Fever", duration: "3 days" }, { text: "Cough" }], symptoms: [{ name: "Headache", severity: "mild" }], history: { hpi: "Started 3 days ago" }, examination: { general: "Alert", custom: [{ title: "Throat", text: "noted" }] }, assessment: "Doctor's assessment", impression: "Impression text", differential: "Alt", clinicalNotes: "Notes", advice: "Rest, fluids", followUpRequired: true, followUpAfterDays: 7, followUpNotes: "Review" });
    expect(r1.rev).toBe(cur.rev + 1);
    cur = await getConsultation(A.doctor, C.id);
    expect(cur.content.chiefComplaints[0]).toMatchObject({ text: "Fever", duration: "3 days" });
    expect(cur.content).toMatchObject({ assessment: "Doctor's assessment", advice: "Rest, fluids", followUp: { required: true, afterDays: 7, notes: "Review" } });
    expect(cur.content.examination.custom[0].title).toBe("Throat");
    expect(await code(patchConsultation(A.doctor, C.id, { rev: cur.rev - 1, clinicalNotes: "stale" }))).toBe("CONFLICT"); // stale tab can't overwrite
    expect(await code(patchConsultation(A.doctor, C.id, { rev: cur.rev, chiefComplaints: [{ text: "" }] }))).toBe("VALIDATION_ERROR");
    expect(await code(patchConsultation(A.doctor2, C.id, { rev: cur.rev, clinicalNotes: "x" }))).toBe("FORBIDDEN");
    expect(await code(patchConsultation(A.recep, C.id, { rev: cur.rev, clinicalNotes: "x" }))).toBe("FORBIDDEN");
    expect(await code(patchConsultation(A.nurse, C.id, { rev: cur.rev, clinicalNotes: "x" }))).toBe("FORBIDDEN");
  });
  it("diagnosis: manual entry, one primary at a time, edit, remove", async () => {
    const a = await addDiagnosis(A.doctor, C.id, { name: "Viral illness (doctor's entry)", type: "PRIMARY" });
    await addDiagnosis(A.doctor, C.id, { name: "Second item", type: "SECONDARY", code: "X1" });
    const b = await addDiagnosis(A.doctor, C.id, { name: "New primary", type: "PRIMARY" });
    let d = (await getConsultation(A.doctor, C.id)).diagnoses;
    expect(d.filter((x: { type: string }) => x.type === "PRIMARY").map((x: { name: string }) => x.name)).toEqual(["New primary"]);
    await updateDiagnosis(A.doctor, C.id, a.id, { name: "Viral illness (edited)", type: "PRIMARY" });
    d = (await getConsultation(A.doctor, C.id)).diagnoses;
    expect(d.filter((x: { type: string }) => x.type === "PRIMARY").map((x: { name: string }) => x.name)).toEqual(["Viral illness (edited)"]);
    await removeDiagnosis(A.doctor, C.id, b.id);
    expect(await code(removeDiagnosis(A.doctor, C.id, b.id))).toBe("NOT_FOUND");
    expect(await code(addDiagnosis(A.recep, C.id, { name: "Not allowed" }))).toBe("FORBIDDEN");
    expect(await code(addDiagnosis(A.nurse, C.id, { name: "Not allowed" }))).toBe("FORBIDDEN");
    expect(await code(addDiagnosis(A.doctor, C.id, { name: "x" }))).toBe("VALIDATION_ERROR");
  });
});

describe("prescription draft → review → finalize (7–12, 21)", () => {
  it("saves a multi-medicine draft in order and validates required fields", async () => {
    const c = await startC(A);
    await savePrescriptionDraft(A.doctor, c.id, { items: [med(), med({ name: "Second medicine", strength: "10 mg", frequency: "Once daily", morning: false, night: false, evening: true }), med({ name: "Third" })] });
    const rx = await prescriptionSummary(A.doctor, c.id, true);
    expect(rx!.items.map((i) => i.name)).toEqual(["Paracetamol (test entry)", "Second medicine", "Third"]);
    expect(rx).toMatchObject({ status: "DRAFT", number: null, currentVersion: 0 });
    await savePrescriptionDraft(A.doctor, c.id, { items: [med({ name: "Reordered first" }), med()] });
    expect((await prescriptionSummary(A.doctor, c.id, true))!.items[0].name).toBe("Reordered first");
    for (const bad of [{ items: [med({ name: "" })] }, { items: [med({ dose: "" })] }, { items: [med({ frequency: "" })] }, { items: [med({ durationDays: -2 })] }, { items: [med({ startDate: "2030-02-01", endDate: "2030-01-01" })] }, { items: [med({ foodTiming: "WHENEVER" })] }]) expect(await code(savePrescriptionDraft(A.doctor, c.id, bad))).toBe("VALIDATION_ERROR");
    expect(await code(savePrescriptionDraft(A.recep, c.id, { items: [med()] }))).toBe("FORBIDDEN");
    expect(await code(savePrescriptionDraft(A.compounder, c.id, { items: [med()] }))).toBe("FORBIDDEN");
    expect(await code(savePrescriptionDraft(A.doctor2, c.id, { items: [med()] }))).toBe("FORBIDDEN");
  });
  it("review needs medicines; finalize needs review + explicit confirmation; assigns a clinic RX number and version 1", async () => {
    const c = await startC(A);
    expect(await code(prescriptionAction(A.doctor, c.id, { action: "review" }))).toBe("VALIDATION_ERROR");
    await savePrescriptionDraft(A.doctor, c.id, { items: [med()] });
    expect(await code(prescriptionAction(A.doctor, c.id, { action: "finalize", confirm: true }))).toBe("CONFLICT"); // not reviewed yet
    await prescriptionAction(A.doctor, c.id, { action: "review" });
    expect(await code(prescriptionAction(A.doctor, c.id, { action: "finalize" }))).toBe("VALIDATION_ERROR"); // no confirm
    const f = await prescriptionAction(A.doctor, c.id, { action: "finalize", confirm: true }) as { number: string; version: number };
    expect(f.number).toMatch(/^RX-\d{4}-\d{6}$/); expect(f.version).toBe(1);
    expect(await prescriptionSummary(A.doctor, c.id, true)).toMatchObject({ status: "FINALIZED", number: f.number, currentVersion: 1 });
    expect(await db.prescriptionVersion.count({ where: { prescription: { consultationId: c.id } } })).toBe(1);
    expect(await code(prescriptionAction(A.doctor, c.id, { action: "finalize", confirm: true }))).toBe("CONFLICT");
  });
  it("CONCURRENCY: double-clicking finalize makes exactly one version", async () => {
    const c = await startC(A);
    await savePrescriptionDraft(A.doctor, c.id, { items: [med()] }); await prescriptionAction(A.doctor, c.id, { action: "review" });
    const r = await Promise.all(Array.from({ length: 6 }, () => code(prescriptionAction(A.doctor, c.id, { action: "finalize", confirm: true }))));
    expect(r.filter((x) => x === "ok").length).toBe(1);
    expect(await db.prescriptionVersion.count({ where: { prescription: { consultationId: c.id } } })).toBe(1);
  });
  it("prescription numbers are unique and sequential per clinic; another clinic counts separately", async () => {
    const nums: string[] = [];
    const cs: { id: string }[] = []; for (let i = 0; i < 5; i++) cs.push(await startC(A));
    await Promise.all(cs.map(async (c) => { await savePrescriptionDraft(A.doctor, c.id, { items: [med()] }); await prescriptionAction(A.doctor, c.id, { action: "review" }); const f = await prescriptionAction(A.doctor, c.id, { action: "finalize", confirm: true }) as { number: string }; nums.push(f.number); }));
    expect(new Set(nums).size).toBe(5);
    const bc = await startC(B); await savePrescriptionDraft(B.doctor, bc.id, { items: [med()] }); await prescriptionAction(B.doctor, bc.id, { action: "review" });
    expect(((await prescriptionAction(B.doctor, bc.id, { action: "finalize", confirm: true })) as { number: string }).number).toMatch(/-000001$/);
  });
  it("a finalized prescription can't be edited silently; amendment creates version 2 with a reason and keeps version 1", async () => {
    const c = await startC(A);
    await savePrescriptionDraft(A.doctor, c.id, { items: [med()] }); await prescriptionAction(A.doctor, c.id, { action: "review" });
    const v1 = await prescriptionAction(A.doctor, c.id, { action: "finalize", confirm: true }) as { number: string };
    expect(await code(savePrescriptionDraft(A.doctor, c.id, { items: [med({ name: "Sneaky change" })] }))).toBe("CONFLICT");
    expect(await code(prescriptionAction(A.doctor, c.id, { action: "amend" }))).toBe("VALIDATION_ERROR");
    expect(await code(prescriptionAction(A.compounder, c.id, { action: "amend", reason: "no" }))).toBe("FORBIDDEN");
    expect(await code(prescriptionAction(A.admin, c.id, { action: "amend", reason: "admin edit" }))).toBe("FORBIDDEN");
    await prescriptionAction(A.doctor, c.id, { action: "amend", reason: "Dose corrected" });
    await savePrescriptionDraft(A.doctor, c.id, { items: [med({ dose: "2 tablets" })] });
    await prescriptionAction(A.doctor, c.id, { action: "review" });
    const v2 = await prescriptionAction(A.doctor, c.id, { action: "finalize", confirm: true }) as { number: string; version: number };
    expect(v2).toMatchObject({ number: v1.number, version: 2 }); // same number, new version
    const vers = await db.prescriptionVersion.findMany({ where: { prescription: { consultationId: c.id } }, orderBy: { version: "asc" } });
    expect(vers.length).toBe(2); expect(vers[1].reason).toBe("Dose corrected"); expect(vers[0].snapshot).toContain('"dose":"1 tablet"'); expect(vers[1].snapshot).toContain('"dose":"2 tablets"');
    expect(vers[0].contentHash).not.toBe(vers[1].contentHash);
    expect((await prescriptionSummary(A.doctor, c.id, false))!.versions.map((v) => v.version)).toEqual([2, 1]);
  });
  it("amending needs a reason to re-finalize and audits everything", async () => {
    const c = await startC(A);
    await savePrescriptionDraft(A.doctor, c.id, { items: [med()] }); await prescriptionAction(A.doctor, c.id, { action: "review" }); await prescriptionAction(A.doctor, c.id, { action: "finalize", confirm: true });
    await prescriptionAction(A.doctor, c.id, { action: "amend", reason: "typo" });
    const actions = (await db.auditLog.findMany({ where: { tenantId: A.id, OR: [{ entityId: c.id }, { entityType: "prescription" }] } })).map((l) => l.action);
    expect(actions).toEqual(expect.arrayContaining(["prescription.created", "prescription.reviewed", "prescription.finalized", "prescription.amended"]));
  });
});

describe("consultation finalize, amend, immutability (5, 13, 21)", () => {
  it("full flow: ready → finalize (with prescription) completes the OPD visit and snapshots the content", async () => {
    const c = await startC(A); await readyToFinalize(A, c);
    expect(await code(consultationAction(A.doctor, c.id, { action: "finalize" }))).toBe("VALIDATION_ERROR"); // needs confirm
    const f = await consultationAction(A.doctor, c.id, { action: "finalize", confirm: true }) as { status: string; version: number; prescriptionNumber: string; visitCompleted: boolean };
    expect(f).toMatchObject({ status: "FINALIZED", version: 1, visitCompleted: true }); expect(f.prescriptionNumber).toMatch(/^RX-/);
    expect((await db.opdVisit.findUniqueOrThrow({ where: { id: c.visitId } })).status).toBe("COMPLETED");
    const ver = await db.consultationVersion.findFirstOrThrow({ where: { consultationId: c.id } });
    expect(ver.snapshot).toContain("Cough"); expect(ver.contentHash).toHaveLength(64);
    expect((await db.prescription.findFirstOrThrow({ where: { consultationId: c.id } })).status).toBe("FINALIZED");
  });
  it("finalized content is immutable: every edit path refuses", async () => {
    const c = await startC(A); await readyToFinalize(A, c); await consultationAction(A.doctor, c.id, { action: "finalize", confirm: true });
    const cur = await getConsultation(A.doctor, c.id);
    expect(await code(patchConsultation(A.doctor, c.id, { rev: cur.rev, clinicalNotes: "changed" }))).toBe("CONFLICT");
    expect(await code(addDiagnosis(A.doctor, c.id, { name: "Late diagnosis" }))).toBe("CONFLICT");
    expect(await code(addVitals(A.nurse, c.id, { pulse: 70 }))).toBe("CONFLICT");
    expect(await code(addVitals(A.doctor, c.id, { pulse: 70 }))).toBe("CONFLICT");
    expect(await code(savePrescriptionDraft(A.doctor, c.id, { items: [med({ name: "Late" })] }))).toBe("CONFLICT");
    expect(await code(consultationAction(A.doctor, c.id, { action: "finalize", confirm: true }))).toBe("CONFLICT");
    expect(await code(consultationAction(A.doctor, c.id, { action: "cancel" }))).toBe("CONFLICT");
    expect(await code(consultationAction(A.doctor, c.id, { action: "edit" }))).toBe("CONFLICT");
    expect((await db.consultation.findUniqueOrThrow({ where: { id: c.id } })).clinicalNotes).toBe("Test note");
  });
  it("CONCURRENCY: duplicate finalization makes one version", async () => {
    const c = await startC(A); await readyToFinalize(A, c);
    const r = await Promise.all(Array.from({ length: 5 }, () => code(consultationAction(A.doctor, c.id, { action: "finalize", confirm: true }))));
    expect(r.filter((x) => x === "ok").length).toBe(1);
    expect(await db.consultationVersion.count({ where: { consultationId: c.id } })).toBe(1);
    expect(await db.prescriptionVersion.count({ where: { prescription: { consultationId: c.id } } })).toBe(1);
  });
  it("amendment: reason required, reopens editing, re-finalizes as version 2", async () => {
    const c = await startC(A); await readyToFinalize(A, c); await consultationAction(A.doctor, c.id, { action: "finalize", confirm: true });
    expect(await code(consultationAction(A.doctor, c.id, { action: "amend" }))).toBe("VALIDATION_ERROR");
    expect(await code(consultationAction(A.admin, c.id, { action: "amend", reason: "admin" }))).toBe("FORBIDDEN");
    expect(await code(consultationAction(A.doctor2, c.id, { action: "amend", reason: "other doctor" }))).toBe("FORBIDDEN");
    await consultationAction(A.doctor, c.id, { action: "amend", reason: "Added missing complaint" });
    const cur = await getConsultation(A.doctor, c.id);
    expect(cur.status).toBe("IN_PROGRESS"); expect(cur.amendReason).toBe("Added missing complaint");
    await patchConsultation(A.doctor, c.id, { rev: cur.rev, clinicalNotes: "Amended note" });
    await consultationAction(A.doctor, c.id, { action: "review" });
    const f = await consultationAction(A.doctor, c.id, { action: "finalize", confirm: true }) as { version: number };
    expect(f.version).toBe(2);
    const vers = await db.consultationVersion.findMany({ where: { consultationId: c.id }, orderBy: { version: "asc" } });
    expect(vers.length).toBe(2); expect(vers[0].snapshot).toContain("Test note"); expect(vers[1].snapshot).toContain("Amended note"); expect(vers[1].reason).toBe("Added missing complaint");
    expect((await db.auditLog.findMany({ where: { entityId: c.id } })).map((l) => l.action)).toEqual(expect.arrayContaining(["consultation.started", "consultation.ready_for_review", "consultation.finalized", "consultation.amended"]));
  });
  it("role limits on the workflow: only the treating doctor reviews/finalizes", async () => {
    const c = await startC(A); const cur = await getConsultation(A.doctor, c.id);
    await patchConsultation(A.doctor, c.id, { rev: cur.rev, clinicalNotes: "x" });
    for (const who of [A.recep, A.compounder, A.accountant, A.lab]) expect(await code(consultationAction(who, c.id, { action: "review" }))).toBe("FORBIDDEN");
    for (const who of [A.nurse, A.admin, A.doctor2]) expect(await code(consultationAction(who, c.id, { action: "review" }))).toBe("FORBIDDEN");
    expect(await code(consultationAction(A.doctor, c.id, { action: "finalize", confirm: true }))).toBe("CONFLICT"); // must be reviewed first
    await consultationAction(A.doctor, c.id, { action: "review" });
    await patchConsultation(A.doctor, c.id, { rev: (await getConsultation(A.doctor, c.id)).rev, clinicalNotes: "edit after review" });
    expect((await getConsultation(A.doctor, c.id)).status).toBe("IN_PROGRESS"); // editing sends it back from review
  });
  it("an empty consultation can't be sent to review; cancel works until a prescription is final", async () => {
    const c = await startC(A);
    expect(await code(consultationAction(A.doctor, c.id, { action: "review" }))).toBe("VALIDATION_ERROR");
    expect((await consultationAction(A.doctor, c.id, { action: "cancel", reason: "opened by mistake" }) as { status: string }).status).toBe("CANCELLED");
    expect(await code(addDiagnosis(A.doctor, c.id, { name: "After cancel" }))).toBe("CONFLICT");
    const d = await startC(A); await savePrescriptionDraft(A.doctor, d.id, { items: [med()] }); await prescriptionAction(A.doctor, d.id, { action: "review" }); await prescriptionAction(A.doctor, d.id, { action: "finalize", confirm: true });
    expect(await code(consultationAction(A.doctor, d.id, { action: "cancel" }))).toBe("CONFLICT");
  });
});

describe("doctor orders (14, 15)", () => {
  let C: { id: string };
  beforeAll(async () => { C = await startC(A); });
  it("doctor creates typed orders; assignee must be clinic staff; orders never touch the prescription", async () => {
    await savePrescriptionDraft(A.doctor, C.id, { items: [med()] });
    const before = JSON.stringify(await prescriptionSummary(A.doctor, C.id, true));
    const o = await createOrder(A.doctor, C.id, { type: "MEDICATION", title: "Give prescribed medicine", priority: "HIGH", assignedToId: A.compounderId });
    await createOrder(A.doctor, C.id, { type: "INVESTIGATION", title: "Blood CBC" });
    await createOrder(A.doctor, C.id, { type: "FOLLOW_UP", title: "Review after 7 days" });
    expect(await code(createOrder(A.doctor, C.id, { type: "OTHER", title: "Bad assignee", assignedToId: B.nurseId }))).toBe("VALIDATION_ERROR");
    expect(await code(createOrder(A.doctor, C.id, { type: "WRONG", title: "x y" }))).toBe("VALIDATION_ERROR");
    expect(JSON.stringify(await prescriptionSummary(A.doctor, C.id, true))).toBe(before);
    expect((await getConsultation(A.doctor, C.id)).orders.length).toBe(3);
    expect(o.id).toBeTruthy();
  });
  it("who may create, see and move orders", async () => {
    for (const who of [A.recep, A.nurse, A.compounder, A.accountant, A.admin, A.doctor2]) expect(await code(createOrder(who, C.id, { type: "OTHER", title: "Not allowed" }))).toBe("FORBIDDEN");
    const compOrders = (await listOrders(A.compounder, {})).orders;
    expect(compOrders.every((o: { type: string }) => ["MEDICATION", "DOCUMENT", "OTHER"].includes(o.type))).toBe(true); expect(compOrders.some((o: { type: string }) => o.type === "INVESTIGATION")).toBe(false);
    expect(await code(listOrders(A.recep, {}))).toBe("FORBIDDEN"); expect(await code(listOrders(A.accountant, {}))).toBe("FORBIDDEN");
    const med1 = compOrders.find((o: { type: string }) => o.type === "MEDICATION");
    expect(await code(updateOrderStatus(A.compounder, med1.id, { status: "CANCELLED" }))).toBe("FORBIDDEN");
    expect(await code(updateOrderStatus(A.compounder, med1.id, { status: "IN_PROGRESS" }))).toBe("ok");
    expect(await code(updateOrderStatus(A.compounder, med1.id, { status: "COMPLETED" }))).toBe("ok");
    expect(await code(updateOrderStatus(A.compounder, med1.id, { status: "IN_PROGRESS" }))).toBe("CONFLICT");
    const row = await db.doctorOrder.findUniqueOrThrow({ where: { id: med1.id } });
    expect(row).toMatchObject({ status: "COMPLETED", completedById: A.compounderId });
    const inv = (await listOrders(A.nurse, {})).orders.find((o: { type: string }) => o.type === "INVESTIGATION");
    expect(await code(updateOrderStatus(A.compounder, inv?.id ?? "x", { status: "COMPLETED" }))).toBe("FORBIDDEN"); // compounder doesn't work investigations
    expect(await code(updateOrderStatus(A.nurse, inv.id, { status: "IN_PROGRESS" }))).toBe("ok");
    expect(await code(updateOrderStatus(A.doctor, inv.id, { status: "CANCELLED" }))).toBe("ok");
    expect(await code(updateOrderStatus(A.doctor2, inv.id, { status: "COMPLETED" }))).toBe("FORBIDDEN");
    expect(await code(updateOrderStatus(B.doctor, inv.id, { status: "COMPLETED" }))).toBe("NOT_FOUND");
    expect((await db.auditLog.findMany({ where: { tenantId: A.id, entityType: "doctor_order" } })).map((l) => l.action)).toEqual(expect.arrayContaining(["order.created", "order.updated", "order.completed"]));
  });
});

describe("medicine search and templates (no invented data)", () => {
  it("with no medicine list or external source the search honestly reports 'not configured'", async () => {
    const r = await searchMedicines(B.doctor, "para");
    expect(r).toEqual({ configured: false, source: null, items: [] });
    expect(await db.medicineReference.count()).toBe(0); // nothing was seeded
  });
  it("a clinic can load its own real list; search is tenant-scoped and permission-guarded", async () => {
    await addMedicine(A.admin, { name: "Test-Med-Alpha", genericName: "alphagen", brandName: "AlphaBrand", strength: "100 mg", form: "tablet" });
    const hit = await searchMedicines(A.doctor, "alphagen");
    expect(hit.configured).toBe(true); expect(hit.items[0]).toMatchObject({ name: "Test-Med-Alpha", strength: "100 mg" });
    expect((await searchMedicines(A.doctor, "AlphaBrand")).items.length).toBe(1);
    expect((await searchMedicines(A.doctor, "x")).items).toEqual([]); // too short
    expect((await searchMedicines(B.doctor, "alphagen")).items).toEqual([]); // other clinic: not configured, nothing leaks
    expect(await code(addMedicine(A.doctor, { name: "Nope Med" }))).toBe("FORBIDDEN");
    for (const who of [A.recep, A.compounder, A.accountant]) expect(await code(searchMedicines(who, "alpha"))).toBe("FORBIDDEN");
  });
  it("templates are structural scaffolds; doctors keep their own; applying is a client-side copy into a draft", async () => {
    const t = await listTemplates(A.doctor);
    expect(t.builtin.map((x) => x.name)).toEqual(expect.arrayContaining(["General consultation", "Fever", "Follow-up", "Routine check-up"]));
    expect(JSON.stringify(t.builtin)).not.toMatch(/normal|no abnormality|within normal/i); // never pre-filled findings
    const s = await saveTemplate(A.doctor, { name: "My template", content: { examination: "General:" } });
    expect((await listTemplates(A.doctor)).mine.map((m) => m.id)).toContain(s.id);
    expect((await listTemplates(A.doctor2)).mine.length).toBe(0);
    expect(await code(saveTemplate(A.nurse, { name: "Nurse template", content: {} }))).toBe("FORBIDDEN");
  });
});

describe("tenant isolation, access control and privacy (17–20, 24)", () => {
  let CA: { id: string; patientId: string }, CB: { id: string; patientId: string };
  beforeAll(async () => {
    CA = await startC(A); CB = await startC(B);
    await savePrescriptionDraft(B.doctor, CB.id, { items: [med({ name: "BetaOnlyMedicine" })] }); await prescriptionAction(B.doctor, CB.id, { action: "review" }); await prescriptionAction(B.doctor, CB.id, { action: "finalize", confirm: true });
    await createOrder(B.doctor, CB.id, { type: "OTHER", title: "Beta order" });
  });
  it("Clinic A can't read or change Clinic B's consultation, prescription, orders, vitals or diagnoses (all services)", async () => {
    for (const who of [A.doctor, A.admin, A.nurse]) {
      expect(await code(getConsultation(who, CB.id))).toBe("NOT_FOUND");
      expect(await code(consultationContext(who, CB.id))).toBe("NOT_FOUND");
    }
    expect(await code(patchConsultation(A.doctor, CB.id, { rev: 0, clinicalNotes: "x" }))).toBe("NOT_FOUND");
    expect(await code(consultationAction(A.doctor, CB.id, { action: "review" }))).toBe("NOT_FOUND");
    expect(await code(addVitals(A.nurse, CB.id, { pulse: 70 }))).toBe("NOT_FOUND");
    expect(await code(addDiagnosis(A.doctor, CB.id, { name: "Injected" }))).toBe("NOT_FOUND");
    expect(await code(savePrescriptionDraft(A.doctor, CB.id, { items: [med()] }))).toBe("NOT_FOUND");
    expect(await code(prescriptionAction(A.doctor, CB.id, { action: "amend", reason: "hijack" }))).toBe("NOT_FOUND");
    expect(await code(prescriptionDocument(A.admin, CB.id))).toBe("NOT_FOUND");
    expect(await code(recordPrescriptionAccess(A.compounder, CB.id, "PRINTED", 1))).toBe("NOT_FOUND");
    expect(await code(createOrder(A.doctor, CB.id, { type: "OTHER", title: "Injected order" }))).toBe("NOT_FOUND");
    const bOrder = await db.doctorOrder.findFirstOrThrow({ where: { consultationId: CB.id } });
    expect(await code(updateOrderStatus(A.doctor, bOrder.id, { status: "COMPLETED" }))).toBe("NOT_FOUND");
    expect(JSON.stringify((await listOrders(A.admin, {})).orders)).not.toContain("Beta order");
    expect((await listConsultations(A.doctor, { patientId: CB.patientId })).rows).toEqual([]);
    expect((await db.consultation.findUniqueOrThrow({ where: { id: CB.id } })).clinicalNotes).toBeNull();
  });
  it("opening another clinic's patient/visit by id gets nowhere", async () => {
    const vB = await visit(B);
    expect(await code(startConsultation(A.doctor, vB.visitId))).toBe("NOT_FOUND");
    expect(await db.consultation.count({ where: { opdVisitId: vB.visitId } })).toBe(0);
  });
  it("non-clinical roles and platform admins have no clinical access", async () => {
    for (const who of [A.recep, A.accountant, A.lab, A.compounder, A.superAdmin]) {
      expect(await code(getConsultation(who, CA.id))).toBe("FORBIDDEN");
      expect(await code(consultationContext(who, CA.id))).toBe("FORBIDDEN");
      expect(await code(listConsultations(who, {}))).toBe("FORBIDDEN");
    }
    expect(await code(patientTimeline(A.accountant, CA.patientId, {}))).toBe("FORBIDDEN");
    expect(await code(getConsultation(A.nurse, CA.id))).toBe("ok"); // nursing staff can read (and add vitals)
    expect(await code(getConsultation(A.doctor2, CA.id))).toBe("ok"); // colleagues in the same clinic can read, not edit
    expect(await code(getConsultation(A.admin, CA.id))).toBe("ok");
  });
  it("prescription documents: finalized only, print permission, tenant branding, audited, hash + escape", async () => {
    const c = await startC(A); await savePrescriptionDraft(A.doctor, c.id, { items: [med({ name: "<script>alert(1)</script>Med", instructions: "\"quoted\" & <b>bold</b>" })] });
    expect(await code(prescriptionDocument(A.doctor, c.id))).toBe("NOT_FOUND"); // draft: nothing to print
    await prescriptionAction(A.doctor, c.id, { action: "review" }); await prescriptionAction(A.doctor, c.id, { action: "finalize", confirm: true });
    for (const who of [A.recep, A.accountant, A.lab, A.nurse, A.superAdmin]) expect(await code(prescriptionDocument(who, c.id))).toBe("FORBIDDEN");
    const doc = await prescriptionDocument(A.compounder, c.id);
    expect(doc.clinic).toMatchObject({ name: "Clinic a", phone: "+911234500000", color: "#0e7c86" });
    expect(doc.snapshot).toMatchObject({ number: expect.stringMatching(/^RX-/), doctor: { registrationNumber: "TEST-REG-1", qualification: "MBBS (test)" } });
    const { body } = renderPrescription(doc);
    expect(body).toContain("Clinic a"); expect(body).not.toContain("MECGURA"); expect(body).toContain("TEST-REG-1");
    expect(body).not.toContain("<script>"); expect(body).toContain("&lt;script&gt;"); expect(body).not.toContain("<b>bold</b>");
    expect(prescriptionHtmlFile(doc)).toContain("<!doctype html>");
    await recordPrescriptionAccess(A.compounder, c.id, "PRINTED", 1); await recordPrescriptionAccess(A.doctor, c.id, "DOWNLOADED", 1);
    const acts = (await db.auditLog.findMany({ where: { tenantId: A.id, action: { in: ["prescription.printed", "prescription.downloaded"] } } })).map((l) => l.action);
    expect(acts).toEqual(expect.arrayContaining(["prescription.printed", "prescription.downloaded"]));
    expect(await code(prescriptionDocument(A.doctor, c.id, 9))).toBe("NOT_FOUND");
    // another clinic's branding on its own prescriptions
    const bd = await prescriptionDocument(B.doctor, CB.id);
    expect(bd.clinic.name).toBe("Clinic b"); expect(JSON.stringify(bd)).not.toContain("Clinic a");
  });
  it("audit logs hold ids and field names — never clinical text", async () => {
    const c = await startC(A); const cur = await getConsultation(A.doctor, c.id);
    await patchConsultation(A.doctor, c.id, { rev: cur.rev, clinicalNotes: "SECRET-CLINICAL-NOTE-TEXT", assessment: "SECRET-ASSESSMENT" });
    await addDiagnosis(A.doctor, c.id, { name: "SECRET-DIAGNOSIS-NAME" });
    await savePrescriptionDraft(A.doctor, c.id, { items: [med({ name: "SECRET-MEDICINE-NAME" })] });
    await addVitals(A.doctor, c.id, { pulse: 77, notes: "SECRET-VITALS-NOTE" });
    await createOrder(A.doctor, c.id, { type: "OTHER", title: "SECRET-ORDER-TITLE", description: "SECRET-ORDER-DESC" });
    const blob = JSON.stringify(await db.auditLog.findMany({ where: { tenantId: A.id }, select: { action: true, metadata: true } }));
    expect(blob).not.toContain("SECRET-");
  });
});

describe("Patient 360 integration, context sidebar (25)", () => {
  it("timeline gets consultation events (clinical roles only) and the sidebar shows prior clinical context", async () => {
    const c = await startC(A);
    await createRecord(A.doctor, c.patientId, "allergies", { allergen: "Penicillin (test)", severity: "MILD" });
    await createRecord(A.doctor, c.patientId, "medications", { name: "Existing medicine (test)", source: "PATIENT_REPORTED" });
    await addVitals(A.nurse, c.id, { pulse: 70 }); await addDiagnosis(A.doctor, c.id, { name: "Dx for timeline" });
    await readyToFinalize(A, c); await consultationAction(A.doctor, c.id, { action: "finalize", confirm: true });
    const types = (await patientTimeline(A.doctor, c.patientId, {})).events.map((e) => e.type);
    expect(types).toEqual(expect.arrayContaining(["CONSULTATION_STARTED", "VITALS_RECORDED", "DIAGNOSIS_ADDED", "PRESCRIPTION_CREATED", "PRESCRIPTION_FINALIZED", "CONSULTATION_FINALIZED"]));
    const ev = (await patientTimeline(A.doctor, c.patientId, { filter: "clinical" })).events.find((e) => e.type === "CONSULTATION_FINALIZED");
    expect(ev?.href).toBe(`/consultations/${c.id}`);
    expect(JSON.stringify((await patientTimeline(A.recep, c.patientId, {})).events)).not.toMatch(/CONSULTATION|PRESCRIPTION|Dx for timeline/);
    // next visit: the sidebar carries the earlier consultation, diagnosis, allergy, medicines and prescription
    const v2 = await registerVisit(A.recep, { patient: { patientId: c.patientId, viaProfile: true }, doctorUserId: A.doctorId });
    const c2 = await startConsultation(A.doctor, v2.id); const ctxData = await consultationContext(A.doctor, c2.id);
    expect(ctxData.allergies[0].allergen).toBe("Penicillin (test)"); expect(ctxData.currentMedications[0].name).toBe("Existing medicine (test)");
    expect(ctxData.previousDiagnoses).toContain("Dx for timeline"); expect(ctxData.previousConsultations[0]).toMatchObject({ id: c.id, complaint: "Cough" });
    expect(ctxData.recentPrescriptions[0].medicines.length).toBe(1); expect(ctxData.previousVitals[0].pulse).toBe(70); expect(ctxData.documents.available).toBe(false);
    expect(ctxData.currentMedications.map((m) => m.name)).not.toContain("Paracetamol (test entry)"); // old prescription isn't merged into "current"
  });
});
