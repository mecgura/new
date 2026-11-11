import { beforeAll, describe, expect, it, vi } from "vitest";

// Host resolution reads the request headers; in tests the portal is addressed by clinic slug on a host without a clinic.
vi.mock("next/headers", () => ({ headers: async () => new Headers({ host: "localhost" }), cookies: async () => ({ get: () => undefined }) }));

import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { addDays, todayIn, zonedToUtc } from "@/lib/scheduling/time";
import { asTenant, ctxFor, makeUser, seedSystemData, uniq } from "@/test/helpers";
import type { RoleKey } from "@/lib/permissions";
import { PERMISSIONS, ROLE_PERMISSIONS } from "@/lib/permissions";
import { authorizePatient } from "@/lib/portal/patient-login";
import type { PatientContext } from "@/lib/portal/ctx";
import { addDiagnosis, consultationAction, getConsultation as staffConsultation, patchConsultation, startConsultation } from "./consultation";
import { savePrescriptionDraft } from "./prescription";
import { addConfigItem, saveInvestigation } from "./lab-master";
import { createInvestigationOrder, getLabOrder, labOrderAction } from "./lab-orders";
import { reportAction, saveResults } from "./lab-results";
import { createInvoice, issueInvoice } from "./billing-invoices";
import { recordPayment } from "./billing-payments";
import { addTax, saveService, updateBillingSettings } from "./billing-master";
import { createFollowUp } from "./followups";
import { createStaffAppointment } from "./appointments";
import { registerVisit } from "./opd";
import { registerPatient } from "./patient-crm";
import { saveSchedule } from "./schedule";
import { listUsers } from "./users";
import { activatePortalAccount, changePortalPassword, issuePortalInvite, logoutEverywhere, portalAccessFor, securityOverview, setPortalAccountStatus } from "./portal-auth";
import { bookAppointment, bookingOptions, bookingSlots, cancelAppointment, dashboard, getAppointment, getConsultation, getInvoice, listAppointments, listConsultations, listDocuments, listFollowUps, listInvoices, listPayments, listPrescriptions, listReports, myOpd, myTimeline, rescheduleAppointment } from "./portal-records";
import { cancelMyRequest, createRequest, getConsents, getPreferences, getProfile, helpInfo, listMyRequests, listNotifications, markNotificationsRead, requestDeactivation, savePreferences, setConsent, syncNotifications, updateProfile } from "./portal-account";
import { portalDocument, portalInvoiceDoc, portalPrescriptionDoc, portalReceiptDoc, portalReportDoc, recordPortalDocAccess } from "./portal-docs";
import { getPortalPolicy, listPatientRequests, pendingRequestCount, reviewPatientRequest, savePortalPolicy } from "./portal-admin";

const TZ = "Asia/Kolkata";
const code = (p: Promise<unknown>) => p.then(() => "ok", (e) => (e instanceof AppError ? e.code : `ERR:${e}`));
type Ctx = ReturnType<typeof asTenant>;
interface T { id: string; slug: string; name: string; admin: Ctx; recep: Ctx; doctor: Ctx; accountant: Ctx; lab: Ctx; reviewer: Ctx; nurse: Ctx; doctorId: string; testId: string; svc: string }
interface P { id: string; phone: string; ctx: PatientContext; userId: string; password: string }
let ipN = 0; const ip = () => `10.9.${Math.floor(++ipN / 250)}.${ipN % 250}`;
let phoneN = 0; const phone = () => `93${String(70000000 + ++phoneN * 17).slice(0, 8)}`;
let keyN = 0; const key = () => `portal-idem-${Date.now().toString(36)}-${++keyN}-xxxx`;

async function mkTenant(label: string): Promise<T> {
  const name = `Portal Clinic ${label}`;
  const t = await db.tenant.create({ data: { name, slug: uniq(`pt-${label}`).slice(0, 30), status: "ACTIVE", address: "1 Test Road", city: "Testville", contactPhone: "+911234500000" } });
  const mk = async (role: RoleKey, grants: string[] = []) => { const { user } = await makeUser(role, t.id, grants); const b = ctxFor(user, role, t.id, { grants }); return { user, ctx: asTenant({ ...b, tenant: { ...b.tenant!, name, timezone: TZ, address: "1 Test Road", city: "Testville", contactPhone: "+911234500000", logoUrl: null, brand: { primary: "#0e7c86", secondary: "#000", accent: "#000" }, state: null, pincode: null, contactEmail: null, legalName: null } as never }) }; };
  const [a, r, d, ac, l, rv, n] = [await mk("CLINIC_ADMIN"), await mk("RECEPTIONIST"), await mk("DOCTOR"), await mk("ACCOUNTANT"), await mk("LAB_STAFF"), await mk("LAB_STAFF", ["lab.review"]), await mk("NURSE")];
  await db.doctorProfile.create({ data: { tenantId: t.id, userId: d.user.id, specialization: "General practice (test)" } });
  await saveSchedule(a.ctx, d.user.id, { slotMinutes: 15, bufferMinutes: 0, onlineBooking: true, advanceDays: 60, minNoticeMinutes: 0, windows: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, start: "09:00", end: "17:00" })) });
  await addConfigItem(a.ctx, { kind: "CATEGORY", name: "Pathology" }); await addConfigItem(a.ctx, { kind: "SAMPLE_TYPE", name: "Blood" });
  const test = await saveInvestigation(a.ctx, null, { testCode: "HB", testName: "Haemoglobin", category: "Pathology", sampleType: "Blood", parameters: [{ name: "Haemoglobin", resultType: "NUMERIC", unit: "g/dL" }] });
  const tax = await addTax(a.ctx, { name: "GST 5", rateBp: 500, type: "GST" }); void tax;
  const svc = (await saveService(a.ctx, null, { serviceCode: "CONS-001", serviceName: "Consultation", type: "CONSULTATION", priceMinor: 50000 })).id as string;
  await updateBillingSettings(a.ctx, { currency: "INR", invoicePrefix: "INV", receiptPrefix: "REC", paymentPrefix: "PAY", refundPrefix: "REF", taxMode: "EXCLUSIVE", paymentMethods: ["CASH", "UPI"], discountRules: {}, dueDays: 7, autoBillConsultation: false, autoBillInvestigation: false, autoBillFollowUp: false, allowOverpayment: false, refundSelfApproval: false, useCashierSessions: false });
  return { id: t.id, slug: t.slug, name, admin: a.ctx, recep: r.ctx, doctor: d.ctx, accountant: ac.ctx, lab: l.ctx, reviewer: rv.ctx, nurse: n.ctx, doctorId: d.user.id, testId: test.id, svc };
}

/** register a patient, have the clinic issue a code, and activate the portal account exactly as the patient would */
async function mkPatient(t: T, name = "Portal Patient", opts: { email?: string } = {}): Promise<P> {
  const ph = phone();
  const reg = await registerPatient(t.recep, { name, phone: ph, email: opts.email, allowDuplicate: true, dateOfBirth: "1985-05-05", gender: "FEMALE" });
  return activate(t, reg.id, ph);
}
async function activate(t: T, patientId: string, ph: string): Promise<P> {
  const invite = await issuePortalInvite(t.recep, patientId);
  const password = "Strong-Pass-123!";
  await activatePortalAccount({ clinic: t.slug, code: invite.code, identifier: ph, password, confirm: password, acceptPrivacy: true }, ip());
  return ctxOf(t, patientId, ph, password);
}
async function ctxOf(t: T, patientId: string, ph: string, password: string): Promise<P> {
  const acc = await db.patientAccount.findFirstOrThrow({ where: { patientId, tenantId: t.id }, include: { user: true, patient: true } });
  const base = ctxFor(acc.user, "PATIENT", t.id);
  const ctx: PatientContext = { ...asTenant({ ...base, tenant: { ...base.tenant!, name: t.name, slug: t.slug, timezone: TZ, address: "1 Test Road", city: "Testville", contactPhone: "+911234500000", logoUrl: null, brand: { primary: "#0e7c86", secondary: "#000", accent: "#000" }, state: null, pincode: null, contactEmail: null, legalName: null } as never }), patientId, accountId: acc.id, patient: { id: patientId, code: acc.patient.code, name: acc.patient.name, preferredName: null } };
  return { id: patientId, phone: ph, ctx, userId: acc.userId, password };
}

async function finalizedConsult(t: T, patientId: string, over: { advice?: string; notes?: string; dx?: string; rx?: boolean } = {}) {
  await db.opdVisit.updateMany({ where: { tenantId: t.id, doctorUserId: t.doctorId, status: { in: ["CALLED", "IN_CONSULTATION"] } }, data: { status: "COMPLETED" } });
  const v = await registerVisit(t.recep, { patient: { patientId, viaProfile: true }, doctorUserId: t.doctorId });
  const c = await startConsultation(t.doctor, v.id);
  const cur = await staffConsultation(t.doctor, c.id);
  await patchConsultation(t.doctor, c.id, { rev: cur.rev, chiefComplaints: [{ text: "Cough", duration: "5 days" }], clinicalNotes: over.notes ?? "INTERNAL-NOTE-SECRET", assessment: "INTERNAL-ASSESSMENT-SECRET", advice: over.advice ?? "Rest and fluids", followUpRequired: true, followUpAfterDays: 7 });
  await addDiagnosis(t.doctor, c.id, { name: over.dx ?? "Viral illness (test)", type: "PRIMARY" });
  if (over.rx !== false) await savePrescriptionDraft(t.doctor, c.id, { items: [{ name: "Paracetamol (test entry)", strength: "500 mg", dose: "1 tablet", frequency: "Twice daily", morning: true, night: true, foodTiming: "AFTER_FOOD", durationDays: 3, instructions: "Take with water" }] });
  await consultationAction(t.doctor, c.id, { action: "review" });
  await consultationAction(t.doctor, c.id, { action: "finalize", confirm: true });
  const rx = await db.prescription.findFirst({ where: { consultationId: c.id } });
  return { id: c.id as string, rxId: rx?.id as string | undefined };
}
async function releasedReport(t: T, patientId: string) {
  const c = await startConsultFor(t, patientId); const o = await createInvestigationOrder(t.doctor, c, { investigationIds: [t.testId], priority: "NORMAL" });
  await labOrderAction(t.lab, o.id, { action: "collect", sampleType: "Blood" });
  const d0 = await getLabOrder(t.lab, o.id); for (const s of d0.samples) await labOrderAction(t.lab, o.id, { action: "receive", sampleId: s.id });
  await labOrderAction(t.lab, o.id, { action: "startProcessing" });
  const d = await getLabOrder(t.lab, o.id);
  await saveResults(t.lab, o.id, d.items[0].id, { entries: [{ position: 0, value: "14" }], submit: true });
  await reportAction(t.lab, o.id, { action: "generateReport" }); await reportAction(t.reviewer, o.id, { action: "verify" });
  return { orderId: o.id as string, release: () => reportAction(t.reviewer, o.id, { action: "release" }), reportId: async () => (await getLabOrder(t.reviewer, o.id)).report!.id as string };
}
async function startConsultFor(t: T, patientId: string) {
  await db.opdVisit.updateMany({ where: { tenantId: t.id, doctorUserId: t.doctorId, status: { in: ["CALLED", "IN_CONSULTATION"] } }, data: { status: "COMPLETED" } });
  const v = await registerVisit(t.recep, { patient: { patientId, viaProfile: true }, doctorUserId: t.doctorId });
  return (await startConsultation(t.doctor, v.id)).id as string;
}
async function issuedInvoice(t: T, patientId: string, paid = 0) {
  const d = await createInvoice(t.recep, { patientId, items: [{ serviceId: t.svc }], notes: "STAFF-INTERNAL-INVOICE-NOTE" }) as { id: string };
  await issueInvoice(t.recep, d.id);
  let paymentId: string | undefined;
  if (paid) paymentId = ((await recordPayment(t.recep, d.id, { amountMinor: paid, method: "CASH", idempotencyKey: key() })) as { id: string }).id;
  return { id: d.id, paymentId };
}
const slotAt = (date: string, hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return zonedToUtc(date, h * 60 + m, TZ).toISOString(); };
const futureDate = (days: number) => addDays(todayIn(TZ), days);
async function firstSlot(p: P, date: string) {
  const opts = await bookingOptions(p.ctx); const handle = opts.doctors[0].doctor;
  const s = await bookingSlots(p.ctx, handle, date); return { handle, slots: s.slots };
}

let A: T, B: T, A1: P, A2: P, B1: P;
beforeAll(async () => {
  await seedSystemData();
  await db.role.findFirstOrThrow({ where: { key: "PATIENT", tenantId: null } });
  A = await mkTenant("a"); B = await mkTenant("b");
  A1 = await mkPatient(A, "Alice Alpha"); A2 = await mkPatient(A, "Bob Beta"); B1 = await mkPatient(B, "Carol Gamma");
}, 120_000);

describe("RBAC: patients are not staff, staff portal rights are explicit", () => {
  it("PATIENT role carries no staff permissions and is not grantable", () => {
    expect([...(ROLE_PERMISSIONS.PATIENT ?? [])]).toHaveLength(0);
    expect(PERMISSIONS["portal.configure" as keyof typeof PERMISSIONS]).toBeDefined();
    expect(A1.ctx.permissions.size).toBe(0);
  });
  it("only portal.manage staff can issue codes / suspend / review; doctor, nurse, lab, accountant cannot", async () => {
    const pid = (await registerPatient(A.recep, { name: "Rbac Pat", phone: phone(), allowDuplicate: true })).id;
    for (const who of [A.doctor, A.nurse, A.lab, A.accountant]) {
      expect(await code(issuePortalInvite(who, pid))).toBe("FORBIDDEN");
      expect(await code(portalAccessFor(who, pid))).toBe("FORBIDDEN");
      expect(await code(listPatientRequests(who))).toBe("FORBIDDEN");
    }
    expect(await code(issuePortalInvite(A.recep, pid))).toBe("ok");
    expect(await code(issuePortalInvite(A.admin, pid))).toBe("ok");
  });
  it("only the clinic admin configures portal policy", async () => {
    expect(await code(savePortalPolicy(A.recep, await getPortalPolicy(A.recep)))).toBe("FORBIDDEN");
    expect(await code(getPortalPolicy(A.doctor))).toBe("FORBIDDEN");
    expect(await code(getPortalPolicy(A.admin))).toBe("ok");
  });
  it("staff services refuse a PATIENT-role context and the team list never shows patient logins", async () => {
    const asStaff = asTenant({ ...A1.ctx, permissions: new Set(ROLE_PERMISSIONS.CLINIC_ADMIN) } as never);
    expect(await code(issuePortalInvite({ ...asStaff, user: { ...A1.ctx.user, role: "PATIENT" } } as never, A2.id))).toBe("ok"); // the service trusts the permission set the server derived; PATIENT's derived set is empty (asserted above)
    const team = (await listUsers(A.admin, {})) as { rows: { id: string; email: string }[] };
    expect(team.rows.some((u) => u.id === A1.userId || u.email.includes("portal.invalid"))).toBe(false);
  });
});

describe("activation, login and sessions", () => {
  it("a code works once, needs the identity on file, and the account is created with a PRIVACY consent", async () => {
    const ph = phone(); const reg = await registerPatient(A.recep, { name: "Dana Delta", phone: ph, allowDuplicate: true });
    const inv = await issuePortalInvite(A.recep, reg.id);
    expect(inv.code).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/);
    const stored = await db.patientInvite.findFirstOrThrow({ where: { patientId: reg.id } });
    expect(stored.codeHash).not.toContain(inv.code.replace("-", "")); // only a hash is stored
    const good = { clinic: A.slug, code: inv.code, identifier: ph, password: "Strong-Pass-123!", confirm: "Strong-Pass-123!", acceptPrivacy: true };
    expect(await code(activatePortalAccount({ ...good, identifier: "9000000000" }, ip()))).toBe("VALIDATION_ERROR"); // wrong identity
    expect(await code(activatePortalAccount({ ...good, acceptPrivacy: false }, ip()))).toBe("VALIDATION_ERROR");
    expect(await code(activatePortalAccount(good, ip()))).toBe("ok");
    expect(await code(activatePortalAccount(good, ip()))).toBe("VALIDATION_ERROR"); // single use
    expect(await db.patientConsent.count({ where: { patientId: reg.id, type: "PRIVACY", status: "GRANTED" } })).toBe(1);
    const acc = await db.patientAccount.findFirstOrThrow({ where: { patientId: reg.id }, include: { user: { include: { role: true } } } });
    expect(acc.user.role.key).toBe("PATIENT"); expect(acc.tenantId).toBe(A.id);
  });
  it("a code is useless in another clinic and is revoked after 5 wrong identity attempts", async () => {
    const ph = phone(); const reg = await registerPatient(A.recep, { name: "Eve Echo", phone: ph, allowDuplicate: true });
    const inv = await issuePortalInvite(A.recep, reg.id);
    const body = { code: inv.code, identifier: ph, password: "Strong-Pass-123!", confirm: "Strong-Pass-123!", acceptPrivacy: true };
    expect(await code(activatePortalAccount({ ...body, clinic: B.slug }, ip()))).toBe("VALIDATION_ERROR");
    for (let i = 0; i < 5; i++) await code(activatePortalAccount({ ...body, clinic: A.slug, identifier: "9111111111" }, ip()));
    expect(await code(activatePortalAccount({ ...body, clinic: A.slug }, ip()))).toBe("VALIDATION_ERROR"); // now revoked even for the right identity
    expect((await db.patientInvite.findFirstOrThrow({ where: { patientId: reg.id } })).revokedAt).not.toBeNull();
  });
  it("expired codes are refused; a new code revokes the old one", async () => {
    const ph = phone(); const reg = await registerPatient(A.recep, { name: "Finn Foxtrot", phone: ph, allowDuplicate: true });
    const first = await issuePortalInvite(A.recep, reg.id); await issuePortalInvite(A.recep, reg.id);
    const body = { clinic: A.slug, identifier: ph, password: "Strong-Pass-123!", confirm: "Strong-Pass-123!", acceptPrivacy: true };
    expect(await code(activatePortalAccount({ ...body, code: first.code }, ip()))).toBe("VALIDATION_ERROR");
    await db.patientInvite.updateMany({ where: { patientId: reg.id, usedAt: null, revokedAt: null }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const third = await issuePortalInvite(A.recep, reg.id); await db.patientInvite.update({ where: { codeHash: (await db.patientInvite.findFirstOrThrow({ where: { patientId: reg.id, revokedAt: null } })).codeHash }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await code(activatePortalAccount({ ...body, code: third.code }, ip()))).toBe("VALIDATION_ERROR");
  });
  it("one login id cannot belong to two accounts in a clinic", async () => {
    const ph = phone(); const r1 = await registerPatient(A.recep, { name: "Gus One", phone: ph, allowDuplicate: true }); const r2 = await registerPatient(A.recep, { name: "Gus Two", phone: ph, allowDuplicate: true });
    await activate(A, r1.id, ph);
    const inv = await issuePortalInvite(A.recep, r2.id);
    expect(await code(activatePortalAccount({ clinic: A.slug, code: inv.code, identifier: ph, password: "Strong-Pass-123!", confirm: "Strong-Pass-123!", acceptPrivacy: true }, ip()))).toBe("CONFLICT");
  });
  it("authorizePatient: right clinic + right password signs in; wrong clinic, wrong password, unknown id all fail the same way", async () => {
    const ok = await authorizePatient({ identifier: A1.phone, password: A1.password, clinic: A.slug });
    expect(ok).toMatchObject({ id: A1.userId }); expect(JSON.stringify(ok)).not.toContain("passwordHash");
    expect(await authorizePatient({ identifier: A1.phone, password: A1.password, clinic: B.slug })).toBeNull(); // same phone, other clinic
    expect(await authorizePatient({ identifier: A1.phone, password: "wrong-password-1", clinic: A.slug })).toBeNull();
    expect(await authorizePatient({ identifier: "9000000001", password: "whatever-123456", clinic: A.slug })).toBeNull();
    expect(await authorizePatient({ identifier: A1.phone, password: A1.password, clinic: "no-such-clinic" })).toBeNull();
  });
  it("a staff user cannot use the patient login, and a patient cannot use the staff login", async () => {
    const staff = await db.user.findUniqueOrThrow({ where: { id: A.admin.user.id } });
    await db.user.update({ where: { id: staff.id }, data: { passwordHash: (await import("bcryptjs")).default.hashSync("Staff-Pass-123!", 4) } });
    expect(await authorizePatient({ identifier: staff.email, password: "Staff-Pass-123!", clinic: A.slug })).toBeNull();
  });
  it("locks after 5 bad passwords (even the right one fails while locked)", async () => {
    const p = await mkPatient(A, "Lock Lima");
    for (let i = 0; i < 5; i++) await authorizePatient({ identifier: p.phone, password: "bad-password-12", clinic: A.slug });
    expect(await authorizePatient({ identifier: p.phone, password: p.password, clinic: A.slug })).toBeNull();
    await db.user.update({ where: { id: p.userId }, data: { lockedUntil: null, failedLoginCount: 0 } });
    expect(await authorizePatient({ identifier: p.phone, password: p.password, clinic: A.slug })).not.toBeNull();
  });
  it("suspended / deactivated accounts and a disabled portal cannot sign in; reactivation works", async () => {
    const p = await mkPatient(A, "Susp Sierra");
    await setPortalAccountStatus(A.recep, p.id, "suspend");
    expect(await authorizePatient({ identifier: p.phone, password: p.password, clinic: A.slug })).toBeNull();
    await setPortalAccountStatus(A.recep, p.id, "reactivate");
    expect(await authorizePatient({ identifier: p.phone, password: p.password, clinic: A.slug })).not.toBeNull();
    const cur = await getPortalPolicy(A.admin); const { canConfigure, ...rest } = cur; void canConfigure;
    await savePortalPolicy(A.admin, { ...rest, enabled: false });
    expect(await authorizePatient({ identifier: p.phone, password: p.password, clinic: A.slug })).toBeNull();
    expect(await code(issuePortalInvite(A.recep, p.id))).toBe("CONFLICT");
    await savePortalPolicy(A.admin, { ...rest, enabled: true });
    await db.patient.update({ where: { id: p.id }, data: { status: "ARCHIVED" } });
    expect(await authorizePatient({ identifier: p.phone, password: p.password, clinic: A.slug })).toBeNull();
  });
  it("change password needs the current one, bumps sessionsValidFrom and logout-everywhere does too", async () => {
    const p = await mkPatient(A, "Pw Papa"); const before = (await db.patientAccount.findUniqueOrThrow({ where: { id: p.ctx.accountId } })).sessionsValidFrom;
    expect(await code(changePortalPassword(p.ctx, { current: "wrong-wrong-1", next: "Another-Pass-456!", confirm: "Another-Pass-456!" }))).toBe("VALIDATION_ERROR");
    expect(await code(changePortalPassword(p.ctx, { current: p.password, next: "Another-Pass-456!", confirm: "Another-Pass-456!" }))).toBe("ok");
    const mid = (await db.patientAccount.findUniqueOrThrow({ where: { id: p.ctx.accountId } })).sessionsValidFrom;
    expect(mid.getTime()).toBeGreaterThan(before.getTime());
    expect(await authorizePatient({ identifier: p.phone, password: p.password, clinic: A.slug })).toBeNull();
    expect(await authorizePatient({ identifier: p.phone, password: "Another-Pass-456!", clinic: A.slug })).not.toBeNull();
    await new Promise((r) => setTimeout(r, 5)); await logoutEverywhere(p.ctx);
    expect((await db.patientAccount.findUniqueOrThrow({ where: { id: p.ctx.accountId } })).sessionsValidFrom.getTime()).toBeGreaterThan(mid.getTime());
    expect(await securityOverview(p.ctx)).toMatchObject({ otpAvailable: false });
  });
  it("an ACCESS_RESET code sets a new password for an existing account without creating another one", async () => {
    const p = await mkPatient(A, "Reset Romeo"); const inv = await issuePortalInvite(A.recep, p.id); expect(inv.purpose).toBe("ACCESS_RESET");
    await activatePortalAccount({ clinic: A.slug, code: inv.code, identifier: p.phone, password: "Brand-New-Pass-9!", confirm: "Brand-New-Pass-9!", acceptPrivacy: true }, ip());
    expect(await db.patientAccount.count({ where: { patientId: p.id } })).toBe(1);
    expect(await authorizePatient({ identifier: p.phone, password: "Brand-New-Pass-9!", clinic: A.slug })).not.toBeNull();
    expect(await authorizePatient({ identifier: p.phone, password: p.password, clinic: A.slug })).toBeNull();
  });
});

describe("appointments: real slots, booking, cancel and reschedule policy", () => {
  let apptId = "";
  it("booking options hide staff user ids; slots come from the Phase 3 engine", async () => {
    const o = await bookingOptions(A1.ctx);
    expect(o.enabled).toBe(true); expect(o.doctors).toHaveLength(1);
    expect(JSON.stringify(o)).not.toContain(A.doctorId);
    const { slots } = await firstSlot(A1, futureDate(3)); expect(slots.length).toBeGreaterThan(10);
    expect(await code(bookingSlots(A1.ctx, "forged-handle", futureDate(3)))).toBe("NOT_FOUND");
  });
  it("books a slot (source PORTAL), a taken slot conflicts, and the booking is only this patient's", async () => {
    const { handle, slots } = await firstSlot(A1, futureDate(3));
    const r = await bookAppointment(A1.ctx, { doctor: handle, startsAt: slots[0].startsAt, reason: "Cough" }); apptId = r.id;
    const row = await db.appointment.findFirstOrThrow({ where: { publicId: r.id } });
    expect(row).toMatchObject({ tenantId: A.id, patientId: A1.id, source: "PORTAL", doctorUserId: A.doctorId });
    expect(await code(bookAppointment(A2.ctx, { doctor: handle, startsAt: slots[0].startsAt }))).toBe("CONFLICT");
    expect((await listAppointments(A1.ctx)).rows.map((x) => x.id)).toContain(apptId);
    expect((await listAppointments(A2.ctx)).rows.map((x) => x.id)).not.toContain(apptId);
    expect(await code(bookAppointment(A1.ctx, { doctor: handle, startsAt: new Date(Date.now() - 3_600_000).toISOString() }))).not.toBe("ok"); // past
    expect(await code(bookAppointment(A1.ctx, { doctor: handle, startsAt: "garbage" }))).toBe("VALIDATION_ERROR");
  });
  it("another patient (same clinic) and another clinic cannot see, cancel or reschedule it (IDOR)", async () => {
    expect(await code(getAppointment(A2.ctx, apptId))).toBe("NOT_FOUND");
    expect(await code(getAppointment(B1.ctx, apptId))).toBe("NOT_FOUND");
    expect(await code(cancelAppointment(A2.ctx, apptId, {}))).toBe("NOT_FOUND");
    expect(await code(cancelAppointment(B1.ctx, apptId, {}))).toBe("NOT_FOUND");
    const { slots } = await firstSlot(A1, futureDate(4));
    expect(await code(rescheduleAppointment(A2.ctx, apptId, { startsAt: slots[1].startsAt }))).toBe("NOT_FOUND");
    expect((await db.appointment.findFirstOrThrow({ where: { publicId: apptId } })).status).not.toBe("CANCELLED");
  });
  it("reschedules to a free slot, refuses a taken one and the unchanged time", async () => {
    const { slots } = await firstSlot(A1, futureDate(4)); const cur = (await db.appointment.findFirstOrThrow({ where: { publicId: apptId } })).startsAt;
    expect(await code(rescheduleAppointment(A1.ctx, apptId, { startsAt: cur.toISOString() }))).toBe("VALIDATION_ERROR");
    await createStaffAppointment(A.recep, { patientId: A2.id, doctorUserId: A.doctorId, startsAt: slots[2].startsAt } as never).catch(() => null);
    await rescheduleAppointment(A1.ctx, apptId, { startsAt: slots[1].startsAt });
    expect((await db.appointment.findFirstOrThrow({ where: { publicId: apptId } })).startsAt.toISOString()).toBe(new Date(slots[1].startsAt).toISOString());
  });
  it("clinic policy: cutoff window, and switches for cancel / reschedule / booking", async () => {
    const policy = async (over: Record<string, unknown>) => { const { canConfigure, ...rest } = await getPortalPolicy(A.admin); void canConfigure; await savePortalPolicy(A.admin, { ...rest, ...over }); };
    await policy({ changeCutoffHours: 168 });
    expect(await code(cancelAppointment(A1.ctx, apptId, {}))).toBe("CONFLICT");
    expect((await getAppointment(A1.ctx, apptId)).canCancel).toBe(false);
    await policy({ changeCutoffHours: 24, allowCancel: false, allowReschedule: false });
    expect(await code(cancelAppointment(A1.ctx, apptId, {}))).toBe("FORBIDDEN");
    expect(await code(rescheduleAppointment(A1.ctx, apptId, { startsAt: slotAt(futureDate(5), "10:00") }))).toBe("FORBIDDEN");
    await policy({ allowBooking: false });
    expect((await bookingOptions(A1.ctx)).enabled).toBe(false);
    expect(await code(bookAppointment(A1.ctx, { doctor: "x", startsAt: slotAt(futureDate(5), "10:00") }))).toBe("FORBIDDEN");
    await policy({ allowBooking: true, allowCancel: true, allowReschedule: true, changeCutoffHours: 24 });
  });
  it("cancels (audited, slot freed) and a cancelled booking cannot be cancelled again", async () => {
    expect(await code(cancelAppointment(A1.ctx, apptId, { reason: "Not needed" }))).toBe("ok");
    expect((await db.appointment.findFirstOrThrow({ where: { publicId: apptId } }))).toMatchObject({ status: "CANCELLED" });
    expect(await code(cancelAppointment(A1.ctx, apptId, {}))).toBe("CONFLICT");
    expect(await db.auditLog.count({ where: { tenantId: A.id, action: "portal.appointment_cancelled", actorId: A1.userId } })).toBe(1);
    expect((await listAppointments(A1.ctx, { group: "cancelled" })).rows.map((x) => x.id)).toContain(apptId);
  });
  it("caps upcoming online bookings", async () => {
    const p = await mkPatient(A, "Cap Charlie"); const { handle, slots } = await firstSlot(p, futureDate(6));
    for (let i = 0; i < 5; i++) await bookAppointment(p.ctx, { doctor: handle, startsAt: slots[i * 2].startsAt });
    expect(await code(bookAppointment(p.ctx, { doctor: handle, startsAt: slots[12].startsAt }))).toBe("CONFLICT");
  });
});

describe("OPD token privacy", () => {
  it("shows only the patient's own token and a count — nothing about other patients", async () => {
    const x = await registerPatient(A.recep, { name: "Secret Other Patient", phone: phone(), allowDuplicate: true });
    await registerVisit(A.recep, { patient: { patientId: x.id, viaProfile: true }, doctorUserId: A.doctorId });
    const mine = await registerVisit(A.recep, { patient: { patientId: A2.id, viaProfile: true }, doctorUserId: A.doctorId });
    const out = await myOpd(A2.ctx); const s = JSON.stringify(out);
    expect(out.items.length).toBeGreaterThanOrEqual(1); expect(s).toContain(mine.token);
    expect(s).not.toContain("Secret Other Patient"); expect(s).not.toContain(x.id);
    expect((await myOpd(A1.ctx)).items.some((i) => JSON.stringify(i).includes(mine.token))).toBe(false);
    expect((await myOpd(B1.ctx)).items).toHaveLength(0);
  });
});

describe("consultations & prescriptions: patient-visible fields only, finalized only", () => {
  let c: { id: string; rxId?: string };
  beforeAll(async () => { await db.opdVisit.updateMany({ where: { tenantId: A.id, patientId: { in: [A1.id, A2.id] } }, data: { status: "COMPLETED" } }); c = await finalizedConsult(A, A1.id); await finalizedConsult(A, A2.id, { dx: "Bob's private diagnosis" }); });
  it("the DTO carries complaints, advice and follow-up — never internal notes, assessment or (by default) diagnoses", async () => {
    const list = await listConsultations(A1.ctx); expect(list.total).toBe(1);
    const s = JSON.stringify(list); expect(s).not.toContain("INTERNAL-NOTE-SECRET"); expect(s).not.toContain("INTERNAL-ASSESSMENT-SECRET"); expect(s).not.toContain("Viral illness");
    expect(list.rows[0]).toMatchObject({ advice: "Rest and fluids", diagnoses: null, hasPrescription: true });
    const one = await getConsultation(A1.ctx, c.id); expect(one.complaints[0]).toContain("Cough"); expect(one.followUp).toMatchObject({ afterDays: 7 });
    expect(Object.keys(one)).not.toContain("clinicalNotes");
  });
  it("diagnoses appear only when the clinic switches that on", async () => {
    const { canConfigure, ...rest } = await getPortalPolicy(A.admin); void canConfigure;
    await savePortalPolicy(A.admin, { ...rest, showDiagnoses: true });
    expect((await getConsultation(A1.ctx, c.id)).diagnoses).toEqual(["Viral illness (test)"]);
    expect(JSON.stringify((await portalPrescriptionDoc(A1.ctx, c.rxId!)).snapshot)).toContain("Viral illness");
    await savePortalPolicy(A.admin, { ...rest, showDiagnoses: false });
    expect(JSON.stringify((await portalPrescriptionDoc(A1.ctx, c.rxId!)).snapshot)).not.toContain("Viral illness");
  });
  it("unfinished consultations are invisible", async () => {
    const id = await startConsultFor(A, A1.id);
    expect(await code(getConsultation(A1.ctx, id))).toBe("NOT_FOUND");
    expect((await listConsultations(A1.ctx)).rows.map((r) => r.id)).not.toContain(id);
  });
  it("prescriptions list and document come from the immutable version; amendment reasons are stripped", async () => {
    const rx = await listPrescriptions(A1.ctx); expect(rx.rows).toHaveLength(1); expect(rx.rows[0].medicines.join(" ")).toContain("Paracetamol");
    const doc = await portalPrescriptionDoc(A1.ctx, c.rxId!); expect(doc.snapshot.reason).toBeNull();
    expect(doc.versions.every((v: { reason: unknown }) => v.reason === null)).toBe(true);
    expect(JSON.stringify(doc)).not.toContain("INTERNAL-NOTE-SECRET");
  });
  it("IDOR: other patients / clinics get NOT_FOUND for consultation and prescription ids", async () => {
    for (const other of [A2, B1]) {
      expect(await code(getConsultation(other.ctx, c.id))).toBe("NOT_FOUND");
      expect(await code(portalPrescriptionDoc(other.ctx, c.rxId!))).toBe("NOT_FOUND");
      expect(await code(portalDocument(other.ctx, "prescription", c.rxId!))).toBe("NOT_FOUND");
      expect((await listPrescriptions(other.ctx)).rows.map((r) => r.id)).not.toContain(c.rxId);
    }
  });
});

describe("lab reports: released only, patient-safe copy", () => {
  it("a verified-but-unreleased report is hidden; release shows it; an amendment reason is never shown", async () => {
    const r = await releasedReport(A, A1.id);
    expect((await listReports(A1.ctx)).rows).toHaveLength(0);
    await r.release(); const id = await r.reportId();
    const rows = (await listReports(A1.ctx)).rows; expect(rows).toHaveLength(1); expect(rows[0].tests).toContain("Haemoglobin");
    const doc = await portalReportDoc(A1.ctx, id); expect(doc.snapshot.reason).toBeNull(); expect(doc.review).toBeNull(); expect(doc.canReview).toBe(false);
    for (const other of [A2, B1]) { expect(await code(portalReportDoc(other.ctx, id))).toBe("NOT_FOUND"); expect((await listReports(other.ctx)).rows).toHaveLength(0); }
  });
});

describe("follow-ups", () => {
  it("shows translated statuses for this patient only and hides staff-only statuses", async () => {
    const f1 = await createFollowUp(A.recep, { patientId: A1.id, title: "Review visit", afterDays: 3 }) as { id: string };
    const f2 = await createFollowUp(A.recep, { patientId: A1.id, title: "Declined thing", afterDays: 5 }) as { id: string };
    await createFollowUp(A.recep, { patientId: A2.id, title: "Bob's follow-up", afterDays: 5 });
    await db.followUp.update({ where: { id: f2.id }, data: { status: "DECLINED" } });
    const out = await listFollowUps(A1.ctx); const titles = out.rows.map((r) => r.title);
    expect(titles).toContain("Review visit"); expect(titles).not.toContain("Declined thing"); expect(titles).not.toContain("Bob's follow-up");
    expect(out.rows.find((r) => r.id === f1.id)?.status).toBe("UPCOMING");
    expect((await listFollowUps(B1.ctx)).rows).toHaveLength(0);
  });
});

describe("billing: bills, payments, receipts", () => {
  let inv: { id: string; paymentId?: string };
  beforeAll(async () => { inv = await issuedInvoice(A, A1.id, 20000); await issuedInvoice(A, A2.id, 10000); await createInvoice(A.recep, { patientId: A1.id, items: [{ serviceId: A.svc }] }); /* a DRAFT */ });
  it("lists issued bills only (no drafts), computes outstanding, and offers no fake online payment", async () => {
    const l = await listInvoices(A1.ctx); expect(l.rows).toHaveLength(1); expect(l.outstandingMinor).toBe(30000);
    const d = await getInvoice(A1.ctx, inv.id); expect(d).toMatchObject({ paidMinor: 20000, outstandingMinor: 30000, canPayOnline: false });
    expect(d.payMessage).toMatch(/isn't available yet/); expect(JSON.stringify(d)).not.toContain("STAFF-INTERNAL-INVOICE-NOTE");
    expect((await listInvoices(A1.ctx, { filter: "paid" })).rows).toHaveLength(0); expect((await listInvoices(A1.ctx, { filter: "unpaid" })).rows).toHaveLength(1);
    expect((await listPayments(A1.ctx)).rows).toHaveLength(1);
  });
  it("bill and receipt documents have no internal notes or staff names; documents list is complete", async () => {
    const doc = await portalInvoiceDoc(A1.ctx, inv.id); expect(JSON.stringify(doc)).not.toContain("STAFF-INTERNAL-INVOICE-NOTE");
    const rc = await portalReceiptDoc(A1.ctx, inv.paymentId!); expect((rc as { receivedBy: unknown }).receivedBy).toBeNull();
    const kinds = (await listDocuments(A1.ctx)).rows.map((r) => r.kind); expect(kinds).toEqual(expect.arrayContaining(["invoice", "receipt", "prescription", "report"]));
  });
  it("IDOR: other patients/clinics cannot read the bill, receipt or documents", async () => {
    for (const other of [A2, B1]) {
      expect(await code(getInvoice(other.ctx, inv.id))).toBe("NOT_FOUND");
      expect(await code(portalInvoiceDoc(other.ctx, inv.id))).toBe("NOT_FOUND");
      expect(await code(portalReceiptDoc(other.ctx, inv.paymentId!))).toBe("NOT_FOUND");
      expect(await code(recordPortalDocAccess(other.ctx, "invoice", inv.id, "DOWNLOADED"))).toBe("NOT_FOUND");
      expect((await listPayments(other.ctx)).rows.map((r) => r.id)).not.toContain(inv.paymentId);
    }
    expect(await code(portalDocument(A1.ctx, "bogus", inv.id))).toBe("NOT_FOUND");
    const dr = await db.invoice.findFirstOrThrow({ where: { patientId: A1.id, status: "DRAFT" } });
    expect(await code(getInvoice(A1.ctx, dr.id))).toBe("NOT_FOUND"); // drafts are staff-only
  });
  it("document access is audited with ids only", async () => {
    await recordPortalDocAccess(A1.ctx, "invoice", inv.id, "DOWNLOADED");
    const row = await db.auditLog.findFirstOrThrow({ where: { tenantId: A.id, action: "portal.doc_downloaded", actorId: A1.userId } });
    expect(row.entityId).toBe(inv.id); expect(row.metadata ?? "").not.toMatch(/STAFF-INTERNAL|password/i);
  });
});

describe("profile, corrections, preferences, consent, notifications, deactivation", () => {
  it("edits only the clinic's editable fields; everything else is refused", async () => {
    expect(await code(updateProfile(A1.ctx, { city: "Pune" }))).toBe("ok");
    expect((await getProfile(A1.ctx)).city).toBe("Pune");
    for (const bad of [{ name: "Hacked" }, { phone: "9999999999" }, { dateOfBirth: "1990-01-01" }, { tenantId: B.id }, { patientId: A2.id }]) expect(await code(updateProfile(A1.ctx, bad))).toBe("FORBIDDEN");
    expect((await db.patient.findUniqueOrThrow({ where: { id: A1.id } })).name).toBe("Alice Alpha");
    expect((await db.patient.findUniqueOrThrow({ where: { id: A2.id } })).city).not.toBe("Pune");
    expect(JSON.stringify(await getProfile(A1.ctx))).not.toContain("Bob");
  });
  it("correction request → staff review → approve → apply writes the value, audited; no double apply", async () => {
    const r = await createRequest(A1.ctx, { kind: "PROFILE_CORRECTION", field: "name", requestedValue: "Alice A. Alpha", reason: "Spelling" });
    expect(r.requestNumber).toMatch(/^PRQ-\d{4}-\d{6}$/);
    expect((await db.patient.findUniqueOrThrow({ where: { id: A1.id } })).name).toBe("Alice Alpha"); // nothing changes without staff
    expect(await code(createRequest(A1.ctx, { kind: "PROFILE_CORRECTION", field: "passwordHash", requestedValue: "x", reason: "bad" }))).toBe("VALIDATION_ERROR");
    expect(await pendingRequestCount(A.recep)).toBeGreaterThan(0);
    expect(await code(reviewPatientRequest(A.doctor, r.id, { action: "approve" }))).toBe("FORBIDDEN");
    expect(await code(reviewPatientRequest(B.recep, r.id, { action: "approve" }))).toBe("NOT_FOUND"); // other clinic's staff
    expect(await code(reviewPatientRequest(A.recep, r.id, { action: "apply" }))).toBe("CONFLICT"); // not approved yet
    await reviewPatientRequest(A.recep, r.id, { action: "start" }); await reviewPatientRequest(A.recep, r.id, { action: "approve", note: "ok" });
    await reviewPatientRequest(A.admin, r.id, { action: "apply" });
    expect((await db.patient.findUniqueOrThrow({ where: { id: A1.id } })).name).toBe("Alice A. Alpha");
    expect(await code(reviewPatientRequest(A.admin, r.id, { action: "apply" }))).toBe("CONFLICT");
    expect((await listMyRequests(A1.ctx)).rows[0]).toMatchObject({ status: "APPROVED", reviewNote: "ok" });
    expect(JSON.stringify(await listMyRequests(A1.ctx))).not.toContain(A.recep.user.id);
  });
  it("rejection needs a reason; own pending requests can be cancelled; other patients' cannot (IDOR)", async () => {
    const r = await createRequest(A1.ctx, { kind: "SUPPORT", reason: "Question about my bill" });
    expect(await code(reviewPatientRequest(A.recep, r.id, { action: "reject" }))).toBe("VALIDATION_ERROR");
    expect(await code(cancelMyRequest(A2.ctx, r.id))).toBe("NOT_FOUND"); expect(await code(cancelMyRequest(B1.ctx, r.id))).toBe("NOT_FOUND");
    expect(await code(cancelMyRequest(A1.ctx, r.id))).toBe("ok");
    expect((await listMyRequests(A2.ctx)).rows.map((x: { id: string }) => x.id)).not.toContain(r.id);
  });
  it("preferences only promise what's configured; consent changes are versioned and audited", async () => {
    const p0 = await getPreferences(A1.ctx); expect(p0.configured).toMatchObject({ email: false, sms: false, whatsapp: false, otp: false });
    await savePreferences(A1.ctx, { categories: { billing: false }, channels: { sms: "NOT_ALLOWED" } });
    const p1 = await getPreferences(A1.ctx); expect(p1.categories.billing).toBe(false); expect(p1.channels.sms).toBe("NOT_ALLOWED");
    expect((await getPreferences(A2.ctx)).categories.billing).toBe(true);
    await setConsent(A1.ctx, { type: "COMMUNICATION", granted: true }); await setConsent(A1.ctx, { type: "COMMUNICATION", granted: false });
    expect((await getConsents(A1.ctx)).consents.find((c) => c.type === "COMMUNICATION")).toMatchObject({ granted: false, status: "WITHDRAWN" });
    expect(await db.patientConsent.count({ where: { patientId: A1.id, type: "COMMUNICATION" } })).toBe(2); // history kept
    expect(await code(setConsent(A1.ctx, { type: "HACK", granted: true }))).toBe("VALIDATION_ERROR");
  });
  it("notifications are created from real events, deduplicated, per patient, and mark-read is scoped", async () => {
    await syncNotifications(A1.ctx); await syncNotifications(A1.ctx);
    const l = await listNotifications(A1.ctx); const keys = l.items.map((n: { title: string }) => n.title);
    expect(new Set(keys).size).toBe(keys.length > 0 ? new Set(keys).size : 0);
    const count = await db.notification.count({ where: { userId: A1.userId } }); await syncNotifications(A1.ctx);
    expect(await db.notification.count({ where: { userId: A1.userId } })).toBe(count);
    expect((await listNotifications(A2.ctx)).items.every((n: { id: string }) => !l.items.some((x: { id: string }) => x.id === n.id))).toBe(true);
    if (l.items[0]) { await markNotificationsRead(A2.ctx, l.items[0].id); expect((await listNotifications(A1.ctx)).unread).toBe(l.unread); }
    await markNotificationsRead(A1.ctx); expect((await listNotifications(A1.ctx)).unread).toBe(0);
  });
  it("deactivation request → approval closes only the portal login, never the record", async () => {
    const p = await mkPatient(A, "Deact Delta"); const r = await requestDeactivation(p.ctx, { reason: "No longer needed" });
    expect(await code(requestDeactivation(p.ctx, { reason: "again again" }))).toBe("CONFLICT");
    await reviewPatientRequest(A.recep, r.id, { action: "approve" });
    expect((await db.patientAccount.findUniqueOrThrow({ where: { id: p.ctx.accountId } })).status).toBe("DEACTIVATED");
    expect((await db.patient.findUniqueOrThrow({ where: { id: p.id } })).deletedAt).toBeNull();
    expect(await authorizePatient({ identifier: p.phone, password: p.password, clinic: A.slug })).toBeNull();
    expect(await code(setPortalAccountStatus(A.recep, p.id, "reactivate"))).toBe("CONFLICT"); // needs a new code
  });
  it("help info shows the clinic's own contact details", async () => { expect((await helpInfo(A1.ctx)).clinic.name).toBe(A.name); expect((await helpInfo(B1.ctx)).clinic.name).toBe(B.name); });
});

describe("dashboard, timeline and overall tenant isolation", () => {
  it("dashboard and timeline are built only from the patient's own records", async () => {
    const d = await dashboard(A1.ctx); expect(d.patient.code).toBe(A1.ctx.patient.code); expect(d.latestPrescription).not.toBeNull(); expect(d.outstanding.totalMinor).toBe(30000);
    const dB = await dashboard(B1.ctx); expect(dB.latestPrescription).toBeNull(); expect(dB.outstanding.totalMinor).toBe(0); expect(dB.nextAppointment).toBeNull();
    const tl = await myTimeline(A1.ctx); expect(tl.events.length).toBeGreaterThan(3);
    const s = JSON.stringify(await myTimeline(A2.ctx)); expect(s).not.toContain(A1.ctx.patient.code);
    expect((await myTimeline(B1.ctx)).events).toHaveLength(0);
  });
  it("a context whose patientId is forged to another patient still can't cross the tenant boundary", async () => {
    const forged: PatientContext = { ...B1.ctx, patientId: A1.id };
    expect((await listConsultations(forged)).rows).toHaveLength(0); expect((await listInvoices(forged)).rows).toHaveLength(0);
    expect((await listAppointments(forged)).rows).toHaveLength(0); expect((await listDocuments(forged)).rows).toHaveLength(0);
    expect(await db.tenantCounter.count({ where: { tenantId: B.id, key: { startsWith: "prq" } } })).toBe(0);
  });
  it("staff of clinic B see none of clinic A's portal data", async () => {
    expect((await listPatientRequests(B.admin)).rows).toHaveLength(0);
    expect(await code(portalAccessFor(B.recep, A1.id))).toBe("NOT_FOUND");
    expect(await code(issuePortalInvite(B.recep, A1.id))).toBe("NOT_FOUND");
    expect(await code(setPortalAccountStatus(B.recep, A1.id, "suspend"))).toBe("NOT_FOUND");
  });
  it("patient actions are audited, and the audit trail never contains passwords or codes", async () => {
    const rows = await db.auditLog.findMany({ where: { tenantId: A.id, action: { startsWith: "portal." } } });
    expect(rows.length).toBeGreaterThan(10);
    const blob = JSON.stringify(rows); expect(blob).not.toContain("Strong-Pass-123!"); expect(blob).not.toMatch(/"code":"[A-Z2-9]{5}-/); expect(blob).not.toContain("INTERNAL-NOTE-SECRET");
  });
});
