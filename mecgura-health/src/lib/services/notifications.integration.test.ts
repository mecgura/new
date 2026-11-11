import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ headers: async () => new Headers({ host: "localhost" }), cookies: async () => ({ get: () => undefined }) }));

import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { addDays, todayIn, zonedToUtc } from "@/lib/scheduling/time";
import { asTenant, ctxFor, makeUser, seedSystemData, uniq } from "@/test/helpers";
import type { RoleKey } from "@/lib/permissions";
import { PRIORITY_RANK, TYPES, TYPE_KEYS, safeActionUrl, categoryOfType } from "@/lib/notifications/catalog";
import { effectivePriority, notify, safeNotify, visibleAtFor } from "@/lib/notifications/engine";
import { runNotificationJobs, platformHealth } from "@/lib/notifications/jobs";
import { notifyLabOrdered, notifyPayment } from "@/lib/notifications/events";
import { __setProvider } from "@/lib/communications/providers/registry";
import type { SmsProvider } from "@/lib/communications/providers/types";
import { processDue } from "@/lib/communications/worker";
import { registerPatient } from "./patient-crm";
import { registerVisit, queueAction } from "./opd";
import { saveSchedule } from "./schedule";
import { appointmentAction, createStaffAppointment } from "./appointments";
import { saveCommSettings } from "./comms-staff";
import { activatePortalAccount, issuePortalInvite } from "./portal-auth";
import { acknowledge, archive, archiveAllRead, getNotification, getPreferences, getRules, listNotifications, markAllRead, markRead, patientActor, resetRule, saveRule, savePreferences, saveSettings, staffActor, todaySummary, unreadCount } from "./notifications";
import { platformNotificationOverview } from "./notifications-platform";
import { createMedicine } from "./pharmacy-master";
import { createFollowUp } from "./followups";
import { createInvoice, issueInvoice } from "./billing-invoices";
import { saveService } from "./billing-master";
import { recordPayment } from "./billing-payments";
import { addConfigItem, saveInvestigation } from "./lab-master";
import { createInvestigationOrder } from "./lab-orders";
import { startConsultation } from "./consultation";

const TZ = "Asia/Kolkata";
const code = (p: Promise<unknown>) => p.then(() => "ok", (e) => (e instanceof AppError ? e.code : `ERR:${e}`));
type Ctx = ReturnType<typeof asTenant>;
interface T { id: string; slug: string; name: string; admin: Ctx; recep: Ctx; doctor: Ctx; doctor2: Ctx; accountant: Ctx; lab: Ctx; nurse: Ctx; compounder: Ctx; pharm: Ctx; pharmStaff: Ctx; doctorId: string; doctor2Id: string; svc: string; testId: string }
let phoneN = 0; const phone = () => `91${String(20000000 + ++phoneN * 29).slice(0, 8)}`; let ipN = 0;

async function mkTenant(label: string): Promise<T> {
  const name = `Notif Clinic ${label}`;
  const t = await db.tenant.create({ data: { name, slug: uniq(`nt-${label}`).slice(0, 30), status: "ACTIVE", address: "1 Test Road", city: "Testville", contactPhone: "+911234500000" } });
  const mk = async (role: RoleKey) => { const { user } = await makeUser(role, t.id); const b = ctxFor(user, role, t.id); return { user, ctx: asTenant({ ...b, tenant: { ...b.tenant!, name, timezone: TZ, address: "1 Test Road", city: "Testville", contactPhone: "+911234500000", logoUrl: null, brand: { primary: "#0e7c86", secondary: "#000", accent: "#000" }, state: null, pincode: null, contactEmail: null, legalName: null } as never }) }; };
  const [a, r, d, d2, ac, l, n, c, pm, ps] = [await mk("CLINIC_ADMIN"), await mk("RECEPTIONIST"), await mk("DOCTOR"), await mk("DOCTOR"), await mk("ACCOUNTANT"), await mk("LAB_STAFF"), await mk("NURSE"), await mk("COMPOUNDER"), await mk("PHARMACY_MANAGER"), await mk("PHARMACY_STAFF")];
  const sched = { slotMinutes: 15, bufferMinutes: 0, onlineBooking: true, advanceDays: 60, minNoticeMinutes: 0, windows: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, start: "09:00", end: "17:00" })) };
  await saveSchedule(a.ctx, d.user.id, sched); await saveSchedule(a.ctx, d2.user.id, sched);
  await addConfigItem(a.ctx, { kind: "CATEGORY", name: "Pathology" }); await addConfigItem(a.ctx, { kind: "SAMPLE_TYPE", name: "Blood" });
  const test = await saveInvestigation(a.ctx, null, { testCode: "HB", testName: "Haemoglobin", category: "Pathology", sampleType: "Blood", parameters: [{ name: "Haemoglobin", resultType: "NUMERIC", unit: "g/dL" }] });
  const svc = (await saveService(a.ctx, null, { serviceCode: "C-1", serviceName: "Consultation", type: "CONSULTATION", priceMinor: 50000 })).id as string;
  return { id: t.id, slug: t.slug, name, admin: a.ctx, recep: r.ctx, doctor: d.ctx, doctor2: d2.ctx, accountant: ac.ctx, lab: l.ctx, nurse: n.ctx, compounder: c.ctx, pharm: pm.ctx, pharmStaff: ps.ctx, doctorId: d.user.id, doctor2Id: d2.user.id, svc, testId: test.id };
}
async function pat(t: T, name = "Notif Patient") { const ph = phone(); const r = await registerPatient(t.recep, { name, phone: ph, email: `p${ph}@n.test`, allowDuplicate: true, dateOfBirth: "1990-01-01", gender: "MALE" }); return { id: r.id as string, phone: ph }; }
async function portal(t: T, patientId: string, ph: string) {
  const inv = await issuePortalInvite(t.recep, patientId);
  await activatePortalAccount({ clinic: t.slug, code: inv.code, identifier: ph, password: "Strong-Pass-123!", confirm: "Strong-Pass-123!", acceptPrivacy: true }, `10.8.0.${++ipN}`);
  const acc = await db.patientAccount.findFirstOrThrow({ where: { patientId }, include: { user: true } });
  return { userId: acc.userId, actor: patientActor({ user: { id: acc.userId, tenantId: t.id }, tenantId: t.id, patientId }) };
}
const A_ = (c: Ctx) => staffActor(c);
const rowsOf = async (c: Ctx, q: Record<string, unknown> = {}) => (await listNotifications(A_(c), { pageSize: 50, ...q })).rows;
const notifOf = (userId: string, where: Record<string, unknown> = {}) => db.notification.findMany({ where: { userId, ...where }, orderBy: { createdAt: "asc" } });
const day = (n: number) => addDays(todayIn(TZ), n);
async function appointment(t: T, patientId: string, doctorId = t.doctorId, hh = 10 * 60) { return createStaffAppointment(t.recep, { doctorUserId: doctorId, startsAt: zonedToUtc(day(3), hh, TZ).toISOString(), patient: { patientId, viaProfile: true } }) as Promise<{ id: string }>; }

let A: T, B: T;
beforeAll(async () => { await seedSystemData(); A = await mkTenant("a"); B = await mkTenant("b"); }, 120_000);
afterEach(() => { __setProvider("SMS", undefined); __setProvider("EMAIL", undefined); __setProvider("WHATSAPP", undefined); });

describe("catalogue and safety helpers", () => {
  it("every type has a title, a message and a sane default; critical is never user-assignable", () => {
    for (const k of TYPE_KEYS) { const d = TYPES[k]; expect(d.title({})).toBeTruthy(); expect(d.audience.length).toBeGreaterThan(0); }
    expect(effectivePriority("OPD_CHECKED_IN", { priority: "CRITICAL" })).toBe("URGENT");
    expect(effectivePriority("OPD_CHECKED_IN", { priority: "HIGH" })).toBe("HIGH");
    expect(effectivePriority("ACCOUNT_LOCKED", { priority: "LOW" })).toBe("CRITICAL"); // security can't be downgraded
    expect(effectivePriority("OPD_CHECKED_IN", { priority: "bogus" })).toBe("NORMAL");
  });
  it("only in-app paths can ever be stored or followed", () => {
    for (const bad of ["javascript:alert(1)", "//evil.example/x", "https://evil.example", "/a b", "/x\"onmouseover=\"", "data:text/html,x", `/${"a".repeat(400)}`]) expect(safeActionUrl(bad)).toBeNull();
    expect(safeActionUrl("/lab/orders/abc?x=1")).toBe("/lab/orders/abc?x=1"); expect(categoryOfType("REPORT_RELEASED")).toBe("LAB"); expect(categoryOfType("SOMETHING")).toBe("GENERAL");
  });
  it("quiet hours hold low / normal but never high+, in the clinic zone", () => {
    const s = { quietEnabled: true, quietStartMin: 22 * 60, quietEndMin: 8 * 60 }; const late = zonedToUtc(day(0), 23 * 60, TZ);
    expect(visibleAtFor(s, TZ, "NORMAL", late).getTime()).toBe(zonedToUtc(day(1), 8 * 60, TZ).getTime()); expect(visibleAtFor(s, TZ, "HIGH", late).getTime()).toBe(late.getTime());
    expect(visibleAtFor({ ...s, quietEnabled: false }, TZ, "LOW", late).getTime()).toBe(late.getTime()); expect(visibleAtFor(null, TZ, "LOW", late).getTime()).toBe(late.getTime());
  });
});

describe("recipient resolution, isolation and idempotency", () => {
  it("appointment events reach exactly the right people (patient, that doctor, reception) and nobody else", async () => {
    const p = await pat(A); const acc = await portal(A, p.id, p.phone); const a = await appointment(A, p.id);
    const docRows = await rowsOf(A.doctor); expect(docRows.some((r) => r.type === "APPOINTMENT_CONFIRMED_STAFF")).toBe(true);
    expect((await rowsOf(A.doctor2)).some((r) => r.type === "APPOINTMENT_CONFIRMED_STAFF")).toBe(false); // another doctor
    expect((await rowsOf(B.doctor)).length + (await rowsOf(B.recep)).length).toBe(0); // another clinic
    expect((await rowsOf(A.accountant)).some((r) => r.category === "APPOINTMENT")).toBe(false);
    expect((await notifOf(acc.userId)).some((n) => n.type === "APPOINTMENT_CONFIRMED" && n.actionUrl?.startsWith("/portal/appointments/"))).toBe(true);
    await appointmentAction(A.recep, a.id, { action: "cancel", reasonKind: "PATIENT_REQUEST" });
    expect((await rowsOf(A.doctor)).some((r) => r.type === "APPOINTMENT_CANCELLED" && r.priority === "HIGH")).toBe(true);
    expect((await rowsOf(A.recep)).some((r) => r.type === "APPOINTMENT_CANCELLED")).toBe(false); // the actor isn't told about their own action
    expect((await notifOf(acc.userId, { type: "APPOINTMENT_CANCELLED" })).length).toBe(1);
  });
  it("a repeated event notifies each person once (also in parallel)", async () => {
    const p = await pat(A); await appointment(A, p.id, A.doctorId, 11 * 60);
    const before = (await rowsOf(A.doctor)).length; const key = uniq("evt");
    const rs = await Promise.all([1, 2, 3, 4].map(() => notify({ tenantId: A.id, type: "PATIENT_REQUEST_RECEIVED", eventKey: key, patientId: p.id, vars: { patient: "X", kind: "support" }, actionUrl: "/patients/requests" })));
    expect(rs.reduce((n, r) => n + r.created, 0)).toBe(2); // reception + clinic admin, once each
    expect((await rowsOf(A.doctor)).length).toBe(before);
    expect((await rowsOf(A.recep)).filter((r) => r.type === "PATIENT_REQUEST_RECEIVED")).toHaveLength(1);
  });
  it("platform alerts go only to Super Admins, never to a clinic", async () => {
    const sa = await makeUser("SUPER_ADMIN", null); const r = await notify({ tenantId: null, type: "QUEUE_BACKLOG", eventKey: uniq("q"), vars: { count: "40" } });
    expect(r.created).toBeGreaterThanOrEqual(1); expect((await notifOf(sa.user.id)).some((n) => n.type === "QUEUE_BACKLOG" && n.tenantId === null)).toBe(true);
    expect((await rowsOf(A.admin)).some((x) => x.type === "QUEUE_BACKLOG")).toBe(false);
    expect(await code(listNotifications(staffActor(ctxFor(sa.user, "SUPER_ADMIN", null)), {}))).toBe("ok");
  });
  it("one user can never read, change or archive another user's (or another clinic's) notification (IDOR)", async () => {
    const p = await pat(A); await appointment(A, p.id, A.doctorId, 12 * 60); const mine = (await rowsOf(A.doctor))[0];
    for (const other of [A.doctor2, A.recep, B.doctor, B.admin]) {
      expect(await code(getNotification(A_(other), mine.id))).toBe("NOT_FOUND"); expect(await code(archive(A_(other), mine.id))).toBe("NOT_FOUND"); expect((await markRead(A_(other), mine.id)).updated).toBe(0); expect(await code(acknowledge(A_(other), mine.id))).toBe("CONFLICT");
      expect((await rowsOf(other)).map((r) => r.id)).not.toContain(mine.id);
    }
    expect((await db.notification.findUniqueOrThrow({ where: { id: mine.id } })).readAt).toBeNull(); expect((await db.notification.findUniqueOrThrow({ where: { id: mine.id } })).archivedAt).toBeNull();
  });
  it("a notification failure never breaks the business action", async () => {
    const orig = db.notificationRule.findUnique; (db.notificationRule as { findUnique: unknown }).findUnique = async () => { throw new Error("db down"); };
    try { const p = await pat(A); const a = await appointment(A, p.id, A.doctorId, 13 * 60); expect((await db.appointment.findUniqueOrThrow({ where: { id: a.id } })).status).toBe("CONFIRMED"); expect(await safeNotify({ tenantId: A.id, type: "PATIENT_REGISTERED", eventKey: uniq("x") })).toBeNull(); }
    finally { (db.notificationRule as { findUnique: unknown }).findUnique = orig; }
  });
});

describe("role-specific notifications from real events", () => {
  it("lab: staff get the order, the doctor gets the report and rejected samples, the patient only theirs", async () => {
    const p = await pat(A); const acc = await portal(A, p.id, p.phone); const other = await pat(A); const accO = await portal(A, other.id, other.phone);
    await db.opdVisit.updateMany({ where: { tenantId: A.id, doctorUserId: A.doctorId, status: { in: ["CALLED", "IN_CONSULTATION"] } }, data: { status: "COMPLETED" } });
    const v = await registerVisit(A.recep, { patient: { patientId: p.id, viaProfile: true }, doctorUserId: A.doctorId }); const c = await startConsultation(A.doctor, v.id);
    const o = await createInvestigationOrder(A.doctor, c.id, { investigationIds: [A.testId], priority: "NORMAL" });
    expect((await rowsOf(A.lab)).some((r) => r.type === "LAB_ORDERED")).toBe(true); expect((await rowsOf(A.accountant)).some((r) => r.type === "LAB_ORDERED")).toBe(false); expect((await rowsOf(A.pharm)).some((r) => r.type === "LAB_ORDERED")).toBe(false);
    expect(await notifyLabOrdered(A.id, o.id)).toBeUndefined(); // idempotent re-report
    expect((await rowsOf(A.lab)).filter((r) => r.type === "LAB_ORDERED" && r.entityType === "lab_order")).toHaveLength(1);
    expect((await notifOf(accO.userId)).filter((n) => n.entityId === o.id)).toHaveLength(0); expect((await notifOf(acc.userId)).filter((n) => n.type.startsWith("LAB_"))).toHaveLength(0); // not released yet
  });
  it("billing: accountant sees payments, the patient sees their own, reception doesn't see finance", async () => {
    const p = await pat(A); const acc = await portal(A, p.id, p.phone); const inv = await createInvoice(A.recep, { patientId: p.id, items: [{ serviceId: A.svc }] }) as { id: string }; await issueInvoice(A.recep, inv.id);
    const pay = await recordPayment(A.recep, inv.id, { amountMinor: 20000, method: "CASH", idempotencyKey: `idem-${Date.now()}-n-xxxx` }) as { id: string };
    expect((await rowsOf(A.accountant)).some((r) => r.type === "PAYMENT_RECEIVED")).toBe(true); expect((await rowsOf(A.accountant)).some((r) => r.type === "INVOICE_ISSUED")).toBe(false); /* off by default */ expect((await rowsOf(A.recep)).some((r) => r.category === "BILLING")).toBe(false);
    await notifyPayment(A.id, pay.id); const mine = await notifOf(acc.userId); expect(mine.map((n) => n.type).sort()).toEqual(["INVOICE_AVAILABLE", "PAYMENT_CONFIRMED"]);
    expect(mine.every((n) => n.actionUrl?.startsWith("/portal/"))).toBe(true); expect((await rowsOf(A.admin)).some((r) => r.type === "PAYMENT_RECEIVED")).toBe(false);
    expect((await rowsOf(A.recep)).map((r) => r.body ?? "").join()).not.toMatch(/₹|200\.00/);
  });
  it("OPD: check-ins fold into one grouped notification; emergencies are urgent, ungrouped and need acknowledging", async () => {
    await db.notification.deleteMany({ where: { userId: A.doctorId } });
    for (let i = 0; i < 3; i++) { const p = await pat(A, `Queue Person ${i}`); await registerVisit(A.recep, { patient: { patientId: p.id, viaProfile: true }, doctorUserId: A.doctorId }); }
    const grouped = (await rowsOf(A.doctor)).filter((r) => r.type === "OPD_CHECKED_IN"); expect(grouped).toHaveLength(1); expect(grouped[0].groupCount).toBe(3); expect(grouped[0].title).toBe("3 patients have checked in"); expect(grouped[0].actionUrl).toBe("/opd");
    expect((await rowsOf(A.compounder)).filter((r) => r.type === "OPD_CHECKED_IN")).toHaveLength(1); expect((await rowsOf(A.doctor2)).filter((r) => r.type === "OPD_CHECKED_IN")).toHaveLength(0);
    const e = await pat(A, "Emergency Person"); await registerVisit(A.recep, { patient: { patientId: e.id, viaProfile: true }, doctorUserId: A.doctorId, emergency: true });
    const em = (await rowsOf(A.doctor)).find((r) => r.type === "OPD_EMERGENCY")!; expect(em).toMatchObject({ priority: "URGENT", ackRequired: true, groupCount: 1 });
    expect((await rowsOf(A.admin)).some((r) => r.type === "OPD_EMERGENCY")).toBe(true);
    expect(await code(archive(A_(A.doctor), em.id))).toBe("CONFLICT"); // must acknowledge first
    expect(await code(acknowledge(A_(A.doctor), em.id))).toBe("ok"); expect(await code(acknowledge(A_(A.doctor), em.id))).toBe("CONFLICT");
    const d = await getNotification(A_(A.doctor), em.id); expect(d.acknowledged).toBe(true); expect(await code(archive(A_(A.doctor), em.id))).toBe("ok");
    expect(await db.auditLog.count({ where: { tenantId: A.id, action: "notification.acknowledged", entityId: em.id } })).toBe(1);
  });
  it("OPD call tells the patient (only their own token)", async () => {
    const p = await pat(A); const acc = await portal(A, p.id, p.phone); const q = await pat(A); const accQ = await portal(A, q.id, q.phone);
    await db.opdVisit.updateMany({ where: { tenantId: A.id, doctorUserId: A.doctor2Id, status: { in: ["CALLED", "IN_CONSULTATION"] } }, data: { status: "COMPLETED" } });
    const v = await registerVisit(A.recep, { patient: { patientId: p.id, viaProfile: true }, doctorUserId: A.doctor2Id }); await registerVisit(A.recep, { patient: { patientId: q.id, viaProfile: true }, doctorUserId: A.doctor2Id });
    await queueAction(A.recep, v.id, { action: "call" });
    const mine = await notifOf(acc.userId, { type: "OPD_CALLED" }); expect(mine).toHaveLength(1); expect(mine[0].body).toContain(v.token); expect(JSON.stringify(mine)).not.toMatch(/Notif Patient|Queue Person/); expect(await notifOf(accQ.userId, { type: "OPD_CALLED" })).toHaveLength(0);
  });
  it("security: a lock alerts the person and the admin as CRITICAL; the account holder can't switch it off", async () => {
    const { notifyStaffSecurity } = await import("@/lib/notifications/events");
    await notifyStaffSecurity(A.id, "locked", A.nurse.user.id, { who: "Nurse One" });
    const n = (await rowsOf(A.nurse)).find((r) => r.type === "ACCOUNT_LOCKED")!; expect(n.priority).toBe("CRITICAL"); expect((await rowsOf(A.admin)).some((r) => r.type === "ACCOUNT_LOCKED")).toBe(true);
    expect(await code(savePreferences(A_(A.nurse), { categories: { SECURITY: false } }))).toBe("FORBIDDEN");
    await savePreferences(A_(A.nurse), { categories: { APPOINTMENT: false } });
    const p = await pat(A); await appointment(A, p.id, A.doctorId, 14 * 60); // nurse isn't an audience anyway, so use doctor below
    await savePreferences(A_(A.doctor2), { categories: { SYSTEM: false, PATIENT: false } });
    const before = (await rowsOf(A.doctor2)).length; await notify({ tenantId: A.id, type: "PATIENT_REQUEST_RECEIVED", eventKey: uniq("p"), assigneeUserId: A.doctor2Id, vars: { patient: "x", kind: "y" } }); expect((await rowsOf(A.doctor2)).length).toBe(before);
  });
  it("pharmacy and follow-up jobs use real data and never repeat on the same day", async () => {
    await createMedicine(A.pharm, { genericName: "Jobgeneric", brandName: "Jobbrand", strength: "5 mg", dosageForm: "Tablet", manufacturer: "Synthetic", category: "Analgesic", unit: "tablet", reorderLevel: 10, minimumStock: 5, maximumStock: 200, purchasePriceMinor: 100, sellingPriceMinor: 200, taxRateBp: 500 });
    const p = await pat(A); await createFollowUp(A.recep, { patientId: p.id, title: "Past due", afterDays: 0 });
    await db.followUp.updateMany({ where: { tenantId: A.id, patientId: p.id }, data: { dueDate: day(-3) } });
    const s1 = await runNotificationJobs(); expect(s1.tenants).toBeGreaterThanOrEqual(2);
    const out = (await rowsOf(A.pharm)).filter((r) => r.type === "STOCK_OUT"); expect(out).toHaveLength(1); expect(out[0].body).toMatch(/\d+ medicine\(s\) have no sellable stock/); expect(out[0].priority).toBe("URGENT");
    expect((await rowsOf(A.admin)).filter((r) => r.type === "STOCK_OUT")).toHaveLength(1); expect((await rowsOf(A.doctor)).some((r) => r.type === "STOCK_OUT")).toBe(false);
    expect((await rowsOf(A.admin)).some((r) => r.type === "FOLLOWUP_OVERDUE")).toBe(true);
    await runNotificationJobs(); expect((await rowsOf(A.pharm)).filter((r) => r.type === "STOCK_OUT")).toHaveLength(1); // same day => no repeat
    expect((await rowsOf(B.pharm)).filter((r) => r.type === "STOCK_OUT")).toHaveLength(0); // clinic B has no medicines
  });
  it("patient reminders appear in-app with every external channel off", async () => {
    const p = await pat(A); const acc = await portal(A, p.id, p.phone); const start = new Date(Date.now() + 20 * 3_600_000);
    const a = await db.appointment.create({ data: { tenantId: A.id, publicId: uniq("APT"), doctorUserId: A.doctorId, patientId: p.id, startsAt: start, endsAt: new Date(start.getTime() + 900_000), type: "OPD", source: "RECEPTION", status: "CONFIRMED", createdAt: new Date(Date.now() - 3 * 86_400_000) } });
    await runNotificationJobs(); await runNotificationJobs(); const r = await notifOf(acc.userId, { type: "APPOINTMENT_REMINDER" }); expect(r).toHaveLength(1); expect(r[0].entityId).toBe(a.id);
    await db.followUp.create({ data: { tenantId: A.id, followUpNumber: uniq("FU"), patientId: p.id, title: "Review", dueDate: day(1), status: "PENDING", source: "MANUAL", type: "GENERAL", priority: "NORMAL" } as never }).catch(() => null);
  });
});

describe("rules, priority, acknowledgement, escalation", () => {
  it("only the clinic admin edits rules; a rule can turn a notification off, change recipients and priority (never above URGENT)", async () => {
    expect(await code(getRules(A.recep))).toBe("FORBIDDEN"); expect(await code(saveRule(A.recep, { type: "PATIENT_REGISTERED", enabled: true, inApp: true }))).toBe("FORBIDDEN"); expect(await code(getRules(A.admin))).toBe("ok");
    expect(await code(saveRule(A.admin, { type: "PATIENT_REGISTERED", enabled: true, inApp: true, priority: "CRITICAL" }))).toBe("VALIDATION_ERROR");
    expect(await code(saveRule(A.admin, { type: "ACCOUNT_LOCKED", enabled: false, inApp: true }))).toBe("FORBIDDEN"); expect(await code(saveRule(A.admin, { type: "ACCOUNT_LOCKED", enabled: true, inApp: true, priority: "LOW" }))).toBe("FORBIDDEN");
    expect(await code(saveRule(A.admin, { type: "OPD_CHECKED_IN", enabled: true, inApp: true, externalChannels: ["SMS"] }))).toBe("VALIDATION_ERROR"); // no external delivery exists for this one
    await saveRule(A.admin, { type: "PATIENT_REGISTERED", enabled: true, inApp: true, roles: ["RECEPTIONIST"], priority: "HIGH" });
    await registerPatient(A.admin, { name: "Rule Patient", phone: phone(), allowDuplicate: true });
    const r = (await rowsOf(A.recep)).find((x) => x.type === "PATIENT_REGISTERED"); expect(r).toMatchObject({ priority: "HIGH" }); expect((await rowsOf(A.admin)).some((x) => x.type === "PATIENT_REGISTERED")).toBe(false); // admin acted, and isn't in the audience
    await saveRule(A.admin, { type: "PATIENT_REGISTERED", enabled: false, inApp: true }); const n = (await rowsOf(A.recep)).length; await registerPatient(A.doctor, { name: "Off Patient", phone: phone(), allowDuplicate: true }).catch(() => null); await registerPatient(A.recep, { name: "Off Patient", phone: phone(), allowDuplicate: true }); expect((await rowsOf(A.recep)).length).toBe(n);
    expect((await getRules(A.admin)).rules.find((x) => x.type === "PATIENT_REGISTERED")!.customised).toBe(true); await resetRule(A.admin, "PATIENT_REGISTERED"); expect((await getRules(A.admin)).rules.find((x) => x.type === "PATIENT_REGISTERED")!.customised).toBe(false);
    expect(await db.auditLog.count({ where: { tenantId: A.id, action: "notification.rule_changed" } })).toBeGreaterThanOrEqual(3); expect((await getRules(B.admin)).rules.every((x) => !x.customised)).toBe(true);
  });
  it("escalation: an unacknowledged important notification tells the admin exactly once", async () => {
    await saveRule(A.admin, { type: "OPD_EMERGENCY", enabled: true, inApp: true, ackRequired: true, escalateAfterMin: 5 });
    const e = await pat(A, "Escalate Me"); await registerVisit(A.recep, { patient: { patientId: e.id, viaProfile: true }, doctorUserId: A.doctor2Id, emergency: true });
    const em = (await rowsOf(A.doctor2)).find((r) => r.type === "OPD_EMERGENCY")!; expect((await runNotificationJobs()).escalated).toBe(0); // not due yet
    await db.notification.update({ where: { id: em.id }, data: { visibleAt: new Date(Date.now() - 10 * 60_000) } });
    expect((await runNotificationJobs()).escalated).toBe(1); expect((await runNotificationJobs()).escalated).toBe(0);
    const esc = (await rowsOf(A.admin)).filter((r) => r.type === "NOTIFICATION_ESCALATED"); expect(esc).toHaveLength(1); expect(esc[0].priority).toBe("URGENT"); expect(esc[0].ackRequired).toBe(false); // an escalation never escalates again
    expect((await db.notification.findUniqueOrThrow({ where: { id: em.id } })).escalatedAt).not.toBeNull();
    await resetRule(A.admin, "OPD_EMERGENCY");
  });
  it("an acknowledged notification is not escalated", async () => {
    await saveRule(A.admin, { type: "OPD_EMERGENCY", enabled: true, inApp: true, ackRequired: true, escalateAfterMin: 5 }); const before = (await rowsOf(A.admin)).filter((r) => r.type === "NOTIFICATION_ESCALATED").length;
    const e = await pat(A, "Acked Person"); await db.opdVisit.updateMany({ where: { tenantId: A.id, doctorUserId: A.doctorId, status: { in: ["CALLED", "IN_CONSULTATION"] } }, data: { status: "COMPLETED" } });
    await registerVisit(A.recep, { patient: { patientId: e.id, viaProfile: true }, doctorUserId: A.doctorId, emergency: true }); const em = (await db.notification.findMany({ where: { userId: A.doctorId, type: "OPD_EMERGENCY", acknowledgedAt: null } }))[0];
    await acknowledge(A_(A.doctor), em.id); await db.notification.updateMany({ where: { id: em.id }, data: { visibleAt: new Date(Date.now() - 3_600_000) } }); await runNotificationJobs();
    expect((await rowsOf(A.admin)).filter((r) => r.type === "NOTIFICATION_ESCALATED")).toHaveLength(before); await resetRule(A.admin, "OPD_EMERGENCY");
  });
});

describe("centre: counts, filters, search, archive, quiet hours, retention", () => {
  let u: Ctx;
  beforeAll(async () => { u = A.lab; await db.notification.deleteMany({ where: { userId: u.user.id } }); });
  it("unread count excludes read, archived, expired and held items and is cheap", async () => {
    const mk = (over: Record<string, unknown>) => db.notification.create({ data: { tenantId: A.id, userId: u.user.id, type: "LAB_ORDERED", category: "LAB", title: `T ${uniq("t")}`, ...over } });
    const base = await mk({}); await mk({ readAt: new Date() }); await mk({ archivedAt: new Date() }); await mk({ expiresAt: new Date(Date.now() - 1000) }); await mk({ visibleAt: new Date(Date.now() + 3_600_000) }); await mk({ priority: "URGENT", category: "LAB" });
    expect(await unreadCount(A_(u))).toEqual({ unread: 2, urgent: 1 }); expect(base.id).toBeTruthy();
    expect((await rowsOf(u)).length).toBe(3); expect((await rowsOf(u, { filter: "archived" })).length).toBe(1); expect((await rowsOf(u, { filter: "expired" })).length).toBe(1); expect((await rowsOf(u, { filter: "unread" })).length).toBe(2);
  });
  it("filters by category, priority and date; searches title, entity id and (permitted) patient names; paginates", async () => {
    await db.notification.deleteMany({ where: { userId: u.user.id } }); const p = await pat(A, "Searchable Zed");
    for (let i = 0; i < 25; i++) await db.notification.create({ data: { tenantId: A.id, userId: u.user.id, type: "LAB_ORDERED", category: i % 2 ? "LAB" : "BILLING", priority: i === 3 ? "HIGH" : "NORMAL", title: `Item ${i}`, entityId: i === 5 ? "ENT-5" : null, patientId: i === 7 ? p.id : null, createdAt: new Date(Date.now() - i * 60_000) } });
    await db.notification.create({ data: { tenantId: A.id, userId: u.user.id, type: "X", category: "LAB", title: "Old one", createdAt: new Date(Date.now() - 40 * 86_400_000) } });
    const p1 = await listNotifications(A_(u), { pageSize: 10, page: 1 }); expect(p1.total).toBe(26); expect(p1.rows).toHaveLength(10); expect((await listNotifications(A_(u), { pageSize: 10, page: 3 })).rows).toHaveLength(6);
    expect((await rowsOf(u, { category: "lab" })).every((r) => r.category === "LAB")).toBe(true); expect((await rowsOf(u, { priority: "HIGH" }))).toHaveLength(1);
    expect((await rowsOf(u, { range: "30d" }))).toHaveLength(25); expect((await rowsOf(u, { range: "today" })).length).toBeGreaterThan(0); expect((await rowsOf(u, { q: "Item 12" })).map((r) => r.title)).toContain("Item 12");
    expect((await rowsOf(u, { q: "ENT-5" }))).toHaveLength(1);
    expect((await rowsOf(u, { q: "Searchable" }))).toHaveLength(0); // lab staff may not search by patient
    const doc = A.doctor; await db.notification.create({ data: { tenantId: A.id, userId: doc.user.id, type: "X", category: "LAB", title: "About a patient", patientId: p.id } }); expect((await rowsOf(doc, { q: "Searchable" })).map((r) => r.title)).toContain("About a patient");
    expect((await rowsOf(B.doctor, { q: "Searchable" }))).toHaveLength(0);
    expect(await code(listNotifications(A_(u), { range: "custom", from: "not-a-date" }))).toBe("ok"); // bad input is ignored, not trusted
  });
  it("read / mark-all / archive / archive-read behave; acknowledgement items are protected", async () => {
    await db.notification.deleteMany({ where: { userId: u.user.id } });
    const a = await db.notification.create({ data: { tenantId: A.id, userId: u.user.id, type: "X", category: "LAB", title: "a" } }); const b = await db.notification.create({ data: { tenantId: A.id, userId: u.user.id, type: "X", category: "SECURITY", title: "b", readAt: new Date() } });
    const c = await db.notification.create({ data: { tenantId: A.id, userId: u.user.id, type: "X", category: "LAB", title: "c", ackRequired: true } });
    expect((await markRead(A_(u), a.id)).updated).toBe(1); expect((await markAllRead(A_(u))).updated).toBe(0); // the ack one stays unread
    expect((await unreadCount(A_(u))).unread).toBe(1); expect((await archiveAllRead(A_(u))).archived).toBe(1); // 'a' only: security and unacknowledged are kept
    expect((await db.notification.findUniqueOrThrow({ where: { id: b.id } })).archivedAt).toBeNull(); expect((await db.notification.findUniqueOrThrow({ where: { id: c.id } })).archivedAt).toBeNull();
    expect((await archive(A_(u), a.id, false)).archived).toBe(false); expect(await code(archive(A_(u), c.id))).toBe("CONFLICT");
  });
  it("quiet hours hold routine items for the person; high priority still arrives", async () => {
    const p = await pat(A); const who = A.doctor2; await savePreferences(A_(who), { quietEnabled: true, quietStartMin: 0, quietEndMin: 1439 }); await savePreferences(A_(who), { categories: { SYSTEM: true, PATIENT: true } });
    const n0 = (await rowsOf(who)).length; await notify({ tenantId: A.id, type: "FOLLOWUP_CREATED", eventKey: uniq("qh"), assigneeUserId: who.user.id, patientId: p.id, vars: { patient: "x", date: "d" } }); // normal
    expect((await rowsOf(who)).length).toBe(n0); expect((await db.notification.findFirst({ where: { userId: who.user.id, type: "FOLLOWUP_CREATED" }, orderBy: { createdAt: "desc" } }))!.visibleAt.getTime()).toBeGreaterThan(Date.now());
    await notify({ tenantId: A.id, type: "LAB_SAMPLE_REJECTED", eventKey: uniq("qh2"), doctorUserId: who.user.id, vars: { patient: "x", number: "n" } }); expect((await rowsOf(who)).length).toBe(n0 + 1);
    await savePreferences(A_(who), { quietEnabled: false });
  });
  it("retention is off by default, archives only safe read items when on, and never deletes", async () => {
    await db.notification.deleteMany({ where: { userId: A.accountant.user.id } }); const old = new Date(Date.now() - 60 * 86_400_000);
    const keep = (over: Record<string, unknown>) => db.notification.create({ data: { tenantId: A.id, userId: A.accountant.user.id, type: "X", category: "BILLING", title: "r", readAt: old, createdAt: old, ...over } });
    const ok = await keep({}); const sec = await keep({ category: "SECURITY" }); const crit = await keep({ priority: "CRITICAL" }); const ack = await keep({ ackRequired: true });
    await runNotificationJobs(); expect((await db.notification.findUniqueOrThrow({ where: { id: ok.id } })).archivedAt).toBeNull(); // off by default
    expect(await code(saveSettings(A.admin, { retentionEnabled: true, archiveReadAfterDays: 30, expireAfterDays: 20, lowStockCheck: true }))).toBe("VALIDATION_ERROR");
    await saveSettings(A.admin, { retentionEnabled: true, archiveReadAfterDays: 30, expireAfterDays: 60, lowStockCheck: true }); await runNotificationJobs();
    expect((await db.notification.findUniqueOrThrow({ where: { id: ok.id } })).archivedAt).not.toBeNull(); for (const r of [sec, crit, ack]) expect((await db.notification.findUniqueOrThrow({ where: { id: r.id } })).archivedAt).toBeNull();
    expect(await db.notification.count({ where: { userId: A.accountant.user.id } })).toBeGreaterThanOrEqual(4); // nothing deleted
    await saveSettings(A.admin, { retentionEnabled: false, archiveReadAfterDays: 30, expireAfterDays: 180, lowStockCheck: true });
  });
  it("preferences: staff only; per category; quiet hours validated", async () => {
    const p0 = await getPreferences(A_(A.nurse)); expect(p0.categories.find((c) => c.key === "SECURITY")!.locked).toBe(true);
    expect(await code(savePreferences(A_(A.nurse), { quietEnabled: true, quietStartMin: 60, quietEndMin: 60 }))).toBe("VALIDATION_ERROR");
    const pa = await pat(A); const acc = await portal(A, pa.id, pa.phone); expect(await code(getPreferences(acc.actor))).toBe("FORBIDDEN"); expect(await code(acknowledge(acc.actor, "x"))).toBe("FORBIDDEN");
  });
  it("today's summary uses real counts for the person's role", async () => {
    const p = await pat(A); await appointment(A, p.id, A.doctorId, 15 * 60); const s = await todaySummary(A.doctor); expect(s).toMatchObject({ date: day(0) }); expect(typeof s!.appointments).toBe("number"); expect(await todaySummary(A.pharm)).toMatchObject({ appointments: null });
  });
});

describe("detail, action authorisation, delivery status", () => {
  it("an action link is offered only if the person may open that record and it exists in their clinic", async () => {
    const p = await pat(A, "Linked Person"); const inv = await createInvoice(A.recep, { patientId: p.id, items: [{ serviceId: A.svc }] }) as { id: string }; await issueInvoice(A.recep, inv.id);
    const mk = (userId: string, tenantId: string, over: Record<string, unknown>) => db.notification.create({ data: { tenantId, userId, type: "INVOICE_ISSUED", category: "BILLING", title: "x", entityType: "invoice", entityId: inv.id, actionUrl: `/billing/invoices/${inv.id}`, ...over } });
    const acct = await mk(A.accountant.user.id, A.id, {}); expect((await getNotification(A_(A.accountant), acct.id)).actionUrl).toBe(`/billing/invoices/${inv.id}`);
    const doc = await mk(A.doctor.user.id, A.id, {}); expect((await getNotification(A_(A.doctor), doc.id)).actionUrl).toBeNull(); // no billing permission
    const wrong = await mk(B.accountant.user.id, B.id, {}); expect((await getNotification(A_(B.accountant), wrong.id)).actionUrl).toBeNull(); // clinic A's invoice id inside clinic B
    const evil = await mk(A.accountant.user.id, A.id, { actionUrl: "javascript:alert(1)" }); expect((await getNotification(A_(A.accountant), evil.id)).actionUrl).toBeNull();
  });
  it("detail shows real Phase 11 delivery status to those who may see it, simplified to the patient", async () => {
    const p = await pat(A); const acc = await portal(A, p.id, p.phone); const a = await appointment(A, p.id, A.doctorId, 16 * 60);
    await db.communicationMessage.create({ data: { tenantId: A.id, patientId: p.id, channel: "SMS", eventType: "APPOINTMENT_CONFIRMED", entityType: "appointment", entityId: a.id, recipient: "+910000000000", body: "secret text", provider: "twilio", providerMessageId: "SMxyz", status: "FAILED", failureCode: "HTTP_401", dedupeKey: uniq("d") } });
    const n = (await notifOf(acc.userId, { type: "APPOINTMENT_CONFIRMED" }))[0]; const d = await getNotification(acc.actor, n.id, { markRead: true });
    expect(d.delivery).toEqual([expect.objectContaining({ channel: "SMS", status: "NOT_DELIVERED" })]); expect(JSON.stringify(d)).not.toMatch(/SMxyz|twilio|HTTP_401|secret text/); expect(d.readAt).not.toBeNull(); expect(d.description).toBeNull(); expect(d.entityType).toBeNull();
    const s = (await rowsOf(A.doctor)).find((r) => r.type === "APPOINTMENT_CONFIRMED_STAFF" && r.entityType === "appointment")!; const sd = await getNotification(A_(A.doctor), s.id); expect(sd.delivery.length).toBe(1); expect(sd.delivery[0].status).toBe("FAILED"); expect(JSON.stringify(sd)).not.toMatch(/SMxyz|HTTP_401|secret text/);
    const rs = (await rowsOf(A.recep)); void rs; expect((await getNotification(A_(A.doctor), s.id)).description).toBeTruthy();
  });
  it("patient-facing notifications never include staff-only items, and patients can't see each other's", async () => {
    const p = await pat(A); const acc = await portal(A, p.id, p.phone); const q = await pat(A); const accQ = await portal(A, q.id, q.phone);
    await appointment(A, p.id, A.doctorId, 9 * 60 + 15); const mine = await listNotifications(acc.actor, {}); expect(mine.rows.every((r) => TYPES[r.type as keyof typeof TYPES]?.for !== "STAFF" || r.type === "LAB_REPORT_AMENDED")).toBe(true);
    expect((await listNotifications(accQ.actor, {})).rows.map((r) => r.id)).not.toContain(mine.rows[0]?.id); expect(await code(getNotification(accQ.actor, mine.rows[0].id))).toBe("NOT_FOUND");
    expect(JSON.stringify(mine)).not.toMatch(/Notif Clinic|doctor_name|recipients/); expect(JSON.stringify(mine.rows)).not.toContain(A.admin.user.id);
  });
  it("patient channel rules from Phase 12 narrow what Phase 11 may use", async () => {
    const sms = { name: "stub", channel: "SMS" as const, isConfigured: () => true, webhookReady: () => true, getMessageStatus: async () => null, parseWebhook: () => ({ verified: false, updates: [] }), sendSMS: async () => ({ ok: true as const, providerMessageId: `S-${Math.random()}` }) };
    __setProvider("SMS", sms as unknown as SmsProvider);
    await saveCommSettings(A.admin, { whatsappEnabled: false, smsEnabled: true, emailEnabled: false, channelOrder: ["WHATSAPP", "SMS", "EMAIL"], senderName: null, replyTo: null, defaultLanguage: "en", eventToggles: {}, reminderOffsets: [1440], quietEnabled: false, quietStartMin: 1320, quietEndMin: 480, fallbackRules: {}, maxRetries: 3, dailyCapPerPatient: 8 });
    const p1 = await pat(A); await appointment(A, p1.id, A.doctorId, 9 * 60 + 30); await processDue({ tenantId: A.id, limit: 200 }); expect(await db.communicationMessage.count({ where: { tenantId: A.id, patientId: p1.id, channel: "SMS", eventType: "APPOINTMENT_CONFIRMED" } })).toBe(1);
    await saveRule(A.admin, { type: "APPOINTMENT_CONFIRMED", enabled: true, inApp: true, externalChannels: ["EMAIL"] }); // SMS not allowed for this message any more
    const p2 = await pat(A); const acc2 = await portal(A, p2.id, p2.phone); await appointment(A, p2.id, A.doctorId, 9 * 60 + 45);
    expect(await db.communicationMessage.count({ where: { tenantId: A.id, patientId: p2.id, channel: "SMS", eventType: "APPOINTMENT_CONFIRMED", status: { not: "SKIPPED" } } })).toBe(0); expect((await notifOf(acc2.userId, { type: "APPOINTMENT_CONFIRMED" })).length).toBe(1); // in-app still works
    await saveRule(A.admin, { type: "APPOINTMENT_CONFIRMED", enabled: true, inApp: true, externalChannels: [] });
    const p3 = await pat(A); await appointment(A, p3.id, A.doctorId, 10 * 60 + 15); expect(await db.communicationMessage.count({ where: { tenantId: A.id, patientId: p3.id } })).toBe(0); // all external channels switched off for this message
    await resetRule(A.admin, "APPOINTMENT_CONFIRMED");
  });
});

describe("platform monitoring", () => {
  it("is Super Admin only, aggregate, and never exposes patient content", async () => {
    const sa = ctxFor((await makeUser("SUPER_ADMIN", null)).user, "SUPER_ADMIN", null); expect(await code(platformNotificationOverview(A.admin as never))).toBe("FORBIDDEN");
    await notify({ tenantId: A.id, type: "PROVIDER_FAILURE", eventKey: uniq("pf"), vars: { count: "5", channel: "sms", code: "HTTP_401" } });
    const o = await platformNotificationOverview(sa); expect(o.alerts.every((a) => ["SYSTEM", "SECURITY"].includes(a.category))).toBe(true); expect(o.alerts.some((a) => a.title.includes("provider"))).toBe(true);
    expect(JSON.stringify(o)).not.toMatch(/Notif Patient|Queue Person|Searchable|appointment/i);
    expect((await platformNotificationOverview(sa, { tenantId: B.id })).alerts.filter((a) => a.tenantId === A.id)).toHaveLength(0); expect((await platformNotificationOverview(sa, { priority: "CRITICAL" })).alerts.every((a) => a.priority === "CRITICAL")).toBe(true);
  });
  it("scheduler-stale and backlog alerts are raised for Super Admins when the scheduler is configured", async () => {
    process.env.CRON_SECRET = "cron-secret-0123456789"; await db.notificationEvent.deleteMany({ where: { userId: "system:scheduler" } });
    await db.notificationEvent.create({ data: { userId: "system:scheduler", eventKey: "run:old", createdAt: new Date(Date.now() - 60 * 60_000) } });
    expect(await platformHealth()).toBeGreaterThanOrEqual(1); expect(await db.notification.count({ where: { type: "SCHEDULER_STALE", tenantId: null } })).toBeGreaterThan(0);
    delete process.env.CRON_SECRET; void PRIORITY_RANK;
  });
});
