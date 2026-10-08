import "server-only";
import { notifyReportReleased } from "@/lib/notifications/events";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import type { TenantRequestContext } from "@/lib/auth/context";
import { parseJson, sha256 } from "@/lib/clinical/snapshot";
import { computeFlag, pickRange, rangeText, type TestSnap } from "@/lib/lab/core";
import { AppError } from "@/lib/errors";
import { timeInTz, todayIn, utcToZoned } from "@/lib/scheduling/time";
import { tenantDb } from "@/lib/tenant/db";
import { parseOrThrow } from "@/lib/validation";
import { labActionSchema, resultEntriesSchema, reviewSchema } from "@/lib/validation/lab";
import { ageLabel, nextCounter, tenantTimezone, type Client } from "./clinic-shared";
import { syncReminders } from "./followup-reminders";
import { labGuard } from "./lab-master";
import { isLabStaffView, moveDoctorOrder, notify, refreshOrderStatus } from "./lab-orders";

/**
 * Results → report → release → doctor review.
 *  - flags/ranges come ONLY from the test's configured reference data (snapshotted at order time); no range configured = no flag;
 *  - a report is released as an immutable, hashed version; amending reopens results and the next release is version n+1;
 *  - doctors only ever see RELEASED versions; nothing here interprets, diagnoses or suggests treatment.
 */
const db = (ctx: TenantRequestContext) => tenantDb(ctx) as Client;
const iso = (d: Date | null | undefined) => d?.toISOString() ?? null;
const pad = (n: number) => String(n).padStart(6, "0");
const stale = () => new AppError("CONFLICT", { message: "Someone else just changed this. Refresh and try again." });

function ageYearsOf(p: { dateOfBirth: Date | null; ageYears: number | null }): number | null {
  const l = ageLabel(p);
  return l ? parseInt(l, 10) : null;
}

async function loadOrder(tx: Client, tenantId: string, orderId: string, doctorScope?: string) {
  const o = await tx.investigationOrder.findFirst({ where: { id: orderId, tenantId, ...(doctorScope ? { doctorUserId: doctorScope } : {}) }, include: { items: true, report: true, patient: true } });
  if (!o) throw new AppError("NOT_FOUND", { message: "Order not found." });
  return o;
}
function needLab(ctx: TenantRequestContext) { labGuard(ctx); if (!ctx.permissions.has("tests.view")) throw new AppError("FORBIDDEN"); }

/* ------------------------------------------------- result entry ------------------------------------------------- */
export async function saveResults(ctx: TenantRequestContext, orderId: string, itemId: string, raw: unknown) {
  needLab(ctx);
  if (!ctx.permissions.has("lab.result")) throw new AppError("FORBIDDEN", { message: "You can't enter results." });
  const input = parseOrThrow(resultEntriesSchema, raw);
  const tenantId = ctx.tenantId;
  const out = await db(ctx).$transaction(async (tx: Client) => {
    const o = await loadOrder(tx, tenantId, orderId);
    if (o.status === "CANCELLED") throw new AppError("CONFLICT", { message: "This order was cancelled." });
    const item = o.items.find((i: { id: string }) => i.id === itemId);
    if (!item) throw new AppError("NOT_FOUND", { message: "Test not found on this order." });
    // a correction (report sent back, or an amendment of a released report) reopens SUBMITTED results for editing; they stay complete
    const correcting = !!o.report && ["DRAFT", "AMENDED"].includes(o.report.status) && item.resultStatus === "SUBMITTED" && item.status === "RESULT_READY";
    if (!correcting && (!["PROCESSING", "RESULT_READY"].includes(item.status) || !["NONE", "DRAFT"].includes(item.resultStatus))) throw new AppError("CONFLICT", { message: item.resultStatus === "NONE" ? "Start processing this test before entering results." : "Results for this test are already submitted. Ask a lab reviewer to send them back for correction." });
    if (correcting) input.submit = true; // corrections are always complete values
    const snap = parseJson<TestSnap | null>(item.snapshot, null);
    if (!snap) throw new AppError("INTERNAL", { message: "This test has no stored definition." });
    const gender = o.patient.gender as string | null;
    const age = ageYearsOf(o.patient);
    const existing = await tx.labResultEntry.findMany({ where: { tenantId, orderItemId: itemId } });
    const byPos = new Map<number, { id: string }>(existing.map((e: { position: number; id: string }) => [e.position, e]));
    const fieldErrors: Record<string, string> = {};
    const values = new Map<number, { value: string; remarks?: string }>();
    for (const e of input.entries) {
      const p = snap.parameters[e.position];
      if (!p) { fieldErrors[`entries.${e.position}`] = "Unknown parameter."; continue; }
      if (e.value !== "" && p.resultType === "NUMERIC" && !Number.isFinite(Number(e.value.replace(/,/g, "")))) fieldErrors[`entries.${e.position}`] = `${p.name} must be a number.`;
      values.set(e.position, { value: e.value, remarks: e.remarks });
    }
    if (input.submit) snap.parameters.forEach((p, n) => { const v = values.get(n)?.value ?? (byPos.has(n) ? existing.find((x: { position: number }) => x.position === n)?.value : ""); if (!v) fieldErrors[`entries.${n}`] = `Enter a value for ${p.name}.`; });
    if (Object.keys(fieldErrors).length) throw new AppError("VALIDATION_ERROR", { message: Object.values(fieldErrors)[0], fieldErrors });
    for (const [position, e] of values) {
      const p = snap.parameters[position];
      if (e.value === "") { if (byPos.has(position)) await tx.labResultEntry.deleteMany({ where: { tenantId, orderItemId: itemId, position } }); continue; }
      const numeric = p.resultType === "NUMERIC" ? Number(e.value.replace(/,/g, "")) : null;
      const range = p.resultType === "NUMERIC" ? pickRange(p.ranges, gender, age) : null;
      const data = { value: e.value, numericValue: numeric, unit: p.unit ?? null, refText: p.resultType === "NUMERIC" ? rangeText(range, p.unit) : null, flag: computeFlag(p, e.value, numeric, range), remarks: e.remarks ?? null, enteredById: ctx.user.id, parameterName: p.name };
      await tx.labResultEntry.upsert({ where: { orderItemId_position: { orderItemId: itemId, position } }, update: data, create: { tenantId, orderItemId: itemId, position, ...data } });
    }
    const firstEntry = existing.length === 0;
    if (input.submit) {
      const r = await tx.investigationOrderItem.updateMany({ where: { id: itemId, tenantId, resultStatus: { in: correcting ? ["SUBMITTED"] : ["NONE", "DRAFT"] } }, data: { resultStatus: "SUBMITTED", status: "RESULT_READY" } });
      if (r.count !== 1) throw stale();
      // a sample is complete once every test that used it is ready
      if (item.sampleId) {
        const open = await tx.investigationOrderItem.count({ where: { tenantId, sampleId: item.sampleId, status: { not: "RESULT_READY" } } });
        if (!open) {
          const sr = await tx.sample.updateMany({ where: { id: item.sampleId, tenantId, status: "PROCESSING" }, data: { status: "COMPLETED" } });
          if (sr.count === 1) await tx.sampleEvent.create({ data: { tenantId, sampleId: item.sampleId, action: "PROCESSING_COMPLETED", userId: ctx.user.id } });
        }
      }
    } else {
      await tx.investigationOrderItem.updateMany({ where: { id: itemId, tenantId, resultStatus: { in: ["NONE", "DRAFT"] } }, data: { resultStatus: "DRAFT" } });
    }
    await refreshOrderStatus(tx, tenantId, orderId);
    return { firstEntry, submitted: input.submit, count: values.size };
  });
  await recordAudit({ action: out.submitted ? AUDIT_ACTIONS.RESULT_SUBMITTED : out.firstEntry ? AUDIT_ACTIONS.RESULT_ENTERED : AUDIT_ACTIONS.RESULT_EDITED, tenantId, actorId: ctx.user.id, entityType: "investigation_order_item", entityId: itemId, metadata: { orderId, parameters: out.count } });
  return { submitted: out.submitted };
}

/* --------------------------------------------------- report --------------------------------------------------- */
const REPORT_ACTIONS = ["generateReport", "verify", "release", "requestCorrection", "amend"] as const;
export const isReportAction = (a: string) => (REPORT_ACTIONS as readonly string[]).includes(a);

export interface ReportSnapshot {
  reportNumber: string; version: number; orderNumber: string; orderedAt: string; releasedAt: string; priority: string; source: string; externalRef: string | null; clinicalNotes: string | null; reason: string | null;
  patient: { code: string; name: string; gender: string | null; age: string | null };
  doctorName: string; verifiedBy: string | null; releasedBy: string | null;
  samples: { sampleNumber: string; sampleType: string; collectedAt: string; receivedAt: string | null }[];
  tests: { name: string; code: string; category: string; results: { parameter: string; value: string; unit: string | null; refText: string | null; flag: string | null; remarks: string | null }[] }[];
}

export async function reportAction(ctx: TenantRequestContext, orderId: string, raw: unknown) {
  needLab(ctx);
  const a = parseOrThrow(labActionSchema, raw);
  const tdb = db(ctx);
  const tenantId = ctx.tenantId;
  const uid = ctx.user.id;
  const visible = await tdb.investigationOrder.findFirst({ where: { id: orderId, ...(ctx.user.role === "DOCTOR" ? { doctorUserId: uid } : {}) }, select: { id: true } });
  if (!visible) throw new AppError("NOT_FOUND", { message: "Order not found." });

  if (a.action === "generateReport") {
    if (!(ctx.permissions.has("lab.result") || ctx.permissions.has("lab.review"))) throw new AppError("FORBIDDEN", { message: "You can't generate reports." });
    const yr = todayIn(await tenantTimezone(tenantId)).slice(0, 4);
    const out = await tdb.$transaction(async (tx: Client) => {
      const o = await loadOrder(tx, tenantId, orderId);
      if (o.status === "CANCELLED") throw new AppError("CONFLICT", { message: "This order was cancelled." });
      const live = o.items.filter((i: { status: string }) => i.status !== "CANCELLED");
      if (!live.length || !live.every((i: { resultStatus: string; status: string }) => i.status === "RESULT_READY" && i.resultStatus === "SUBMITTED")) throw new AppError("CONFLICT", { message: "Submit results for every test before generating the report." });
      if (o.report && o.report.status !== "DRAFT") throw new AppError("CONFLICT", { message: "A report already exists for this order." });
      if (o.report) {
        const r = await tx.labReport.updateMany({ where: { id: o.report.id, tenantId, status: "DRAFT" }, data: { status: "UNDER_REVIEW", generatedById: uid, generatedAt: new Date() } });
        if (r.count !== 1) throw stale();
        await refreshOrderStatus(tx, tenantId, orderId);
        return { id: o.report.id as string, reportNumber: o.report.reportNumber as string };
      }
      const n = await nextCounter(tx, tenantId, `rpt:${yr}`);
      const rep = await tx.labReport.create({ data: { tenantId, reportNumber: `RPT-${yr}-${pad(n)}`, investigationOrderId: orderId, patientId: o.patientId, doctorUserId: o.doctorUserId, status: "UNDER_REVIEW", generatedById: uid } });
      await refreshOrderStatus(tx, tenantId, orderId);
      return { id: rep.id as string, reportNumber: rep.reportNumber as string };
    });
    await recordAudit({ action: AUDIT_ACTIONS.REPORT_GENERATED, tenantId, actorId: uid, entityType: "lab_report", entityId: out.id, metadata: { orderId, reportNumber: out.reportNumber } });
    return out;
  }

  if (!ctx.permissions.has("lab.review")) throw new AppError("FORBIDDEN", { message: "Only a lab reviewer can do this." });

  if (a.action === "verify") {
    const id = await tdb.$transaction(async (tx: Client) => {
      const o = await loadOrder(tx, tenantId, orderId);
      if (!o.report) throw new AppError("CONFLICT", { message: "Generate the report first." });
      const r = await tx.labReport.updateMany({ where: { id: o.report.id, tenantId, status: { in: ["UNDER_REVIEW", "AMENDED"] } }, data: { status: "VERIFIED", verifiedById: uid, verifiedAt: new Date() } });
      if (r.count !== 1) throw new AppError("CONFLICT", { message: "This report isn't waiting for verification." });
      const live = o.items.filter((i: { status: string }) => i.status !== "CANCELLED");
      if (live.some((i: { resultStatus: string }) => i.resultStatus !== "SUBMITTED")) throw new AppError("CONFLICT", { message: "Every test must have submitted results before verification." });
      await tx.investigationOrderItem.updateMany({ where: { tenantId, investigationOrderId: orderId, status: { not: "CANCELLED" } }, data: { resultStatus: "VERIFIED" } });
      return o.report.id as string;
    });
    await recordAudit({ action: AUDIT_ACTIONS.RESULT_VERIFIED, tenantId, actorId: uid, entityType: "lab_report", entityId: id, metadata: { orderId } });
    return { status: "VERIFIED" };
  }

  if (a.action === "release") {
    const out = await tdb.$transaction(async (tx: Client) => {
      const o = await loadOrder(tx, tenantId, orderId);
      if (!o.report) throw new AppError("CONFLICT", { message: "Generate the report first." });
      const version = o.report.currentVersion + 1;
      const r = await tx.labReport.updateMany({ where: { id: o.report.id, tenantId, status: "VERIFIED", currentVersion: o.report.currentVersion }, data: { status: "RELEASED", currentVersion: version, releasedById: uid, releasedAt: new Date(), amendReason: null } });
      if (r.count !== 1) throw new AppError("CONFLICT", { message: "This report isn't verified, or was just released." });
      const snap = await buildSnapshot(tx, tenantId, o, version, version > 1 ? o.report.amendReason : null);
      await tx.labReportVersion.create({ data: { tenantId, reportId: o.report.id, version, snapshot: JSON.stringify(snap), contentHash: sha256(JSON.stringify(snap)), reason: snap.reason, createdById: uid } });
      await tx.investigationOrderItem.updateMany({ where: { tenantId, investigationOrderId: orderId, status: { not: "CANCELLED" } }, data: { resultStatus: "RELEASED" } });
      await moveDoctorOrder(tx, tenantId, o.doctorOrderId, "COMPLETED", uid);
      await refreshOrderStatus(tx, tenantId, orderId);
      await notify(tx, tenantId, o.doctorUserId, { type: "REPORT_RELEASED", title: `${version > 1 ? "Amended report" : "Report"} ready — ${o.orderNumber}`, body: "Open the report to review it.", entityType: "lab_report", entityId: o.report.id });
      return { id: o.report.id as string, version, reportNumber: o.report.reportNumber as string };
    });
    await recordAudit({ action: out.version > 1 ? AUDIT_ACTIONS.REPORT_AMENDED : AUDIT_ACTIONS.REPORT_RELEASED, tenantId, actorId: uid, entityType: "lab_report", entityId: out.id, metadata: { orderId, version: out.version } });
    await notifyReportReleased(tenantId, out.id);
    return out;
  }

  if (a.action === "requestCorrection") {
    if (!a.reason) throw new AppError("VALIDATION_ERROR", { message: "Enter a reason.", fieldErrors: { reason: "Enter a reason." } });
    await tdb.$transaction(async (tx: Client) => {
      const o = await loadOrder(tx, tenantId, orderId);
      if (!o.report) throw new AppError("CONFLICT", { message: "There is no report to correct." });
      const r = await tx.labReport.updateMany({ where: { id: o.report.id, tenantId, status: { in: ["UNDER_REVIEW", "VERIFIED"] } }, data: { status: "DRAFT", verifiedById: null, verifiedAt: null } });
      if (r.count !== 1) throw new AppError("CONFLICT", { message: "Only a report that has not been released can be sent back." });
      await tx.investigationOrderItem.updateMany({ where: { tenantId, investigationOrderId: orderId, status: { not: "CANCELLED" } }, data: { resultStatus: "SUBMITTED" } });
      await refreshOrderStatus(tx, tenantId, orderId);
    });
    await recordAudit({ action: AUDIT_ACTIONS.REPORT_CORRECTION, tenantId, actorId: uid, entityType: "investigation_order", entityId: orderId, metadata: { reason: a.reason } });
    return { status: "DRAFT" };
  }

  // amend a RELEASED report: results reopen, the released version stays visible and unchanged until the next release
  if (!a.reason) throw new AppError("VALIDATION_ERROR", { message: "Enter the reason for the amendment.", fieldErrors: { reason: "Enter the reason for the amendment." } });
  await tdb.$transaction(async (tx: Client) => {
    const o = await loadOrder(tx, tenantId, orderId);
    if (!o.report || o.report.currentVersion < 1) throw new AppError("CONFLICT", { message: "Only a released report can be amended." });
    const r = await tx.labReport.updateMany({ where: { id: o.report.id, tenantId, status: "RELEASED" }, data: { status: "AMENDED", amendReason: a.reason, verifiedById: null, verifiedAt: null } });
    if (r.count !== 1) throw new AppError("CONFLICT", { message: "This report is already being amended." });
    await tx.investigationOrderItem.updateMany({ where: { tenantId, investigationOrderId: orderId, status: { not: "CANCELLED" } }, data: { resultStatus: "SUBMITTED" } });
    await refreshOrderStatus(tx, tenantId, orderId);
  });
  await recordAudit({ action: AUDIT_ACTIONS.REPORT_AMENDED, tenantId, actorId: uid, entityType: "investigation_order", entityId: orderId, metadata: { stage: "reopened", reason: a.reason } });
  return { status: "AMENDED" };
}

async function buildSnapshot(tx: Client, tenantId: string, o: Record<string, any>, version: number, reason: string | null): Promise<ReportSnapshot> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const items = o.items.filter((i: { status: string }) => i.status !== "CANCELLED");
  const entries = await tx.labResultEntry.findMany({ where: { tenantId, orderItemId: { in: items.map((i: { id: string }) => i.id) } }, orderBy: { position: "asc" } });
  const samples = await tx.sample.findMany({ where: { investigationOrderId: o.id, tenantId, status: { not: "REJECTED" } }, orderBy: { collectedAt: "asc" } });
  const rel = await tx.labReport.findFirst({ where: { id: o.report.id, tenantId }, select: { releasedAt: true, releasedById: true, verifiedById: true } });
  const users = await tx.user.findMany({ where: { id: { in: [o.doctorUserId, rel?.verifiedById, rel?.releasedById].filter(Boolean) } }, select: { id: true, name: true } });
  const nm = (id: string | null) => users.find((u: { id: string }) => u.id === id)?.name ?? null;
  const relName = nm(rel?.releasedById ?? null);
  return {
    reportNumber: o.report.reportNumber, version, orderNumber: o.orderNumber, orderedAt: o.orderedAt.toISOString(), releasedAt: (rel?.releasedAt ?? new Date()).toISOString(), priority: o.priority, source: o.source, externalRef: o.externalRef ?? null, clinicalNotes: o.clinicalNotes ?? null, reason,
    patient: { code: o.patient.code, name: o.patient.name, gender: o.patient.gender ?? null, age: ageLabel(o.patient) },
    doctorName: nm(o.doctorUserId) ?? "", verifiedBy: nm(rel?.verifiedById ?? null), releasedBy: relName,
    samples: samples.map((s: { sampleNumber: string; sampleType: string; collectedAt: Date; receivedAt: Date | null }) => ({ sampleNumber: s.sampleNumber, sampleType: s.sampleType, collectedAt: s.collectedAt.toISOString(), receivedAt: iso(s.receivedAt) })),
    tests: items.map((i: { id: string; snapshot: string; testNameSnapshot: string }) => { const s = parseJson<TestSnap | null>(i.snapshot, null); return { name: i.testNameSnapshot, code: s?.code ?? "", category: s?.category ?? "", results: entries.filter((e: { orderItemId: string }) => e.orderItemId === i.id).map((e: { parameterName: string; value: string; unit: string | null; refText: string | null; flag: string | null; remarks: string | null }) => ({ parameter: e.parameterName, value: e.value, unit: e.unit, refText: e.refText, flag: e.flag, remarks: e.remarks })) }; }),
  };
}

/* ------------------------------------------------ doctor review ------------------------------------------------ */
export async function reviewReport(ctx: TenantRequestContext, reportId: string, raw: unknown) {
  needLab(ctx);
  if (ctx.user.role !== "DOCTOR" || !(ctx.permissions.has("reports.review") || ctx.permissions.has("reports.view"))) throw new AppError("FORBIDDEN", { message: "Only doctors review reports." });
  const input = parseOrThrow(reviewSchema, raw);
  const tenantId = ctx.tenantId;
  const rep = await db(ctx).labReport.findFirst({ where: { id: reportId, doctorUserId: ctx.user.id } });
  if (!rep) throw new AppError("NOT_FOUND", { message: "Report not found." });
  if (rep.currentVersion < 1) throw new AppError("CONFLICT", { message: "This report has not been released yet." });
  await db(ctx).$transaction(async (tx: Client) => {
    const where = { reportId, version: rep.currentVersion, doctorUserId: ctx.user.id };
    const ex = await tx.labReportReview.findFirst({ where: { tenantId, ...where } });
    if (ex && ex.status === "REVIEWED") throw new AppError("CONFLICT", { message: "You already reviewed this version." });
    if (ex) await tx.labReportReview.updateMany({ where: { id: ex.id, tenantId }, data: { status: input.status, note: input.note ?? null, at: new Date() } });
    else await tx.labReportReview.create({ data: { tenantId, ...where, status: input.status, note: input.note ?? null } });
    await refreshOrderStatus(tx, tenantId, rep.investigationOrderId);
  });
  await recordAudit({ action: AUDIT_ACTIONS.REPORT_REVIEWED, tenantId, actorId: ctx.user.id, entityType: "lab_report", entityId: reportId, metadata: { version: rep.currentVersion, status: input.status } });
  return { status: input.status, version: rep.currentVersion as number };
}

/* ------------------------------------------------ report views ------------------------------------------------ */
/** Released report for viewing/printing (authenticated, tenant-checked). Doctors: own orders only. Reception/nursing never get results. */
export async function labReportDocument(ctx: TenantRequestContext, reportId: string, version?: number) {
  needLab(ctx);
  const own = ctx.user.role === "DOCTOR";
  if (!own && !isLabStaffView(ctx)) throw new AppError("FORBIDDEN");
  const rep = await db(ctx).labReport.findFirst({ where: { id: reportId, ...(own ? { doctorUserId: ctx.user.id } : {}) }, include: { versions: { orderBy: { version: "desc" } }, reviews: { where: own ? { doctorUserId: ctx.user.id } : {} } } });
  if (!rep || !rep.versions.length) throw new AppError("NOT_FOUND", { message: "There is no released report yet." });
  const v = version ? rep.versions.find((x: { version: number }) => x.version === version) : rep.versions[0];
  if (!v) throw new AppError("NOT_FOUND", { message: "That report version doesn't exist." });
  const t = ctx.tenant;
  return {
    id: rep.id as string, orderId: rep.investigationOrderId as string, status: rep.status as string, snapshot: parseJson<ReportSnapshot>(v.snapshot, null as never), version: v.version as number, latestVersion: rep.versions[0].version as number, hash: (v.contentHash as string).slice(0, 12),
    versions: rep.versions.map((x: { version: number; createdAt: Date; reason: string | null }) => ({ version: x.version, createdAt: x.createdAt.toISOString(), reason: x.reason })),
    review: rep.reviews.find((r: { version: number }) => r.version === v.version) ? (() => { const r = rep.reviews.find((x: { version: number }) => x.version === v.version); return { status: r.status as string, note: r.note as string | null, at: r.at.toISOString() }; })() : null,
    canReview: own && v.version === rep.versions[0].version,
    clinic: { name: t.name, legalName: t.legalName, logoUrl: t.logoUrl, address: [t.address, t.city, t.state, t.pincode].filter(Boolean).join(", "), phone: t.contactPhone, email: t.contactEmail, color: t.brand.primary },
    generatedAt: `${utcToZoned(new Date(), t.timezone).date} ${timeInTz(new Date(), t.timezone)}`,
  };
}
export type LabReportDoc = Awaited<ReturnType<typeof labReportDocument>>;

export async function recordReportAccess(ctx: TenantRequestContext, reportId: string, kind: "VIEWED" | "PRINTED" | "DOWNLOADED", version: number) {
  const doc = await labReportDocument(ctx, reportId, version);
  const action = kind === "VIEWED" ? AUDIT_ACTIONS.REPORT_VIEWED_DOC : kind === "DOWNLOADED" ? AUDIT_ACTIONS.REPORT_DOWNLOADED : AUDIT_ACTIONS.REPORT_VIEWED_DOC;
  await recordAudit({ action, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "lab_report", entityId: reportId, metadata: { reportNumber: doc.snapshot.reportNumber, version, access: kind.toLowerCase() } });
  return { recorded: true };
}

/** Reports for one patient (Patient 360). Released versions only. */
export async function patientLabReports(ctx: TenantRequestContext, patientId: string) {
  needLab(ctx);
  const own = ctx.user.role === "DOCTOR";
  if (!own && !isLabStaffView(ctx)) throw new AppError("FORBIDDEN");
  const orders = await db(ctx).investigationOrder.findMany({ where: { patientId, ...(own ? { doctorUserId: ctx.user.id } : {}) }, orderBy: { orderedAt: "desc" }, take: 50, include: { items: { select: { testNameSnapshot: true } }, report: { select: { id: true, reportNumber: true, status: true, currentVersion: true, releasedAt: true } } } });
  return orders.map((o: Record<string, any>) => ({ id: o.id, orderNumber: o.orderNumber, status: o.status, priority: o.priority, orderedAt: iso(o.orderedAt), tests: o.items.map((i: { testNameSnapshot: string }) => i.testNameSnapshot), report: o.report && o.report.currentVersion > 0 ? { id: o.report.id, reportNumber: o.report.reportNumber, status: o.report.status, version: o.report.currentVersion, releasedAt: iso(o.report.releasedAt) } : null })); // eslint-disable-line @typescript-eslint/no-explicit-any
}

/* ------------------------------------------------ notifications ------------------------------------------------ */
export interface NotificationView { id: string; type: string; title: string; body: string | null; entityType: string | null; entityId: string | null; read: boolean; createdAt: string | null }
export async function listNotifications(ctx: TenantRequestContext): Promise<{ unread: number; items: NotificationView[] }> {
  await syncReminders(ctx).catch(() => undefined); // in-app reminders, created lazily
  const rows = await db(ctx).notification.findMany({ where: { userId: ctx.user.id }, orderBy: { createdAt: "desc" }, take: 20 });
  const unread = await db(ctx).notification.count({ where: { userId: ctx.user.id, readAt: null } });
  return { unread, items: rows.map((n: Record<string, any>) => ({ id: n.id, type: n.type, title: n.title, body: n.body, entityType: n.entityType, entityId: n.entityId, read: !!n.readAt, createdAt: iso(n.createdAt) })) }; // eslint-disable-line @typescript-eslint/no-explicit-any
}
export async function markNotificationsRead(ctx: TenantRequestContext, id?: string) {
  await db(ctx).notification.updateMany({ where: { userId: ctx.user.id, readAt: null, ...(id ? { id } : {}) }, data: { readAt: new Date() } });
  return { ok: true };
}

/* ---------------------------------------------- slip and label ---------------------------------------------- */
export async function labSlipDocument(ctx: TenantRequestContext, orderId: string) {
  labGuard(ctx);
  if (!ctx.permissions.has("tests.print")) throw new AppError("FORBIDDEN");
  const o = await db(ctx).investigationOrder.findFirst({ where: { id: orderId, ...(ctx.user.role === "DOCTOR" ? { doctorUserId: ctx.user.id } : {}) }, include: { items: true, patient: true } });
  if (!o) throw new AppError("NOT_FOUND", { message: "Order not found." });
  const doc = await db(ctx).user.findFirst({ where: { id: o.doctorUserId }, select: { name: true } });
  const t = ctx.tenant;
  return {
    orderNumber: o.orderNumber as string, orderedAt: o.orderedAt.toISOString().slice(0, 16).replace("T", " "), priority: o.priority as string, source: o.source as string, clinicalNotes: o.clinicalNotes as string | null, doctorName: (doc?.name ?? "") as string,
    patient: { code: o.patient.code as string, name: o.patient.name as string, gender: (o.patient.gender ?? null) as string | null, age: ageLabel(o.patient) },
    tests: o.items.filter((i: { status: string }) => i.status !== "CANCELLED").map((i: { testNameSnapshot: string; sampleTypeSnapshot: string | null; snapshot: string }) => ({ name: i.testNameSnapshot, sampleType: i.sampleTypeSnapshot, preparation: parseJson<TestSnap | null>(i.snapshot, null)?.preparation ?? null })) as { name: string; sampleType: string | null; preparation: string | null }[],
    clinic: { name: t.name, logoUrl: t.logoUrl, address: [t.address, t.city, t.state, t.pincode].filter(Boolean).join(", "), phone: t.contactPhone, email: t.contactEmail, color: t.brand.primary },
  };
}
export type LabSlipDoc = Awaited<ReturnType<typeof labSlipDocument>>;

export async function sampleLabelDocument(ctx: TenantRequestContext, sampleId: string) {
  labGuard(ctx);
  if (!ctx.permissions.has("tests.print")) throw new AppError("FORBIDDEN");
  const s = await db(ctx).sample.findFirst({ where: { id: sampleId }, include: { order: { include: { patient: true } } } });
  if (!s) throw new AppError("NOT_FOUND", { message: "Sample not found." });
  if (ctx.user.role === "DOCTOR" && s.order.doctorUserId !== ctx.user.id) throw new AppError("NOT_FOUND", { message: "Sample not found." });
  const t = ctx.tenant;
  return {
    sampleNumber: s.sampleNumber as string, barcodeToken: s.barcodeToken as string, sampleType: s.sampleType as string, attempt: s.attempt as number, collectedAt: s.collectedAt.toISOString().slice(0, 16).replace("T", " "), orderNumber: s.order.orderNumber as string, priority: s.order.priority as string,
    patient: { code: s.order.patient.code as string, name: s.order.patient.name as string, gender: (s.order.patient.gender ?? null) as string | null, age: ageLabel(s.order.patient) },
    clinic: { name: t.name, color: t.brand.primary },
  };
}
export type SampleLabelDoc = Awaited<ReturnType<typeof sampleLabelDocument>>;
export async function recordSlipLabelAccess(ctx: TenantRequestContext, kind: "SLIP" | "LABEL", id: string) {
  if (kind === "SLIP") await labSlipDocument(ctx, id); else await sampleLabelDocument(ctx, id);
  await recordAudit({ action: kind === "SLIP" ? AUDIT_ACTIONS.SLIP_PRINTED : AUDIT_ACTIONS.LABEL_PRINTED, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: kind === "SLIP" ? "investigation_order" : "sample", entityId: id, metadata: {} });
  return { recorded: true };
}
