import "server-only";
import { notifyLabOrdered, notifyLabSample } from "@/lib/notifications/events";
import { randomBytes } from "node:crypto";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import type { TenantRequestContext } from "@/lib/auth/context";
import { parseJson } from "@/lib/clinical/snapshot";
import { deriveOrderStatus, PRIORITY_RANK, type TestSnap } from "@/lib/lab/core";
import { AppError } from "@/lib/errors";
import { todayIn } from "@/lib/scheduling/time";
import { tenantDb } from "@/lib/tenant/db";
import { parseOrThrow } from "@/lib/validation";
import { labActionSchema, labOrderCreateSchema } from "@/lib/validation/lab";
import { nextCounter, tenantTimezone, type Client } from "./clinic-shared";
import { containsCI } from "./shared";
import { autoBill } from "./billing-invoices";
import { labGuard } from "./lab-master";
import { snapshotOf } from "./lab-master";

/**
 * Laboratory orders, samples and chain of custody.
 *  - one Sample per (order, sample type); a rejected sample is kept forever and a recollection is a NEW sample (attempt + 1);
 *  - collection claims items with a guarded updateMany, so two people can never collect the same test twice;
 *  - order status is always re-derived from the items/report (never set by hand).
 */
const db = (ctx: TenantRequestContext) => tenantDb(ctx) as Client;
const PAGE = 20;
export const OPEN_BEFORE_COLLECTION = ["ORDERED", "CONFIRMED", "SAMPLE_PENDING"];
const iso = (d: Date | null | undefined) => d?.toISOString() ?? null;
const newToken = () => randomBytes(12).toString("base64url");
const year = async (tenantId: string) => todayIn(await tenantTimezone(tenantId)).slice(0, 4);
const pad = (n: number) => String(n).padStart(6, "0");

export const isLabStaffView = (ctx: TenantRequestContext) => ctx.permissions.has("lab.result") || ctx.permissions.has("lab.review") || ctx.user.role === "CLINIC_ADMIN";
const canCollect = (ctx: TenantRequestContext) => ctx.permissions.has("lab.collect");
const canProcess = (ctx: TenantRequestContext) => ctx.permissions.has("lab.result") || ctx.permissions.has("lab.collect");
function requireView(ctx: TenantRequestContext) { labGuard(ctx); if (!ctx.permissions.has("tests.view")) throw new AppError("FORBIDDEN"); }


export interface LabOrderRow { id: string; orderNumber: string; priority: string; status: string; source: string; orderedAt: string | null; consultationId: string | null; patient: { id: string; code: string; name: string } | null; doctorName: string | null; tests: string[]; testCount: number; report: { id: string; reportNumber: string; status: string } | null }
export interface LabSampleEventView { id: string; action: string; by: string | null; department: string | null; notes: string | null; at: string | null }
export interface LabSampleView { id: string; sampleNumber: string; sampleType: string; attempt: number; previousSampleId: string | null; status: string; rejectionReason: string | null; notes: string | null; collectedAt: string | null; collectedBy: string | null; receivedAt: string | null; receivedBy: string | null; rejectedAt: string | null; rejectedBy: string | null; events: LabSampleEventView[] }
export interface LabItemView { id: string; testName: string; sampleType: string | null; status: string; resultStatus: string; sampleId: string | null; notes: string | null; snapshot: TestSnap | null; results: { position: number; parameterName: string; value: string; unit: string | null; refText: string | null; flag: string | null; remarks: string | null }[] }
export interface LabOrderDetail {
  id: string; orderNumber: string; status: string; priority: string; source: string; externalRef: string | null; labPartner: { id: string; name: string } | null; clinicalNotes: string | null; orderedAt: string | null; cancelledAt: string | null; cancelReason: string | null; completedAt: string | null;
  consultationId: string | null; doctorName: string | null; orderedByName: string | null; patient: { id: string; code: string; name: string; gender: string | null; ageYears: number | null; dateOfBirth: string | null } | null; seeResults: boolean;
  items: LabItemView[]; samples: LabSampleView[];
  report: { id: string; reportNumber: string; status: string; currentVersion: number; amendReason: string | null; generatedAt: string | null; verifiedAt: string | null; releasedAt: string | null } | null;
  can: { confirm: boolean; cancel: boolean; collect: boolean; process: boolean; enterResults: boolean; review: boolean; print: boolean };
}

/* ---------------------------------------------- notifications ---------------------------------------------- */
export async function notify(tx: Client, tenantId: string, userId: string, n: { type: string; title: string; body?: string; entityType?: string; entityId?: string }) {
  // Superseded by the Phase 12 notification hub (src/lib/notifications/events.ts), which raises these with rules, priority and de-duplication.
  void tx; void tenantId; void userId; void n;
}

/* ------------------------------------- status derivation (used by results too) ------------------------------------- */
export async function refreshOrderStatus(tx: Client, tenantId: string, orderId: string) {
  const o = await tx.investigationOrder.findFirst({ where: { id: orderId, tenantId }, include: { items: { select: { status: true, resultStatus: true } }, report: { select: { id: true, status: true, currentVersion: true } } } });
  if (!o) throw new AppError("NOT_FOUND", { message: "Order not found." });
  const confirmed = o.status !== "ORDERED";
  const reviewed = o.report && o.report.currentVersion > 0 ? (await tx.labReportReview.count({ where: { tenantId, reportId: o.report.id, version: o.report.currentVersion, status: { in: ["REVIEWED", "ACKNOWLEDGED"] } } })) > 0 : false;
  const next = deriveOrderStatus({ status: o.status === "CANCELLED" ? "CANCELLED" : "OPEN", confirmed }, o.items, o.report, reviewed);
  if (next !== o.status) await tx.investigationOrder.updateMany({ where: { id: orderId, tenantId }, data: { status: next, ...(next === "DOCTOR_REVIEWED" ? { completedAt: new Date() } : {}) } });
  return next;
}
/** Phase 5 DoctorOrder follows the lab order (no duplicate order rows). */
export async function moveDoctorOrder(tx: Client, tenantId: string, doctorOrderId: string | null, to: "IN_PROGRESS" | "COMPLETED" | "CANCELLED", userId: string) {
  if (!doctorOrderId) return;
  const from = to === "IN_PROGRESS" ? ["PENDING"] : ["PENDING", "IN_PROGRESS"];
  await tx.doctorOrder.updateMany({ where: { id: doctorOrderId, tenantId, status: { in: from } }, data: { status: to, ...(to === "COMPLETED" ? { completedAt: new Date(), completedById: userId } : {}) } });
}

/* ------------------------------------------------- create ------------------------------------------------- */
export async function createInvestigationOrder(ctx: TenantRequestContext, consultationId: string, raw: unknown) {
  labGuard(ctx);
  if (ctx.user.role !== "DOCTOR" || !ctx.permissions.has("tests.order")) throw new AppError("FORBIDDEN", { message: "Only doctors order investigations." });
  const input = parseOrThrow(labOrderCreateSchema, raw);
  const tdb = db(ctx);
  const c = await tdb.consultation.findFirst({ where: { id: consultationId }, select: { id: true, patientId: true, doctorUserId: true, status: true, patient: { select: { status: true } } } });
  if (!c) throw new AppError("NOT_FOUND", { message: "Consultation not found." });
  if (c.doctorUserId !== ctx.user.id) throw new AppError("FORBIDDEN", { message: "Only the treating doctor can order investigations for this consultation." });
  if (c.status === "CANCELLED") throw new AppError("CONFLICT", { message: "This consultation was cancelled." });
  if (c.patient.status === "ARCHIVED") throw new AppError("CONFLICT", { message: "This patient record is archived." });
  const ids = [...new Set(input.investigationIds)];
  const tests = await tdb.investigation.findMany({ where: { id: { in: ids }, active: true }, include: { parameters: { orderBy: { position: "asc" } } } });
  if (tests.length !== ids.length) throw new AppError("VALIDATION_ERROR", { message: "One of the chosen tests is no longer available.", fieldErrors: { investigationIds: "One of the chosen tests is no longer available." } });
  if (input.source === "EXTERNAL" && !(await tdb.labPartner.findFirst({ where: { id: input.labPartnerId, active: true }, select: { id: true } }))) throw new AppError("VALIDATION_ERROR", { message: "Choose an active external laboratory.", fieldErrors: { labPartnerId: "Choose an active external laboratory." } });
  const yr = await year(ctx.tenantId);
  const snaps = await Promise.all(ids.map(async (id) => { const t = tests.find((x: { id: string }) => x.id === id); return { t, snap: await snapshotOf(t) }; }));
  const out = await tdb.$transaction(async (tx: Client) => {
    const n = await nextCounter(tx, ctx.tenantId, `lab:${yr}`);
    const title = `Lab: ${snaps.map((s) => s.snap.shortName || s.snap.name).join(", ")}`.slice(0, 120);
    const dOrder = await tx.doctorOrder.create({ data: { tenantId: ctx.tenantId, patientId: c.patientId, consultationId, doctorUserId: ctx.user.id, type: "INVESTIGATION", title, description: null, priority: input.priority === "NORMAL" ? "NORMAL" : input.priority === "HIGH" ? "HIGH" : "URGENT", createdById: ctx.user.id } });
    const order = await tx.investigationOrder.create({ data: { tenantId: ctx.tenantId, orderNumber: `LAB-${yr}-${pad(n)}`, patientId: c.patientId, consultationId, doctorUserId: ctx.user.id, doctorOrderId: dOrder.id, source: input.source, labPartnerId: input.source === "EXTERNAL" ? input.labPartnerId : null, priority: input.priority, priorityRank: PRIORITY_RANK[input.priority], clinicalNotes: input.clinicalNotes ?? null, createdById: ctx.user.id } });
    await tx.investigationOrderItem.createMany({ data: snaps.map((s) => ({ tenantId: ctx.tenantId, investigationOrderId: order.id, investigationId: s.t.id, testNameSnapshot: s.snap.name, sampleTypeSnapshot: s.snap.sampleType ?? null, snapshot: JSON.stringify(s.snap), priority: input.priority })) });
    return { id: order.id as string, orderNumber: order.orderNumber as string };
  });
  await notifyLabOrdered(ctx.tenantId, out.id);
  await autoBill(ctx, "investigation", out.id); // draft invoice only if the clinic enabled it; never blocks the order
  await recordAudit({ action: AUDIT_ACTIONS.LAB_ORDER_CREATED, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "investigation_order", entityId: out.id, metadata: { consultationId, tests: ids.length, priority: input.priority, source: input.source } });
  return out;
}

/* -------------------------------------------------- lists -------------------------------------------------- */
export const TABS: Record<string, string[] | undefined> = {
  new: ["ORDERED", "CONFIRMED", "SAMPLE_PENDING"],
  collected: ["SAMPLE_COLLECTED", "SAMPLE_RECEIVED"],
  processing: ["PROCESSING"],
  results: ["RESULT_READY"],
  reports: ["REPORT_GENERATED", "DOCTOR_REVIEWED"],
  cancelled: ["CANCELLED"],
  all: undefined,
};
function scopeFor(ctx: TenantRequestContext) { return ctx.user.role === "DOCTOR" ? { doctorUserId: ctx.user.id } : {}; }

export async function listLabOrders(ctx: TenantRequestContext, q: { tab?: string; q?: string; priority?: string; patientId?: string; consultationId?: string; page?: number }) {
  requireView(ctx);
  const tab = q.tab && q.tab in TABS ? q.tab : "new";
  const text = q.q?.trim().slice(0, 60);
  const page = Math.max(1, q.page ?? 1);
  const showPatientId = ctx.permissions.has("patients.identity") || ctx.permissions.has("patients.view");
  const where = {
    ...scopeFor(ctx),
    ...(TABS[tab] ? { status: { in: TABS[tab] } } : {}),
    ...(q.priority && q.priority in PRIORITY_RANK ? { priority: q.priority } : {}),
    ...(q.patientId ? { patientId: q.patientId } : {}), ...(q.consultationId ? { consultationId: q.consultationId } : {}),
    ...(text ? { OR: [{ orderNumber: containsCI(text) }, { patient: { name: containsCI(text) } }, { patient: { code: containsCI(text) } }] } : {}),
  };
  const [rows, total] = await Promise.all([
    db(ctx).investigationOrder.findMany({ where, orderBy: [{ priorityRank: "asc" }, { orderedAt: "asc" }], skip: (page - 1) * PAGE, take: PAGE, include: { patient: { select: { id: true, code: true, name: true } }, items: { select: { testNameSnapshot: true, status: true } }, report: { select: { id: true, reportNumber: true, status: true } } } }),
    db(ctx).investigationOrder.count({ where }),
  ]);
  const docIds = [...new Set(rows.map((r: { doctorUserId: string }) => r.doctorUserId))] as string[];
  const docs = docIds.length ? await db(ctx).user.findMany({ where: { id: { in: docIds } }, select: { id: true, name: true } }) : [];
  const dm = new Map<string, string>(docs.map((d: { id: string; name: string }) => [d.id, d.name]));
  return {
    page, pageSize: PAGE, total, tab,
    rows: (rows as Record<string, any>[]).map((r: Record<string, any>) => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
      id: r.id, orderNumber: r.orderNumber, priority: r.priority, status: r.status, source: r.source, orderedAt: iso(r.orderedAt), consultationId: r.consultationId,
      patient: showPatientId ? r.patient : null, doctorName: dm.get(r.doctorUserId) ?? null, tests: r.items.map((i: { testNameSnapshot: string }) => i.testNameSnapshot), testCount: r.items.length,
      report: r.report ? { id: r.report.id, reportNumber: r.report.reportNumber, status: r.report.status } : null,
    })) as LabOrderRow[],
  };
}

/** Real database counts for the lab command center. */
export async function labStats(ctx: TenantRequestContext) {
  requireView(ctx);
  const scope = scopeFor(ctx);
  const c = (extra: Record<string, unknown>) => db(ctx).investigationOrder.count({ where: { ...scope, ...extra } });
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const [newOrders, collected, processing, resultsReady, awaitingRelease, reports, urgent, completedToday, rejectedSamples] = await Promise.all([
    c({ status: { in: TABS.new } }), c({ status: { in: TABS.collected } }), c({ status: "PROCESSING" }), c({ status: "RESULT_READY" }),
    db(ctx).labReport.count({ where: { ...(ctx.user.role === "DOCTOR" ? { doctorUserId: ctx.user.id } : {}), status: { in: ["UNDER_REVIEW", "VERIFIED"] } } }),
    c({ status: { in: TABS.reports } }), c({ priority: { in: ["URGENT", "STAT"] }, status: { notIn: ["DOCTOR_REVIEWED", "CANCELLED", "REPORT_GENERATED"] } }),
    c({ status: "DOCTOR_REVIEWED", completedAt: { gte: start } }),
    ctx.user.role === "DOCTOR" ? Promise.resolve(0) : db(ctx).sample.count({ where: { status: "REJECTED", rejectedAt: { gte: start } } }),
  ]);
  const unreviewed = ctx.user.role === "DOCTOR" || ctx.permissions.has("reports.review") ? await db(ctx).labReport.count({ where: { ...(ctx.user.role === "DOCTOR" ? { doctorUserId: ctx.user.id } : {}), status: { in: ["RELEASED", "AMENDED"] }, order: { status: { not: "DOCTOR_REVIEWED" } } } }) : 0;
  return { newOrders, collected, processing, resultsReady, awaitingRelease, reports, urgent, completedToday, rejectedSamples, awaitingDoctorReview: unreviewed };
}

/* ------------------------------------------------- detail ------------------------------------------------- */
export async function loadOrderRow(ctx: TenantRequestContext, id: string) {
  const o = await db(ctx).investigationOrder.findFirst({ where: { id, ...scopeFor(ctx) }, include: { items: { orderBy: { testNameSnapshot: "asc" } }, samples: { orderBy: { collectedAt: "asc" }, include: { events: { orderBy: { at: "asc" } } } }, report: true, patient: true } });
  if (!o) throw new AppError("NOT_FOUND", { message: "Order not found." });
  return o;
}

export async function getLabOrder(ctx: TenantRequestContext, id: string): Promise<LabOrderDetail> {
  requireView(ctx);
  const o = await loadOrderRow(ctx, id);
  const released = o.report && ["RELEASED", "AMENDED"].includes(o.report.status) && o.report.currentVersion > 0;
  const seeResults = isLabStaffView(ctx) || (ctx.user.role === "DOCTOR" && released);
  const itemIds = o.items.map((i: { id: string }) => i.id);
  const results = seeResults && itemIds.length ? await db(ctx).labResultEntry.findMany({ where: { orderItemId: { in: itemIds } }, orderBy: { position: "asc" } }) : [];
  const userIds = new Set<string>([o.doctorUserId, o.createdById]);
  for (const s of o.samples) { userIds.add(s.collectedById); if (s.receivedById) userIds.add(s.receivedById); if (s.rejectedById) userIds.add(s.rejectedById); for (const e of s.events) userIds.add(e.userId); }
  const users = await db(ctx).user.findMany({ where: { id: { in: [...userIds] } }, select: { id: true, name: true } });
  const un = new Map<string, string>(users.map((u: { id: string; name: string }) => [u.id, u.name]));
  const partner = o.labPartnerId ? await db(ctx).labPartner.findFirst({ where: { id: o.labPartnerId }, select: { id: true, name: true } }) : null;
  const showPatientId = ctx.permissions.has("patients.identity") || ctx.permissions.has("patients.view");
  const p = o.patient;
  return {
    id: o.id, orderNumber: o.orderNumber, status: o.status, priority: o.priority, source: o.source, externalRef: o.externalRef, labPartner: partner,
    clinicalNotes: o.clinicalNotes, orderedAt: iso(o.orderedAt), cancelledAt: iso(o.cancelledAt), cancelReason: o.cancelReason, completedAt: iso(o.completedAt),
    consultationId: o.consultationId, doctorName: un.get(o.doctorUserId) ?? null, orderedByName: un.get(o.createdById) ?? null,
    patient: showPatientId ? { id: p.id, code: p.code, name: p.name, gender: p.gender, ageYears: p.ageYears, dateOfBirth: iso(p.dateOfBirth) } : null,
    seeResults,
    items: o.items.map((i: Record<string, any>) => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
      id: i.id, testName: i.testNameSnapshot, sampleType: i.sampleTypeSnapshot, status: i.status, resultStatus: i.resultStatus, sampleId: i.sampleId, notes: i.notes,
      snapshot: parseJson<TestSnap | null>(i.snapshot, null),
      results: results.filter((r: { orderItemId: string }) => r.orderItemId === i.id).map((r: Record<string, any>) => ({ position: r.position, parameterName: r.parameterName, value: r.value, unit: r.unit, refText: r.refText, flag: r.flag, remarks: r.remarks })), // eslint-disable-line @typescript-eslint/no-explicit-any
    })),
    samples: o.samples.map((s: Record<string, any>) => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
      id: s.id, sampleNumber: s.sampleNumber, sampleType: s.sampleType, attempt: s.attempt, previousSampleId: s.previousSampleId, status: s.status, rejectionReason: s.rejectionReason, notes: s.notes,
      collectedAt: iso(s.collectedAt), collectedBy: un.get(s.collectedById) ?? null, receivedAt: iso(s.receivedAt), receivedBy: s.receivedById ? un.get(s.receivedById) ?? null : null, rejectedAt: iso(s.rejectedAt), rejectedBy: s.rejectedById ? un.get(s.rejectedById) ?? null : null,
      events: s.events.map((e: { id: string; action: string; userId: string; department: string | null; notes: string | null; at: Date }) => ({ id: e.id, action: e.action, by: un.get(e.userId) ?? null, department: e.department, notes: e.notes, at: iso(e.at) })),
    })),
    report: o.report ? { id: o.report.id, reportNumber: o.report.reportNumber, status: o.report.status, currentVersion: o.report.currentVersion, amendReason: o.report.amendReason, generatedAt: iso(o.report.generatedAt), verifiedAt: iso(o.report.verifiedAt), releasedAt: iso(o.report.releasedAt) } : null,
    can: {
      confirm: (canCollect(ctx) || ctx.permissions.has("tests.order")) && o.status === "ORDERED",
      cancel: (ctx.user.role === "CLINIC_ADMIN" || (ctx.user.role === "DOCTOR" && o.doctorUserId === ctx.user.id)) && OPEN_BEFORE_COLLECTION.includes(o.status),
      collect: canCollect(ctx) && !["CANCELLED"].includes(o.status) && !o.report,
      process: canProcess(ctx), enterResults: ctx.permissions.has("lab.result"), review: ctx.permissions.has("lab.review"), print: ctx.permissions.has("tests.print"),
    },
  };
}

/* ------------------------------------------------- actions ------------------------------------------------- */
async function loadForAction(tx: Client, tenantId: string, id: string) {
  const o = await tx.investigationOrder.findFirst({ where: { id, tenantId }, include: { items: true } });
  if (!o) throw new AppError("NOT_FOUND", { message: "Order not found." });
  if (o.status === "CANCELLED") throw new AppError("CONFLICT", { message: "This order was cancelled." });
  return o;
}
const stale = () => new AppError("CONFLICT", { message: "Someone else just changed this. Refresh and try again." });

export async function labOrderAction(ctx: TenantRequestContext, orderId: string, raw: unknown) {
  labGuard(ctx);
  const a = parseOrThrow(labActionSchema, raw);
  const tdb = db(ctx);
  const tenantId = ctx.tenantId;
  const uid = ctx.user.id;
  // existence/scope check first so a foreign-tenant or other doctor's order answers not-found
  const base = await tdb.investigationOrder.findFirst({ where: { id: orderId, ...scopeFor(ctx) }, select: { id: true, doctorUserId: true, doctorOrderId: true, orderNumber: true, source: true, status: true } });
  if (!base) throw new AppError("NOT_FOUND", { message: "Order not found." });

  switch (a.action) {
    case "confirm": {
      if (!(canCollect(ctx) || ctx.permissions.has("tests.order"))) throw new AppError("FORBIDDEN");
      const r = await tdb.investigationOrder.updateMany({ where: { id: orderId, tenantId, status: "ORDERED" }, data: { status: "SAMPLE_PENDING" } });
      if (r.count !== 1) throw new AppError("CONFLICT", { message: "This order is already confirmed or cancelled." });
      await recordAudit({ action: AUDIT_ACTIONS.LAB_ORDER_UPDATED, tenantId, actorId: uid, entityType: "investigation_order", entityId: orderId, metadata: { change: "confirmed" } });
      return { status: "SAMPLE_PENDING" };
    }
    case "cancel": {
      const own = ctx.user.role === "DOCTOR" && base.doctorUserId === uid && ctx.permissions.has("tests.order");
      if (!own && ctx.user.role !== "CLINIC_ADMIN") throw new AppError("FORBIDDEN", { message: "Only the ordering doctor or a clinic admin can cancel an order." });
      if (!a.reason) throw new AppError("VALIDATION_ERROR", { message: "Enter a reason.", fieldErrors: { reason: "Enter a reason." } });
      await tdb.$transaction(async (tx: Client) => {
        const r = await tx.investigationOrder.updateMany({ where: { id: orderId, tenantId, status: { in: OPEN_BEFORE_COLLECTION } }, data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: a.reason } });
        if (r.count !== 1) throw new AppError("CONFLICT", { message: "A sample has already been collected, so this order can't be cancelled." });
        await tx.investigationOrderItem.updateMany({ where: { investigationOrderId: orderId, tenantId }, data: { status: "CANCELLED" } });
        await moveDoctorOrder(tx, tenantId, base.doctorOrderId, "CANCELLED", uid);
      });
      await recordAudit({ action: AUDIT_ACTIONS.LAB_ORDER_CANCELLED, tenantId, actorId: uid, entityType: "investigation_order", entityId: orderId, metadata: {} });
      return { status: "CANCELLED" };
    }
    case "collect": {
      if (!canCollect(ctx)) throw new AppError("FORBIDDEN", { message: "You can't collect samples." });
      const sampleType = a.sampleType;
      if (!sampleType) throw new AppError("VALIDATION_ERROR", { message: "Choose the sample type.", fieldErrors: { sampleType: "Choose the sample type." } });
      const yr = await year(tenantId);
      const out = await tdb.$transaction(async (tx: Client) => {
        const o = await loadForAction(tx, tenantId, orderId);
        if (await tx.labReport.findFirst({ where: { investigationOrderId: orderId, tenantId, status: { in: ["RELEASED", "AMENDED", "VERIFIED"] } }, select: { id: true } })) throw new AppError("CONFLICT", { message: "A report has already been issued for this order." });
        const norm = (t: string | null) => (t && t.trim()) || "Not specified";
        const eligible = o.items.filter((i: { sampleTypeSnapshot: string | null; status: string; id: string }) => norm(i.sampleTypeSnapshot) === sampleType && ["ORDERED", "RECOLLECTION_REQUIRED"].includes(i.status) && (!a.itemIds || a.itemIds.includes(i.id)));
        if (!eligible.length) throw new AppError("CONFLICT", { message: "No tests are waiting for this sample type. It may already be collected." });
        const prior = await tx.sample.findFirst({ where: { investigationOrderId: orderId, tenantId, sampleType }, orderBy: { attempt: "desc" }, select: { id: true, attempt: true } });
        const n = await nextCounter(tx, tenantId, `smp:${yr}`);
        const sample = await tx.sample.create({ data: { tenantId, sampleNumber: `SMP-${yr}-${pad(n)}`, barcodeToken: newToken(), investigationOrderId: orderId, sampleType, attempt: (prior?.attempt ?? 0) + 1, previousSampleId: prior?.id ?? null, collectedById: uid, notes: a.notes ?? null } });
        // claim: a concurrent collector's claim makes this count short, which rolls everything back
        const claim = await tx.investigationOrderItem.updateMany({ where: { tenantId, id: { in: eligible.map((i: { id: string }) => i.id) }, status: { in: ["ORDERED", "RECOLLECTION_REQUIRED"] } }, data: { status: "SAMPLE_COLLECTED", sampleId: sample.id } });
        if (claim.count !== eligible.length) throw new AppError("CONFLICT", { message: "Someone else just collected this sample. Refresh to see it." });
        await tx.sampleEvent.create({ data: { tenantId, sampleId: sample.id, action: "COLLECTED", userId: uid, department: a.department ?? null, notes: a.notes ?? null } });
        await moveDoctorOrder(tx, tenantId, o.doctorOrderId, "IN_PROGRESS", uid);
        await refreshOrderStatus(tx, tenantId, orderId);
        return { id: sample.id as string, sampleNumber: sample.sampleNumber as string, attempt: sample.attempt as number, tests: eligible.length };
      });
      await recordAudit({ action: AUDIT_ACTIONS.SAMPLE_COLLECTED, tenantId, actorId: uid, entityType: "sample", entityId: out.id, metadata: { orderId, attempt: out.attempt, tests: out.tests } });
      await notifyLabSample(tenantId, orderId, "collected", out.id);
      return out;
    }
    case "receive": {
      if (!canProcess(ctx)) throw new AppError("FORBIDDEN", { message: "You can't receive samples." });
      if (!a.sampleId) throw new AppError("VALIDATION_ERROR", { message: "Choose the sample.", fieldErrors: { sampleId: "Choose the sample." } });
      await tdb.$transaction(async (tx: Client) => {
        await loadForAction(tx, tenantId, orderId);
        const r = await tx.sample.updateMany({ where: { id: a.sampleId, tenantId, investigationOrderId: orderId, status: "COLLECTED" }, data: { status: "RECEIVED", receivedById: uid, receivedAt: new Date() } });
        if (r.count !== 1) throw new AppError("CONFLICT", { message: "This sample isn't waiting to be received." });
        await tx.investigationOrderItem.updateMany({ where: { tenantId, sampleId: a.sampleId, status: "SAMPLE_COLLECTED" }, data: { status: "SAMPLE_RECEIVED" } });
        await tx.sampleEvent.create({ data: { tenantId, sampleId: a.sampleId, action: "RECEIVED", userId: uid, department: a.department ?? null, notes: a.notes ?? null } });
        await refreshOrderStatus(tx, tenantId, orderId);
      });
      await recordAudit({ action: AUDIT_ACTIONS.SAMPLE_RECEIVED, tenantId, actorId: uid, entityType: "sample", entityId: a.sampleId, metadata: { orderId } });
      return { ok: true };
    }
    case "reject": {
      if (!canProcess(ctx)) throw new AppError("FORBIDDEN", { message: "You can't reject samples." });
      if (!a.sampleId) throw new AppError("VALIDATION_ERROR", { message: "Choose the sample.", fieldErrors: { sampleId: "Choose the sample." } });
      if (!a.reason) throw new AppError("VALIDATION_ERROR", { message: "Choose a rejection reason.", fieldErrors: { reason: "Choose a rejection reason." } });
      const reasons = await tdb.labConfigItem.findMany({ where: { kind: "REJECTION_REASON", active: true }, select: { name: true } });
      if (reasons.length && !reasons.some((r: { name: string }) => r.name === a.reason)) throw new AppError("VALIDATION_ERROR", { message: "Choose a reason from the list.", fieldErrors: { reason: "Choose a reason from the list." } });
      await tdb.$transaction(async (tx: Client) => {
        const o = await loadForAction(tx, tenantId, orderId);
        const affected = o.items.filter((i: { sampleId: string | null }) => i.sampleId === a.sampleId);
        if (affected.some((i: { resultStatus: string }) => !["NONE", "DRAFT"].includes(i.resultStatus))) throw new AppError("CONFLICT", { message: "Results are already submitted for this sample, so it can't be rejected." });
        const r = await tx.sample.updateMany({ where: { id: a.sampleId, tenantId, investigationOrderId: orderId, status: { in: ["COLLECTED", "RECEIVED", "PROCESSING"] } }, data: { status: "REJECTED", rejectedById: uid, rejectedAt: new Date(), rejectionReason: a.reason } });
        if (r.count !== 1) throw new AppError("CONFLICT", { message: "This sample can't be rejected now." });
        await tx.labResultEntry.deleteMany({ where: { tenantId, orderItemId: { in: affected.map((i: { id: string }) => i.id) } } });
        await tx.investigationOrderItem.updateMany({ where: { tenantId, sampleId: a.sampleId }, data: { status: "RECOLLECTION_REQUIRED", resultStatus: "NONE", sampleId: null } });
        await tx.sampleEvent.createMany({ data: [{ tenantId, sampleId: a.sampleId, action: "REJECTED", userId: uid, department: a.department ?? null, notes: a.reason }, { tenantId, sampleId: a.sampleId, action: "RECOLLECTION_REQUESTED", userId: uid, notes: a.notes ?? null }] });
        await refreshOrderStatus(tx, tenantId, orderId);
        await notify(tx, tenantId, o.doctorUserId, { type: "SAMPLE_REJECTED", title: `Sample rejected — ${o.orderNumber}`, body: "A new sample must be collected.", entityType: "investigation_order", entityId: orderId });
      });
      await recordAudit({ action: AUDIT_ACTIONS.SAMPLE_REJECTED, tenantId, actorId: uid, entityType: "sample", entityId: a.sampleId, metadata: { orderId, reason: a.reason } });
      await recordAudit({ action: AUDIT_ACTIONS.SAMPLE_RECOLLECTION, tenantId, actorId: uid, entityType: "investigation_order", entityId: orderId, metadata: { sampleId: a.sampleId } });
      await notifyLabSample(tenantId, orderId, "rejected", a.sampleId!);
      return { ok: true };
    }
    case "startProcessing": {
      if (!ctx.permissions.has("lab.result")) throw new AppError("FORBIDDEN", { message: "You can't start processing." });
      const n = await tdb.$transaction(async (tx: Client) => {
        const o = await loadForAction(tx, tenantId, orderId);
        const ids = o.items.filter((i: { status: string; id: string }) => i.status === "SAMPLE_RECEIVED" && (!a.itemIds || a.itemIds.includes(i.id))).map((i: { id: string }) => i.id);
        if (!ids.length) throw new AppError("CONFLICT", { message: "No received samples are waiting to be processed." });
        const r = await tx.investigationOrderItem.updateMany({ where: { tenantId, id: { in: ids }, status: "SAMPLE_RECEIVED" }, data: { status: "PROCESSING" } });
        if (r.count !== ids.length) throw stale();
        const sampleIds = [...new Set(o.items.filter((i: { id: string }) => ids.includes(i.id)).map((i: { sampleId: string | null }) => i.sampleId).filter(Boolean))] as string[];
        for (const sid of sampleIds) {
          await tx.sample.updateMany({ where: { id: sid, tenantId, status: "RECEIVED" }, data: { status: "PROCESSING" } });
          await tx.sampleEvent.create({ data: { tenantId, sampleId: sid, action: "PROCESSING_STARTED", userId: uid, department: a.department ?? null } });
        }
        await refreshOrderStatus(tx, tenantId, orderId);
        return ids.length;
      });
      await recordAudit({ action: AUDIT_ACTIONS.SAMPLE_PROCESSING, tenantId, actorId: uid, entityType: "investigation_order", entityId: orderId, metadata: { tests: n } });
      return { tests: n };
    }
    case "setExternalRef": {
      if (!(canProcess(ctx) || ctx.user.role === "CLINIC_ADMIN")) throw new AppError("FORBIDDEN");
      if (base.source !== "EXTERNAL") throw new AppError("CONFLICT", { message: "Only external orders have an external reference." });
      const r = await tdb.investigationOrder.updateMany({ where: { id: orderId, tenantId }, data: { externalRef: a.externalRef ?? null } });
      if (r.count !== 1) throw new AppError("NOT_FOUND");
      await recordAudit({ action: AUDIT_ACTIONS.LAB_ORDER_UPDATED, tenantId, actorId: uid, entityType: "investigation_order", entityId: orderId, metadata: { change: "external_reference" } });
      return { ok: true };
    }
    default:
      throw new AppError("VALIDATION_ERROR", { message: "That action isn't handled here." });
  }
}
