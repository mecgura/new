import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { addDays, todayIn, zonedToUtc } from "@/lib/scheduling/time";
import { asTenant, ctxFor, makeUser, seedSystemData, uniq } from "@/test/helpers";
import type { RoleKey } from "@/lib/permissions";
import { appointmentAction, createStaffAppointment } from "./appointments";
import { queueAction, registerVisit } from "./opd";
import { archivePatient, exportPatient, getPatientProfile, listPatientAppointments, listPatientVisits, listPatients, patientTimeline, registerPatient, restorePatient, setPatientStatus, updatePatient } from "./patient-crm";
import { createRecord, getFamily, linkFamily, listRecords, unlinkFamily, updateRecord } from "./patient-records";
import { checkDuplicates, searchPatients } from "./patients";
import { saveSchedule } from "./schedule";

const TZ = "Asia/Kolkata";
const code = (p: Promise<unknown>) => p.then(() => "ok", (e) => (e instanceof AppError ? e.code : `ERR:${e}`));
type Ctx = ReturnType<typeof asTenant>;
interface T { id: string; admin: Ctx; doctor: Ctx; recep: Ctx; nurse: Ctx; compounder: Ctx; accountant: Ctx; lab: Ctx; staff: Ctx; doctorId: string }

async function mkTenant(label: string): Promise<T> {
  const t = await db.tenant.create({ data: { name: `CRM ${label}`, slug: uniq(`crm-${label}`).slice(0, 30), status: "ACTIVE" } });
  const mk = async (role: RoleKey) => { const { user } = await makeUser(role, t.id); return { user, ctx: asTenant(ctxFor(user, role, t.id)) }; };
  const [a, d, r, n, c, ac, l, s] = [await mk("CLINIC_ADMIN"), await mk("DOCTOR"), await mk("RECEPTIONIST"), await mk("NURSE"), await mk("COMPOUNDER"), await mk("ACCOUNTANT"), await mk("LAB_STAFF"), await mk("STAFF")];
  await saveSchedule(a.ctx, d.user.id, { slotMinutes: 15, bufferMinutes: 0, onlineBooking: false, advanceDays: 60, minNoticeMinutes: 0, windows: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, start: "09:00", end: "17:00" })) });
  return { id: t.id, admin: a.ctx, doctor: d.ctx, recep: r.ctx, nurse: n.ctx, compounder: c.ctx, accountant: ac.ctx, lab: l.ctx, staff: s.ctx, doctorId: d.user.id };
}
let phoneN = 0;
const reg = (t: T, over: Record<string, unknown> = {}) => registerPatient(t.recep, { name: "Test Patient", phone: `98${String(20000000 + ++phoneN * 13).slice(0, 8)}`, allowDuplicate: true, ...over });
const slotAt = (date: string, h: number, m = 0) => zonedToUtc(date, h * 60 + m, TZ).toISOString();

let A: T, B: T;
beforeAll(async () => { await seedSystemData(); A = await mkTenant("a"); B = await mkTenant("b"); });

describe("registration, ids and search", () => {
  it("A. registers a patient with a stable, clinic-scoped, non-derived ID", async () => {
    const p = await reg(A, { name: "Asha Verma", phone: "9876543210", gender: "FEMALE", dateOfBirth: "1990-05-01", city: "Shimla", bloodGroup: "O+", emergencyContactName: "Ravi Verma", emergencyContactRelation: "Spouse", emergencyContactPhone: "9876500000", privacyAcknowledged: true });
    expect(p.code).toMatch(/^P-\d{6}$/); expect(p.code).not.toContain("9876");
    const row = await db.patient.findUniqueOrThrow({ where: { id: p.id } });
    expect(row).toMatchObject({ tenantId: A.id, phone: "+919876543210", status: "ACTIVE", bloodGroup: "O+", emergencyContactPhone: "+919876500000", dateOfBirth: new Date("1990-05-01T00:00:00Z") });
    expect((await db.patientConsent.findMany({ where: { patientId: p.id } })).map((c) => c.type)).toEqual(["PRIVACY"]); // D/O: consent recorded because staff confirmed it
  });
  it("D. patient IDs are unique, sequential per clinic, never reused", async () => {
    const ids = await Promise.all(Array.from({ length: 10 }, () => reg(B)));
    expect(new Set(ids.map((i) => i.code)).size).toBe(10);
    const first = await reg(B); const second = await reg(B);
    expect(Number(second.code.slice(2))).toBe(Number(first.code.slice(2)) + 1);
    await archivePatient(B.admin, first.id, {});
    expect(Number((await reg(B)).code.slice(2))).toBeGreaterThan(Number(second.code.slice(2))); // archived codes aren't recycled
  });
  it("validates input; emergency contact needs name + phone together; unknown fields can't set tenant/status", async () => {
    expect(await code(registerPatient(A.recep, { name: "x", phone: "123" }))).toBe("VALIDATION_ERROR");
    expect(await code(registerPatient(A.recep, { name: "Valid Name", phone: "9876500011", emergencyContactName: "Only Name" }))).toBe("VALIDATION_ERROR");
    expect(await code(registerPatient(A.recep, { name: "Valid Name", phone: "9876500012", bloodGroup: "Z+" }))).toBe("VALIDATION_ERROR");
    const p = await registerPatient(A.recep, { name: "Sneaky Person", phone: "9876500013", tenantId: B.id, status: "ARCHIVED", code: "P-999999" });
    const row = await db.patient.findUniqueOrThrow({ where: { id: p.id } });
    expect(row.tenantId).toBe(A.id); expect(row.status).toBe("ACTIVE"); expect(row.code).not.toBe("P-999999");
  });
  it("C. duplicate detection by mobile, email and name+DOB needs explicit confirmation", async () => {
    await registerPatient(A.recep, { name: "Dup Original", phone: "9876500020", email: "dup@example.com", dateOfBirth: "1985-01-01" });
    expect(await code(registerPatient(A.recep, { name: "Someone Else", phone: "9876500020" }))).toBe("CONFLICT");
    expect(await code(registerPatient(A.recep, { name: "Someone Else", phone: "9876500021", email: "DUP@example.com" }))).toBe("CONFLICT");
    expect(await code(registerPatient(A.recep, { name: "Dup Original", phone: "9876500022", dateOfBirth: "1985-01-01" }))).toBe("CONFLICT");
    expect(await code(registerPatient(A.recep, { name: "Someone Else", phone: "9876500020", allowDuplicate: true }))).toBe("ok");
    const cards = await checkDuplicates(A.recep, { phone: "9876500020" });
    expect(cards.length).toBeGreaterThanOrEqual(1); expect(JSON.stringify(cards)).not.toContain("9876500020"); expect(cards[0].phoneMasked).toBe("••••••0020");
    expect((await checkDuplicates(B.recep, { phone: "9876500020" })).length).toBe(0); // other clinic's patients never match
  });
  it("B. search is tenant-scoped, masked, and skips archived patients", async () => {
    const p = await reg(A, { name: "Searchable Sundar", phone: "9876500030" });
    expect((await searchPatients(A.recep, { q: "Searchable" })).map((x) => x.id)).toContain(p.id);
    expect((await searchPatients(B.recep, { q: "Searchable" })).length).toBe(0);
    await archivePatient(A.admin, p.id, {});
    expect((await searchPatients(A.recep, { q: "Searchable" })).length).toBe(0);
  });
  it("patient list: paginated, filtered, searchable, masked phone", async () => {
    for (let i = 0; i < 25; i++) await reg(B, { name: `Listing Person ${String(i).padStart(2, "0")}` });
    const p1 = await listPatients(B.recep, { q: "Listing Person", page: 1 }); const p2 = await listPatients(B.recep, { q: "Listing Person", page: 2 });
    expect(p1.rows.length).toBe(20); expect(p2.rows.length).toBe(5); expect(p1.total).toBe(25); expect(p1.rows[0].phoneMasked).toMatch(/^••••••\d{4}$/);
    expect(JSON.stringify(p1)).not.toContain("+91");
    expect((await listPatients(B.recep, { status: "ARCHIVED" })).rows.every((r) => r.status === "ARCHIVED")).toBe(true);
    expect((await listPatients(B.recep, { recent: "true" })).total).toBeGreaterThan(0);
    expect((await listPatients(A.recep, { q: "Listing Person" })).total).toBe(0);
    expect(await code(listPatients(B.recep, { page: "0" }))).toBe("VALIDATION_ERROR");
  });
});

describe("profile, editing, status, archive/restore", () => {
  let P: { id: string; code: string };
  beforeAll(async () => { P = await reg(A, { name: "Profile Person", phone: "9876500040", email: "pp@example.com", dateOfBirth: "1980-02-02" }); });
  it("E. edit changes only what changed and audits field names, not values", async () => {
    expect(await code(updatePatient(A.doctor, P.id, { name: "X Y", phone: "9876500040" }))).toBe("FORBIDDEN");
    expect((await updatePatient(A.recep, P.id, { name: "Profile Person", phone: "9876500040", email: "pp@example.com", dateOfBirth: "1980-02-02" })).updated).toBe(false);
    expect((await updatePatient(A.recep, P.id, { name: "Profile Person", phone: "9876500040", email: "pp@example.com", dateOfBirth: "1980-02-02", city: "Solan", alternatePhone: "9876500041" })).updated).toBe(true);
    const log = await db.auditLog.findFirstOrThrow({ where: { tenantId: A.id, entityId: P.id, action: "patient.updated" } });
    expect(log.metadata).toContain("city"); expect(log.metadata).not.toContain("Solan"); expect(log.metadata).not.toContain("9876500041");
  });
  it("N. emergency contact + communication preferences are stored and returned to staff with view access", async () => {
    await updatePatient(A.recep, P.id, { name: "Profile Person", phone: "9876500040", emergencyContactName: "Kin Person", emergencyContactRelation: "Brother", emergencyContactPhone: "9876500042", prefWhatsapp: "ALLOWED", prefSms: "NOT_ALLOWED" });
    const prof = await getPatientProfile(A.recep, P.id);
    if (prof.tier !== "full") throw new Error();
    expect(prof.patient.emergencyContact).toEqual({ name: "Kin Person", relation: "Brother", phone: "+919876500042" });
    expect(prof.patient.prefs).toMatchObject({ whatsapp: "ALLOWED", sms: "NOT_ALLOWED", phone: "UNKNOWN" });
    expect(await code(updatePatient(A.recep, P.id, { name: "Profile Person", phone: "9876500040", emergencyContactPhone: "9876500042" }))).toBe("VALIDATION_ERROR");
  });
  it("viewing a profile is audited", async () => {
    await getPatientProfile(A.doctor, P.id);
    expect(await db.auditLog.count({ where: { tenantId: A.id, entityId: P.id, action: "patient.viewed" } })).toBeGreaterThan(0);
  });
  it("INACTIVE status toggles; archived is read-only; restore needs admin", async () => {
    expect((await setPatientStatus(A.recep, P.id, "INACTIVE")).status).toBe("INACTIVE");
    expect(await code(setPatientStatus(A.recep, P.id, "ARCHIVED"))).toBe("VALIDATION_ERROR");
    await setPatientStatus(A.recep, P.id, "ACTIVE");
    expect(await code(archivePatient(A.recep, P.id, {}))).toBe("FORBIDDEN"); // F: permission
    expect(await code(archivePatient(A.doctor, P.id, {}))).toBe("FORBIDDEN");
    expect((await archivePatient(A.admin, P.id, { reason: "duplicate record" })).status).toBe("ARCHIVED");
    expect(await code(archivePatient(A.admin, P.id, {}))).toBe("CONFLICT");
    expect(await code(updatePatient(A.recep, P.id, { name: "Profile Person", phone: "9876500040" }))).toBe("CONFLICT");
    expect(await code(createRecord(A.doctor, P.id, "allergies", { allergen: "Penicillin" }))).toBe("CONFLICT");
    expect(await code(restorePatient(A.recep, P.id))).toBe("FORBIDDEN");
    expect((await restorePatient(A.admin, P.id)).status).toBe("ACTIVE"); // G
    expect(await code(restorePatient(A.admin, P.id))).toBe("CONFLICT");
    const actions = (await db.auditLog.findMany({ where: { tenantId: A.id, entityId: P.id } })).map((l) => l.action);
    expect(actions).toEqual(expect.arrayContaining(["patient.archived", "patient.restored"]));
    const arch = await db.auditLog.findFirstOrThrow({ where: { entityId: P.id, action: "patient.archived" } });
    expect(arch.metadata).not.toContain("duplicate record"); // reason text isn't copied into the log
  });
  it("archived patients can still be found by the list filter but can't be linked to new visits", async () => {
    const q = await reg(A, { name: "Archived Visitor" });
    await archivePatient(A.admin, q.id, {});
    expect((await listPatients(A.recep, { status: "ARCHIVED", q: "Archived Visitor" })).total).toBe(1);
    expect(await code(registerVisit(A.recep, { patient: { patientId: q.id, viaProfile: true }, doctorUserId: A.doctorId }))).toBe("CONFLICT");
  });
  it("archiving is blocked while the patient is queued or has upcoming appointments", async () => {
    const q = await reg(A, { name: "Busy Patient" });
    const v = await registerVisit(A.recep, { patient: { patientId: q.id, viaProfile: true }, doctorUserId: A.doctorId });
    expect(await code(archivePatient(A.admin, q.id, {}))).toBe("CONFLICT");
    await queueAction(A.recep, v.id, { action: "cancel" });
    await createStaffAppointment(A.recep, { doctorUserId: A.doctorId, startsAt: slotAt(addDays(todayIn(TZ), 5), 9), patient: { patientId: q.id, viaProfile: true } });
    expect(await code(archivePatient(A.admin, q.id, {}))).toBe("CONFLICT");
  });
});

describe("Phase 3 connections and timeline", () => {
  let T1: T, P: { id: string };
  beforeAll(async () => { T1 = await mkTenant("conn"); P = await reg(T1, { name: "Connected Patient" }); });
  it("H/I. appointments and OPD visits show on the patient file and timeline; no duplicate tables", async () => {
    const date = addDays(todayIn(TZ), 3);
    const ap = await createStaffAppointment(T1.recep, { doctorUserId: T1.doctorId, startsAt: slotAt(date, 10), patient: { patientId: P.id, viaProfile: true } });
    const v = await registerVisit(T1.recep, { patient: { patientId: P.id, viaProfile: true }, doctorUserId: T1.doctorId });
    const prof = await getPatientProfile(T1.recep, P.id); if (prof.tier !== "full") throw new Error();
    expect(prof.overview.nextAppointment?.doctor).toBeTruthy(); expect(prof.overview.todayVisit).toMatchObject({ token: v.token, status: "WAITING" });
    await queueAction(T1.doctor, v.id, { action: "call" });
    expect(((await getPatientProfile(T1.recep, P.id)) as { overview: { todayVisit: { status: string } } }).overview.todayVisit.status).toBe("CALLED");
    await queueAction(T1.doctor, v.id, { action: "start" }); await queueAction(T1.doctor, v.id, { action: "complete" });
    const done = await getPatientProfile(T1.recep, P.id) as { overview: { totalVisits: number; lastVisitAt: string | null } };
    expect(done.overview.totalVisits).toBe(1); expect(done.overview.lastVisitAt).toBeTruthy();
    const visits = await listPatientVisits(T1.recep, P.id); expect(visits.visits.length).toBe(1); expect(visits.visits[0]).toMatchObject({ token: v.token, status: "COMPLETED" });
    const appts = await listPatientAppointments(T1.recep, P.id); expect(appts.upcoming.map((a) => a.publicId)).toContain((await db.appointment.findUniqueOrThrow({ where: { id: ap.id } })).publicId);
    await appointmentAction(T1.recep, ap.id, { action: "cancel", reasonKind: "OTHER" });
    expect((await listPatientAppointments(T1.recep, P.id)).past[0].status).toBe("CANCELLED");
  });
  it("J. timeline merges real events newest-first, paginates, filters, and invents nothing", async () => {
    const all = await patientTimeline(T1.recep, P.id, {});
    const types = all.events.map((e) => e.type);
    expect(types).toEqual(expect.arrayContaining(["PATIENT_CREATED", "APPOINTMENT_CREATED", "APPOINTMENT_CANCELLED", "TOKEN_ASSIGNED", "OPD_CALLED", "OPD_STARTED", "OPD_COMPLETED"]));
    expect([...all.events].map((e) => e.at)).toEqual([...all.events].map((e) => e.at).sort().reverse());
    expect(types.some((t) => /CONSULTATION_CREATED|PRESCRIPTION|TEST_ORDERED|REPORT|BILL|PAYMENT|FOLLOWUP/.test(t))).toBe(false);
    expect((await patientTimeline(T1.recep, P.id, { filter: "opd" })).events.every((e) => e.category === "opd")).toBe(true);
    expect((await patientTimeline(T1.recep, P.id, { filter: "appointments" })).events.every((e) => e.category === "appointments")).toBe(true);
    const future = await patientTimeline(T1.recep, P.id, { filter: "documents" });
    expect(future.available).toBe(false); expect(future.events).toEqual([]);
    expect((await patientTimeline(T1.recep, P.id, { page: 2 })).events.length).toBeLessThanOrEqual(20);
    expect(await code(patientTimeline(T1.recep, P.id, { filter: "bogus" }))).toBe("VALIDATION_ERROR");
  });
  it("clinical timeline events appear only for clinical roles", async () => {
    await createRecord(T1.doctor, P.id, "allergies", { allergen: "Penicillin", reaction: "Rash", severity: "MODERATE" });
    expect((await patientTimeline(T1.doctor, P.id, { filter: "clinical" })).events.map((e) => e.detail)).toContain("Penicillin");
    const rec = await patientTimeline(T1.recep, P.id, { filter: "clinical" });
    expect(rec.events).toEqual([]); expect(rec.restricted).toBe(true);
    expect(JSON.stringify(await patientTimeline(T1.recep, P.id, {}))).not.toContain("Penicillin");
  });
});

describe("clinical records", () => {
  let P: { id: string };
  beforeAll(async () => { P = await reg(A, { name: "Clinical Person" }); });
  it("K. allergy records: create, update status, alert on profile (clinical roles only)", async () => {
    const r = await createRecord(A.doctor, P.id, "allergies", { allergen: "Penicillin", reaction: "Rash", severity: "MODERATE", notes: "as told by patient" });
    expect((await listRecords(A.doctor, P.id, "allergies")).items[0]).toMatchObject({ allergen: "Penicillin", severity: "MODERATE", status: "ACTIVE" });
    expect((await getPatientProfile(A.doctor, P.id) as { alerts: { allergies: { allergen: string }[] } }).alerts.allergies[0].allergen).toBe("Penicillin");
    expect((await getPatientProfile(A.recep, P.id) as { alerts: unknown }).alerts).toBeNull();
    await updateRecord(A.nurse, P.id, "allergies", r.id, { allergen: "Penicillin", severity: "MODERATE", status: "INACTIVE" });
    expect(((await getPatientProfile(A.doctor, P.id)) as { alerts: { allergies: unknown[] } }).alerts.allergies).toEqual([]);
    expect(await code(createRecord(A.doctor, P.id, "allergies", { allergen: "A", severity: "EXTREME" }))).toBe("VALIDATION_ERROR");
  });
  it("L/M. medical history, medicines and family history store what staff enter", async () => {
    await createRecord(A.doctor, P.id, "history", { category: "SURGERY", title: "Appendectomy", occurredOn: "2015", status: "RESOLVED" });
    await createRecord(A.nurse, P.id, "medications", { name: "Metformin", strength: "500 mg", frequency: "twice daily", source: "PATIENT_REPORTED" });
    await createRecord(A.doctor, P.id, "family-history", { relation: "FATHER", condition: "Hypertension" });
    expect((await listRecords(A.doctor, P.id, "history")).items[0]).toMatchObject({ title: "Appendectomy", category: "SURGERY" });
    expect((await listRecords(A.doctor, P.id, "medications")).items[0]).toMatchObject({ name: "Metformin", active: true });
    expect((await listRecords(A.doctor, P.id, "family-history")).items[0]).toMatchObject({ relation: "FATHER" });
    expect(await code(createRecord(A.doctor, P.id, "history", { category: "SURGERY", title: "X", occurredOn: "yesterday" }))).toBe("VALIDATION_ERROR");
  });
  it("R. field-level access: only clinical roles read clinical sections; only clinical-edit roles write", async () => {
    for (const who of [A.recep, A.compounder, A.accountant, A.lab, A.staff]) {
      for (const k of ["allergies", "medications", "history", "family-history"] as const) expect(await code(listRecords(who, P.id, k))).toBe("FORBIDDEN");
    }
    expect(await code(createRecord(A.recep, P.id, "allergies", { allergen: "Dust" }))).toBe("FORBIDDEN");
    expect(await code(createRecord(A.admin, P.id, "allergies", { allergen: "Dust" }))).toBe("ok");
    expect(await code(listRecords(A.nurse, P.id, "allergies"))).toBe("ok");
  });
  it("M. notes: tiered by kind, append-only, text never audited", async () => {
    await createRecord(A.recep, P.id, "notes", { kind: "RECEPTION", content: "Prefers morning slots" });
    await createRecord(A.doctor, P.id, "notes", { kind: "CLINICAL", content: "Clinical context note" });
    expect(await code(createRecord(A.recep, P.id, "notes", { kind: "CLINICAL", content: "nope" }))).toBe("FORBIDDEN");
    expect(await code(createRecord(A.compounder, P.id, "notes", { kind: "GENERAL", content: "nope" }))).toBe("FORBIDDEN");
    const asRecep = (await listRecords(A.recep, P.id, "notes")).items; const asDoc = (await listRecords(A.doctor, P.id, "notes")).items;
    expect(asRecep.map((n) => n.kind)).toEqual(["RECEPTION"]); expect(asDoc.map((n) => n.kind).sort()).toEqual(["CLINICAL", "RECEPTION"]);
    expect(asDoc[0]).toMatchObject({ authorRole: expect.any(String) }); expect(asDoc[0].author).toBeTruthy();
    expect(await code(updateRecord(A.doctor, P.id, "notes", asDoc[0].id, {}))).toBe("VALIDATION_ERROR");
    const logs = JSON.stringify(await db.auditLog.findMany({ where: { tenantId: A.id, entityId: P.id }, select: { metadata: true, action: true } }));
    expect(logs).not.toContain("Prefers morning"); expect(logs).not.toContain("Clinical context"); expect(logs).not.toContain("Penicillin"); expect(logs).not.toContain("Metformin"); expect(logs).not.toContain("Appendectomy");
  });
  it("O. consent is an append-only log; latest per type wins; no assumption of legal sufficiency", async () => {
    await createRecord(A.recep, P.id, "consents", { type: "COMMUNICATION", status: "GRANTED", version: "v1" });
    await createRecord(A.recep, P.id, "consents", { type: "COMMUNICATION", status: "WITHDRAWN", version: "v1" });
    expect((await getPatientProfile(A.recep, P.id) as { consents: Record<string, { status: string }> }).consents.COMMUNICATION.status).toBe("WITHDRAWN");
    expect((await listRecords(A.recep, P.id, "consents")).items.length).toBe(2);
    expect(await code(createRecord(A.doctor, P.id, "consents", { type: "PRIVACY", status: "GRANTED" }))).toBe("FORBIDDEN");
    expect(await code(updateRecord(A.recep, P.id, "consents", "x", {}))).toBe("VALIDATION_ERROR");
    expect(await db.auditLog.count({ where: { entityId: P.id, action: "patient.consent_recorded" } })).toBe(2);
  });
  it("accountant / lab see identity only", async () => {
    const prof = await getPatientProfile(A.accountant, P.id);
    expect(prof.patient).toEqual({ id: P.id, code: expect.any(String), name: "Clinical Person", status: "ACTIVE" });
    expect(prof).not.toHaveProperty("overview");
    expect(await code(listPatients(A.accountant, {}))).toBe("FORBIDDEN");
    expect(await code(listPatientVisits(A.lab, P.id))).toBe("FORBIDDEN");
    expect(await code(patientTimeline(A.accountant, P.id, {}))).toBe("FORBIDDEN");
    expect(await code(getPatientProfile(A.staff, P.id))).toBe("FORBIDDEN");
  });
});

describe("family grouping", () => {
  it("P. links patients into a household without merging or sharing records", async () => {
    const a = await reg(A, { name: "Family One" }), b = await reg(A, { name: "Family Two" }), c = await reg(A, { name: "Family Three" });
    await createRecord(A.doctor, a.id, "allergies", { allergen: "OnlyForOne" });
    await linkFamily(A.recep, a.id, { otherPatientId: b.id, relation: "Daughter" });
    await linkFamily(A.recep, c.id, { otherPatientId: a.id });
    expect((await getFamily(A.recep, a.id)).members.map((m) => m.name).sort()).toEqual(["Family Three", "Family Two"]);
    expect((await listRecords(A.doctor, b.id, "allergies")).items).toEqual([]); // records stay separate
    expect(JSON.stringify(await getFamily(A.recep, b.id))).not.toContain("OnlyForOne");
    expect(await code(linkFamily(A.recep, a.id, { otherPatientId: a.id }))).toBe("VALIDATION_ERROR");
    expect(await code(linkFamily(A.doctor, a.id, { otherPatientId: b.id }))).toBe("FORBIDDEN");
    await unlinkFamily(A.recep, c.id);
    await unlinkFamily(A.recep, b.id);
    expect((await getFamily(A.recep, a.id)).members).toEqual([]); // a group of one dissolves
    expect(await db.familyGroup.count({ where: { id: (await db.patient.findUniqueOrThrow({ where: { id: a.id } })).familyGroupId ?? "none" } })).toBe(0);
    expect(await code(unlinkFamily(A.recep, c.id))).toBe("CONFLICT");
  });
  it("can't link across clinics", async () => {
    const a = await reg(A, { name: "Fam A" }), b = await reg(B, { name: "Fam B" });
    expect(await code(linkFamily(A.recep, a.id, { otherPatientId: b.id }))).toBe("NOT_FOUND");
    expect(await code(linkFamily(B.recep, b.id, { otherPatientId: a.id }))).toBe("NOT_FOUND");
  });
});

describe("tenant isolation and access control (S/T/Q)", () => {
  let PA: { id: string }, PB: { id: string };
  beforeAll(async () => {
    PA = await reg(A, { name: "Isolation Alpha", phone: "9876500070" }); PB = await reg(B, { name: "Isolation Beta", phone: "9876500071" });
    await createRecord(B.doctor, PB.id, "allergies", { allergen: "BetaOnlyAllergen" });
    await createRecord(B.recep, PB.id, "notes", { kind: "GENERAL", content: "beta only note" });
  });
  it("Clinic A cannot read, edit, archive, export, or list Clinic B's patient through any service", async () => {
    for (const who of [A.admin, A.doctor, A.recep]) {
      expect(await code(getPatientProfile(who, PB.id))).toBe("NOT_FOUND");
      expect(await code(patientTimeline(who, PB.id, {}))).toBe("NOT_FOUND");
      expect(await code(listPatientVisits(who, PB.id))).toBe("NOT_FOUND");
      expect(await code(listPatientAppointments(who, PB.id))).toBe("NOT_FOUND");
      expect(await code(getFamily(who, PB.id))).toBe("NOT_FOUND");
    }
    expect(await code(listRecords(A.doctor, PB.id, "allergies"))).toBe("NOT_FOUND");
    expect(await code(listRecords(A.recep, PB.id, "notes"))).toBe("NOT_FOUND");
    expect(await code(createRecord(A.doctor, PB.id, "allergies", { allergen: "Injected" }))).toBe("NOT_FOUND");
    expect(await code(updatePatient(A.recep, PB.id, { name: "Hacked Name", phone: "9876500099" }))).toBe("NOT_FOUND");
    expect(await code(archivePatient(A.admin, PB.id, {}))).toBe("NOT_FOUND");
    expect(await code(restorePatient(A.admin, PB.id))).toBe("NOT_FOUND");
    expect(await code(exportPatient(A.admin, PB.id))).toBe("NOT_FOUND");
    expect(await code(setPatientStatus(A.recep, PB.id, "INACTIVE"))).toBe("NOT_FOUND");
    expect((await db.patient.findUniqueOrThrow({ where: { id: PB.id } })).name).toBe("Isolation Beta");
    expect(await db.patientAllergy.count({ where: { patientId: PB.id } })).toBe(1);
  });
  it("record ids from another clinic can't be updated even via the caller's own patient", async () => {
    const own = await createRecord(A.doctor, PA.id, "allergies", { allergen: "Mine" });
    const theirs = await db.patientAllergy.findFirstOrThrow({ where: { patientId: PB.id } });
    expect(await code(updateRecord(A.doctor, PA.id, "allergies", theirs.id, { allergen: "Taken over" }))).toBe("NOT_FOUND");
    expect((await db.patientAllergy.findUniqueOrThrow({ where: { id: theirs.id } })).allergen).toBe("BetaOnlyAllergen");
    expect(own.id).toBeTruthy();
  });
  it("lists, searches and duplicate checks never surface the other clinic", async () => {
    for (const q of ["Isolation", "9876500071", "Beta"]) {
      expect(JSON.stringify(await listPatients(A.recep, { q }))).not.toContain("Isolation Beta");
      expect((await searchPatients(A.recep, { q })).some((x) => x.id === PB.id)).toBe(false);
    }
    expect(await listPatients(B.recep, { q: "Isolation" })).toMatchObject({ total: 1 });
    expect((await checkDuplicates(A.recep, { phone: "9876500071", name: "Isolation Beta" })).length).toBe(0);
  });
  it("Phase 3 patient refs can't reach the other clinic either", async () => {
    expect(await code(registerVisit(A.recep, { patient: { patientId: PB.id, viaProfile: true }, doctorUserId: A.doctorId }))).toBe("NOT_FOUND");
    expect(await code(registerVisit(A.recep, { patient: { patientId: PB.id, verification: { phoneLast4: "0071" } }, doctorUserId: A.doctorId }))).toBe("NOT_FOUND");
    expect(await code(registerVisit(A.nurse, { patient: { patientId: PA.id, viaProfile: true }, doctorUserId: A.doctorId }))).toBe("FORBIDDEN"); // nurse can't register visits
  });
  it("Q. export: admin only, tenant-scoped, audited, clinical data only when permitted", async () => {
    expect(await code(exportPatient(A.recep, PA.id))).toBe("FORBIDDEN");
    expect(await code(exportPatient(A.doctor, PA.id))).toBe("FORBIDDEN");
    const out = await exportPatient(A.admin, PA.id);
    expect(out.patient).toMatchObject({ name: "Isolation Alpha" }); expect(JSON.stringify(out)).not.toContain("tenantId"); expect(JSON.stringify(out)).not.toContain("BetaOnly");
    expect(await db.auditLog.count({ where: { entityId: PA.id, action: "patient.exported" } })).toBe(1);
  });
  it("role matrix for sensitive profile sections", async () => {
    const view = async (c: Ctx) => { const p = await getPatientProfile(c, PA.id) as { access: { clinical: boolean; view: boolean; edit: boolean; archive: boolean } }; return p.access; };
    expect(await view(A.admin)).toMatchObject({ clinical: true, view: true, edit: true, archive: true });
    expect(await view(A.doctor)).toMatchObject({ clinical: true, view: true, edit: false, archive: false });
    expect(await view(A.recep)).toMatchObject({ clinical: false, view: true, edit: true, archive: false });
    expect(await view(A.nurse)).toMatchObject({ clinical: true, view: true, edit: false });
    expect(await view(A.compounder)).toMatchObject({ clinical: false, view: true, edit: false });
    expect(await view(A.accountant)).toMatchObject({ clinical: false, view: false });
  });
});
