import "server-only";
import { z } from "zod";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import type { TenantRequestContext } from "@/lib/auth/context";
import { AppError } from "@/lib/errors";
import { OPEN_STATUSES } from "@/lib/followups/core";
import { csvChunks, toPrintableHtml, toXlsx, type Column, type ReportMeta, type Row } from "@/lib/analytics/export";
import { ageGroup, ageOf, minutesBetween, titleCase } from "@/lib/analytics/stats";
import { RANGE_PRESETS } from "@/lib/analytics/range";
import { daysBetween } from "@/lib/pharmacy/stock";
import { addDays, formatInTz } from "@/lib/scheduling/time";
import { APPOINTMENT_STATUSES } from "@/lib/scheduling/states";
import { BILLED, DOMAIN_PERMISSION, IN_CHUNK, ROW_CAP, buildEnv, chunk, currencyOf, db, doctorNames, doctorWhere, majorString, requireAnalytics, type Domain, type Env } from "./analytics-core";
import { loadPharmacySettings, lowThreshold, sellableStock, stockStatus } from "./pharmacy-core";

/**
 * Report Center. Every report is a fixed, server-defined query: the client chooses a report KEY and validated filters, never a table or column.
 * Identity columns (patient name / phone) are only fetched when the viewer may see them, and only exported with reports.export_patient.
 */
export const PREVIEW_ROWS = 200;
export const EXPORT_CAP = 50_000;
export const CATEGORIES = ["Clinical", "Operational", "Financial", "Patient", "Lab", "Pharmacy", "Communication"] as const;
type Category = (typeof CATEGORIES)[number];
type Filter = "doctor" | "status" | "type" | "channel";

interface Ctx { env: Env; identity: boolean; limit: number; clock: (d: Date | null | undefined) => string; date: (d: Date | null | undefined) => string }
interface ReportDef {
  key: string; name: string; category: Category; description: string; dataSource: string; domain: Domain; financial?: boolean; patientLevel?: boolean;
  filters: Filter[]; statusOptions?: readonly string[]; columns: Column[];
  fetch: (c: Ctx) => Promise<Row[]>;
}
const C = (key: string, label: string, type?: Column["type"], identity?: boolean): Column => ({ key, label, type, identity });

async function patientMap(c: Ctx, ids: (string | null | undefined)[]) {
  const u = [...new Set(ids.filter((x): x is string => !!x))]; const m = new Map<string, { code: string; name?: string; phone?: string | null }>();
  for (const part of chunk(u, IN_CHUNK)) for (const p of await c.env.tdb.patient.findMany({ where: { id: { in: part } }, select: { id: true, code: true, ...(c.identity ? { name: true, phone: true } : {}) } })) m.set(p.id, { code: p.code, name: p.name, phone: p.phone });
  return m;
}
const pcols = [C("patientCode", "Patient ID"), C("patientName", "Patient name", "text", true), C("patientPhone", "Phone", "text", true)];
const pfill = (m: Map<string, { code: string; name?: string; phone?: string | null }>, id: string | null | undefined) => { const p = id ? m.get(id) : undefined; return { patientCode: p?.code ?? "", patientName: p?.name ?? "", patientPhone: p?.phone ?? "" }; };

const REPORTS: ReportDef[] = [
  { key: "appointments", name: "Appointments", category: "Operational", description: "Every appointment in the period with its status and key times.", dataSource: "Appointments", domain: "operations", filters: ["doctor", "status", "type"], statusOptions: APPOINTMENT_STATUSES,
    columns: [C("date", "Date", "date"), C("time", "Time"), C("ref", "Appointment ref"), ...pcols, C("doctor", "Doctor"), C("type", "Type"), C("source", "Source"), C("status", "Status"), C("checkedIn", "Checked in"), C("completed", "Completed"), C("cancelReason", "Cancellation reason")],
    async fetch(c) {
      const { env } = c; const rows = await env.tdb.appointment.findMany({ where: { startsAt: { gte: env.range.start, lt: env.range.end }, ...doctorWhere(env), ...(env.q.status ? { status: env.q.status } : {}), ...(env.q.type ? { type: env.q.type } : {}) }, orderBy: { startsAt: "asc" }, take: c.limit, select: { publicId: true, startsAt: true, patientId: true, doctorUserId: true, type: true, source: true, status: true, checkedInAt: true, completedAt: true, cancellationReason: true } });
      const [pm, dn] = await Promise.all([patientMap(c, rows.map((r: { patientId: string | null }) => r.patientId)), doctorNames(env, rows.map((r: { doctorUserId: string }) => r.doctorUserId))]);
      return rows.map((r: Record<string, any>) => ({ date: env.localize(r.startsAt).date, time: c.clock(r.startsAt), ref: r.publicId, ...pfill(pm, r.patientId), doctor: dn.get(r.doctorUserId) ?? "", type: titleCase(r.type), source: titleCase(r.source), status: titleCase(r.status), checkedIn: c.clock(r.checkedInAt), completed: c.clock(r.completedAt), cancelReason: r.cancellationReason ?? "" }));
    } },
  { key: "opd", name: "Live OPD visits", category: "Operational", description: "Queue visits with check-in, call and consultation times and the waiting time derived from them.", dataSource: "OPD visits", domain: "operations", filters: ["doctor", "status"], statusOptions: ["WAITING", "CALLED", "IN_CONSULTATION", "COMPLETED", "ON_HOLD", "SKIPPED", "CANCELLED"],
    columns: [C("date", "Date", "date"), C("token", "Token"), ...pcols, C("doctor", "Doctor"), C("queue", "Queue"), C("priority", "Priority"), C("status", "Status"), C("checkedIn", "Checked in"), C("called", "Called"), C("started", "Started"), C("completed", "Completed"), C("waitMin", "Waiting (min)", "number"), C("consultMin", "Consultation (min)", "number")],
    async fetch(c) {
      const { env } = c; const rows = await env.tdb.opdVisit.findMany({ where: { tokenDate: { gte: env.range.from, lte: env.range.to }, ...doctorWhere(env), ...(env.q.status ? { status: env.q.status } : {}) }, orderBy: [{ tokenDate: "asc" }, { queueSeq: "asc" }], take: c.limit, select: { tokenDate: true, tokenLabel: true, patientId: true, doctorUserId: true, queueType: true, priority: true, status: true, checkedInAt: true, calledAt: true, startedAt: true, completedAt: true } });
      const [pm, dn] = await Promise.all([patientMap(c, rows.map((r: { patientId: string }) => r.patientId)), doctorNames(env, rows.map((r: { doctorUserId: string }) => r.doctorUserId))]);
      return rows.map((r: Record<string, any>) => ({ date: r.tokenDate, token: r.tokenLabel, ...pfill(pm, r.patientId), doctor: dn.get(r.doctorUserId) ?? "", queue: titleCase(r.queueType), priority: titleCase(r.priority), status: titleCase(r.status), checkedIn: c.clock(r.checkedInAt), called: c.clock(r.calledAt), started: c.clock(r.startedAt), completed: c.clock(r.completedAt), waitMin: minutesBetween(r.checkedInAt, r.calledAt), consultMin: minutesBetween(r.startedAt, r.completedAt) }));
    } },
  { key: "followups", name: "Follow-ups", category: "Operational", description: "Follow-ups due in the period with status, priority and outcome. Choose status “Overdue” for open follow-ups past their due date.", dataSource: "Follow-ups", domain: "operations", filters: ["doctor", "status"], statusOptions: ["OVERDUE", "PENDING", "DUE", "IN_PROGRESS", "CONTACTED", "APPOINTMENT_BOOKED", "COMPLETED", "PATIENT_DECLINED", "NO_RESPONSE", "RESCHEDULED", "CANCELLED", "EXPIRED"],
    columns: [C("number", "Follow-up"), ...pcols, C("doctor", "Doctor"), C("type", "Type"), C("due", "Due date", "date"), C("status", "Status"), C("priority", "Priority"), C("assigned", "Assigned to"), C("outcome", "Outcome"), C("completedOn", "Completed on", "date")],
    async fetch(c) {
      const { env } = c; const overdue = env.q.status === "OVERDUE";
      const rows = await env.tdb.followUp.findMany({ where: { dueDate: { gte: env.range.from, lte: overdue ? addDays(env.today, -1) < env.range.to ? addDays(env.today, -1) : env.range.to : env.range.to }, ...doctorWhere(env), ...(overdue ? { status: { in: [...OPEN_STATUSES] } } : env.q.status ? { status: env.q.status } : {}) }, orderBy: { dueDate: "asc" }, take: c.limit, select: { followUpNumber: true, patientId: true, doctorUserId: true, type: true, dueDate: true, status: true, priority: true, assignedToId: true, outcome: true, completedAt: true } });
      const [pm, dn] = await Promise.all([patientMap(c, rows.map((r: { patientId: string }) => r.patientId)), doctorNames(env, rows.flatMap((r: { doctorUserId: string | null; assignedToId: string | null }) => [r.doctorUserId, r.assignedToId]))]);
      return rows.map((r: Record<string, any>) => ({ number: r.followUpNumber, ...pfill(pm, r.patientId), doctor: dn.get(r.doctorUserId) ?? "", type: titleCase(r.type), due: r.dueDate, status: titleCase(r.status), priority: titleCase(r.priority), assigned: dn.get(r.assignedToId) ?? "", outcome: r.outcome ? titleCase(r.outcome) : "", completedOn: r.completedAt ? env.localize(r.completedAt).date : "" }));
    } },
  { key: "consultations", name: "Consultations", category: "Clinical", description: "Consultation records opened in the period: status and timing only — no clinical notes.", dataSource: "Consultations", domain: "clinical", patientLevel: true, filters: ["doctor", "status"], statusOptions: ["DRAFT", "IN_PROGRESS", "READY_FOR_REVIEW", "FINALIZED", "CANCELLED"],
    columns: [C("number", "Consultation"), C("date", "Date", "date"), ...pcols, C("doctor", "Doctor"), C("status", "Status"), C("finalizedAt", "Finalised at"), C("durationMin", "Open to final (min)", "number"), C("followUp", "Follow-up requested")],
    async fetch(c) {
      const { env } = c; const rows = await env.tdb.consultation.findMany({ where: { startedAt: { gte: env.range.start, lt: env.range.end }, ...doctorWhere(env), ...(env.q.status ? { status: env.q.status } : {}) }, orderBy: { startedAt: "asc" }, take: c.limit, select: { number: true, startedAt: true, patientId: true, doctorUserId: true, status: true, finalizedAt: true, followUpRequired: true } });
      const [pm, dn] = await Promise.all([patientMap(c, rows.map((r: { patientId: string }) => r.patientId)), doctorNames(env, rows.map((r: { doctorUserId: string }) => r.doctorUserId))]);
      return rows.map((r: Record<string, any>) => ({ number: r.number, date: env.localize(r.startedAt).date, ...pfill(pm, r.patientId), doctor: dn.get(r.doctorUserId) ?? "", status: titleCase(r.status), finalizedAt: r.finalizedAt ? `${env.localize(r.finalizedAt).date} ${c.clock(r.finalizedAt)}` : "", durationMin: minutesBetween(r.startedAt, r.finalizedAt), followUp: r.followUpRequired ? "Yes" : "No" }));
    } },
  { key: "diagnoses", name: "Diagnosis summary", category: "Clinical", description: "How often each recorded diagnosis appears in finalised consultations. Counts only — no patient details.", dataSource: "Consultation diagnoses", domain: "clinical", filters: ["doctor"],
    columns: [C("diagnosis", "Diagnosis"), C("code", "Code"), C("count", "Count", "number")],
    async fetch(c) {
      const { env } = c; const rows = await env.tdb.consultationDiagnosis.findMany({ where: { consultation: { is: { startedAt: { gte: env.range.start, lt: env.range.end }, status: "FINALIZED", ...doctorWhere(env) } } }, select: { name: true, code: true }, take: ROW_CAP });
      const m = new Map<string, { diagnosis: string; code: string; count: number }>(); for (const r of rows as { name: string; code: string | null }[]) { const k = `${r.code ?? ""}|${r.name.toLowerCase()}`; const cur = m.get(k) ?? { diagnosis: r.name, code: r.code ?? "", count: 0 }; cur.count++; m.set(k, cur); }
      return [...m.values()].sort((a, b) => b.count - a.count || a.diagnosis.localeCompare(b.diagnosis)).slice(0, c.limit);
    } },
  { key: "patients", name: "Patients", category: "Patient", description: "Patients registered in the period (doctors: patients they saw in the period) with demographics and visit counts.", dataSource: "Patients, OPD visits", domain: "patients", patientLevel: true, filters: ["doctor"], statusOptions: ["ACTIVE", "ARCHIVED"],
    columns: [...pcols, C("gender", "Gender"), C("ageGroup", "Age group"), C("city", "City"), C("registered", "Registered on", "date"), C("status", "Status"), C("visits", "Visits in period", "number")],
    async fetch(c) {
      const { env } = c; const r = env.range; let where: Record<string, unknown> = { createdAt: { gte: r.start, lt: r.end } };
      if (env.doctorId) where = { opdVisits: { some: { doctorUserId: env.doctorId, tokenDate: { gte: r.from, lte: r.to }, status: { not: "CANCELLED" } } } };
      const rows = await env.tdb.patient.findMany({ where: { ...where, ...(env.q.status ? { status: env.q.status } : {}) }, orderBy: { createdAt: "asc" }, take: c.limit, select: { id: true, code: true, gender: true, dateOfBirth: true, ageYears: true, city: true, createdAt: true, status: true, ...(c.identity ? { name: true, phone: true } : {}) } });
      const visits = new Map<string, number>(); for (const part of chunk(rows.map((x: { id: string }) => x.id), IN_CHUNK)) for (const v of await env.tdb.opdVisit.groupBy({ by: ["patientId"], where: { patientId: { in: part }, tokenDate: { gte: r.from, lte: r.to }, status: { not: "CANCELLED" }, ...doctorWhere(env) }, _count: { _all: true } })) visits.set(v.patientId, v._count._all);
      return rows.map((p: Record<string, any>) => ({ patientCode: p.code, patientName: p.name ?? "", patientPhone: p.phone ?? "", gender: p.gender ? titleCase(p.gender) : "", ageGroup: ageGroup(ageOf(p, r.to)) ?? "", city: p.city ?? "", registered: env.localize(p.createdAt).date, status: titleCase(p.status), visits: visits.get(p.id) ?? 0 }));
    } },
  { key: "lab", name: "Laboratory orders", category: "Lab", description: "Investigation orders in the period with their status and the time from order to released report.", dataSource: "Investigation orders, lab reports", domain: "lab", patientLevel: true, filters: ["doctor", "status"], statusOptions: ["ORDERED", "CONFIRMED", "SAMPLE_PENDING", "SAMPLE_COLLECTED", "SAMPLE_RECEIVED", "PROCESSING", "RESULT_READY", "REPORT_GENERATED", "DOCTOR_REVIEWED", "CANCELLED", "RELEASED"],
    columns: [C("number", "Order"), C("date", "Ordered on", "date"), ...pcols, C("doctor", "Doctor"), C("priority", "Priority"), C("status", "Status"), C("released", "Report released"), C("tatHours", "Turnaround (hours)", "number")],
    async fetch(c) {
      const { env } = c; const rel = env.q.status === "RELEASED";
      const rows = await env.tdb.investigationOrder.findMany({ where: { orderedAt: { gte: env.range.start, lt: env.range.end }, ...doctorWhere(env), ...(rel ? { report: { is: { status: "RELEASED" } } } : env.q.status ? { status: env.q.status } : {}) }, orderBy: { orderedAt: "asc" }, take: c.limit, select: { orderNumber: true, orderedAt: true, patientId: true, doctorUserId: true, priority: true, status: true, report: { select: { releasedAt: true } } } });
      const [pm, dn] = await Promise.all([patientMap(c, rows.map((r: { patientId: string }) => r.patientId)), doctorNames(env, rows.map((r: { doctorUserId: string }) => r.doctorUserId))]);
      return rows.map((r: Record<string, any>) => { const m = minutesBetween(r.orderedAt, r.report?.releasedAt); return { number: r.orderNumber, date: env.localize(r.orderedAt).date, ...pfill(pm, r.patientId), doctor: dn.get(r.doctorUserId) ?? "", priority: titleCase(r.priority), status: titleCase(r.status), released: r.report?.releasedAt ? `${env.localize(r.report.releasedAt).date} ${c.clock(r.report.releasedAt)}` : "", tatHours: m === null ? null : Math.round(m / 60) }; });
    } },
  { key: "billing", name: "Invoices", category: "Financial", description: "Invoices dated in the period with billed, collected, refunded and due amounts taken from the invoice snapshot.", dataSource: "Invoices", domain: "financial", financial: true, patientLevel: true, filters: ["doctor", "status"], statusOptions: ["ISSUED", "PARTIALLY_PAID", "PAID", "CANCELLED", "REFUNDED", "PARTIALLY_REFUNDED"],
    columns: [C("number", "Invoice"), C("date", "Date", "date"), ...pcols, C("doctor", "Doctor"), C("status", "Status"), C("subtotal", "Gross billed", "money"), C("discount", "Discount", "money"), C("tax", "Tax", "money"), C("total", "Net billed", "money"), C("collected", "Collected", "money"), C("refunded", "Refunded", "money"), C("due", "Due", "money"), C("dueDate", "Due date", "date")],
    async fetch(c) {
      const { env } = c; const rows = await env.tdb.invoice.findMany({ where: { invoiceDate: { gte: env.range.from, lte: env.range.to }, status: env.q.status ? env.q.status : { in: [...BILLED, "CANCELLED"] }, ...doctorWhere(env) }, orderBy: [{ invoiceDate: "asc" }, { invoiceNumber: "asc" }], take: c.limit, select: { invoiceNumber: true, invoiceDate: true, patientId: true, doctorUserId: true, status: true, subtotalMinor: true, discountMinor: true, taxMinor: true, totalMinor: true, collectedMinor: true, refundedMinor: true, dueMinor: true, dueDate: true } });
      const [pm, dn] = await Promise.all([patientMap(c, rows.map((r: { patientId: string }) => r.patientId)), doctorNames(env, rows.map((r: { doctorUserId: string | null }) => r.doctorUserId))]);
      return rows.map((r: Record<string, any>) => ({ number: r.invoiceNumber, date: r.invoiceDate, ...pfill(pm, r.patientId), doctor: dn.get(r.doctorUserId) ?? "", status: titleCase(r.status), subtotal: majorString(r.subtotalMinor), discount: majorString(r.discountMinor), tax: majorString(r.taxMinor), total: majorString(r.totalMinor), collected: majorString(r.collectedMinor), refunded: majorString(r.refundedMinor), due: majorString(r.status === "CANCELLED" ? 0 : Math.max(0, r.totalMinor - r.collectedMinor)), dueDate: r.dueDate ?? "" }));
    } },
  { key: "payments", name: "Payments", category: "Financial", description: "Successful payments received in the period.", dataSource: "Payments", domain: "financial", financial: true, patientLevel: true, filters: ["doctor"],
    columns: [C("number", "Payment"), C("date", "Date", "date"), C("invoice", "Invoice"), C("patientCode", "Patient ID"), C("method", "Method"), C("status", "Status"), C("amount", "Amount", "money"), C("refunded", "Refunded", "money")],
    async fetch(c) {
      const { env } = c; const rows = await env.tdb.payment.findMany({ where: { paymentDate: { gte: env.range.from, lte: env.range.to }, status: { in: ["SUCCESS", "PARTIALLY_REFUNDED", "REFUNDED"] }, ...(env.doctorId ? { invoice: { is: { doctorUserId: env.doctorId } } } : {}) }, orderBy: [{ paymentDate: "asc" }, { paymentNumber: "asc" }], take: c.limit, select: { paymentNumber: true, paymentDate: true, method: true, status: true, amountMinor: true, refundedMinor: true, patientId: true, invoice: { select: { invoiceNumber: true } } } });
      const pm = await patientMap(c, rows.map((r: { patientId: string }) => r.patientId));
      return rows.map((r: Record<string, any>) => ({ number: r.paymentNumber, date: r.paymentDate, invoice: r.invoice.invoiceNumber, patientCode: pm.get(r.patientId)?.code ?? "", method: titleCase(r.method), status: titleCase(r.status), amount: majorString(r.amountMinor), refunded: majorString(r.refundedMinor) }));
    } },
  { key: "refunds", name: "Refunds", category: "Financial", description: "Refunds created in the period and their status.", dataSource: "Refunds", domain: "financial", financial: true, filters: ["status"], statusOptions: ["REQUESTED", "APPROVED", "PROCESSED", "REJECTED"],
    columns: [C("number", "Refund"), C("date", "Date", "date"), C("invoice", "Invoice"), C("method", "Method"), C("status", "Status"), C("reason", "Reason"), C("amount", "Amount", "money")],
    async fetch(c) {
      const { env } = c; const rows = await env.tdb.refund.findMany({ where: { createdAt: { gte: env.range.start, lt: env.range.end }, ...(env.q.status ? { status: env.q.status } : {}), ...(env.doctorId ? { invoice: { is: { doctorUserId: env.doctorId } } } : {}) }, orderBy: { createdAt: "asc" }, take: c.limit, select: { refundNumber: true, createdAt: true, method: true, status: true, reason: true, amountMinor: true, invoice: { select: { invoiceNumber: true } } } });
      return rows.map((r: Record<string, any>) => ({ number: r.refundNumber, date: env.localize(r.createdAt).date, invoice: r.invoice.invoiceNumber, method: titleCase(r.method), status: titleCase(r.status), reason: r.reason, amount: majorString(r.amountMinor) }));
    } },
  { key: "services", name: "Service revenue", category: "Financial", description: "Billed amount per service, from invoice snapshots (later price changes never alter it).", dataSource: "Invoice items", domain: "financial", financial: true, filters: ["doctor"],
    columns: [C("service", "Service"), C("type", "Type"), C("quantity", "Quantity", "number"), C("total", "Billed", "money")],
    async fetch(c) {
      const { env } = c; const g = await env.tdb.invoiceItem.groupBy({ by: ["descriptionSnapshot", "serviceTypeSnapshot"], where: { invoice: { is: { invoiceDate: { gte: env.range.from, lte: env.range.to }, status: { in: BILLED }, ...doctorWhere(env) } } }, _sum: { lineTotalMinor: true, quantity: true }, orderBy: { _sum: { lineTotalMinor: "desc" } }, take: c.limit });
      return g.map((x: Record<string, any>) => ({ service: x.descriptionSnapshot, type: titleCase(x.serviceTypeSnapshot ?? "OTHER"), quantity: x._sum.quantity ?? 0, total: majorString(x._sum.lineTotalMinor ?? 0) }));
    } },
  { key: "pharmacy-stock", name: "Pharmacy stock", category: "Pharmacy", description: "Current sellable stock per active medicine against its reorder level (a snapshot as of now).", dataSource: "Medicines, batches", domain: "pharmacy", filters: ["status"], statusOptions: ["IN_STOCK", "LOW_STOCK", "OUT_OF_STOCK"],
    columns: [C("medicine", "Medicine"), C("strength", "Strength"), C("unit", "Unit"), C("available", "Sellable stock", "number"), C("reorder", "Reorder level", "number"), C("status", "Status"), C("nearestExpiry", "Nearest expiry", "date"), C("value", "Stock value", "money")],
    async fetch(c) {
      const { env } = c; const meds = await env.tdb.medicine.findMany({ where: { active: true }, orderBy: { genericName: "asc" }, take: c.limit, select: { id: true, genericName: true, brandName: true, strength: true, unit: true, reorderLevel: true, minimumStock: true } });
      const stock = await sellableStock(env.tdb, env.today); const bs = await env.tdb.medicineBatch.findMany({ where: { quantityAvailable: { gt: 0 } }, select: { medicineId: true, expiryDate: true, quantityAvailable: true, purchasePriceMinor: true }, take: ROW_CAP });
      const near = new Map<string, string>(); const val = new Map<string, number>(); for (const b of bs as { medicineId: string; expiryDate: string; quantityAvailable: number; purchasePriceMinor: number }[]) { if (b.expiryDate >= env.today && (!near.has(b.medicineId) || b.expiryDate < near.get(b.medicineId)!)) near.set(b.medicineId, b.expiryDate); val.set(b.medicineId, (val.get(b.medicineId) ?? 0) + b.quantityAvailable * b.purchasePriceMinor); }
      const hasValue = (bs as { purchasePriceMinor: number }[]).some((b) => b.purchasePriceMinor > 0);
      return meds.map((m: { id: string; genericName: string; brandName: string | null; strength: string | null; unit: string; reorderLevel: number; minimumStock: number }) => ({ medicine: m.brandName ? `${m.brandName} (${m.genericName})` : m.genericName, strength: m.strength ?? "", unit: m.unit, available: stock.get(m.id) ?? 0, reorder: lowThreshold(m), status: titleCase(stockStatus(stock.get(m.id) ?? 0, m)), nearestExpiry: near.get(m.id) ?? "", value: hasValue ? majorString(val.get(m.id) ?? 0) : "Stock valuation not configured", _s: stockStatus(stock.get(m.id) ?? 0, m) })).filter((r: { _s: string }) => !env.q.status || r._s === env.q.status);
    } },
  { key: "pharmacy-expiry", name: "Pharmacy expiry", category: "Pharmacy", description: "Batches that still hold stock and are expired or inside the clinic's near-expiry window (a snapshot as of now).", dataSource: "Medicine batches", domain: "pharmacy", filters: [], 
    columns: [C("medicine", "Medicine"), C("batch", "Batch"), C("expiry", "Expiry date", "date"), C("days", "Days remaining", "number"), C("quantity", "Quantity", "number"), C("state", "State")],
    async fetch(c) {
      const { env } = c; const s = await loadPharmacySettings(env.tdb, env.ctx.tenantId); const near = addDays(env.today, s.nearExpiryDays);
      const rows = await env.tdb.medicineBatch.findMany({ where: { quantityAvailable: { gt: 0 }, expiryDate: { lte: near } }, orderBy: { expiryDate: "asc" }, take: c.limit, select: { batchNumber: true, expiryDate: true, quantityAvailable: true, medicine: { select: { genericName: true, brandName: true } } } });
      return rows.map((b: Record<string, any>) => { const d = daysBetween(env.today, b.expiryDate); return { medicine: b.medicine.brandName ?? b.medicine.genericName, batch: b.batchNumber, expiry: b.expiryDate, days: d, quantity: b.quantityAvailable, state: d < 0 ? "Expired" : "Near expiry" }; });
    } },
  { key: "pharmacy-dispensing", name: "Dispensing", category: "Pharmacy", description: "Dispensing records in the period with their value.", dataSource: "Dispensing", domain: "pharmacy", patientLevel: true, filters: ["status"], statusOptions: ["DISPENSED", "CANCELLED"],
    columns: [C("number", "Dispensing"), C("date", "Date", "date"), C("patientCode", "Patient ID"), C("status", "Status"), C("by", "Dispensed by"), C("total", "Total", "money")],
    async fetch(c) {
      const { env } = c; const rows = await env.tdb.dispensing.findMany({ where: { dispensedAt: { gte: env.range.start, lt: env.range.end }, ...(env.q.status ? { status: env.q.status } : {}) }, orderBy: { dispensedAt: "asc" }, take: c.limit, select: { dispensingNumber: true, dispensedAt: true, patientId: true, status: true, dispensedById: true, totalMinor: true } });
      const [pm, dn] = await Promise.all([patientMap(c, rows.map((r: { patientId: string }) => r.patientId)), doctorNames(env, rows.map((r: { dispensedById: string }) => r.dispensedById))]);
      return rows.map((r: Record<string, any>) => ({ number: r.dispensingNumber, date: env.localize(r.dispensedAt).date, patientCode: pm.get(r.patientId)?.code ?? "", status: titleCase(r.status), by: dn.get(r.dispensedById) ?? "", total: majorString(r.totalMinor) }));
    } },
  { key: "communications", name: "Messages", category: "Communication", description: "Patient messages created in the period with their delivery state. Message contents and recipient contact details are never included.", dataSource: "Communication messages", domain: "communication", patientLevel: true, filters: ["status", "channel"], statusOptions: ["QUEUED", "PROCESSING", "RETRYING", "SENT", "DELIVERED", "READ", "FAILED", "CANCELLED", "SKIPPED"],
    columns: [C("date", "Date", "date"), C("channel", "Channel"), C("event", "Event"), C("patientCode", "Patient ID"), C("status", "Status"), C("sent", "Sent"), C("delivered", "Delivered"), C("read", "Read"), C("failure", "Failure code")],
    async fetch(c) {
      const { env } = c; const rows = await env.tdb.communicationMessage.findMany({ where: { createdAt: { gte: env.range.start, lt: env.range.end }, ...(env.q.status ? { status: env.q.status } : {}), ...(env.q.channel ? { channel: env.q.channel } : {}) }, orderBy: { createdAt: "asc" }, take: c.limit, select: { createdAt: true, channel: true, eventType: true, patientId: true, status: true, sentAt: true, deliveredAt: true, readAt: true, failureCode: true } });
      const pm = await patientMap(c, rows.map((r: { patientId: string | null }) => r.patientId));
      return rows.map((r: Record<string, any>) => ({ date: env.localize(r.createdAt).date, channel: titleCase(r.channel), event: titleCase(String(r.eventType).replace(/\./g, " ")), patientCode: r.patientId ? (pm.get(r.patientId)?.code ?? "") : "", status: titleCase(r.status), sent: c.clock(r.sentAt), delivered: c.clock(r.deliveredAt), read: c.clock(r.readAt), failure: r.failureCode ?? "" }));
    } },
];
const BY_KEY = new Map(REPORTS.map((r) => [r.key, r]));
export const reportKeys = () => REPORTS.map((r) => r.key);

function find(key: string): ReportDef { const d = BY_KEY.get(key); if (!d) throw new AppError("NOT_FOUND", { message: "This report doesn't exist." }); return d; }
const can = (ctx: TenantRequestContext, d: ReportDef) => ctx.permissions.has("analytics.view") && ctx.permissions.has(DOMAIN_PERMISSION[d.domain]);
const canExport = (ctx: TenantRequestContext, d: ReportDef) => can(ctx, d) && ctx.permissions.has("reports.export") && (!d.financial || ctx.permissions.has("reports.export_financial"));

/** Catalog: only reports the viewer may open. */
export function reportCatalog(ctx: TenantRequestContext) {
  requireAnalytics(ctx);
  const items = REPORTS.filter((d) => can(ctx, d)).map((d) => ({ key: d.key, name: d.name, category: d.category, description: d.description, dataSource: d.dataSource, filters: d.filters, statusOptions: d.statusOptions ?? null, columns: d.columns.map((c) => c.label), canExport: canExport(ctx, d), financial: !!d.financial }));
  return { categories: CATEGORIES.filter((c) => items.some((i) => i.category === c)), reports: items };
}

function makeClock(tz: string) {
  const f = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }); const memo = new Map<number, string>();
  return (d: Date | null | undefined) => { if (!d) return ""; const k = Math.floor(d.getTime() / 60000); let v = memo.get(k); if (!v) { v = f.format(d); if (memo.size > 50000) memo.clear(); memo.set(k, v); } return v; };
}
function filterText(env: Env, d: ReportDef) {
  const parts: string[] = [];
  if (env.doctorId) parts.push(env.own ? "Doctor: you" : "Doctor filter applied");
  if (env.q.status && d.filters.includes("status")) parts.push(`Status: ${titleCase(env.q.status)}`);
  if (env.q.type && d.filters.includes("type")) parts.push(`Type: ${titleCase(env.q.type)}`);
  if (env.q.channel && d.filters.includes("channel")) parts.push(`Channel: ${titleCase(env.q.channel)}`);
  return parts.join("; ");
}
function validateFilters(d: ReportDef, env: Env) {
  if (env.q.status && !d.filters.includes("status")) throw new AppError("VALIDATION_ERROR", { message: "This report can't be filtered by status." });
  if (env.q.status && d.statusOptions && !d.statusOptions.includes(env.q.status)) throw new AppError("VALIDATION_ERROR", { message: "Choose a valid status for this report." });
  if (env.q.type && !d.filters.includes("type")) throw new AppError("VALIDATION_ERROR", { message: "This report can't be filtered by type." });
  if (env.q.channel && (!d.filters.includes("channel") || !["WHATSAPP", "SMS", "EMAIL"].includes(env.q.channel))) throw new AppError("VALIDATION_ERROR", { message: "Choose a valid channel." });
}

async function build(ctx: TenantRequestContext, key: string, raw: unknown, mode: "preview" | "export") {
  const d = find(key);
  if (!can(ctx, d)) throw new AppError("FORBIDDEN", { message: "You don't have access to this report." }); // same answer for "exists but not yours": no enumeration
  if (mode === "export" && !canExport(ctx, d)) throw new AppError("FORBIDDEN", { message: "You can't export this report." });
  const env = await buildEnv(ctx, raw); validateFilters(d, env);
  const viewIdentity = ctx.permissions.has("patients.identity");
  const identity = mode === "export" ? viewIdentity && ctx.permissions.has("reports.export_patient") : viewIdentity;
  const limit = mode === "export" ? EXPORT_CAP + 1 : PREVIEW_ROWS + 1;
  const c: Ctx = { env, identity, limit, clock: makeClock(env.tz), date: (x) => (x ? env.localize(x).date : "") };
  let rows = await d.fetch(c);
  const truncated = rows.length >= limit; if (truncated) rows = rows.slice(0, limit - 1);
  const cols = d.columns.filter((col) => !col.identity || identity);
  const currency = d.financial ? await currencyOf(env) : undefined;
  const meta: ReportMeta = { name: d.name, description: d.description, dataSource: d.dataSource, range: `${env.range.from} to ${env.range.to} (${env.range.label})`, timezone: env.tz, generatedAt: formatInTz(new Date(), env.tz, { dateStyle: "medium", timeStyle: "short" }), generatedBy: ctx.user.name, filters: filterText(env, d), truncated, currency, note: !identity && d.columns.some((x) => x.identity) ? "Patient names and contact details are not included; patients are shown by Patient ID." : undefined };
  return { d, env, rows, cols, meta, truncated, identity };
}

export async function runReport(ctx: TenantRequestContext, key: string, raw: unknown) {
  const r = await build(ctx, key, raw, "preview");
  await recordAudit({ action: AUDIT_ACTIONS.ANALYTICS_REPORT_GENERATED, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "analytics_report", entityId: key, metadata: { report: key, from: r.env.range.from, to: r.env.range.to, rows: r.rows.length, doctorScoped: !!r.env.doctorId } });
  return { report: { key: r.d.key, name: r.d.name, category: r.d.category, description: r.d.description, dataSource: r.d.dataSource, financial: !!r.d.financial, filters: r.d.filters, statusOptions: r.d.statusOptions ?? null }, columns: r.cols.map((c) => ({ key: c.key, label: c.label, type: c.type ?? "text" })), rows: r.rows.slice(0, PREVIEW_ROWS), shown: Math.min(r.rows.length, PREVIEW_ROWS), more: r.rows.length > PREVIEW_ROWS || r.truncated, identityIncluded: r.identity, canExport: canExport(ctx, r.d), currency: r.meta.currency ?? null, meta: { generatedAt: new Date().toISOString(), timezone: r.env.tz, range: { from: r.env.range.from, to: r.env.range.to, label: r.env.range.label }, generatedBy: ctx.user.name, filters: r.meta.filters } };
}

export const EXPORT_FORMATS = ["csv", "xlsx", "pdf"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];
export async function exportReport(ctx: TenantRequestContext, key: string, raw: unknown, format: string) {
  if (!(EXPORT_FORMATS as readonly string[]).includes(format)) throw new AppError("VALIDATION_ERROR", { message: "Choose CSV, XLSX or PDF." });
  const r = await build(ctx, key, raw, "export"); const f = format as ExportFormat;
  const base = `${key}-${r.env.range.from}_${r.env.range.to}`;
  await recordAudit({ action: AUDIT_ACTIONS.ANALYTICS_REPORT_EXPORTED, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "analytics_report", entityId: key, metadata: { report: key, format: f, from: r.env.range.from, to: r.env.range.to, rows: r.rows.length, truncated: r.truncated, identityIncluded: r.identity, financial: !!r.d.financial, doctorScoped: !!r.env.doctorId } });
  if (f === "csv") return { filename: `${base}.csv`, contentType: "text/csv; charset=utf-8", chunks: csvChunks(r.meta, r.cols, r.rows) as (string | Uint8Array)[] };
  if (f === "xlsx") return { filename: `${base}.xlsx`, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", chunks: [toXlsx(r.meta, r.cols, r.rows)] as (string | Uint8Array)[] };
  return { filename: `${base}.html`, contentType: "text/html; charset=utf-8", chunks: [toPrintableHtml(r.meta, r.cols, r.rows, ctx.tenant.name)] as (string | Uint8Array)[] };
}

/* --------------------------------------------------- scheduled-report foundation --------------------------------------------------- */
/** Definitions only. Nothing is generated, e-mailed or sent anywhere by this phase. */
const scheduleSchema = z.object({
  name: z.string().trim().min(2).max(80), reportKey: z.string().max(40), frequency: z.enum(["DAILY", "WEEKLY", "MONTHLY"]), format: z.enum(["CSV", "XLSX", "PDF"]).default("CSV"),
  preset: z.enum(RANGE_PRESETS).refine((p) => p !== "custom", "Scheduled reports use a rolling range.").default("last7"), status: z.string().max(40).optional(), doctorId: z.string().max(40).optional(),
});
export async function listSchedules(ctx: TenantRequestContext) {
  requireAnalytics(ctx);
  const rows = await db(ctx).scheduledReport.findMany({ orderBy: { createdAt: "desc" }, take: 100 });
  return { schedules: rows.filter((s: { reportKey: string }) => { const d = BY_KEY.get(s.reportKey); return d && can(ctx, d); }).map((s: Record<string, any>) => ({ id: s.id as string, name: s.name as string, reportKey: s.reportKey as string, frequency: s.frequency as string, format: s.format as string, enabled: s.enabled as boolean, filters: JSON.parse(s.filters || "{}") as Record<string, string>, lastRunAt: null as string | null })) as { id: string; name: string; reportKey: string; frequency: string; format: string; enabled: boolean; filters: Record<string, string>; lastRunAt: string | null }[], canConfigure: ctx.permissions.has("analytics.configure"), delivery: "Scheduled delivery is not active yet. These definitions are saved for a later release; nothing is sent." };
}
export async function saveSchedule(ctx: TenantRequestContext, raw: unknown) {
  requireAnalytics(ctx, "analytics.configure");
  const p = scheduleSchema.safeParse(raw);
  if (!p.success) throw new AppError("VALIDATION_ERROR", { message: p.error.issues[0]?.message ?? "Check the schedule details.", fieldErrors: Object.fromEntries(p.error.issues.map((i) => [String(i.path[0] ?? "name"), i.message])) });
  const d = find(p.data.reportKey); if (!can(ctx, d)) throw new AppError("FORBIDDEN", { message: "You don't have access to this report." });
  if (p.data.status && (!d.filters.includes("status") || (d.statusOptions && !d.statusOptions.includes(p.data.status)))) throw new AppError("VALIDATION_ERROR", { message: "Choose a valid status for this report." });
  const tdb = db(ctx);
  if ((await tdb.scheduledReport.count({})) >= 50) throw new AppError("CONFLICT", { message: "You can keep up to 50 scheduled reports." });
  const row = await tdb.scheduledReport.create({ data: { name: p.data.name, reportKey: d.key, frequency: p.data.frequency, format: p.data.format, filters: JSON.stringify({ preset: p.data.preset, ...(p.data.status ? { status: p.data.status } : {}) }), createdById: ctx.user.id }, select: { id: true } });
  await recordAudit({ action: AUDIT_ACTIONS.SCHEDULED_REPORT_SAVED, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "scheduled_report", entityId: row.id, metadata: { report: d.key, frequency: p.data.frequency } });
  return { id: row.id as string };
}
export async function deleteSchedule(ctx: TenantRequestContext, id: string) {
  requireAnalytics(ctx, "analytics.configure");
  const r = await db(ctx).scheduledReport.deleteMany({ where: { id } }); // tenant-scoped: another clinic's id deletes nothing
  if (!r.count) throw new AppError("NOT_FOUND", { message: "That scheduled report doesn't exist." });
  await recordAudit({ action: AUDIT_ACTIONS.SCHEDULED_REPORT_DELETED, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "scheduled_report", entityId: id });
  return { deleted: true };
}
