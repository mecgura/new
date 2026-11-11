import "server-only";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { formatMoney } from "@/lib/billing/money";
import * as comm from "@/lib/communications/triggers";
import type { AppointmentEvent } from "@/lib/events/appointments";
import { dateInTz, timeInTz } from "@/lib/scheduling/time";
import { safeNotify, type NotifyInput } from "./engine";


/**
 * The event hub (Phase 12). Business modules report a fact HERE. The hub (1) raises the in-app notifications for the right people and
 * (2) hands the patient-facing external delivery to the Phase 11 communication engine. Both run after the business transaction has
 * committed, and neither can fail the caller.
 */
async function guard(what: string, fn: () => Promise<unknown>) { try { await fn(); } catch (err) { logger.error("notification trigger failed", { what, error: err }); } }
const send = (i: NotifyInput) => safeNotify(i);
const pname = async (tenantId: string, patientId: string | null | undefined) => (patientId ? (await db.patient.findFirst({ where: { id: patientId, tenantId }, select: { name: true } }))?.name ?? "A patient" : "A patient");

/* ---------------------------------------------------------------- appointments ---------------------------------------------------------------- */
export function onAppointmentEvent(e: AppointmentEvent) {
  return guard(`appt:${e.name}`, async () => {
    await comm.onAppointmentEvent(e);
    const x = await comm.appointmentVars(e.tenantId, e.appointmentId); if (!x || !x.a.patientId) return; const { a, t, vars } = x;
    if (["WALK_IN", "EMERGENCY"].includes(a.type)) return;
    const doctor = vars.doctor_name ?? "your doctor"; const when = `${dateInTz(a.startsAt, t.timezone)} ${timeInTz(a.startsAt, t.timezone)}`; const patient = await pname(e.tenantId, a.patientId);
    const base = { tenantId: e.tenantId, patientId: a.patientId, entityType: "appointment", entityId: a.id, doctorUserId: a.doctorUserId, actorUserId: e.actorUserId, vars: { patient, doctor, when } };
    const portal = `/portal/appointments/${a.publicId}`; const start = a.startsAt.getTime();
    const status = e.name === "appointment.created" ? (a.status === "REQUESTED" ? "requested" : "confirmed") : e.name.split(".")[1];
    if (status === "requested") await send({ ...base, type: "APPOINTMENT_REQUESTED", eventKey: `appt:${a.id}:requested`, actionUrl: "/appointments", patientDedupeKey: `appointment_requested:${a.id}:${start}` });
    else if (status === "confirmed") { await send({ ...base, type: "APPOINTMENT_CONFIRMED", eventKey: `appt:${a.id}:confirmed`, actionUrl: portal, patientDedupeKey: `appointment_confirmed:${a.id}:${start}` }); await send({ ...base, type: "APPOINTMENT_CONFIRMED_STAFF", eventKey: `appt:${a.id}:confirmed:staff`, actionUrl: "/appointments" }); }
    else if (status === "rescheduled") { await send({ ...base, type: "APPOINTMENT_RESCHEDULED", eventKey: `appt:${a.id}:resched:${start}`, actionUrl: portal, patientDedupeKey: `appointment_confirmed:${a.id}:${start}` }); }
    else if (status === "cancelled") await send({ ...base, type: "APPOINTMENT_CANCELLED", eventKey: `appt:${a.id}:cancelled`, actionUrl: null, patientDedupeKey: `appointment_cancelled:${a.id}:${start}` });
  });
}
export const notifyNoShow = (tenantId: string, appointmentId: string, actorUserId?: string) => guard("no-show", async () => {
  const x = await comm.appointmentVars(tenantId, appointmentId); if (!x?.a.patientId) return;
  await send({ tenantId, type: "APPOINTMENT_NO_SHOW", eventKey: `appt:${appointmentId}:noshow`, entityType: "appointment", entityId: appointmentId, patientId: x.a.patientId, actorUserId, vars: { patient: await pname(tenantId, x.a.patientId), when: `${dateInTz(x.a.startsAt, x.t.timezone)} ${timeInTz(x.a.startsAt, x.t.timezone)}` } });
});
export const notifyAppointmentReminder = (tenantId: string, appointmentId: string, offset: number) => guard("reminder", async () => {
  const x = await comm.appointmentVars(tenantId, appointmentId); if (!x?.a.patientId) return;
  await send({ tenantId, type: "APPOINTMENT_REMINDER", eventKey: `appt:${appointmentId}:rem:${offset}:${x.a.startsAt.getTime()}`, entityType: "appointment", entityId: appointmentId, patientId: x.a.patientId, actionUrl: `/portal/appointments/${x.a.publicId}`, vars: { when: `${dateInTz(x.a.startsAt, x.t.timezone)} ${timeInTz(x.a.startsAt, x.t.timezone)}`, doctor: x.vars.doctor_name ?? "your doctor" } });
});

/* ---------------------------------------------------------------- OPD ---------------------------------------------------------------- */
export const notifyOpd = (tenantId: string, visitId: string, kind: "checked_in" | "called" | "completed", actorUserId?: string) => guard("opd", async () => {
  if (kind !== "completed") await comm.notifyOpd(tenantId, visitId, kind);
  const v = await db.opdVisit.findFirst({ where: { id: visitId, tenantId }, select: { id: true, patientId: true, doctorUserId: true, tokenLabel: true, priority: true, visitType: true } }); if (!v) return;
  const patient = await pname(tenantId, v.patientId); const doc = await db.user.findFirst({ where: { id: v.doctorUserId }, select: { name: true } });
  const base = { tenantId, patientId: v.patientId, entityType: "opd_visit", entityId: v.id, doctorUserId: v.doctorUserId, actorUserId, vars: { patient, token: v.tokenLabel, doctor: doc?.name ?? "the doctor" } };
  if (kind === "checked_in") {
    if (v.priority === "EMERGENCY" || v.visitType === "EMERGENCY") await send({ ...base, type: "OPD_EMERGENCY", eventKey: `opd:${v.id}:emergency`, actionUrl: "/opd" });
    else await send({ ...base, type: "OPD_CHECKED_IN", eventKey: `opd:${v.id}:in`, actionUrl: "/opd", groupKey: `opd-in:${v.doctorUserId}` });
  } else if (kind === "called") await send({ ...base, type: "OPD_CALLED", eventKey: `opd:${v.id}:called`, actionUrl: "/portal/opd" });
  else await send({ ...base, type: "OPD_DONE", eventKey: `opd:${v.id}:done`, actionUrl: "/opd" });
});

/* ---------------------------------------------------------------- patients ---------------------------------------------------------------- */
export const notifyPatientRegistered = (tenantId: string, patientId: string, actorUserId?: string) => guard("patient", async () => send({ tenantId, type: "PATIENT_REGISTERED", eventKey: `patient:${patientId}:registered`, entityType: "patient", entityId: patientId, patientId, actorUserId, vars: { patient: await pname(tenantId, patientId) } }));
export const notifyPatientRequest = (tenantId: string, patientId: string, requestId: string, kind: string) => guard("patient-request", async () => send({ tenantId, type: "PATIENT_REQUEST_RECEIVED", eventKey: `prq:${requestId}`, entityType: "patient_request", entityId: requestId, patientId, actionUrl: "/patients/requests", vars: { patient: await pname(tenantId, patientId), kind: kind.toLowerCase().replace(/_/g, " ") } }));

/* ---------------------------------------------------------------- clinical ---------------------------------------------------------------- */
export const notifyPrescription = (tenantId: string, consultationId: string) => guard("prescription", async () => {
  await comm.notifyPrescription(tenantId, consultationId);
  const rx = await db.prescription.findFirst({ where: { consultationId, tenantId, currentVersion: { gt: 0 } } }); if (!rx) return;
  const key = `rx:${rx.id}:${rx.currentVersion}`; const number = rx.number ?? "";
  await send({ tenantId, type: "PRESCRIPTION_AVAILABLE", eventKey: key, entityType: "prescription", entityId: rx.id, patientId: rx.patientId, actionUrl: `/portal/prescriptions/${rx.id}`, patientDedupeKey: key, vars: { number } });
  await send({ tenantId, type: "PRESCRIPTION_READY", eventKey: `${key}:dispense`, entityType: "prescription", entityId: rx.id, patientId: rx.patientId, actionUrl: "/pharmacy/dispensing", vars: { patient: await pname(tenantId, rx.patientId), number } });
});

/* ---------------------------------------------------------------- lab ---------------------------------------------------------------- */
export const notifyLabOrdered = (tenantId: string, orderId: string) => guard("lab-ordered", async () => {
  const o = await db.investigationOrder.findFirst({ where: { id: orderId, tenantId }, include: { items: { select: { testNameSnapshot: true } } } }); if (!o) return;
  await send({ tenantId, type: "LAB_ORDERED", eventKey: `lab:${o.id}:ordered`, entityType: "lab_order", entityId: o.id, patientId: o.patientId, priority: ["HIGH", "URGENT", "STAT"].includes(o.priority) ? "HIGH" : undefined, vars: { patient: await pname(tenantId, o.patientId), tests: o.items.map((i: { testNameSnapshot: string }) => i.testNameSnapshot).slice(0, 3).join(", ") } });
});
export const notifyLabSample = (tenantId: string, orderId: string, kind: "collected" | "rejected", sampleId: string) => guard("lab-sample", async () => {
  const o = await db.investigationOrder.findFirst({ where: { id: orderId, tenantId }, select: { id: true, orderNumber: true, patientId: true, doctorUserId: true } }); if (!o) return;
  await send({ tenantId, type: kind === "collected" ? "LAB_SAMPLE_COLLECTED" : "LAB_SAMPLE_REJECTED", eventKey: `lab:${o.id}:sample:${sampleId}:${kind}`, entityType: "lab_order", entityId: o.id, patientId: o.patientId, doctorUserId: o.doctorUserId, vars: { patient: await pname(tenantId, o.patientId), number: o.orderNumber } });
});
export const notifyReportReleased = (tenantId: string, reportId: string) => guard("report", async () => {
  await comm.notifyReportReleased(tenantId, reportId);
  const r = await db.labReport.findFirst({ where: { id: reportId, tenantId, currentVersion: { gt: 0 }, status: { in: ["RELEASED", "AMENDED"] } } }); if (!r) return; // never a draft / unverified report
  const key = `report:${r.id}:${r.currentVersion}`; const patient = await pname(tenantId, r.patientId); const amended = r.currentVersion > 1;
  const base = { tenantId, entityType: "lab_report", entityId: r.id, patientId: r.patientId, doctorUserId: r.doctorUserId, vars: { patient, number: r.reportNumber } };
  if (amended) await send({ ...base, type: "LAB_REPORT_AMENDED", eventKey: `${key}:amended`, actionUrl: undefined, patientDedupeKey: key });
  else { await send({ ...base, type: "LAB_REPORT_RELEASED", eventKey: `${key}:doctor` }); await send({ ...base, type: "LAB_REPORT_AVAILABLE", eventKey: `${key}:patient`, actionUrl: `/portal/reports/${r.id}`, patientDedupeKey: key }); }
});

/* ---------------------------------------------------------------- follow-ups ---------------------------------------------------------------- */
export const notifyFollowUpCreated = (tenantId: string, followUpId: string, actorUserId?: string) => guard("followup", async () => {
  await comm.notifyFollowUpCreated(tenantId, followUpId);
  const f = await db.followUp.findFirst({ where: { id: followUpId, tenantId }, select: { id: true, patientId: true, dueDate: true, assignedToId: true, doctorUserId: true } }); if (!f) return;
  await send({ tenantId, type: "FOLLOWUP_CREATED", eventKey: `fu:${f.id}:created`, entityType: "followup", entityId: f.id, patientId: f.patientId, assigneeUserId: f.assignedToId ?? f.doctorUserId, actorUserId, vars: { patient: await pname(tenantId, f.patientId), date: f.dueDate } });
});

/* ---------------------------------------------------------------- billing ---------------------------------------------------------------- */
export const notifyInvoiceIssued = (tenantId: string, invoiceId: string, actorUserId?: string) => guard("invoice", async () => {
  await comm.notifyInvoiceIssued(tenantId, invoiceId);
  const i = await db.invoice.findFirst({ where: { id: invoiceId, tenantId, status: { not: "DRAFT" } } }); if (!i) return;
  await send({ tenantId, type: "INVOICE_ISSUED", eventKey: `inv:${i.id}:issued:staff`, entityType: "invoice", entityId: i.id, patientId: i.patientId, actorUserId, vars: { number: i.invoiceNumber, patient: await pname(tenantId, i.patientId) } });
  await send({ tenantId, type: "INVOICE_AVAILABLE", eventKey: `inv:${i.id}:issued`, entityType: "invoice", entityId: i.id, patientId: i.patientId, actionUrl: `/portal/billing/invoices/${i.id}`, patientDedupeKey: `invoice:${i.id}`, vars: { number: i.invoiceNumber } });
});
export const notifyPayment = (tenantId: string, paymentId: string, actorUserId?: string) => guard("payment", async () => {
  await comm.notifyPayment(tenantId, paymentId);
  const p = await db.payment.findFirst({ where: { id: paymentId, tenantId, status: { in: ["SUCCESS", "PARTIALLY_REFUNDED"] } }, include: { invoice: { select: { currency: true, invoiceNumber: true } } } }); if (!p) return;
  await send({ tenantId, type: "PAYMENT_RECEIVED", eventKey: `pay:${p.id}:staff`, entityType: "invoice", entityId: p.invoiceId, patientId: p.patientId, actorUserId, vars: { amount: formatMoney(p.amountMinor, p.invoice.currency), patient: await pname(tenantId, p.patientId), number: p.invoice.invoiceNumber } });
  await send({ tenantId, type: "PAYMENT_CONFIRMED", eventKey: `pay:${p.id}`, entityType: "payment", entityId: p.id, patientId: p.patientId, actionUrl: "/portal/billing?view=payments", patientDedupeKey: `payment:${p.id}`, vars: { number: p.receiptNumber ?? "" } });
});
export const notifyRefundRequested = (tenantId: string, refundId: string, actorUserId?: string) => guard("refund", async () => {
  const r = await db.refund.findFirst({ where: { id: refundId, tenantId }, include: { payment: { select: { patientId: true, invoice: { select: { currency: true } } } } } }); if (!r) return;
  await send({ tenantId, type: "REFUND_REQUESTED", eventKey: `refund:${r.id}:requested`, entityType: "payment", entityId: r.paymentId, patientId: r.payment.patientId, actionUrl: "/billing/refunds", actorUserId, vars: { amount: formatMoney(r.amountMinor, r.payment.invoice.currency), patient: await pname(tenantId, r.payment.patientId) } });
});

/* ---------------------------------------------------------------- pharmacy ---------------------------------------------------------------- */
export const notifyPurchaseReceived = (tenantId: string, purchaseId: string, actorUserId?: string) => guard("purchase", async () => {
  const p = await db.purchase.findFirst({ where: { id: purchaseId, tenantId }, select: { id: true, purchaseNumber: true } }); if (!p) return;
  await send({ tenantId, type: "PURCHASE_RECEIVED", eventKey: `purchase:${p.id}:received`, entityType: "purchase", entityId: p.id, actorUserId, vars: { number: p.purchaseNumber } });
});

/* ---------------------------------------------------------------- portal account / security ---------------------------------------------------------------- */
const SECURITY_TEXT = { password_changed: "your password was changed", logout_all: "all your sessions were signed out", reset_issued: "the clinic issued a new access code", reset_done: "your access was reset and a new password was set" } as const;
export const notifyAccount = (tenantId: string, patientId: string, kind: "activated" | keyof typeof SECURITY_TEXT, key: string) => guard("account", async () => {
  await comm.notifyAccount(tenantId, patientId, kind, key);
  if (kind === "activated") return; // the patient is signing in right now — nothing to tell them in-app
  await send({ tenantId, type: "PATIENT_SECURITY", eventKey: `sec:${key}:${kind}:${Math.floor(Date.now() / 60_000)}`, entityType: "patient_account", entityId: key, patientId, actionUrl: "/portal/security", vars: { event: SECURITY_TEXT[kind].replace(/^./, (c) => c.toUpperCase()) } });
});
export const notifyStaffSecurity = (tenantId: string | null, kind: "password_changed" | "locked" | "role_changed", userId: string, extra: { who?: string; role?: string } = {}) => guard("security", async () => {
  const minute = Math.floor(Date.now() / 60_000);
  if (kind === "password_changed") await send({ tenantId, type: "PASSWORD_CHANGED", eventKey: `sec:${userId}:pw:${minute}`, entityType: "user", entityId: userId, selfUserId: userId, actionUrl: "/settings" });
  else if (kind === "locked") await send({ tenantId, type: "ACCOUNT_LOCKED", eventKey: `sec:${userId}:lock:${Math.floor(Date.now() / 900_000)}`, entityType: "user", entityId: userId, selfUserId: userId, vars: { who: extra.who ?? "An account" } });
  else await send({ tenantId, type: "ROLE_CHANGED", eventKey: `sec:${userId}:role:${extra.role}:${minute}`, entityType: "user", entityId: userId, selfUserId: userId, vars: { who: extra.who ?? "A user", role: (extra.role ?? "").replace(/_/g, " ").toLowerCase() } });
});
