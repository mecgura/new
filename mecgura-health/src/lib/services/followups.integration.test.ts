import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { addDays, todayIn, zonedToUtc } from "@/lib/scheduling/time";
import { asTenant, ctxFor, makeUser, seedSystemData, uniq } from "@/test/helpers";
import type { RoleKey } from "@/lib/permissions";
import { nextRecallDate, addMonths, dueBucket } from "@/lib/followups/core";
import { appointmentAction, createStaffAppointment } from "./appointments";
import { consultationAction, getConsultation, patchConsultation, startConsultation } from "./consultation";
import { assignableUsers, createFollowUp, editFollowUp, followUpAction, followUpStats, followUpTimeline, getFollowUp, getSettings, listFollowUps, logContact, patientFollowUps, updateSettings } from "./followups";
import { listNotifications } from "./lab-results";
import { registerVisit } from "./opd";
import { registerPatient, updatePatient } from "./patient-crm";
import { createRecall, listRecalls, recallAction } from "./recalls";
import { saveSchedule } from "./schedule";
import { savePrescriptionDraft } from "./prescription";

const TZ = "Asia/Kolkata";
const code = (p: Promise<unknown>) => p.then(() => "ok", (e) => (e instanceof AppError ? e.code : `ERR:${e}`));
type Ctx = ReturnType<typeof asTenant>;
interface T { id: string; admin: Ctx; doctor: Ctx; doctor2: Ctx; recep: Ctx; recep2: Ctx; nurse: Ctx; accountant: Ctx; lab: Ctx; superAdmin: Ctx; doctorId: string; recepId: string; recep2Id: string; nurseId: string; accountantId: string }
const today = () => todayIn(TZ);
const slotAt = (date: string, hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return zonedToUtc(date, h * 60 + m, TZ).toISOString(); };

async function mkTenant(label: string): Promise<T> {
  const t = await db.tenant.create({ data: { name: `FU Clinic ${label}`, slug: uniq(`fu-${label}`).slice(0, 30), status: "ACTIVE" } });
  const mk = async (role: RoleKey) => { const { user } = await makeUser(role, t.id); return { user, ctx: asTenant({ ...ctxFor(user, role, t.id), tenant: { ...ctxFor(user, role, t.id).tenant!, name: `FU Clinic ${label}`, timezone: TZ, brand: { primary: "#0e7c86", secondary: "#000", accent: "#000" } } as never }) }; };
  const [a, d, d2, r, r2, n, ac, l] = [await mk("CLINIC_ADMIN"), await mk("DOCTOR"), await mk("DOCTOR"), await mk("RECEPTIONIST"), await mk("RECEPTIONIST"), await mk("NURSE"), await mk("ACCOUNTANT"), await mk("LAB_STAFF")];
  const sa = await makeUser("SUPER_ADMIN", null); const sac = asTenant({ ...ctxFor(sa.user, "SUPER_ADMIN", t.id), viewingAs: true });
  const sched = { slotMinutes: 15, bufferMinutes: 0, onlineBooking: false, advanceDays: 60, minNoticeMinutes: 0, windows: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, start: "09:00", end: "17:00" })) };
  await saveSchedule(a.ctx, d.user.id, sched); await saveSchedule(a.ctx, d2.user.id, sched);
  return { id: t.id, admin: a.ctx, doctor: d.ctx, doctor2: d2.ctx, recep: r.ctx, recep2: r2.ctx, nurse: n.ctx, accountant: ac.ctx, lab: l.ctx, superAdmin: sac, doctorId: d.user.id, recepId: r.user.id, recep2Id: r2.user.id, nurseId: n.user.id, accountantId: ac.user.id };
}
let phoneN = 0;
async function patient(t: T, name = "FU Patient", extra: Record<string, unknown> = {}) {
  const p = await registerPatient(t.recep, { name, phone: `95${String(50000000 + ++phoneN * 17).slice(0, 8)}`, allowDuplicate: true, dateOfBirth: "1985-05-05", gender: "FEMALE", ...extra });
  return p.id as string;
}
async function consult(t: T, doctor: Ctx = t.doctor) {
  await db.opdVisit.updateMany({ where: { tenantId: t.id, doctorUserId: doctor.user.id, status: { in: ["CALLED", "IN_CONSULTATION"] } }, data: { status: "COMPLETED" } });
  const pid = await patient(t, "Consult FU Patient");
  const v = await registerVisit(t.recep, { patient: { patientId: pid, viaProfile: true }, doctorUserId: doctor.user.id });
  const c = await startConsultation(doctor, v.id);
  return { patientId: pid, id: c.id };
}
const manual = async (t: T, over: Record<string, unknown> = {}) => (await createFollowUp(t.recep, { patientId: await patient(t), title: "Call the patient", afterDays: 3, ...over })) as { id: string; followUpNumber: string };
const past = (id: string, days = 3) => db.followUp.update({ where: { id }, data: { dueDate: addDays(today(), -days) } });
const act = (who: Ctx, id: string, body: Record<string, unknown>) => followUpAction(who, id, body);
const contact = (who: Ctx, id: string, over: Record<string, unknown> = {}) => logContact(who, id, { method: "PHONE", outcome: "CONTACTED", ...over });
const futureSlot = (n = 5, hhmm = "10:00") => slotAt(addDays(today(), n), hhmm);

let A: T, B: T;
beforeAll(async () => { await seedSystemData(); A = await mkTenant("a"); B = await mkTenant("b"); });

describe("pure rules", () => {
  it("date math and buckets", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(nextRecallDate("2026-10-07", "YEARLY")).toBe("2027-10-07");
    expect(nextRecallDate("2026-10-07", "QUARTERLY")).toBe("2027-01-07");
    expect(nextRecallDate("2026-10-07", "CUSTOM", 2)).toBe("2026-12-07");
    expect(nextRecallDate("2026-10-07", "ONE_TIME")).toBeNull();
    expect(dueBucket("2026-10-01", "2026-10-07", "PENDING")).toBe("overdue");
    expect(dueBucket("2026-10-07", "2026-10-07", "DUE")).toBe("today");
    expect(dueBucket("2026-10-09", "2026-10-07", "PENDING")).toBe("upcoming");
    expect(dueBucket("2026-10-01", "2026-10-07", "COMPLETED")).toBe("closed");
  });
});

describe("creating follow-ups (1–3, 6)", () => {
  it("staff create a manual follow-up with a clinic-scoped number", async () => {
    const pid = await patient(A);
    const r = await createFollowUp(A.recep, { patientId: pid, title: "Call about the visit", afterDays: 2, priority: "HIGH", description: "Please reschedule", type: "MANUAL_FOLLOW_UP" }) as { id: string; followUpNumber: string };
    expect(r.followUpNumber).toMatch(/^FU-\d{4}-\d{6}$/);
    const row = await db.followUp.findUniqueOrThrow({ where: { id: r.id } });
    expect(row).toMatchObject({ tenantId: A.id, patientId: pid, status: "PENDING", priority: "HIGH", source: "MANUAL", dueDate: addDays(today(), 2), createdById: A.recepId });
    expect(await db.followUpEvent.count({ where: { followUpId: r.id, type: "CREATED" } })).toBe(1);
  });
  it("numbers are unique per clinic and clinics count independently", async () => {
    const a1 = await manual(A), a2 = await manual(A);
    expect(a1.followUpNumber).not.toBe(a2.followUpNumber);
    const b1 = await manual(B);
    expect(b1.followUpNumber).toMatch(/^FU-\d{4}-000001$/);
  });
  it("validates input: patient, due date or days, past dates, types", async () => {
    const pid = await patient(A);
    expect(await code(createFollowUp(A.recep, { title: "x1", afterDays: 1 }))).toBe("VALIDATION_ERROR");
    expect(await code(createFollowUp(A.recep, { patientId: pid, title: "Call" }))).toBe("VALIDATION_ERROR");
    expect(await code(createFollowUp(A.recep, { patientId: pid, title: "Call", dueDate: addDays(today(), -1) }))).toBe("VALIDATION_ERROR");
    expect(await code(createFollowUp(A.recep, { patientId: pid, title: "Call", afterDays: 1, type: "MAGIC" }))).toBe("VALIDATION_ERROR");
    expect(await code(createFollowUp(A.recep, { patientId: pid, title: "Call", afterDays: 1, assignedToId: A.accountantId }))).toBe("VALIDATION_ERROR");
    expect(await code(createFollowUp(A.recep, { patientId: pid, title: "Call", afterDays: 1, assignedToId: B.recepId }))).toBe("VALIDATION_ERROR");
  });
  it("roles: only those with followups.create; platform admin never", async () => {
    const pid = await patient(A);
    for (const who of [A.nurse, A.accountant, A.lab, A.superAdmin]) expect(await code(createFollowUp(who, { patientId: pid, title: "Call", afterDays: 1 }))).toBe("FORBIDDEN");
    expect(await code(createFollowUp(A.doctor, { patientId: pid, title: "Call", afterDays: 1 }))).toBe("ok");
  });
  it("an identical open follow-up (double click) is refused", async () => {
    const pid = await patient(A);
    const body = { patientId: pid, title: "Same one", afterDays: 4 };
    const rs = await Promise.all([code(createFollowUp(A.recep, body)), code(createFollowUp(A.recep, body))]);
    expect(rs.filter((x) => x === "ok").length).toBeGreaterThanOrEqual(1);
    expect(await code(createFollowUp(A.recep, body))).toBe("CONFLICT");
  });
  it("archived patients and foreign-clinic patients are refused", async () => {
    const pid = await patient(A); await db.patient.update({ where: { id: pid }, data: { status: "ARCHIVED" } });
    expect(await code(createFollowUp(A.recep, { patientId: pid, title: "Call", afterDays: 1 }))).toBe("CONFLICT");
    const bp = await patient(B);
    expect(await code(createFollowUp(A.recep, { patientId: bp, title: "Call", afterDays: 1 }))).toBe("NOT_FOUND");
  });
});

describe("from consultation, prescription and report (2–4, 8, 38–39)", () => {
  it("the doctor's plan becomes ONE linked follow-up on finalize; amend updates, never duplicates", async () => {
    const c = await consult(A);
    const cur = await getConsultation(A.doctor, c.id);
    await patchConsultation(A.doctor, c.id, { rev: cur.rev, chiefComplaints: [{ text: "Cough" }], clinicalNotes: "n", followUpRequired: true, followUpAfterDays: 7, followUpNotes: "Review symptoms" });
    await consultationAction(A.doctor, c.id, { action: "review" });
    await consultationAction(A.doctor, c.id, { action: "finalize", confirm: true });
    const rows = await db.followUp.findMany({ where: { consultationId: c.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ tenantId: A.id, patientId: c.patientId, doctorUserId: A.doctorId, type: "CONSULTATION_FOLLOW_UP", source: "CONSULTATION", dueDate: addDays(today(), 7), doctorNotes: "Review symptoms", assignedToId: null });
    // amend with a different date
    await consultationAction(A.doctor, c.id, { action: "amend", reason: "Changed plan" });
    const cur2 = await getConsultation(A.doctor, c.id);
    await patchConsultation(A.doctor, c.id, { rev: cur2.rev, followUpRequired: true, followUpAfterDays: 14, followUpNotes: "Review symptoms" });
    await consultationAction(A.doctor, c.id, { action: "review" });
    await consultationAction(A.doctor, c.id, { action: "finalize", confirm: true });
    const after = await db.followUp.findMany({ where: { consultationId: c.id } });
    expect(after).toHaveLength(1);
    expect(after[0].dueDate).toBe(addDays(today(), 14));
    expect(after[0].rescheduleCount).toBe(1);
    expect(await db.followUpEvent.count({ where: { followUpId: after[0].id, type: "RESCHEDULED" } })).toBe(1);
    // doctor removes the plan: the open follow-up is cancelled (history kept)
    await consultationAction(A.doctor, c.id, { action: "amend", reason: "No follow-up needed" });
    const cur3 = await getConsultation(A.doctor, c.id);
    await patchConsultation(A.doctor, c.id, { rev: cur3.rev, followUpRequired: false });
    await consultationAction(A.doctor, c.id, { action: "review" });
    await consultationAction(A.doctor, c.id, { action: "finalize", confirm: true });
    expect((await db.followUp.findUniqueOrThrow({ where: { id: after[0].id } })).status).toBe("CANCELLED");
  });
  it("a consultation without a follow-up plan creates nothing", async () => {
    const c = await consult(A);
    const cur = await getConsultation(A.doctor, c.id);
    await patchConsultation(A.doctor, c.id, { rev: cur.rev, chiefComplaints: [{ text: "Cough" }], clinicalNotes: "n" });
    await consultationAction(A.doctor, c.id, { action: "review" });
    await consultationAction(A.doctor, c.id, { action: "finalize", confirm: true });
    expect(await db.followUp.count({ where: { consultationId: c.id } })).toBe(0);
  });
  it("doctor creates a follow-up from the consultation; patient and doctor come from the record, not the client", async () => {
    const c = await consult(A);
    const r = await createFollowUp(A.doctor, { consultationId: c.id, title: "Review symptoms", afterDays: 5, patientId: "someone-else", doctorUserId: "x" }) as { id: string };
    const row = await db.followUp.findUniqueOrThrow({ where: { id: r.id } });
    expect(row).toMatchObject({ patientId: c.patientId, doctorUserId: A.doctorId, consultationId: c.id, type: "CONSULTATION_FOLLOW_UP", source: "CONSULTATION" });
    expect(await code(createFollowUp(A.doctor2, { consultationId: c.id, title: "Mine?", afterDays: 5 }))).toBe("FORBIDDEN");
    expect(await code(createFollowUp(A.recep, { consultationId: c.id, title: "Reception", afterDays: 5 }))).toBe("FORBIDDEN");
    expect(await code(createFollowUp(B.doctor, { consultationId: c.id, title: "Foreign", afterDays: 5 }))).toBe("NOT_FOUND");
  });
  it("from a prescription it links prescription, consultation, patient and doctor", async () => {
    const c = await consult(A);
    await savePrescriptionDraft(A.doctor, c.id, { items: [{ name: "Test medicine (entry)", dose: "1", frequency: "Daily", durationDays: 3 }] });
    const rx = await db.prescription.findFirstOrThrow({ where: { consultationId: c.id } });
    const r = await createFollowUp(A.doctor, { prescriptionId: rx.id, title: "Medication review", afterDays: 14 }) as { id: string };
    expect(await db.followUp.findUniqueOrThrow({ where: { id: r.id } })).toMatchObject({ prescriptionId: rx.id, consultationId: c.id, patientId: c.patientId, doctorUserId: A.doctorId, type: "MEDICATION_REVIEW", source: "PRESCRIPTION" });
    expect(await code(createFollowUp(A.doctor2, { prescriptionId: rx.id, title: "x2", afterDays: 1 }))).toBe("FORBIDDEN");
  });
  it("from a RELEASED lab report only; never automatically", async () => {
    const c = await consult(A);
    const order = await db.investigationOrder.create({ data: { tenantId: A.id, orderNumber: `LAB-T-${Date.now()}`, patientId: c.patientId, consultationId: c.id, doctorUserId: A.doctorId, createdById: A.doctorId } });
    const report = await db.labReport.create({ data: { tenantId: A.id, reportNumber: `RPT-T-${Date.now()}`, investigationOrderId: order.id, patientId: c.patientId, doctorUserId: A.doctorId, generatedById: A.doctorId, currentVersion: 0 } });
    expect(await db.followUp.count({ where: { labReportId: report.id } })).toBe(0);
    expect(await code(createFollowUp(A.doctor, { labReportId: report.id, title: "Review report", afterDays: 7 }))).toBe("CONFLICT");
    await db.labReport.update({ where: { id: report.id }, data: { currentVersion: 1, status: "RELEASED" } });
    const r = await createFollowUp(A.doctor, { labReportId: report.id, title: "Review the lab report", afterDays: 7 }) as { id: string };
    expect(await db.followUp.findUniqueOrThrow({ where: { id: r.id } })).toMatchObject({ labReportId: report.id, investigationOrderId: order.id, consultationId: c.id, patientId: c.patientId, doctorUserId: A.doctorId, type: "REPORT_REVIEW", source: "REPORT" });
    expect(await code(createFollowUp(A.doctor2, { labReportId: report.id, title: "x3", afterDays: 1 }))).toBe("FORBIDDEN");
    expect(await code(createFollowUp(A.recep, { labReportId: report.id, title: "x4", afterDays: 1 }))).toBe("FORBIDDEN");
    expect(await code(createFollowUp(B.doctor, { labReportId: report.id, title: "x5", afterDays: 1 }))).toBe("NOT_FOUND");
  });
});

describe("due, overdue and the worklist (7–8, 12–14, 24)", () => {
  it("DUE is set when the date arrives; overdue is computed, never stored; nothing auto-completes", async () => {
    const f = await manual(A, { afterDays: 0 });
    const list = await listFollowUps(A.recep, { tab: "today" });
    const row = list.rows.find((r) => r.id === f.id)!;
    expect(row.status).toBe("DUE"); expect(row.overdueDays).toBe(0);
    await past(f.id, 3);
    const od = (await listFollowUps(A.recep, { tab: "overdue" })).rows.find((r) => r.id === f.id)!;
    expect(od.overdueDays).toBe(3); expect(od.status).toBe("DUE");
    expect((await listFollowUps(A.recep, { tab: "upcoming" })).rows.some((r) => r.id === f.id)).toBe(false);
    const later = await manual(A, { afterDays: 5 });
    expect((await listFollowUps(A.recep, { tab: "upcoming" })).rows.find((r) => r.id === later.id)!.status).toBe("PENDING");
  });
  it("tabs, filters, search and pagination are server-side", async () => {
    const pid = await patient(A, "Searchable Sally");
    const f = await createFollowUp(A.recep, { patientId: pid, title: "Search me", afterDays: 1, priority: "URGENT", type: "DOCUMENT_PENDING" }) as { id: string; followUpNumber: string };
    expect((await listFollowUps(A.recep, { q: "Searchable" })).rows.map((r) => r.id)).toEqual([f.id]);
    expect((await listFollowUps(A.recep, { q: f.followUpNumber })).rows.map((r) => r.id)).toEqual([f.id]);
    expect((await listFollowUps(A.recep, { priority: "URGENT", type: "DOCUMENT_PENDING" })).rows.some((r) => r.id === f.id)).toBe(true);
    expect((await listFollowUps(A.recep, { priority: "LOW", q: "Searchable" })).rows).toHaveLength(0);
    expect((await listFollowUps(A.recep, { date: addDays(today(), 1), q: "Searchable" })).rows).toHaveLength(1);
    for (let i = 0; i < 22; i++) await manual(A, { title: `Bulk ${i}` });
    const p1 = await listFollowUps(A.admin, { page: 1 }); const p2 = await listFollowUps(A.admin, { page: 2 });
    expect(p1.rows.length).toBe(20); expect(p2.rows.length).toBeGreaterThan(0);
    expect(p1.rows.some((r) => p2.rows.map((x) => x.id).includes(r.id))).toBe(false);
  });
  it("stats are real database counts and clinic-scoped", async () => {
    const before = await followUpStats(A.admin);
    const f = await manual(A, { afterDays: 0 }); const g = await manual(A, { afterDays: 0 }); await past(g.id, 2);
    const s = await followUpStats(A.admin);
    expect(s.dueToday).toBe(before.dueToday + 1); expect(s.overdue).toBe(before.overdue + 1);
    const open = ["PENDING", "DUE", "IN_PROGRESS", "CONTACTED", "APPOINTMENT_BOOKED", "NO_RESPONSE", "RESCHEDULED"];
    expect(s.dueToday).toBe(await db.followUp.count({ where: { tenantId: A.id, status: { in: open }, dueDate: today() } }));
    expect(s.overdue).toBe(await db.followUp.count({ where: { tenantId: A.id, status: { in: open }, dueDate: { lt: today() } } }));
    expect(s.upcoming).toBe(await db.followUp.count({ where: { tenantId: A.id, status: { in: open }, dueDate: { gt: today() } } }));
    expect((await followUpStats(B.admin)).overdue).toBe(await db.followUp.count({ where: { tenantId: B.id, status: { in: open }, dueDate: { lt: today() } } }));
    expect(f.id).not.toBe(g.id);
  });
  it("visibility by role; foreign clinics, accountants, lab staff and platform admin see nothing", async () => {
    const mine = await createFollowUp(A.recep, { patientId: await patient(A), title: "Assigned to recep2", afterDays: 1, assignedToId: A.recep2Id }) as { id: string };
    const free = await manual(A, { title: "Unassigned one" });
    expect((await listFollowUps(A.recep, { q: "Assigned to recep2" })).rows).toHaveLength(0); // reception sees own + unassigned only
    expect((await listFollowUps(A.recep2, { q: "Assigned to recep2" })).rows).toHaveLength(1);
    expect((await listFollowUps(A.recep, { q: "Unassigned one" })).rows).toHaveLength(1);
    expect(await code(getFollowUp(A.recep, mine.id))).toBe("NOT_FOUND");
    expect((await listFollowUps(A.nurse, { q: "Unassigned one" })).rows).toHaveLength(0); // nurse: assigned only
    expect((await listFollowUps(A.admin, { q: "Assigned to recep2" })).rows).toHaveLength(1);
    expect(await code(getFollowUp(B.admin, mine.id))).toBe("NOT_FOUND");
    expect(await code(followUpAction(B.recep, free.id, { action: "start" }))).toBe("NOT_FOUND");
    for (const who of [A.accountant, A.lab, A.superAdmin]) { expect(await code(listFollowUps(who, {}))).toBe("FORBIDDEN"); expect(await code(getFollowUp(who, mine.id))).toBe("FORBIDDEN"); }
    expect((await listFollowUps(B.admin, { q: "Unassigned one" })).rows).toHaveLength(0);
  });
  it("a doctor sees their own patients' follow-ups, not another doctor's", async () => {
    const c = await consult(A);
    const mine = await createFollowUp(A.doctor, { consultationId: c.id, title: "Doctor one", afterDays: 2 }) as { id: string };
    expect(await code(getFollowUp(A.doctor, mine.id))).toBe("ok");
    expect(await code(getFollowUp(A.doctor2, mine.id))).toBe("NOT_FOUND");
    expect((await listFollowUps(A.doctor2, { q: "Doctor one" })).rows).toHaveLength(0);
  });
  it("clinical fields stay hidden from reception", async () => {
    const c = await consult(A);
    const r = await createFollowUp(A.doctor, { consultationId: c.id, title: "Clinical check", afterDays: 2, doctorNotes: "Private clinical note", assignedToId: A.recepId }) as { id: string };
    const d = await getFollowUp(A.recep, r.id);
    expect(d.doctorNotes).toBeNull(); expect(d.links.consultationId).toBeNull();
    const dd = await getFollowUp(A.doctor, r.id);
    expect(dd.doctorNotes).toBe("Private clinical note"); expect(dd.links.consultationId).toBe(c.id);
    expect(await code(editFollowUp(A.recep, r.id, { doctorNotes: "hack" }))).toBe("FORBIDDEN");
  });
});

describe("assignment and contact log (9–11, 21–22)", () => {
  it("assign, reassign and unassign are recorded; only valid clinic staff can be assigned", async () => {
    const f = await manual(A);
    expect(await code(act(A.recep, f.id, { action: "assign", assignedToId: A.accountantId }))).toBe("VALIDATION_ERROR");
    expect(await code(act(A.recep, f.id, { action: "assign", assignedToId: B.recepId }))).toBe("VALIDATION_ERROR");
    await act(A.recep, f.id, { action: "assign", assignedToId: A.nurseId });
    await act(A.admin, f.id, { action: "assign", assignedToId: A.recep2Id });
    const d = await getFollowUp(A.admin, f.id);
    expect(d.assignedTo!.id).toBe(A.recep2Id);
    expect(d.events.filter((e) => e.type === "ASSIGNED" || e.type === "REASSIGNED").map((e) => e.type).sort()).toEqual(["ASSIGNED", "REASSIGNED"]);
    expect(await db.auditLog.count({ where: { tenantId: A.id, entityId: f.id, action: { in: ["followup.assigned", "followup.reassigned"] } } })).toBe(2);
    const list = (await assignableUsers(A.admin)).users.map((u) => u.id);
    expect(list).toContain(A.recepId); expect(list).not.toContain(A.accountantId);
    expect(await code(assignableUsers(A.accountant))).toBe("FORBIDDEN");
  });
  it("logging contact keeps full history, never completes the follow-up, and takes ownership", async () => {
    const f = await manual(A);
    await contact(A.recep, f.id, { notes: "Left a voicemail", outcome: "NO_RESPONSE" });
    expect((await getFollowUp(A.recep, f.id)).status).toBe("NO_RESPONSE");
    await contact(A.recep, f.id, { notes: "Patient will call back", outcome: "CALL_BACK_REQUESTED", nextAction: "Call again", nextActionDate: addDays(today(), 1) });
    const d = await getFollowUp(A.recep, f.id);
    expect(d.status).toBe("CONTACTED"); expect(d.contacts.map((c) => c.outcome)).toEqual(["CALL_BACK_REQUESTED", "NO_RESPONSE"]);
    expect(d.assignedTo!.id).toBe(A.recepId);
    await contact(A.recep, f.id, { outcome: "APPOINTMENT_BOOKED", notes: "Patient says they booked" });
    expect((await getFollowUp(A.recep, f.id)).status).toBe("CONTACTED"); // a manual note is not a booking
    expect(await db.followUpContact.count({ where: { followUpId: f.id } })).toBe(3);
  });
  it("contact rules: valid outcome/method, role, closed follow-ups, unassigned nurse", async () => {
    const f = await manual(A);
    expect(await code(contact(A.recep, f.id, { outcome: "MAGIC" }))).toBe("VALIDATION_ERROR");
    expect(await code(contact(A.recep, f.id, { method: "PIGEON" }))).toBe("VALIDATION_ERROR");
    expect(await code(contact(A.nurse, f.id))).toBe("NOT_FOUND");
    expect(await code(contact(A.accountant, f.id))).toBe("FORBIDDEN");
    await act(A.admin, f.id, { action: "assign", assignedToId: A.nurseId });
    expect(await code(contact(A.nurse, f.id))).toBe("ok");
    await act(A.admin, f.id, { action: "cancel", reason: "Not needed" });
    expect(await code(contact(A.recep, f.id))).toBe("NOT_FOUND"); // no longer assigned/visible to reception
    expect(await code(contact(A.admin, f.id))).toBe("CONFLICT");
  });
  it("communication preferences are respected and preference changes are audited", async () => {
    const pid = await patient(A, "Pref Patient");
    const f = await createFollowUp(A.recep, { patientId: pid, title: "Pref check", afterDays: 1 }) as { id: string };
    const prow = await db.patient.findUniqueOrThrow({ where: { id: pid } });
    await updatePatient(A.recep, pid, { name: prow.name, phone: prow.phone, prefWhatsapp: "NOT_ALLOWED", prefPhone: "ALLOWED" });
    expect(await db.auditLog.count({ where: { tenantId: A.id, entityId: pid, action: "patient.communication_preference_changed" } })).toBe(1);
    expect(await code(contact(A.recep, f.id, { method: "WHATSAPP", outcome: "MESSAGE_SENT" }))).toBe("CONFLICT");
    expect(await code(contact(A.recep, f.id, { method: "PHONE" }))).toBe("ok");
    expect(await code(contact(A.recep, f.id, { method: "IN_PERSON" }))).toBe("ok");
    const d = await getFollowUp(A.recep, f.id);
    expect(d.patient!.prefs.whatsapp).toBe("NOT_ALLOWED");
    expect(d.integrations).toEqual({ whatsapp: false, sms: false, email: false });
  });
});

describe("appointment engine integration (12–13, 22–23, 37)", () => {
  it("booking from a follow-up uses the existing appointment engine and links it", async () => {
    const pid = await patient(A, "Booking Patient");
    const f = await createFollowUp(A.recep, { patientId: pid, title: "Book visit", afterDays: 1, doctorUserId: A.doctorId }) as { id: string };
    const before = await db.appointment.count({ where: { tenantId: A.id } });
    const a = await createStaffAppointment(A.recep, { doctorUserId: A.doctorId, startsAt: futureSlot(5, "10:00"), type: "FOLLOW_UP", reason: "Follow-up visit", patient: { patientId: pid, viaProfile: true }, followUpId: f.id });
    expect(await db.appointment.count({ where: { tenantId: A.id } })).toBe(before + 1);
    const row = await db.appointment.findUniqueOrThrow({ where: { id: a.id } });
    expect(row).toMatchObject({ type: "FOLLOW_UP", patientId: pid, status: "CONFIRMED" });
    const d = await getFollowUp(A.recep, f.id);
    expect(d.status).toBe("APPOINTMENT_BOOKED"); expect(d.appointment!.id).toBe(a.id);
    expect(d.events.some((e) => e.type === "APPOINTMENT_BOOKED")).toBe(true);
    expect(d.appointments.some((x) => x.id === a.id)).toBe(true); // existing appointment history, not a copy
    expect(await db.auditLog.count({ where: { tenantId: A.id, entityId: f.id, action: "followup.appointment_booked" } })).toBe(1);
  });
  it("a wrong-patient, closed or foreign follow-up is refused BEFORE any appointment is created", async () => {
    const pid = await patient(A, "Right"), other = await patient(A, "Wrong");
    const f = await createFollowUp(A.recep, { patientId: pid, title: "Book visit 2", afterDays: 1 }) as { id: string };
    const count = () => db.appointment.count({ where: { tenantId: A.id } });
    const n0 = await count();
    expect(await code(createStaffAppointment(A.recep, { doctorUserId: A.doctorId, startsAt: futureSlot(6, "10:15"), patient: { patientId: other, viaProfile: true }, followUpId: f.id }))).toBe("VALIDATION_ERROR");
    expect(await code(createStaffAppointment(A.recep, { doctorUserId: A.doctorId, startsAt: futureSlot(6, "10:15"), patient: { patientId: pid, viaProfile: true }, followUpId: "nope" }))).toBe("NOT_FOUND");
    await act(A.admin, f.id, { action: "cancel", reason: "closed" });
    expect(await code(createStaffAppointment(A.admin, { doctorUserId: A.doctorId, startsAt: futureSlot(6, "10:15"), patient: { patientId: pid, viaProfile: true }, followUpId: f.id }))).toBe("CONFLICT");
    expect(await count()).toBe(n0);
    const g = await manual(A);
    expect(await code(createStaffAppointment(B.recep, { doctorUserId: B.doctorId, startsAt: futureSlot(6, "10:30"), patient: { patientId: await patient(B), viaProfile: true }, followUpId: g.id }))).toBe("NOT_FOUND");
  });
  it("a completed visit does not complete the follow-up unless the clinic rule is on", async () => {
    const pid = await patient(A, "Visit Patient");
    const f = await createFollowUp(A.recep, { patientId: pid, title: "Visit done?", afterDays: 1 }) as { id: string };
    const a = await createStaffAppointment(A.recep, { doctorUserId: A.doctorId, startsAt: futureSlot(7, "11:00"), type: "FOLLOW_UP", patient: { patientId: pid, viaProfile: true }, followUpId: f.id });
    await db.appointment.update({ where: { id: a.id }, data: { status: "COMPLETED", completedAt: new Date() } });
    const d = await getFollowUp(A.recep, f.id);
    expect(d.status).toBe("APPOINTMENT_BOOKED"); expect(d.visitCompleted).toBe(true);
    await updateSettings(A.admin, { createOnNoShow: true, createOnCancellation: false, recallCreatesFollowUp: false, completeWhenVisitDone: true, contactOutcomes: [], completionOutcomes: [] });
    await listFollowUps(A.recep, {});
    expect((await getFollowUp(A.recep, f.id)).status).toBe("COMPLETED");
    await updateSettings(A.admin, { createOnNoShow: true, createOnCancellation: false, recallCreatesFollowUp: false, completeWhenVisitDone: false, contactOutcomes: [], completionOutcomes: [] });
  });
  it("cancelling or missing the booked visit re-opens the follow-up instead of spawning another", async () => {
    const pid = await patient(A, "Missed Visit");
    const f = await createFollowUp(A.recep, { patientId: pid, title: "Missed me", afterDays: 1 }) as { id: string };
    const a = await createStaffAppointment(A.recep, { doctorUserId: A.doctorId, startsAt: futureSlot(8, "11:15"), type: "FOLLOW_UP", patient: { patientId: pid, viaProfile: true }, followUpId: f.id });
    const n0 = await db.followUp.count({ where: { tenantId: A.id, patientId: pid } });
    await appointmentAction(A.recep, a.id, { action: "no-show" });
    const d = await getFollowUp(A.recep, f.id);
    expect(d.status).toBe("DUE"); expect(d.appointment).toBeNull();
    expect(d.events.some((e) => e.type === "APPOINTMENT_RELEASED")).toBe(true);
    expect(await db.followUp.count({ where: { tenantId: A.id, patientId: pid } })).toBe(n0);
  });
});

describe("missed appointments follow the clinic's rules (19)", () => {
  it("a no-show creates ONE follow-up candidate (default rule), never twice, never for contact-only bookings", async () => {
    const pid = await patient(A, "No Show Patient");
    const a = await createStaffAppointment(A.recep, { doctorUserId: A.doctorId, startsAt: futureSlot(9, "12:00"), patient: { patientId: pid, viaProfile: true } });
    await appointmentAction(A.recep, a.id, { action: "no-show", reason: "Did not come" });
    const rows = await db.followUp.findMany({ where: { patientId: pid } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ type: "NO_SHOW", source: "NO_SHOW", sourceAppointmentId: a.id, doctorUserId: A.doctorId, status: "DUE" === rows[0].status ? "DUE" : "PENDING", dueDate: today(), assignedToId: null });
    expect(await db.followUp.count({ where: { dedupeKey: `noshow:${a.id}` } })).toBe(1);
    const c = await createStaffAppointment(A.recep, { doctorUserId: A.doctorId, startsAt: futureSlot(9, "12:15"), contactName: "Walk In", contactPhone: "9812345678" });
    const n0 = await db.followUp.count({ where: { tenantId: A.id } });
    await appointmentAction(A.recep, c.id, { action: "no-show" });
    expect(await db.followUp.count({ where: { tenantId: A.id } })).toBe(n0);
  });
  it("the no-show rule can be switched off; cancellation follow-ups only when switched on", async () => {
    const pid = await patient(A, "Rule Patient");
    const mk = (hhmm: string) => createStaffAppointment(A.recep, { doctorUserId: A.doctorId, startsAt: futureSlot(10, hhmm), patient: { patientId: pid, viaProfile: true } });
    const cancel = (id: string) => appointmentAction(A.recep, id, { action: "cancel", reasonKind: "PATIENT_REQUEST" });
    const a1 = await mk("13:00"); await cancel(a1.id);
    expect(await db.followUp.count({ where: { patientId: pid } })).toBe(0); // default: no follow-up after cancellation
    await updateSettings(A.admin, { createOnNoShow: false, createOnCancellation: true, recallCreatesFollowUp: false, completeWhenVisitDone: false, contactOutcomes: [], completionOutcomes: [] });
    const a2 = await mk("13:15"); await cancel(a2.id);
    const a3 = await mk("13:30"); await appointmentAction(A.recep, a3.id, { action: "no-show" });
    const rows = await db.followUp.findMany({ where: { patientId: pid } });
    expect(rows.map((r) => r.type)).toEqual(["MISSED_APPOINTMENT"]);
    await updateSettings(A.admin, { createOnNoShow: true, createOnCancellation: false, recallCreatesFollowUp: false, completeWhenVisitDone: false, contactOutcomes: [], completionOutcomes: [] });
  });
  it("only the clinic admin changes the rules, and it is audited", async () => {
    const body = { createOnNoShow: true, createOnCancellation: false, recallCreatesFollowUp: false, completeWhenVisitDone: false, contactOutcomes: ["LEFT_MESSAGE"], completionOutcomes: ["REFERRED"] };
    for (const who of [A.doctor, A.recep, A.nurse]) expect(await code(updateSettings(who, body))).toBe("FORBIDDEN");
    expect(await code(updateSettings(A.admin, { ...body, contactOutcomes: ["bad value!"] }))).toBe("VALIDATION_ERROR");
    await updateSettings(A.admin, body);
    expect((await getSettings(A.recep)).contactOutcomes).toEqual(["LEFT_MESSAGE"]);
    expect((await getSettings(A.recep)).integrations).toEqual({ whatsapp: false, sms: false, email: false });
    expect(await db.auditLog.count({ where: { tenantId: A.id, action: "followup.config_changed" } })).toBeGreaterThan(0);
    expect((await getSettings(B.recep)).contactOutcomes).toEqual([]); // other clinic unaffected
    // custom outcomes become valid
    const f = await manual(A);
    expect(await code(contact(A.recep, f.id, { outcome: "LEFT_MESSAGE" }))).toBe("ok");
    expect(await code(act(A.recep, f.id, { action: "complete", outcome: "REFERRED", notes: "Referred elsewhere" }))).toBe("ok");
    await updateSettings(A.admin, { ...body, contactOutcomes: [], completionOutcomes: [] });
  });
});

describe("reschedule, complete, cancel (14–17)", () => {
  it("reschedule keeps the history and needs a reason and a valid date", async () => {
    const f = await manual(A, { afterDays: 2 });
    expect(await code(act(A.recep, f.id, { action: "reschedule", dueDate: addDays(today(), 5) }))).toBe("VALIDATION_ERROR");
    expect(await code(act(A.recep, f.id, { action: "reschedule", dueDate: addDays(today(), -1), reason: "x1" }))).toBe("VALIDATION_ERROR");
    await act(A.recep, f.id, { action: "reschedule", dueDate: addDays(today(), 6), reason: "Patient travelling" });
    await act(A.recep, f.id, { action: "reschedule", dueDate: addDays(today(), 9), reason: "Still travelling" });
    const d = await getFollowUp(A.recep, f.id);
    expect(d.dueDate).toBe(addDays(today(), 9)); expect(d.rescheduleCount).toBe(2); expect(d.status).toBe("RESCHEDULED");
    const ev = d.events.filter((e) => e.type === "RESCHEDULED");
    expect(ev.map((e) => [e.fromValue, e.toValue, e.note])).toEqual([[addDays(today(), 6), addDays(today(), 9), "Still travelling"], [addDays(today(), 2), addDays(today(), 6), "Patient travelling"]]);
    expect(await code(act(A.nurse, f.id, { action: "reschedule", dueDate: addDays(today(), 10), reason: "nurse" }))).toBe("NOT_FOUND");
    expect(await db.auditLog.count({ where: { tenantId: A.id, entityId: f.id, action: "followup.rescheduled" } })).toBe(2);
  });
  it("completion needs a valid outcome and notes; it records who and when; clinical types need clinical access", async () => {
    const f = await manual(A);
    expect(await code(act(A.recep, f.id, { action: "complete", outcome: "NOPE", notes: "ok done" }))).toBe("VALIDATION_ERROR");
    expect(await code(act(A.recep, f.id, { action: "complete", outcome: "COMPLETED" }))).toBe("VALIDATION_ERROR");
    expect(await code(act(A.nurse, f.id, { action: "complete", outcome: "COMPLETED", notes: "ok done" }))).toBe("NOT_FOUND");
    const r = await act(A.recep, f.id, { action: "complete", outcome: "COMPLETED", notes: "Visit took place" }) as { status: string };
    expect(r.status).toBe("COMPLETED");
    const row = await db.followUp.findUniqueOrThrow({ where: { id: f.id } });
    expect(row).toMatchObject({ status: "COMPLETED", outcome: "COMPLETED", outcomeNotes: "Visit took place", completedById: A.recepId });
    expect(row.completedAt).toBeInstanceOf(Date);
    expect(await code(act(A.recep, f.id, { action: "complete", outcome: "COMPLETED", notes: "again" }))).toBe("CONFLICT");
    const dec = await manual(A);
    await act(A.recep, dec.id, { action: "complete", outcome: "PATIENT_DECLINED", notes: "Not interested" });
    expect((await getFollowUp(A.recep, dec.id)).status).toBe("PATIENT_DECLINED");
    const clin = await createFollowUp(A.recep, { patientId: await patient(A), title: "Review report", afterDays: 1, type: "REPORT_REVIEW" }) as { id: string };
    expect(await code(act(A.recep, clin.id, { action: "complete", outcome: "COMPLETED", notes: "reception try" }))).toBe("FORBIDDEN");
    expect(await code(act(A.admin, clin.id, { action: "complete", outcome: "COMPLETED", notes: "admin closes" }))).toBe("ok");
  });
  it("the next follow-up is created only when explicitly requested", async () => {
    const f = await manual(A, { priority: "HIGH" });
    const n0 = await db.followUp.count({ where: { tenantId: A.id } });
    await act(A.recep, f.id, { action: "complete", outcome: "COMPLETED", notes: "no next" });
    expect(await db.followUp.count({ where: { tenantId: A.id } })).toBe(n0);
    const g = await manual(A, { priority: "HIGH" });
    const r = await act(A.recep, g.id, { action: "complete", outcome: "COMPLETED", notes: "needs another", nextAfterDays: 30 }) as { next: { id: string } | null };
    expect(r.next).toBeTruthy();
    const nx = await db.followUp.findUniqueOrThrow({ where: { id: r.next!.id } });
    expect(nx).toMatchObject({ patientId: (await db.followUp.findUniqueOrThrow({ where: { id: g.id } })).patientId, dueDate: addDays(today(), 30), priority: "HIGH", status: "PENDING" });
    expect(await code(act(A.recep, (await manual(A)).id, { action: "complete", outcome: "COMPLETED", notes: "past", nextDueDate: addDays(today(), -2) }))).toBe("VALIDATION_ERROR");
  });
  it("cancel needs a reason; completed/cancelled can't be changed; double completion has one winner", async () => {
    const f = await manual(A);
    expect(await code(act(A.recep, f.id, { action: "cancel" }))).toBe("VALIDATION_ERROR");
    expect(await code(act(A.doctor2, f.id, { action: "cancel", reason: "other doctor" }))).toBe("NOT_FOUND");
    await act(A.recep, f.id, { action: "cancel", reason: "Duplicate task" });
    expect((await db.followUp.findUniqueOrThrow({ where: { id: f.id } })).cancelReason).toBe("Duplicate task");
    for (const a of [{ action: "start" }, { action: "reschedule", dueDate: addDays(today(), 4), reason: "late" }, { action: "cancel", reason: "again" }]) expect(await code(act(A.admin, f.id, a))).toBe("CONFLICT");
    const g = await manual(A);
    const rs = await Promise.all([code(act(A.recep, g.id, { action: "complete", outcome: "COMPLETED", notes: "one" })), code(act(A.admin, g.id, { action: "complete", outcome: "COMPLETED", notes: "two" }))]);
    expect(rs.filter((x) => x === "ok")).toHaveLength(1);
    expect(await db.followUpEvent.count({ where: { followUpId: g.id, type: "COMPLETED" } })).toBe(1);
  });
  it("start takes ownership; edit changes only allowed fields and is audited without note content", async () => {
    const f = await manual(A);
    await act(A.recep, f.id, { action: "start" });
    const d = await getFollowUp(A.recep, f.id);
    expect(d.status).toBe("IN_PROGRESS"); expect(d.assignedTo!.id).toBe(A.recepId);
    await editFollowUp(A.recep, f.id, { priority: "URGENT", notes: "SECRET-INTERNAL-NOTE" });
    expect((await getFollowUp(A.recep, f.id)).priority).toBe("URGENT");
    const logs = await db.auditLog.findMany({ where: { tenantId: A.id, entityId: f.id } });
    expect(logs.length).toBeGreaterThanOrEqual(3);
    expect(JSON.stringify(logs)).not.toMatch(/SECRET-INTERNAL-NOTE/);
    expect(await code(editFollowUp(A.nurse, f.id, { priority: "LOW" }))).toBe("FORBIDDEN");
  });
});

describe("recalls (18)", () => {
  it("create, validate and list; scoped to the clinic", async () => {
    const pid = await patient(A, "Recall Patient");
    expect(await code(createRecall(A.nurse, { patientId: pid, title: "Annual check-up", dueDate: addDays(today(), 30) }))).toBe("FORBIDDEN");
    expect(await code(createRecall(A.recep, { patientId: pid, title: "Annual", dueDate: addDays(today(), -1) }))).toBe("VALIDATION_ERROR");
    expect(await code(createRecall(A.recep, { patientId: pid, title: "Annual", dueDate: addDays(today(), 30), frequency: "YEARLY" }))).toBe("VALIDATION_ERROR"); // recurring needs a bound
    expect(await code(createRecall(A.recep, { patientId: await patient(B), title: "Foreign", dueDate: addDays(today(), 30) }))).toBe("NOT_FOUND");
    const r = await createRecall(A.recep, { patientId: pid, title: "Annual check-up", dueDate: addDays(today(), 30), frequency: "YEARLY", maxOccurrences: 3 }) as { id: string };
    const l = await listRecalls(A.recep, { q: "Recall Patient" });
    expect(l.rows).toHaveLength(1); expect(l.rows[0]).toMatchObject({ id: r.id, due: false, frequency: "YEARLY" });
    expect((await listRecalls(B.recep, { q: "Recall Patient" })).rows).toHaveLength(0);
    expect(await code(recallAction(B.recep, r.id, { action: "cancel" }))).toBe("NOT_FOUND");
  });
  it("a recall becomes a follow-up only when staff create it (one per occurrence)", async () => {
    const pid = await patient(A, "Recall FU");
    const r = await createRecall(A.recep, { patientId: pid, title: "Routine review", dueDate: addDays(today(), 3) }) as { id: string };
    expect(await db.followUp.count({ where: { patientId: pid } })).toBe(0);
    const out = await recallAction(A.recep, r.id, { action: "createFollowUp" }) as { followUpId: string };
    expect(await db.followUp.findUniqueOrThrow({ where: { id: out.followUpId } })).toMatchObject({ type: "ROUTINE_RECALL", source: "RECALL", recallId: r.id, patientId: pid, dueDate: addDays(today(), 3) });
    expect(await code(recallAction(A.recep, r.id, { action: "createFollowUp" }))).toBe("CONFLICT");
    expect((await db.recall.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("FOLLOW_UP_CREATED");
  });
  it("recurrence is explicit and bounded: next occurrence only on request, never beyond the limit", async () => {
    const pid = await patient(A, "Recur Patient");
    const r = await createRecall(A.recep, { patientId: pid, title: "Quarterly review", dueDate: addDays(today(), 1), frequency: "QUARTERLY", maxOccurrences: 2 }) as { id: string };
    expect(await db.recall.count({ where: { patientId: pid } })).toBe(1);
    const c1 = await recallAction(A.recep, r.id, { action: "complete", scheduleNext: true }) as { nextId: string };
    const n = await db.recall.findUniqueOrThrow({ where: { id: c1.nextId } });
    expect(n).toMatchObject({ occurrence: 2, status: "ACTIVE", dueDate: nextRecallDate(addDays(today(), 1), "QUARTERLY") });
    expect(await code(recallAction(A.recep, c1.nextId, { action: "complete", scheduleNext: true }))).toBe("CONFLICT");
    await recallAction(A.recep, c1.nextId, { action: "complete" });
    expect(await db.recall.count({ where: { patientId: pid } })).toBe(2);
    const once = await createRecall(A.recep, { patientId: pid, title: "One time", dueDate: addDays(today(), 2) }) as { id: string };
    expect(await code(recallAction(A.recep, once.id, { action: "complete", scheduleNext: true }))).toBe("CONFLICT");
    expect(await code(recallAction(A.recep, once.id, { action: "cancel" }))).toBe("ok");
    expect(await code(recallAction(A.recep, once.id, { action: "cancel" }))).toBe("CONFLICT");
  });
  it("the 'recall creates a follow-up' rule works only when switched on", async () => {
    const pid = await patient(A, "Rule Recall");
    const r = await createRecall(A.recep, { patientId: pid, title: "Due today", dueDate: today() }) as { id: string };
    await listRecalls(A.recep, {});
    expect(await db.followUp.count({ where: { patientId: pid } })).toBe(0);
    await updateSettings(A.admin, { createOnNoShow: true, createOnCancellation: false, recallCreatesFollowUp: true, completeWhenVisitDone: false, contactOutcomes: [], completionOutcomes: [] });
    await listRecalls(A.recep, {}); await listRecalls(A.recep, {});
    expect(await db.followUp.count({ where: { patientId: pid } })).toBe(1);
    expect((await db.recall.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("FOLLOW_UP_CREATED");
    await updateSettings(A.admin, { createOnNoShow: true, createOnCancellation: false, recallCreatesFollowUp: false, completeWhenVisitDone: false, contactOutcomes: [], completionOutcomes: [] });
  });
});

describe("reminders, Patient 360, audit and isolation (22–24, 28–29)", () => {
  it("in-app reminders appear once per day with real counts, and never for zero", async () => {
    const g = await createFollowUp(A.recep, { patientId: await patient(A), title: "Nurse overdue", afterDays: 0, assignedToId: A.nurseId }) as { id: string };
    await past(g.id, 2);
    await createFollowUp(A.recep, { patientId: await patient(A), title: "Nurse due today", afterDays: 0, assignedToId: A.nurseId });
    const n1 = await listNotifications(A.nurse);
    expect(n1.items.some((n) => n.type === "FOLLOW_UP_OVERDUE" && /overdue/.test(n.title))).toBe(true);
    expect(n1.items.some((n) => n.type === "FOLLOW_UP_DUE")).toBe(true);
    await listNotifications(A.nurse); await listNotifications(A.nurse);
    expect(await db.notification.count({ where: { tenantId: A.id, userId: A.nurseId, type: "FOLLOW_UP_OVERDUE" } })).toBe(1);
    expect((await listNotifications(B.nurse)).items.filter((n) => n.type.startsWith("FOLLOW_UP"))).toHaveLength(0);
    expect((await listNotifications(A.accountant)).items.filter((n) => n.type.startsWith("FOLLOW_UP"))).toHaveLength(0);
    expect(JSON.stringify((await listNotifications(A.nurse)).items.filter((n) => /^(FOLLOW_UP|RECALL|REPORT_REVIEW)/.test(n.type)))).not.toMatch(/Nurse overdue|Patient/);
  });
  it("Patient 360 lists the patient's follow-ups in groups and adds timeline events (safe summaries)", async () => {
    const pid = await patient(A, "Timeline Patient");
    const f = await createFollowUp(A.recep, { patientId: pid, title: "Timeline task", afterDays: 2, notes: "PRIVATE-STAFF-NOTE" }) as { id: string };
    const g = await createFollowUp(A.recep, { patientId: pid, title: "Done task", afterDays: 1 }) as { id: string };
    await contact(A.recep, f.id, { notes: "PRIVATE-CONTACT-NOTE" });
    await act(A.recep, f.id, { action: "reschedule", dueDate: addDays(today(), 4), reason: "later" });
    await act(A.recep, g.id, { action: "complete", outcome: "COMPLETED", notes: "all good" });
    const p = await patientFollowUps(A.recep, pid);
    expect(p.followUps.map((x) => x.group).sort()).toEqual(["completed", "upcoming"]);
    expect(p.can).toEqual({ create: true, recall: true });
    const ev = await followUpTimeline(A.recep, pid);
    expect(ev.map((e) => e.type)).toEqual(expect.arrayContaining(["FOLLOW_UP_CREATED", "FOLLOW_UP_CONTACTED", "FOLLOW_UP_RESCHEDULED", "FOLLOW_UP_COMPLETED"]));
    expect(JSON.stringify(ev)).not.toMatch(/PRIVATE-/);
    const other = JSON.stringify(await followUpTimeline(A.recep2, pid)); // scoped like the list: only the still-unassigned follow-up
    expect(other).toContain("Done task"); expect(other).not.toContain("Timeline task");
    expect(await followUpTimeline(A.accountant, pid)).toEqual([]);
    expect(await followUpTimeline(B.admin, pid)).toEqual([]);
    expect(await code(patientFollowUps(B.admin, pid))).toBe("NOT_FOUND");
  });
  it("audit rows cover the lifecycle and never contain notes", async () => {
    const f = await createFollowUp(A.recep, { patientId: await patient(A), title: "Audited", afterDays: 1, notes: "AUDIT-SECRET" }) as { id: string };
    await act(A.recep, f.id, { action: "assign", assignedToId: A.recepId });
    await contact(A.recep, f.id, { notes: "AUDIT-SECRET-2" });
    await act(A.recep, f.id, { action: "complete", outcome: "COMPLETED", notes: "AUDIT-SECRET-3" });
    const rows = await db.auditLog.findMany({ where: { tenantId: A.id, entityId: f.id } });
    expect(rows.map((r) => r.action)).toEqual(expect.arrayContaining(["followup.created", "followup.assigned", "followup.contact_logged", "followup.completed"]));
    expect(JSON.stringify(rows)).not.toMatch(/AUDIT-SECRET/);
    expect(await db.auditLog.count({ where: { tenantId: B.id, entityId: f.id } })).toBe(0);
  });
  it("direct API manipulation across clinics is refused everywhere", async () => {
    const bf = await manual(B);
    const ctxs = [A.admin, A.doctor, A.recep, A.nurse];
    for (const who of ctxs) {
      expect(await code(getFollowUp(who, bf.id))).toBe("NOT_FOUND");
      expect(await code(act(who, bf.id, { action: "cancel", reason: "attack" }))).toBe("NOT_FOUND");
      expect(await code(contact(who, bf.id))).toBe("NOT_FOUND");
      expect(["NOT_FOUND", "FORBIDDEN"]).toContain(await code(editFollowUp(who, bf.id, { title: "hijacked" })));
    }
    expect((await db.followUp.findUniqueOrThrow({ where: { id: bf.id } })).status).toBe("PENDING");
    expect((await listFollowUps(A.admin, { q: bf.followUpNumber })).rows.filter((r) => r.id === bf.id)).toHaveLength(0);
    expect(await code(consultationAction(A.doctor, "nope", { action: "review" }))).not.toBe("ok");
  });
});
