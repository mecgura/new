import "server-only";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import type { TenantRequestContext } from "@/lib/auth/context";
import { nextRecallDate } from "@/lib/followups/core";
import { AppError } from "@/lib/errors";
import { todayIn } from "@/lib/scheduling/time";
import { tenantDb } from "@/lib/tenant/db";
import { parseOrThrow } from "@/lib/validation";
import { recallActionSchema, recallCreateSchema } from "@/lib/validation/followups";
import { tenantTimezone, type Client } from "./clinic-shared";
import { fuGuard, insertFollowUp, loadSettings } from "./followups";
import { containsCI } from "./shared";

/**
 * Recalls: planned future reminders. Recurrence is explicit and bounded (maxOccurrences, at most 12): the NEXT occurrence is created only when
 * staff complete a recall with "schedule next", never automatically, so no unlimited future records exist. A recall becomes a follow-up task
 * only when staff create it, or when the clinic switched on "recall creates a follow-up" (which runs when the list is opened).
 */
const db = (ctx: TenantRequestContext) => tenantDb(ctx) as Client;
const guard = (ctx: TenantRequestContext) => { fuGuard(ctx); if (!ctx.permissions.has("recalls.manage")) throw new AppError("FORBIDDEN"); };
const scope = (ctx: TenantRequestContext): Record<string, unknown> => (ctx.user.role === "DOCTOR" ? { OR: [{ doctorUserId: ctx.user.id }, { createdById: ctx.user.id }] } : {});
const year = async (tenantId: string) => todayIn(await tenantTimezone(tenantId)).slice(0, 4);

export async function createRecall(ctx: TenantRequestContext, raw: unknown) {
  guard(ctx);
  const v = parseOrThrow(recallCreateSchema, raw);
  const tdb = db(ctx);
  const p = await tdb.patient.findFirst({ where: { id: v.patientId }, select: { id: true, status: true } });
  if (!p) throw new AppError("NOT_FOUND", { message: "Patient not found." });
  if (p.status === "ARCHIVED") throw new AppError("CONFLICT", { message: "This patient record is archived." });
  if (v.doctorUserId && !(await tdb.user.findFirst({ where: { id: v.doctorUserId, role: { key: "DOCTOR" }, deletedAt: null }, select: { id: true } }))) throw new AppError("VALIDATION_ERROR", { message: "Choose a doctor from this clinic.", fieldErrors: { doctorUserId: "Choose a doctor from this clinic." } });
  const today = todayIn(await tenantTimezone(ctx.tenantId));
  if (v.dueDate < today) throw new AppError("VALIDATION_ERROR", { message: "Choose today or a later date.", fieldErrors: { dueDate: "Choose today or a later date." } });
  const r = await tdb.recall.create({ data: { tenantId: ctx.tenantId, patientId: v.patientId, doctorUserId: v.doctorUserId ?? (ctx.user.role === "DOCTOR" ? ctx.user.id : null), type: v.type, title: v.title, dueDate: v.dueDate, frequency: v.frequency, customMonths: v.frequency === "CUSTOM" ? v.customMonths : null, maxOccurrences: v.frequency === "ONE_TIME" ? 1 : v.maxOccurrences ?? 1, notes: v.notes ?? null, createdById: ctx.user.id } });
  await recordAudit({ action: AUDIT_ACTIONS.RECALL_CREATED, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "recall", entityId: r.id, metadata: { frequency: v.frequency, type: v.type } });
  return { id: r.id as string };
}

/** Clinic rule "recall creates a follow-up": only when switched on, one follow-up per occurrence (dedupe key). */
async function materialize(ctx: TenantRequestContext) {
  const tdb = db(ctx);
  if (!(await loadSettings(tdb, ctx.tenantId)).recallCreatesFollowUp) return;
  const today = todayIn(await tenantTimezone(ctx.tenantId));
  const due = await tdb.recall.findMany({ where: { status: "ACTIVE", dueDate: { lte: today } }, take: 50 });
  for (const r of due as { id: string; patientId: string; doctorUserId: string | null; title: string; dueDate: string; occurrence: number; type: string }[]) await makeFollowUp(ctx, r, "RULE");
}
async function makeFollowUp(ctx: TenantRequestContext, r: { id: string; patientId: string; doctorUserId: string | null; title: string; dueDate: string; occurrence: number; type: string }, by: "STAFF" | "RULE") {
  const tdb = db(ctx); const yr = await year(ctx.tenantId);
  const today = todayIn(await tenantTimezone(ctx.tenantId));
  const fu = await tdb.$transaction(async (tx: Client) => {
    const row = await insertFollowUp(tx, ctx.tenantId, { patientId: r.patientId, doctorUserId: r.doctorUserId, recallId: r.id, type: "ROUTINE_RECALL", title: r.title, description: "Planned patient recall.", dueDate: r.dueDate < today ? today : r.dueDate, source: "RECALL", dedupeKey: `recall:${r.id}:${r.occurrence}`, createdById: ctx.user.id }, yr, null);
    const existing = row ?? (await tx.followUp.findFirst({ where: { tenantId: ctx.tenantId, dedupeKey: `recall:${r.id}:${r.occurrence}` }, select: { id: true, followUpNumber: true, patientId: true } }));
    if (existing) await tx.recall.updateMany({ where: { id: r.id, tenantId: ctx.tenantId, status: "ACTIVE" }, data: { status: "FOLLOW_UP_CREATED", followUpId: existing.id } });
    return { row, existing };
  });
  if (fu.row) await recordAudit({ action: AUDIT_ACTIONS.FOLLOWUP_CREATED, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "followup", entityId: fu.row.id, metadata: { number: fu.row.followUpNumber, type: "ROUTINE_RECALL", source: by === "RULE" ? "RULE" : "RECALL", priority: "NORMAL", assigned: false } });
  return fu.existing as { id: string; followUpNumber: string } | null;
}

export async function listRecalls(ctx: TenantRequestContext, q: { status?: string; q?: string; patientId?: string; page?: number }) {
  guard(ctx); await materialize(ctx);
  const tdb = db(ctx); const page = Math.max(1, q.page ?? 1); const today = todayIn(await tenantTimezone(ctx.tenantId));
  const text = q.q?.trim().slice(0, 60);
  const and: Record<string, unknown>[] = [scope(ctx), q.status === "all" ? {} : { status: q.status && ["ACTIVE", "FOLLOW_UP_CREATED", "COMPLETED", "CANCELLED"].includes(q.status) ? q.status : { in: ["ACTIVE", "FOLLOW_UP_CREATED"] } }];
  if (q.patientId) and.push({ patientId: q.patientId });
  if (text) and.push({ OR: [{ title: containsCI(text) }, { patient: { name: containsCI(text) } }, { patient: { code: containsCI(text) } }] });
  const where = { AND: and };
  const [rows, total] = await Promise.all([tdb.recall.findMany({ where, orderBy: [{ dueDate: "asc" }], skip: (page - 1) * 20, take: 20, include: { patient: { select: { id: true, code: true, name: true } } } }), tdb.recall.count({ where })]);
  return { page, pageSize: 20, total, today, rows: rows.map((r: Record<string, any>) => ({ id: r.id, title: r.title, type: r.type, dueDate: r.dueDate, frequency: r.frequency, occurrence: r.occurrence, maxOccurrences: r.maxOccurrences, status: r.status, followUpId: r.followUpId, due: r.status === "ACTIVE" && r.dueDate <= today, patient: { id: r.patient.id, code: r.patient.code, name: r.patient.name } })) }; // eslint-disable-line @typescript-eslint/no-explicit-any
}

export async function recallAction(ctx: TenantRequestContext, id: string, raw: unknown) {
  guard(ctx);
  const a = parseOrThrow(recallActionSchema, raw);
  const tdb = db(ctx);
  const r = await tdb.recall.findFirst({ where: { AND: [{ id }, scope(ctx)] } });
  if (!r) throw new AppError("NOT_FOUND", { message: "Recall not found." });
  if (r.status === "COMPLETED" || r.status === "CANCELLED") throw new AppError("CONFLICT", { message: "This recall is already closed." });
  if (a.action === "createFollowUp") {
    if (!ctx.permissions.has("followups.create")) throw new AppError("FORBIDDEN");
    if (r.status !== "ACTIVE") throw new AppError("CONFLICT", { message: "A follow-up was already created for this recall." });
    const fu = await makeFollowUp(ctx, r, "STAFF");
    return { followUpId: fu?.id ?? null };
  }
  if (a.action === "cancel") {
    const u = await tdb.recall.updateMany({ where: { id, tenantId: ctx.tenantId, status: r.status }, data: { status: "CANCELLED" } });
    if (u.count !== 1) throw new AppError("CONFLICT", { message: "This recall was just changed. Refresh and try again." });
    await recordAudit({ action: AUDIT_ACTIONS.RECALL_UPDATED, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "recall", entityId: id, metadata: { change: "cancelled" } });
    return { status: "CANCELLED" };
  }
  // complete (optionally scheduling the NEXT occurrence — explicit, bounded by maxOccurrences)
  let nextDue: string | null = null;
  if (a.scheduleNext) {
    if (r.frequency === "ONE_TIME" || r.occurrence >= r.maxOccurrences) throw new AppError("CONFLICT", { message: "This recall has no more occurrences." });
    nextDue = nextRecallDate(r.dueDate, r.frequency, r.customMonths);
    if (!nextDue) throw new AppError("CONFLICT", { message: "This recall doesn't repeat." });
    const today = todayIn(await tenantTimezone(ctx.tenantId));
    while (nextDue < today) nextDue = nextRecallDate(nextDue, r.frequency, r.customMonths)!; // never create a recall already in the past
  }
  const next = await tdb.$transaction(async (tx: Client) => {
    const u = await tx.recall.updateMany({ where: { id, tenantId: ctx.tenantId, status: r.status }, data: { status: "COMPLETED" } });
    if (u.count !== 1) throw new AppError("CONFLICT", { message: "This recall was just changed. Refresh and try again." });
    if (!nextDue) return null;
    return tx.recall.create({ data: { tenantId: ctx.tenantId, patientId: r.patientId, doctorUserId: r.doctorUserId, type: r.type, title: r.title, dueDate: nextDue, frequency: r.frequency, customMonths: r.customMonths, maxOccurrences: r.maxOccurrences, occurrence: r.occurrence + 1, notes: r.notes, createdById: ctx.user.id } });
  });
  await recordAudit({ action: AUDIT_ACTIONS.RECALL_UPDATED, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "recall", entityId: id, metadata: { change: "completed", next: next?.id ?? null } });
  return { status: "COMPLETED", nextId: (next?.id ?? null) as string | null };
}
