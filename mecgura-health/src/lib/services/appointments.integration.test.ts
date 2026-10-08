import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { addDays, todayIn, zonedToUtc } from "@/lib/scheduling/time";
import { asTenant, ctxFor, makeUser, seedSystemData, uniq } from "@/test/helpers";
import type { RoleKey } from "@/lib/permissions";
import { appointmentAction, createPublicBooking, createStaffAppointment, getAppointment, listAppointments, publicBookingOptions, publicSlots } from "./appointments";
import { getSlots } from "./availability";
import { callNext, displaySnapshot, queueAction, queueSnapshot, registerVisit, tokenStatus, opdStats } from "./opd";
import { createBlock, deleteBlock, listBlocks, listSchedules, readOpdSettings, saveOpdSettings, saveSchedule } from "./schedule";
import { saveDoctorProfile, setDoctorStatus } from "./website-doctors";
import { publishSite, saveSection } from "./website-content";
import { searchPatients } from "./patients";

const TZ = "Asia/Kolkata";
const code = (p: Promise<unknown>) => p.then(() => "ok", (e) => (e instanceof AppError ? e.code : `ERR:${e}`));
type Ctx = ReturnType<typeof asTenant>;
interface T { id: string; admin: Ctx; doctor: Ctx; doctor2: Ctx; recep: Ctx; nurse: Ctx; doctorId: string; doctor2Id: string; slug: string; display: string }

const weekdays = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, start: "09:00", end: "17:00" }));
const schedule = { slotMinutes: 15, bufferMinutes: 0, onlineBooking: true, advanceDays: 60, minNoticeMinutes: 0, roomLabel: "Room 1", windows: weekdays };
const futureDate = (n: number) => addDays(todayIn(TZ), n);
const slotAt = (date: string, hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return zonedToUtc(date, h * 60 + m, TZ).toISOString(); };
let phoneN = 0;
const newPatient = (name = "Test Patient") => ({ newPatient: { name, phone: `98${String(10000000 + ++phoneN * 7).slice(0, 8)}` }, allowDuplicate: false });

async function mkTenant(label: string): Promise<T> {
  const t = await db.tenant.create({ data: { name: `Clinic ${label}`, slug: uniq(`sch-${label}`).slice(0, 30), status: "ACTIVE" } });
  const mk = async (role: RoleKey) => { const { user } = await makeUser(role, t.id); return { user, ctx: asTenant(ctxFor(user, role, t.id)) }; };
  const [a, d, d2, r, n] = [await mk("CLINIC_ADMIN"), await mk("DOCTOR"), await mk("DOCTOR"), await mk("RECEPTIONIST"), await mk("NURSE")];
  for (const d of [a]) void d;
  await saveSchedule(a.ctx, d.user.id, schedule); await saveSchedule(a.ctx, d2.user.id, { ...schedule, onlineBooking: false });
  await saveSection(a.ctx, "hero", { headline: `Clinic ${label}` });
  await saveDoctorProfile(a.ctx, d.user.id, { shortBio: "Doctor" }); await setDoctorStatus(a.ctx, d.user.id, "PUBLISHED");
  await publishSite(a.ctx);
  const slug = `dr-${label}-${Date.now().toString(36)}`;
  await db.doctorPublicProfile.updateMany({ where: { userId: d.user.id }, data: { slug } });
  const profile = await db.doctorPublicProfile.findFirstOrThrow({ where: { userId: d.user.id } });
  await saveOpdSettings(a.ctx, { tokenFormat: "NUMERIC", tokenPad: 2, prefixes: {}, voiceAnnouncement: true, showNextOnDisplay: true, onlineTokens: false, bookingMode: "AUTO_CONFIRM", displayEnabled: true });
  const s = await db.opdSettings.findFirstOrThrow({ where: { tenantId: t.id } });
  return { id: t.id, admin: a.ctx, doctor: d.ctx, doctor2: d2.ctx, recep: r.ctx, nurse: n.ctx, doctorId: d.user.id, doctor2Id: d2.user.id, slug: profile.slug, display: s.displayKey! };
}

let A: T, B: T;
beforeAll(async () => { await seedSystemData(); A = await mkTenant("a"); B = await mkTenant("b"); });

const book = (t: T, date: string, hhmm: string, who = newPatient(), doctorId = t.doctorId) => createStaffAppointment(t.recep, { doctorUserId: doctorId, startsAt: slotAt(date, hhmm), patient: who });

describe("availability (server side)", () => {
  it("returns the doctor's slots from the saved schedule", async () => {
    const r = await getSlots(A.id, A.doctorId, futureDate(2), "staff");
    expect(r.reason).toBe("OK"); expect(r.slots[0].label).toBe("09:00"); expect(r.slots.length).toBe(32);
  });
  it("another clinic's doctor has no slots here", async () => {
    expect((await getSlots(A.id, B.doctorId, futureDate(2), "staff")).slots).toEqual([]);
  });
  it("doctors without online booking are not offered publicly", async () => {
    expect((await getSlots(A.id, A.doctor2Id, futureDate(2), "public")).slots).toEqual([]);
    expect((await getSlots(A.id, A.doctor2Id, futureDate(2), "staff")).slots.length).toBeGreaterThan(0);
  });
  it("blocked time (doctor leave / clinic holiday) removes slots and warns about existing bookings", async () => {
    const date = futureDate(20);
    await book(A, date, "10:00");
    const r = await createBlock(A.admin, { doctorUserId: A.doctorId, startDate: date, startTime: "09:00", endDate: date, endTime: "12:00", kind: "LEAVE" });
    expect(r.existingAppointments).toBe(1);
    const slots = (await getSlots(A.id, A.doctorId, date, "staff")).slots.map((s) => s.label);
    expect(slots).not.toContain("10:00"); expect(slots).toContain("12:00");
    expect((await listBlocks(A.admin)).some((b) => b.id === r.id)).toBe(true);
    expect(await code(deleteBlock(B.admin, r.id))).toBe("NOT_FOUND");
    await deleteBlock(A.admin, r.id);
    expect((await getSlots(A.id, A.doctorId, date, "staff")).slots.map((s) => s.label)).toContain("11:00");
  });
  it("a doctor can edit only their own schedule and blocks", async () => {
    expect(await code(saveSchedule(A.doctor, A.doctorId, schedule))).toBe("ok");
    expect(await code(saveSchedule(A.doctor, A.doctor2Id, schedule))).toBe("FORBIDDEN");
    expect(await code(saveSchedule(A.recep, A.doctorId, schedule))).toBe("FORBIDDEN");
    expect(await code(saveSchedule(A.admin, B.doctorId, schedule))).toBe("VALIDATION_ERROR"); // not this clinic's doctor
    expect(await code(createBlock(A.doctor, { doctorUserId: null, startDate: futureDate(30), endDate: futureDate(30) }))).toBe("FORBIDDEN"); // clinic-wide = admin only
  });
  it("overlapping or backwards sessions are rejected", async () => {
    expect(await code(saveSchedule(A.admin, A.doctorId, { ...schedule, windows: [{ weekday: 1, start: "09:00", end: "12:00" }, { weekday: 1, start: "11:00", end: "13:00" }] }))).toBe("VALIDATION_ERROR");
    expect(await code(saveSchedule(A.admin, A.doctorId, { ...schedule, windows: [{ weekday: 1, start: "12:00", end: "09:00" }] }))).toBe("VALIDATION_ERROR");
  });
  it("lists schedules per clinic only", async () => {
    const list = await listSchedules(A.admin);
    expect(list.map((s) => s.doctorUserId).sort()).toEqual([A.doctorId, A.doctor2Id].sort());
  });
});

describe("booking and double-booking prevention", () => {
  it("staff booking stores the slot; the same slot can't be booked twice", async () => {
    const d = futureDate(3);
    await book(A, d, "09:00");
    expect(await code(book(A, d, "09:00"))).toBe("CONFLICT");
    expect((await getSlots(A.id, A.doctorId, d, "staff")).slots.map((s) => s.label)).not.toContain("09:00");
  });
  it("CONCURRENCY: many simultaneous requests for one slot — exactly one wins", async () => {
    const d = futureDate(4);
    const results = await Promise.all(Array.from({ length: 12 }, () => code(book(A, d, "11:00"))));
    expect(results.filter((r) => r === "ok").length).toBe(1);
    expect(results.filter((r) => r === "CONFLICT").length).toBe(11);
    expect(await db.appointment.count({ where: { tenantId: A.id, doctorUserId: A.doctorId, startsAt: new Date(slotAt(d, "11:00")) } })).toBe(1);
  });
  it("CONCURRENCY: staff and public booking race for the same slot", async () => {
    const d = futureDate(5);
    const pub = () => createPublicBooking(A.id, { doctor: A.slug, startsAt: slotAt(d, "12:00"), name: "Walk Visitor", phone: "9876500001", consent: true }, "1.1.1.1");
    const r = await Promise.all([code(pub()), code(book(A, d, "12:00")), code(pub()), code(book(A, d, "12:00"))]);
    expect(r.filter((x) => x === "ok").length).toBe(1);
  });
  it("the database itself rejects a duplicate slot (unique constraint, not just app logic)", async () => {
    const d = futureDate(6);
    await book(A, d, "09:15");
    const ap = await db.appointment.findFirstOrThrow({ where: { tenantId: A.id, startsAt: new Date(slotAt(d, "09:15")) } });
    await expect(db.appointment.create({ data: { tenantId: A.id, doctorUserId: A.doctorId, startsAt: ap.startsAt, endsAt: ap.endsAt, type: "OPD", source: "RECEPTION", status: "CONFIRMED", slotLock: ap.slotLock, publicId: "AP-DUPLICATE1" } })).rejects.toMatchObject({ code: "P2002" });
  });
  it("the doctor is a clinic doctor: booking another clinic's doctor id fails", async () => {
    expect(await code(createStaffAppointment(A.recep, { doctorUserId: B.doctorId, startsAt: slotAt(futureDate(3), "13:00"), patient: newPatient() }))).toBe("VALIDATION_ERROR");
  });
  it("slots outside the schedule / in the past can't be booked even if the client sends them", async () => {
    expect(await code(book(A, futureDate(3), "03:00"))).toBe("CONFLICT");
    expect(await code(book(A, addDays(todayIn(TZ), -2), "10:00"))).toBe("CONFLICT");
    expect(await code(createStaffAppointment(A.recep, { doctorUserId: A.doctorId, startsAt: "not-a-date", patient: newPatient() }))).toBe("VALIDATION_ERROR");
  });
  it("cancelled and no-show appointments free the slot", async () => {
    const d = futureDate(7);
    const a = await book(A, d, "10:00");
    await appointmentAction(A.recep, a.id, { action: "cancel", reasonKind: "PATIENT_REQUEST" });
    await book(A, d, "10:00");
    const b = await book(A, d, "10:15");
    await appointmentAction(A.recep, b.id, { action: "no-show" });
    expect(await code(book(A, d, "10:15"))).toBe("ok");
  });
  it("reschedule moves the slot, frees the old one and refuses a taken one", async () => {
    const d = futureDate(8);
    const a = await book(A, d, "09:00"); await book(A, d, "09:15");
    expect(await code(appointmentAction(A.recep, a.id, { action: "reschedule", startsAt: slotAt(d, "09:15") }))).toBe("CONFLICT");
    expect(await code(appointmentAction(A.recep, a.id, { action: "reschedule", startsAt: slotAt(d, "14:00") }))).toBe("ok");
    expect(await code(book(A, d, "09:00"))).toBe("ok");
    expect((await getAppointment(A.recep, a.id)).time).toBe("14:00");
  });
  it("only valid status changes are allowed", async () => {
    const d = futureDate(9);
    const a = await book(A, d, "09:00");
    expect(await code(appointmentAction(A.recep, a.id, { action: "confirm" }))).toBe("CONFLICT"); // already confirmed
    await appointmentAction(A.recep, a.id, { action: "cancel", reasonKind: "OTHER", reason: "x" });
    expect(await code(appointmentAction(A.recep, a.id, { action: "cancel", reasonKind: "OTHER" }))).toBe("CONFLICT");
    expect(await code(appointmentAction(A.recep, a.id, { action: "no-show" }))).toBe("CONFLICT");
    expect(await code(appointmentAction(A.recep, a.id, { action: "reschedule", startsAt: slotAt(d, "15:00") }))).toBe("CONFLICT");
    expect(await code(appointmentAction(A.recep, a.id, { status: "COMPLETED" }))).toBe("VALIDATION_ERROR"); // the client can't set a status
  });
  it("every appointment action is audited", async () => {
    const d = futureDate(10);
    const a = await book(A, d, "09:00");
    await appointmentAction(A.recep, a.id, { action: "reschedule", startsAt: slotAt(d, "09:30") });
    await appointmentAction(A.recep, a.id, { action: "cancel", reasonKind: "PATIENT_REQUEST" });
    const actions = (await db.auditLog.findMany({ where: { tenantId: A.id, entityId: a.id } })).map((x) => x.action);
    expect(actions).toEqual(expect.arrayContaining(["appointment.created", "appointment.rescheduled", "appointment.cancelled"]));
  });
});

describe("public booking", () => {
  it("offers only published doctors with online booking, for this clinic", async () => {
    const o = await publicBookingOptions(A.id);
    expect(o.doctors.map((d) => d.slug)).toEqual([A.slug]);
    expect(JSON.stringify(o)).not.toContain(A.doctorId); expect(JSON.stringify(o)).not.toContain(B.slug);
  });
  it("books an online appointment (auto-confirmed) without exposing internal ids", async () => {
    const d = futureDate(11);
    const r = await createPublicBooking(A.id, { doctor: A.slug, startsAt: slotAt(d, "09:00"), name: "Asha Verma", phone: "98765 43210", email: "asha@example.com", reason: "Check-up", consent: true }, "2.2.2.2");
    expect(r.status).toBe("CONFIRMED"); expect(r.appointmentId).toMatch(/^AP-/);
    expect(JSON.stringify(r)).not.toContain(A.doctorId); expect(JSON.stringify(r)).not.toContain(A.id);
    const row = await db.appointment.findFirstOrThrow({ where: { publicId: r.appointmentId } });
    expect(row).toMatchObject({ tenantId: A.id, source: "WEBSITE", type: "ONLINE_APPOINTMENT", contactPhone: "+919876543210", patientId: null });
    const slots = await publicSlots(A.id, A.slug, d);
    expect(slots.slots.map((s) => s.label)).not.toContain("09:00");
  });
  it("REQUIRES_CONFIRMATION mode makes a requested (unconfirmed) booking that staff then confirm", async () => {
    await saveOpdSettings(B.admin, { tokenFormat: "NUMERIC", tokenPad: 2, prefixes: {}, voiceAnnouncement: false, showNextOnDisplay: true, onlineTokens: false, bookingMode: "REQUIRES_CONFIRMATION", displayEnabled: true });
    const r = await createPublicBooking(B.id, { doctor: B.slug, startsAt: slotAt(futureDate(12), "10:00"), name: "Ravi K", phone: "9876543211", consent: true }, "3.3.3.3");
    expect(r.status).toBe("REQUESTED");
    const row = await db.appointment.findFirstOrThrow({ where: { publicId: r.appointmentId } });
    await appointmentAction(B.recep, row.id, { action: "confirm" });
    expect((await db.appointment.findUniqueOrThrow({ where: { id: row.id } })).status).toBe("CONFIRMED");
  });
  it("validates input, consent and honeypot; ignores any tenant/patient/status in the body", async () => {
    const ok = { doctor: A.slug, startsAt: slotAt(futureDate(13), "09:00"), name: "Valid Name", phone: "9876543212", consent: true };
    expect(await code(createPublicBooking(A.id, { ...ok, consent: false }, "4.4.4.4"))).toBe("VALIDATION_ERROR");
    expect(await code(createPublicBooking(A.id, { ...ok, phone: "123" }, "4.4.4.4"))).toBe("VALIDATION_ERROR");
    expect(await code(createPublicBooking(A.id, { ...ok, website_url: "http://spam" }, "4.4.4.4"))).toBe("VALIDATION_ERROR");
    expect(await code(createPublicBooking(A.id, { ...ok, doctor: B.slug }, "4.4.4.4"))).toBe("NOT_FOUND"); // clinic B's doctor, on clinic A's host
    const r = await createPublicBooking(A.id, { ...ok, tenantId: B.id, patientId: "x", status: "COMPLETED", doctorUserId: B.doctorId }, "4.4.4.4");
    const row = await db.appointment.findFirstOrThrow({ where: { publicId: r.appointmentId } });
    expect(row.tenantId).toBe(A.id); expect(row.status).toBe("CONFIRMED"); expect(row.doctorUserId).toBe(A.doctorId); expect(row.patientId).toBeNull();
  });
  it("is rate-limited per visitor", async () => {
    const results: string[] = [];
    for (let i = 0; i < 8; i++) results.push(await code(createPublicBooking(A.id, { doctor: A.slug, startsAt: slotAt(futureDate(14), `${String(9 + Math.floor(i / 4)).padStart(2, "0")}:${String((i % 4) * 15).padStart(2, "0")}`), name: "Spam Test", phone: "9876543299", consent: true }, "9.9.9.9")));
    expect(results.slice(0, 6).every((r) => r === "ok")).toBe(true);
    expect(results.slice(6)).toEqual(["RATE_LIMITED", "RATE_LIMITED"]);
  });
  it("an unpublished website takes no bookings", async () => {
    const C = await mkTenant("c");
    await db.website.update({ where: { tenantId: C.id }, data: { status: "DRAFT" } });
    expect((await publicBookingOptions(C.id)).doctors).toEqual([]);
    expect(await code(createPublicBooking(C.id, { doctor: C.slug, startsAt: slotAt(futureDate(3), "09:00"), name: "Late Comer", phone: "9876543213", consent: true }, "5.5.5.5"))).toBe("NOT_FOUND");
  });
});

describe("tenant isolation and roles", () => {
  it("calendar and detail views never cross clinics", async () => {
    const d = futureDate(15);
    const a = await book(A, d, "09:00"); const b = await book(B, d, "09:00");
    const la = await listAppointments(A.recep, { from: d, to: d });
    expect(la.appointments.map((x) => x.id)).toContain(a.id); expect(la.appointments.map((x) => x.id)).not.toContain(b.id);
    expect(await code(getAppointment(A.recep, b.id))).toBe("NOT_FOUND");
    expect(await code(appointmentAction(A.admin, b.id, { action: "cancel", reasonKind: "OTHER" }))).toBe("NOT_FOUND");
    expect((await db.appointment.findUniqueOrThrow({ where: { id: b.id } })).status).toBe("CONFIRMED");
  });
  it("patients are clinic-private: search never returns another clinic's patient, linking needs verification", async () => {
    const pb = await db.patient.create({ data: { tenantId: B.id, code: "P-B-1", name: "Secret Bpatient", phone: "+919900112233" } });
    expect((await searchPatients(A.recep, { q: "Secret" })).length).toBe(0);
    expect((await searchPatients(A.recep, { q: "9900112233" })).length).toBe(0);
    const d = futureDate(16);
    expect(await code(createStaffAppointment(A.recep, { doctorUserId: A.doctorId, startsAt: slotAt(d, "09:00"), patient: { patientId: pb.id, verification: { phoneLast4: "2233" } } }))).toBe("NOT_FOUND");
    const own = await db.patient.create({ data: { tenantId: A.id, code: "P-A-1", name: "Own Patient", phone: "+919900445566" } });
    expect(await code(createStaffAppointment(A.recep, { doctorUserId: A.doctorId, startsAt: slotAt(d, "09:00"), patient: { patientId: own.id, verification: { phoneLast4: "0000" } } }))).toBe("FORBIDDEN"); // wrong verification
    expect(await code(createStaffAppointment(A.recep, { doctorUserId: A.doctorId, startsAt: slotAt(d, "09:00"), patient: { patientId: own.id, verification: { phoneLast4: "5566" } } }))).toBe("ok");
    const found = await searchPatients(A.recep, { q: "Own Pat" });
    expect(found[0].phoneMasked).toBe("••••••5566"); expect(JSON.stringify(found)).not.toContain("9900445566");
  });
  it("duplicate patients need confirmation", async () => {
    const p = newPatient("Dup Person");
    await book(A, futureDate(17), "09:00", p);
    expect(await code(book(A, futureDate(17), "09:15", p))).toBe("CONFLICT");
    expect(await code(book(A, futureDate(17), "09:15", { ...p, allowDuplicate: true }))).toBe("ok");
  });
  it("role permissions: nurse can look but not change; doctor sees only own appointments", async () => {
    const d = futureDate(18);
    const mine = await book(A, d, "09:00"), other = await book(A, d, "09:15", newPatient(), A.doctor2Id);
    expect(await code(createStaffAppointment(A.nurse, { doctorUserId: A.doctorId, startsAt: slotAt(d, "10:00"), patient: newPatient() }))).toBe("FORBIDDEN");
    expect(await code(appointmentAction(A.nurse, mine.id, { action: "cancel", reasonKind: "OTHER" }))).toBe("FORBIDDEN");
    expect(await code(appointmentAction(A.doctor, mine.id, { action: "cancel", reasonKind: "OTHER" }))).toBe("FORBIDDEN");
    const ids = (await listAppointments(A.doctor, { from: d, to: d })).appointments.map((x) => x.id);
    expect(ids).toContain(mine.id); expect(ids).not.toContain(other.id);
    expect(await code(getAppointment(A.doctor, other.id))).toBe("NOT_FOUND");
    expect((await listAppointments(A.nurse, { from: d, to: d })).appointments.length).toBeGreaterThanOrEqual(2);
  });
  it("calendar rows show a shortened name; the detail view shows the full one", async () => {
    const d = futureDate(19);
    const a = await book(A, d, "09:00", newPatient("Meera Kapoor Singh"));
    const row = (await listAppointments(A.recep, { from: d, to: d })).appointments.find((x) => x.id === a.id)!;
    expect(row.patientLabel).toBe("Meera S."); expect(JSON.stringify(row)).not.toContain("Kapoor");
    expect((await getAppointment(A.recep, a.id)).patientLabel).toBe("Meera Kapoor Singh");
  });
  it("calendar range is capped", async () => {
    expect(await code(listAppointments(A.recep, { from: "2030-01-01", to: "2030-06-01" }))).toBe("VALIDATION_ERROR");
  });
});

describe("live OPD, tokens and queue", () => {
  let T1: T;
  beforeAll(async () => { T1 = await mkTenant("opd"); });
  const reg = (t: T, extra: Record<string, unknown> = {}, doctorUserId = t.doctorId) => registerVisit(t.recep, { patient: newPatient(), doctorUserId, ...extra });

  it("issues unique, sequential tokens per clinic per day", async () => {
    const a = await reg(T1), b = await reg(T1), c = await reg(T1);
    expect([a.token, b.token, c.token]).toEqual(["01", "02", "03"]);
    const other = await reg(B);
    expect(other.token).toBe("01"); // each clinic counts on its own
  });
  it("CONCURRENCY: simultaneous check-ins never share a token", async () => {
    const T2 = await mkTenant("conc");
    const r = await Promise.all(Array.from({ length: 15 }, () => reg(T2)));
    const tokens = r.map((x) => x.token);
    expect(new Set(tokens).size).toBe(15);
    expect(tokens.map(Number).sort((x, y) => x - y)).toEqual(Array.from({ length: 15 }, (_, i) => i + 1));
  });
  it("prefixed token formats", async () => {
    const T3 = await mkTenant("pref");
    await saveOpdSettings(T3.admin, { tokenFormat: "PREFIXED", tokenPad: 3, prefixes: { EMERGENCY: "E", GENERAL: "G" }, voiceAnnouncement: false, showNextOnDisplay: true, onlineTokens: false, bookingMode: "AUTO_CONFIRM", displayEnabled: true });
    expect((await reg(T3)).token).toBe("G-001");
    expect((await reg(T3, { emergency: true })).token).toBe("E-001");
    expect((await reg(T3)).token).toBe("G-002");
    expect(await code(saveOpdSettings(T3.admin, { tokenFormat: "PREFIXED", tokenPad: 3, prefixes: { GENERAL: "TOOLONG" }, voiceAnnouncement: false, showNextOnDisplay: true, onlineTokens: false, bookingMode: "AUTO_CONFIRM", displayEnabled: true }))).toBe("VALIDATION_ERROR");
  });
  it("a patient can't be in today's queue twice", async () => {
    const p = newPatient("Twice Person");
    await reg(T1, { patient: p });
    expect(await code(reg(T1, { patient: { ...p, allowDuplicate: true } }))).toBe("ok"); // a *different* new patient record (dup confirmed)…
    const existing = await db.patient.findFirstOrThrow({ where: { tenantId: T1.id, name: "Twice Person" }, orderBy: { createdAt: "asc" } });
    const phoneLast4 = existing.phone!.slice(-4);
    expect(await code(registerVisit(T1.recep, { patient: { patientId: existing.id, verification: { phoneLast4 } }, doctorUserId: T1.doctorId }))).toBe("CONFLICT"); // …but the same record can't queue twice
  });
  it("call next serves emergency first, then high priority, then arrival order", async () => {
    const T4 = await mkTenant("order");
    const a = await reg(T4), b = await reg(T4), c = await reg(T4, { emergency: true }), d = await reg(T4);
    await queueAction(T4.recep, b.id, { action: "priority", priority: "HIGH", reason: "elderly" });
    const order: string[] = [];
    for (let i = 0; i < 4; i++) {
      const n = await callNext(T4.recep, T4.doctorId); order.push(n.token);
      await queueAction(T4.recep, n.visitId, { action: "start" }); await queueAction(T4.recep, n.visitId, { action: "complete" });
    }
    expect(order).toEqual([c.token, b.token, a.token, d.token]);
  });
  it("emergency registration and priority changes are audited", async () => {
    const e = await reg(T1, { emergency: true });
    const logs = await db.auditLog.findMany({ where: { tenantId: T1.id, entityId: e.id } });
    expect(logs.map((l) => l.action)).toEqual(expect.arrayContaining(["opd.created", "token.assigned", "token.priority_changed"]));
    const n = await reg(T1);
    await queueAction(T1.recep, n.id, { action: "priority", priority: "EMERGENCY", reason: "chest pain reported at desk" });
    const changed = await db.auditLog.findMany({ where: { tenantId: T1.id, entityId: n.id, action: "token.priority_changed" } });
    expect(changed.length).toBe(1); expect(changed[0].metadata).toContain("EMERGENCY");
  });
  it("only one patient is with the doctor at a time", async () => {
    const T5 = await mkTenant("single");
    const a = await reg(T5), b = await reg(T5);
    await queueAction(T5.recep, a.id, { action: "call" });
    expect(await code(queueAction(T5.recep, b.id, { action: "call" }))).toBe("CONFLICT");
    expect(await code(callNext(T5.recep, T5.doctorId))).toBe("CONFLICT");
    // two desks racing to call for the same doctor
    await queueAction(T5.recep, a.id, { action: "recall" });
    const race = await Promise.all([code(queueAction(T5.recep, a.id, { action: "call" })), code(queueAction(T5.recep, b.id, { action: "call" }))]);
    expect(race.filter((x) => x === "ok").length).toBe(1);
  });
  it("hold keeps the place; skip + requeue goes to the end; invalid moves are refused", async () => {
    const T6 = await mkTenant("hold");
    const a = await reg(T6), b = await reg(T6), c = await reg(T6);
    expect(await code(queueAction(T6.recep, a.id, { action: "start" }))).toBe("CONFLICT"); // must be called first
    expect(await code(queueAction(T6.recep, a.id, { action: "complete" }))).toBe("CONFLICT");
    await queueAction(T6.recep, a.id, { action: "hold" }); await queueAction(T6.recep, a.id, { action: "resume" });
    expect((await callNext(T6.recep, T6.doctorId)).token).toBe(a.token); // still first
    await queueAction(T6.recep, a.id, { action: "skip" });
    expect(await code(queueAction(T6.recep, a.id, { action: "resume" }))).toBe("CONFLICT");
    await queueAction(T6.recep, a.id, { action: "requeue" });
    const snap = await queueSnapshot(T6.recep);
    if (snap.notModified) throw new Error();
    const w = snap.visits.filter((v) => v.status === "WAITING").map((v) => v.token);
    expect(w).toEqual([b.token, c.token, a.token]);
    expect(await code(queueAction(T6.recep, a.id, { action: "requeue" }))).toBe("CONFLICT");
  });
  it("completing a visit completes its appointment; check-in creates the visit once", async () => {
    const T7 = await mkTenant("checkin");
    const p = await db.patient.create({ data: { tenantId: T7.id, code: "P-X", name: "Booked Person", phone: "+919811122233" } });
    const todayStart = zonedToUtc(todayIn(TZ), 30, TZ);
    const ap = await db.appointment.create({ data: { tenantId: T7.id, doctorUserId: T7.doctorId, patientId: p.id, startsAt: todayStart, endsAt: new Date(todayStart.getTime() + 900000), type: "OPD", source: "RECEPTION", status: "CONFIRMED", slotLock: `${T7.doctorId}|${todayStart.toISOString()}`, publicId: "AP-CHECKIN01" } });
    const r = await appointmentAction(T7.recep, ap.id, { action: "check-in" }) as { token: string; visitId: string };
    expect(r.token).toBe("01");
    expect(await code(appointmentAction(T7.recep, ap.id, { action: "check-in" }))).toBe("CONFLICT");
    expect((await db.appointment.findUniqueOrThrow({ where: { id: ap.id } })).status).toBe("WAITING");
    await queueAction(T7.recep, r.visitId, { action: "call" }); await queueAction(T7.recep, r.visitId, { action: "start" }); await queueAction(T7.recep, r.visitId, { action: "complete" });
    expect((await db.appointment.findUniqueOrThrow({ where: { id: ap.id } })).status).toBe("COMPLETED");
    expect(await db.opdVisit.count({ where: { appointmentId: ap.id } })).toBe(1);
  });
  it("check-in is refused for a booking that isn't today or isn't confirmed; public bookings need staff to identify the patient", async () => {
    const T8 = await mkTenant("ci2");
    const later = await book(T8, futureDate(3), "09:00");
    expect(await code(appointmentAction(T8.recep, later.id, { action: "check-in" }))).toBe("CONFLICT");
    const todayStart = zonedToUtc(todayIn(TZ), 60, TZ);
    const web = await db.appointment.create({ data: { tenantId: T8.id, doctorUserId: T8.doctorId, contactName: "Web Visitor", contactPhone: "+919811122244", startsAt: todayStart, endsAt: new Date(todayStart.getTime() + 900000), type: "ONLINE_APPOINTMENT", source: "WEBSITE", status: "REQUESTED", slotLock: `${T8.doctorId}|${todayStart.toISOString()}`, publicId: "AP-WEBREQ001" } });
    expect(await code(appointmentAction(T8.recep, web.id, { action: "check-in" }))).toBe("CONFLICT"); // not confirmed yet
    await appointmentAction(T8.recep, web.id, { action: "confirm" });
    expect(await code(appointmentAction(T8.recep, web.id, { action: "check-in" }))).toBe("VALIDATION_ERROR"); // no patient chosen
    expect(await code(appointmentAction(T8.recep, web.id, { action: "check-in", patient: newPatient("Web Visitor") }))).toBe("ok");
  });
  it("role boundaries: doctor works only their own queue; nurse can view only; doctor can't register patients", async () => {
    const T9 = await mkTenant("roles");
    const mine = await reg(T9), theirs = await reg(T9, {}, T9.doctor2Id);
    expect(await code(queueAction(T9.doctor, theirs.id, { action: "call" }))).toBe("NOT_FOUND");
    expect(await code(queueAction(T9.doctor, mine.id, { action: "call" }))).toBe("ok");
    expect(await code(queueAction(T9.doctor, mine.id, { action: "cancel" }))).toBe("FORBIDDEN");
    expect(await code(queueAction(T9.doctor, mine.id, { action: "reassign", doctorUserId: T9.doctor2Id }))).toBe("FORBIDDEN");
    expect(await code(registerVisit(T9.doctor, { patient: newPatient(), doctorUserId: T9.doctorId }))).toBe("FORBIDDEN");
    expect(await code(queueAction(T9.nurse, mine.id, { action: "hold" }))).toBe("FORBIDDEN");
    expect(await code(queueAction(T9.nurse, mine.id, { action: "priority", priority: "HIGH" }))).toBe("FORBIDDEN");
    const own = await queueSnapshot(T9.doctor); if (own.notModified) throw new Error();
    expect(own.visits.map((v) => v.id)).toEqual([mine.id]);
    const all = await queueSnapshot(T9.nurse); if (all.notModified) throw new Error();
    expect(all.visits.length).toBe(2);
    expect(await code(callNext(T9.doctor, T9.doctor2Id))).toBe("FORBIDDEN");
  });
  it("reassign moves a waiting patient to another doctor of the same clinic only", async () => {
    const T10 = await mkTenant("move");
    const v = await reg(T10);
    expect(await code(queueAction(T10.recep, v.id, { action: "reassign", doctorUserId: B.doctorId }))).toBe("VALIDATION_ERROR");
    expect(await code(queueAction(T10.recep, v.id, { action: "reassign", doctorUserId: T10.doctor2Id }))).toBe("ok");
    expect((await db.opdVisit.findUniqueOrThrow({ where: { id: v.id } })).doctorUserId).toBe(T10.doctor2Id);
    expect(await code(queueAction(T10.recep, v.id, { action: "reassign" }))).toBe("VALIDATION_ERROR");
  });
  it("clinic B can't see or act on clinic A's queue", async () => {
    const v = await reg(T1);
    expect(await code(queueAction(B.recep, v.id, { action: "call" }))).toBe("NOT_FOUND");
    const snap = await queueSnapshot(B.recep); if (snap.notModified) throw new Error();
    expect(snap.visits.some((x) => x.id === v.id)).toBe(false);
    expect(await code(callNext(B.recep, T1.doctorId))).toBe("VALIDATION_ERROR");
  });
  it("polling: an unchanged queue answers 'not modified'", async () => {
    const s1 = await queueSnapshot(T1.recep); if (s1.notModified) throw new Error();
    expect(await queueSnapshot(T1.recep, { etag: s1.etag })).toEqual({ notModified: true, etag: s1.etag });
    await reg(T1);
    const s2 = await queueSnapshot(T1.recep); expect(s2.etag).not.toBe(s1.etag);
  });
  it("estimates waiting time from the queue ahead", async () => {
    const T11 = await mkTenant("wait");
    await reg(T11); const second = await reg(T11);
    const s = await queueSnapshot(T11.recep); if (s.notModified) throw new Error();
    expect(s.visits.find((v) => v.id === second.id)!.estimatedWaitMinutes).toBe(15); // one ahead × 15 min slots
  });
  it("stats feed the dashboard widgets", async () => {
    const st = await opdStats(T1.recep);
    expect(st.waiting).toBeGreaterThan(0); expect(st.appointmentsToday).toBeGreaterThanOrEqual(0);
  });
});

describe("public waiting-room display and patient token page", () => {
  let T: T;
  beforeAll(async () => { T = await mkTenant("disp"); });
  it("shows tokens and no patient names, phones or ids", async () => {
    const v = await registerVisit(T.recep, { patient: newPatient("Zubin Mehta Private"), doctorUserId: T.doctorId });
    await registerVisit(T.recep, { patient: newPatient("Second Private"), doctorUserId: T.doctorId });
    await queueAction(T.recep, v.id, { action: "call" });
    const snap = await displaySnapshot(T.display);
    const json = JSON.stringify(snap);
    expect(json).not.toContain("Zubin"); expect(json).not.toContain("Private"); expect(json).not.toMatch(/\+91|98\d{8}/); expect(json).not.toContain(v.id); expect(json).not.toContain(T.doctorId);
    expect(snap.doctors[0].serving[0].token).toBe(v.token); expect(snap.doctors[0].next).toEqual(["02"]);
    expect(snap.announcements.length).toBe(1); expect(snap.voice).toBe(true);
  });
  it("needs the secret key; a rotated or disabled key stops working; each clinic sees only its own", async () => {
    expect(await code(displaySnapshot("not-a-real-key-123456"))).toBe("NOT_FOUND");
    expect(await code(displaySnapshot("short"))).toBe("NOT_FOUND");
    const a = await displaySnapshot(T.display); const b = await displaySnapshot(A.display);
    expect(a.clinicName).not.toBe(b.clinicName);
    await saveOpdSettings(T.admin, { tokenFormat: "NUMERIC", tokenPad: 2, prefixes: {}, voiceAnnouncement: true, showNextOnDisplay: true, onlineTokens: false, bookingMode: "AUTO_CONFIRM", displayEnabled: true, rotateDisplayKey: true });
    expect(await code(displaySnapshot(T.display))).toBe("NOT_FOUND");
    expect(await code(saveOpdSettings(T.doctor, {}))).toBe("FORBIDDEN");
    await saveOpdSettings(T.admin, { tokenFormat: "NUMERIC", tokenPad: 2, prefixes: {}, voiceAnnouncement: true, showNextOnDisplay: true, onlineTokens: false, bookingMode: "AUTO_CONFIRM", displayEnabled: false });
    const s = await readOpdSettings(T.admin); expect(s.displayEnabled).toBe(false);
  });
  it("token page: works only with the right token on the right clinic, and reveals no identity", async () => {
    const v = await registerVisit(T.recep, { patient: newPatient("Token Person"), doctorUserId: T.doctorId });
    const token = v.publicToken;
    const s = await tokenStatus(T.id, token);
    expect(s).toMatchObject({ token: v.token, status: "WAITING", active: true });
    expect(JSON.stringify(s)).not.toContain("Token Person"); expect(JSON.stringify(s)).not.toMatch(/\+91/);
    expect(await code(tokenStatus(A.id, token))).toBe("NOT_FOUND"); // another clinic's host
    expect(await code(tokenStatus(T.id, "abcdefgh12"))).toBe("NOT_FOUND");
    expect(await code(tokenStatus(T.id, "../../etc"))).toBe("NOT_FOUND");
    await queueAction(T.recep, v.id, { action: "cancel" });
    expect((await tokenStatus(T.id, token)).status).toBe("CANCELLED");
  });
});
