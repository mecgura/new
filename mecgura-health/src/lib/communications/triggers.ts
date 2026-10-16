import "server-only";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { COLLECTIBLE, dueOf, formatMoney } from "@/lib/billing/money";
import type { AppointmentEvent } from "@/lib/events/appointments";
import { addDays, dateInTz, timeInTz, todayIn } from "@/lib/scheduling/time";
import type { VarName } from "./catalog";
import { safeEmit } from "./dispatch";
import { loadTenantProfile } from "./links";

/**
 * The ONLY place business facts become communication events. Business modules call one of these AFTER their own transaction
 * has committed; each is wrapped so that a failure here can never undo or fail the business action.
 */
async function guard(what: string, fn: () => Promise<unknown>) { try { await fn(); } catch (err) { logger.error("communication trigger failed", { what, error: err }); } }
const when = (d: Date, tz: string) => ({ appointment_date: dateInTz(d, tz), appointment_time: timeInTz(d, tz) } as Partial<Record<VarName, string>>);
const TYPE_LABEL: Record<string, string> = { ONLINE_APPOINTMENT: "Consultation", FOLLOW_UP: "Follow-up", PROCEDURE: "Procedure", EMERGENCY: "Emergency", OPD: "Consultation", WALK_IN: "Walk-in", OTHER: "Appointment" };

/* ---------------------------------------------------------------- appointments ---------------------------------------------------------------- */
export async function appointmentVars(tenantId: string, appointmentId: string) {
  const a = await db.appointment.findFirst({ where: { id: appointmentId, tenantId } });
  if (!a?.patientId) return null;
  const [t, doc] = await Promise.all([loadTenantProfile(tenantId), db.user.findFirst({ where: { id: a.doctorUserId, tenantId }, select: { name: true } })]);
  if (!t) return null;
  return { a, t, vars: { ...when(a.startsAt, t.timezone), doctor_name: doc?.name ?? "your doctor", appointment_type: TYPE_LABEL[a.type] ?? "Appointment", appointment_id: a.publicId } as Partial<Record<VarName, string>> };
}
/** Hooked into the Phase 3 appointment events (created / confirmed / rescheduled / cancelled). */
export function onAppointmentEvent(e: AppointmentEvent) {
  return guard(`appointment:${e.name}`, async () => {
    const x = await appointmentVars(e.tenantId, e.appointmentId); if (!x) return; const { a, vars } = x;
    if (a.type === "WALK_IN" || a.type === "EMERGENCY") return; // a walk-in is already at the clinic
    const base = { tenantId: e.tenantId, patientId: a.patientId, entityType: "appointment", entityId: a.id, vars, linkPath: `/portal/appointments/${a.publicId}` };
    if (e.name === "appointment.created") await safeEmit({ ...base, event: a.status === "REQUESTED" ? "APPOINTMENT_REQUESTED" : "APPOINTMENT_CONFIRMED", eventKey: `appt:${a.id}:${a.status === "REQUESTED" ? "requested" : "confirmed"}` });
    else if (e.name === "appointment.confirmed") await safeEmit({ ...base, event: "APPOINTMENT_CONFIRMED", eventKey: `appt:${a.id}:confirmed` });
    else if (e.name === "appointment.rescheduled") await safeEmit({ ...base, event: "APPOINTMENT_RESCHEDULED", eventKey: `appt:${a.id}:resched:${a.startsAt.getTime()}` });
    else if (e.name === "appointment.cancelled") await safeEmit({ ...base, event: "APPOINTMENT_CANCELLED", eventKey: `appt:${a.id}:cancelled`, linkPath: undefined });
  });
}

/* ---------------------------------------------------------------- clinical ---------------------------------------------------------------- */
export const notifyPrescription = (tenantId: string, consultationId: string) => guard("prescription", async () => {
  const rx = await db.prescription.findFirst({ where: { consultationId, tenantId, currentVersion: { gt: 0 } } }); if (!rx) return;
  await safeEmit({ tenantId, event: "PRESCRIPTION_AVAILABLE", patientId: rx.patientId, eventKey: `rx:${rx.id}:v${rx.currentVersion}`, entityType: "prescription", entityId: rx.id, vars: { prescription_number: rx.number ?? "" }, linkPath: `/portal/prescriptions/${rx.id}` });
});
export const notifyReportReleased = (tenantId: string, reportId: string) => guard("report", async () => {
  const r = await db.labReport.findFirst({ where: { id: reportId, tenantId, currentVersion: { gt: 0 }, status: { in: ["RELEASED", "AMENDED"] } } }); if (!r) return; // never a draft / unverified report
  await safeEmit({ tenantId, event: "LAB_REPORT_RELEASED", patientId: r.patientId, eventKey: `lab:${r.id}:v${r.currentVersion}`, entityType: "lab_report", entityId: r.id, vars: { report_number: r.reportNumber }, linkPath: `/portal/reports/${r.id}` });
});

/* ---------------------------------------------------------------- follow-ups ---------------------------------------------------------------- */
export const notifyFollowUpCreated = (tenantId: string, followUpId: string) => guard("followup-created", async () => {
  const f = await db.followUp.findFirst({ where: { id: followUpId, tenantId } }); if (!f) return;
  await safeEmit({ tenantId, event: "FOLLOW_UP_CREATED", patientId: f.patientId, eventKey: `fu:${f.id}:created`, entityType: "follow_up", entityId: f.id, vars: { follow_up_date: f.dueDate }, linkPath: "/portal/follow-ups" });
});

/* ---------------------------------------------------------------- billing ---------------------------------------------------------------- */
export const notifyInvoiceIssued = (tenantId: string, invoiceId: string) => guard("invoice", async () => {
  const i = await db.invoice.findFirst({ where: { id: invoiceId, tenantId, status: { not: "DRAFT" } } }); if (!i) return;
  await safeEmit({ tenantId, event: "INVOICE_CREATED", patientId: i.patientId, eventKey: `inv:${i.id}:issued`, entityType: "invoice", entityId: i.id, vars: { invoice_number: i.invoiceNumber, amount_due: formatMoney(dueOf(i as never), i.currency) }, linkPath: `/portal/billing/invoices/${i.id}` });
});
export const notifyPayment = (tenantId: string, paymentId: string) => guard("payment", async () => {
  const p = await db.payment.findFirst({ where: { id: paymentId, tenantId, status: { in: ["SUCCESS", "PARTIALLY_REFUNDED"] } }, include: { invoice: { select: { id: true, currency: true } } } }); if (!p) return;
  await safeEmit({ tenantId, event: "PAYMENT_SUCCESS", patientId: p.patientId, eventKey: `pay:${p.id}`, entityType: "payment", entityId: p.id, vars: { amount_paid: formatMoney(p.amountMinor, p.invoice.currency), payment_date: p.paymentDate, receipt_number: p.receiptNumber ?? "" }, linkPath: `/portal/billing?view=payments` });
});

/* ---------------------------------------------------------------- OPD ---------------------------------------------------------------- */
export const notifyOpd = (tenantId: string, visitId: string, kind: "checked_in" | "called") => guard("opd", async () => {
  const v = await db.opdVisit.findFirst({ where: { id: visitId, tenantId }, select: { id: true, patientId: true, tokenLabel: true } }); if (!v) return;
  await safeEmit({ tenantId, event: kind === "called" ? "OPD_CALLED" : "OPD_CHECKED_IN", patientId: v.patientId, eventKey: `opd:${v.id}:${kind}`, entityType: "opd_visit", entityId: v.id, vars: { token_number: v.tokenLabel }, linkPath: "/portal/opd" });
});

/* ---------------------------------------------------------------- portal account ---------------------------------------------------------------- */
const SECURITY_TEXT = { password_changed: "your password was changed", logout_all: "all sessions were signed out", reset_issued: "the clinic issued a new access code", reset_done: "your access was reset and a new password was set" } as const;
export const notifyAccount = (tenantId: string, patientId: string, kind: "activated" | keyof typeof SECURITY_TEXT, key: string) => guard("account", async () => {
  if (kind === "activated") await safeEmit({ tenantId, event: "PATIENT_ACCOUNT_ACTIVATED", patientId, eventKey: `acct:${key}:activated`, entityType: "patient_account", entityId: key });
  else await safeEmit({ tenantId, event: "ACCOUNT_SECURITY_ALERT", patientId, eventKey: `sec:${key}:${kind}:${Math.floor(Date.now() / 60_000)}`, entityType: "patient_account", entityId: key, vars: { security_event: SECURITY_TEXT[kind] } });
});

/* ---------------------------------------------------------------- scheduler: reminders ---------------------------------------------------------------- */
import { loadSettings, anyChannelEnabled, eventEnabled } from "./settings";
export interface ScheduleSummary { tenants: number; reminders: number; followUps: number; invoices: number }

/** Finds due reminders for ONE clinic. Idempotent: every reminder has a deterministic eventKey, so running it every minute (or twice at once) can't duplicate anything. */
export async function scheduleForTenant(tenantId: string, now = new Date()): Promise<Omit<ScheduleSummary, "tenants">> {
  const s = await loadSettings(tenantId); const out = { reminders: 0, followUps: 0, invoices: 0 };
  if (!anyChannelEnabled(s)) return out;
  const t = await loadTenantProfile(tenantId); if (!t || !["ACTIVE", "TRIAL"].includes(t.status)) return out;
  if (eventEnabled(s, "APPOINTMENT_REMINDER")) for (const offset of s.reminderOffsets) {
    const latest = new Date(now.getTime() + offset * 60_000); const minLeft = new Date(now.getTime() + (offset / 2) * 60_000);
    // due when the appointment is within `offset` minutes AND at least half that far away (a 24 h reminder is never sent with 1 h to go), and it was booked before the reminder was due
    const rows = await db.appointment.findMany({ where: { tenantId, status: "CONFIRMED", patientId: { not: null }, startsAt: { gt: minLeft, lte: latest } }, take: 300, select: { id: true, createdAt: true, startsAt: true } });
    for (const a of rows) {
      if (a.createdAt.getTime() > a.startsAt.getTime() - offset * 60_000) continue; // booked inside the window: the confirmation already told them
      const x = await appointmentVars(tenantId, a.id); if (!x) continue; if (["WALK_IN", "EMERGENCY"].includes(x.a.type)) continue;
      const r = await safeEmit({ tenantId, event: "APPOINTMENT_REMINDER", patientId: x.a.patientId, eventKey: `appt:${a.id}:rem:${offset}:${a.startsAt.getTime()}`, entityType: "appointment", entityId: a.id, vars: x.vars, linkPath: `/portal/appointments/${x.a.publicId}` });
      if (r && !r.duplicate && (r.queued.length || r.skipped)) out.reminders++;
    }
  }
  const today = todayIn(t.timezone, now); const tomorrow = addDays(today, 1);
  if (eventEnabled(s, "FOLLOW_UP_REMINDER")) {
    const fus = await db.followUp.findMany({ where: { tenantId, status: { in: ["PENDING", "DUE", "IN_PROGRESS", "CONTACTED"] }, dueDate: { gte: today, lte: tomorrow } }, take: 300, select: { id: true, patientId: true, dueDate: true } });
    for (const f of fus) { const r = await safeEmit({ tenantId, event: "FOLLOW_UP_REMINDER", patientId: f.patientId, eventKey: `fu:${f.id}:rem:${f.dueDate}`, entityType: "follow_up", entityId: f.id, vars: { follow_up_date: f.dueDate }, linkPath: "/portal/follow-ups" }); if (r && !r.duplicate) out.followUps++; }
  }
  if (eventEnabled(s, "FOLLOW_UP_OVERDUE")) {
    const fus = await db.followUp.findMany({ where: { tenantId, status: { in: ["PENDING", "DUE", "IN_PROGRESS", "CONTACTED"] }, dueDate: { lt: today } }, take: 300, select: { id: true, patientId: true, dueDate: true } });
    for (const f of fus) { const r = await safeEmit({ tenantId, event: "FOLLOW_UP_OVERDUE", patientId: f.patientId, eventKey: `fu:${f.id}:overdue`, entityType: "follow_up", entityId: f.id, vars: { follow_up_date: f.dueDate }, linkPath: "/portal/follow-ups" }); if (r && !r.duplicate) out.followUps++; }
  }
  for (const [event, where] of [["INVOICE_DUE", { dueDate: { gte: today, lte: tomorrow } }], ["INVOICE_OVERDUE", { dueDate: { lt: today } }]] as const) {
    if (!eventEnabled(s, event)) continue;
    const invs = await db.invoice.findMany({ where: { tenantId, status: { in: [...COLLECTIBLE] }, ...where }, take: 300 });
    for (const i of invs) { if (dueOf(i as never) <= 0) continue; const r = await safeEmit({ tenantId, event, patientId: i.patientId, eventKey: `inv:${i.id}:${event === "INVOICE_DUE" ? "due" : "overdue"}`, entityType: "invoice", entityId: i.id, vars: { invoice_number: i.invoiceNumber, amount_due: formatMoney(dueOf(i as never), i.currency) }, linkPath: `/portal/billing/invoices/${i.id}` }); if (r && !r.duplicate) out.invoices++; }
  }
  return out;
}

export async function runScheduler(now = new Date()): Promise<ScheduleSummary> {
  const rows = await db.communicationSettings.findMany({ where: { OR: [{ whatsappEnabled: true }, { smsEnabled: true }, { emailEnabled: true }] }, select: { tenantId: true } });
  const sum: ScheduleSummary = { tenants: 0, reminders: 0, followUps: 0, invoices: 0 };
  for (const r of rows) { try { const o = await scheduleForTenant(r.tenantId, now); sum.tenants++; sum.reminders += o.reminders; sum.followUps += o.followUps; sum.invoices += o.invoices; } catch (err) { logger.error("scheduler failed for a clinic", { error: err }); } }
  return sum;
}
