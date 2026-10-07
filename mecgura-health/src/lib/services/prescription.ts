import "server-only";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import type { TenantRequestContext } from "@/lib/auth/context";
import { parseJson, sha256, type PrescriptionSnapshot } from "@/lib/clinical/snapshot";
import { AppError } from "@/lib/errors";
import { rateLimit } from "@/lib/security/rate-limit";
import { timeInTz, todayIn, utcToZoned } from "@/lib/scheduling/time";
import { tenantDb } from "@/lib/tenant/db";
import { parseOrThrow } from "@/lib/validation";
import { prescriptionActionSchema, prescriptionSaveSchema } from "@/lib/validation/clinical";
import { ageLabel, nextCounter, tenantTimezone, type Client } from "./clinic-shared";

/**
 * Prescription lifecycle: DRAFT -> REVIEW -> FINALIZED (doctor's explicit confirmation). A finalized prescription is never edited:
 * "amend" reopens it as a draft with a reason, and finalizing again writes version n+1. Every version is an immutable snapshot
 * (with a content hash) — the print/download always shows exactly what the doctor approved. Medicines are typed or picked by the
 * doctor; nothing here suggests, checks or changes a medicine, dose or duration.
 */
const db = (ctx: TenantRequestContext) => tenantDb(ctx) as Client;
const owner = (ctx: TenantRequestContext, doctorUserId: string) => ctx.user.role === "DOCTOR" && ctx.user.id === doctorUserId;
const guard = (ctx: TenantRequestContext) => { if (ctx.user.role === "SUPER_ADMIN") throw new AppError("FORBIDDEN", { message: "Platform administrators don't open clinic clinical records." }); };
const locked = "This prescription is finalized. Use “Amend” (with a reason) to create a new version — the original stays on record.";

const itemData = (i: Record<string, unknown>, tenantId: string, prescriptionId: string, position: number) => ({
  tenantId, prescriptionId, position, name: i.name as string, genericName: (i.genericName as string) ?? null, brandName: (i.brandName as string) ?? null, strength: (i.strength as string) ?? null,
  dose: (i.dose as string) ?? null, route: (i.route as string) ?? null, frequency: (i.frequency as string) ?? null, morning: !!i.morning, afternoon: !!i.afternoon, evening: !!i.evening, night: !!i.night,
  foodTiming: (i.foodTiming as string) ?? null, durationDays: (i.durationDays as number) ?? null, quantity: (i.quantity as number) ?? null, quantityUnit: (i.quantityUnit as string) ?? null,
  startDate: (i.startDate as string) ?? null, endDate: (i.endDate as string) ?? null, instructions: (i.instructions as string) ?? null, medicineRefId: (i.medicineRefId as string) ?? null,
});
const itemView = (i: Record<string, unknown>) => { const { tenantId: _t, prescriptionId: _p, ...rest } = i; void _t; void _p; return rest; };

/** Summary for the consultation screen (caller already authorized to read the consultation). */
export interface PrescriptionSummary { id: string; number: string | null; status: "DRAFT" | "REVIEW" | "FINALIZED"; currentVersion: number; amendReason: string | null; finalizedAt: string | null; items: Record<string, unknown>[]; versions: { version: number; createdAt: string; reason: string | null; hash: string }[] }
export async function prescriptionSummary(ctx: TenantRequestContext, consultationId: string, withItems: boolean): Promise<PrescriptionSummary | null> {
  const rx = await db(ctx).prescription.findFirst({ where: { consultationId }, include: { items: { orderBy: { position: "asc" } }, versions: { orderBy: { version: "desc" }, select: { version: true, createdAt: true, reason: true, createdById: true, contentHash: true } } } });
  if (!rx) return null;
  return {
    id: rx.id as string, number: rx.number as string | null, status: rx.status as "DRAFT" | "REVIEW" | "FINALIZED", currentVersion: rx.currentVersion as number, amendReason: rx.amendReason as string | null,
    finalizedAt: rx.finalizedAt ? (rx.finalizedAt as Date).toISOString() : null, items: withItems ? rx.items.map(itemView) : [],
    versions: rx.versions.map((v: { version: number; createdAt: Date; reason: string | null; contentHash: string }) => ({ version: v.version, createdAt: v.createdAt.toISOString(), reason: v.reason, hash: v.contentHash.slice(0, 12) })),
  };
}

async function loadWritable(ctx: TenantRequestContext, consultationId: string) {
  guard(ctx);
  if (ctx.user.role !== "DOCTOR" || !(ctx.permissions.has("prescription.create") || ctx.permissions.has("prescription.edit"))) throw new AppError("FORBIDDEN", { message: "Only the treating doctor can change a prescription." });
  const c = await db(ctx).consultation.findFirst({ where: { id: consultationId }, select: { id: true, number: true, status: true, patientId: true, doctorUserId: true } });
  if (!c) throw new AppError("NOT_FOUND", { message: "Consultation not found." });
  if (!owner(ctx, c.doctorUserId)) throw new AppError("FORBIDDEN", { message: "Only the treating doctor can change this prescription." });
  if (c.status === "CANCELLED") throw new AppError("CONFLICT", { message: "This consultation was cancelled." });
  const rx = await db(ctx).prescription.findFirst({ where: { consultationId } });
  if (rx?.status === "FINALIZED") throw new AppError("CONFLICT", { message: locked });
  // a finalized consultation's prescription can only be edited while it is being amended (rx exists and is not FINALIZED)
  if (c.status === "FINALIZED" && !rx) throw new AppError("CONFLICT", { message: "This consultation is finalized. Amend it before adding a prescription." });
  return { c, rx };
}

export async function savePrescriptionDraft(ctx: TenantRequestContext, consultationId: string, raw: unknown) {
  const { c, rx } = await loadWritable(ctx, consultationId);
  const input = parseOrThrow(prescriptionSaveSchema, raw);
  let created = false;
  const id = await db(ctx).$transaction(async (tx: Client) => {
    let rid = rx?.id as string | undefined;
    if (!rid) { rid = (await tx.prescription.create({ data: { tenantId: ctx.tenantId, consultationId, patientId: c.patientId, doctorUserId: ctx.user.id } })).id; created = true; }
    await tx.prescriptionItem.deleteMany({ where: { prescriptionId: rid } });
    if (input.items.length) await tx.prescriptionItem.createMany({ data: input.items.map((i, n) => itemData(i, ctx.tenantId, rid!, n)) });
    await tx.prescription.updateMany({ where: { id: rid, status: { in: ["DRAFT", "REVIEW"] } }, data: { status: "DRAFT" } }); // editing sends a reviewed draft back to draft
    return rid;
  });
  if (created) await recordAudit({ action: AUDIT_ACTIONS.PRESCRIPTION_CREATED, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "prescription", entityId: id, metadata: { consultationId } });
  else if ((await rateLimit(`rxaudit:${id}`, { limit: 1, windowMs: 5 * 60_000 })).allowed) await recordAudit({ action: AUDIT_ACTIONS.PRESCRIPTION_EDITED, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "prescription", entityId: id, metadata: { items: input.items.length } });
  return { id: id as string, items: input.items.length };
}

/**
 * Finalizes inside the caller's transaction. `soft` (used when the consultation is finalized) skips silently when there is
 * nothing to finalize; the standalone route is strict.
 */
export async function finalizePrescriptionTx(ctx: TenantRequestContext, tx: Client, consultationId: string, o: { requireReview: boolean; tz: string; reason?: string; soft?: boolean }) {
  const rx = await tx.prescription.findFirst({ where: { consultationId } });
  const skip = (msg: string, code: "CONFLICT" | "VALIDATION_ERROR" = "CONFLICT") => { if (o.soft) return null; throw new AppError(code, { message: msg }); };
  if (!rx) return skip("There is no prescription to finalize.");
  if (rx.status === "FINALIZED") return skip(locked);
  const items = await tx.prescriptionItem.findMany({ where: { prescriptionId: rx.id }, orderBy: { position: "asc" } });
  if (!items.length) return skip("Add at least one medicine before finalizing.", "VALIDATION_ERROR");
  if (o.requireReview && rx.status !== "REVIEW") return skip("Review the prescription before finalizing it.");
  const version = rx.currentVersion + 1;
  const reason = rx.amendReason ?? o.reason;
  if (version > 1 && !reason) throw new AppError("VALIDATION_ERROR", { message: "Give a reason for this amendment.", fieldErrors: { reason: "Give a reason for this amendment." } });
  const year = todayIn(o.tz).slice(0, 4);
  const number = rx.number ?? `RX-${year}-${String((await nextCounter(tx, ctx.tenantId, `rx:${year}`))).padStart(6, "0")}`;
  const now = new Date();
  const res = await tx.prescription.updateMany({ where: { id: rx.id, status: rx.status, currentVersion: rx.currentVersion }, data: { status: "FINALIZED", currentVersion: version, number, finalizedAt: now, finalizedById: ctx.user.id, amendReason: null } });
  if (res.count !== 1) throw new AppError("CONFLICT", { message: "This prescription was just finalized or changed by someone else." }); // double submit loses here
  const [cons, doc, diagnoses] = await Promise.all([
    tx.consultation.findFirst({ where: { id: consultationId }, include: { patient: true } }),
    tx.doctorProfile.findFirst({ where: { userId: rx.doctorUserId } }),
    tx.consultationDiagnosis.findMany({ where: { consultationId }, orderBy: [{ type: "asc" }, { createdAt: "asc" }] }),
  ]);
  const doctorUser = await tx.user.findFirst({ where: { id: rx.doctorUserId }, select: { name: true } });
  const snap: PrescriptionSnapshot = {
    number, version, finalizedAt: now.toISOString(), reason: reason ?? null,
    doctor: { name: doctorUser?.name ?? "Doctor", qualification: doc?.qualification ?? null, specialization: doc?.specialization ?? null, registrationNumber: doc?.registrationNumber ?? null },
    patient: { code: cons.patient.code, name: cons.patient.name, age: ageLabel(cons.patient), gender: cons.patient.gender, phone: cons.patient.phone },
    consultation: { number: cons.number, date: utcToZoned(cons.startedAt, o.tz).date },
    diagnoses: diagnoses.map((d: { name: string; code: string | null; type: string }) => ({ name: d.name, code: d.code, type: d.type })),
    items: items.map((i: Record<string, unknown>) => { const { id: _i, tenantId: _t, prescriptionId: _p, position: _pos, medicineRefId: _m, ...rest } = i; void _i; void _t; void _p; void _pos; void _m; return rest as never; }),
    advice: cons.advice, followUp: { required: cons.followUpRequired, afterDays: cons.followUpAfterDays, date: cons.followUpDate, notes: cons.followUpNotes },
  };
  const json = JSON.stringify(snap);
  await tx.prescriptionVersion.create({ data: { tenantId: ctx.tenantId, prescriptionId: rx.id, version, snapshot: json, contentHash: sha256(json), reason: reason ?? null, createdById: ctx.user.id } });
  return { id: rx.id as string, number, version };
}

export async function prescriptionAction(ctx: TenantRequestContext, consultationId: string, raw: unknown) {
  const input = parseOrThrow(prescriptionActionSchema, raw);
  guard(ctx);
  const tz = await tenantTimezone(ctx.tenantId);
  if (input.action === "amend") {
    if (ctx.user.role !== "DOCTOR" || !ctx.permissions.has("prescription.finalize")) throw new AppError("FORBIDDEN");
    const c = await db(ctx).consultation.findFirst({ where: { id: consultationId }, select: { doctorUserId: true } });
    if (!c) throw new AppError("NOT_FOUND", { message: "Consultation not found." });
    if (!owner(ctx, c.doctorUserId)) throw new AppError("FORBIDDEN", { message: "Only the treating doctor can amend this prescription." });
    if (!input.reason || input.reason.length < 3) throw new AppError("VALIDATION_ERROR", { message: "Give a reason for the amendment.", fieldErrors: { reason: "Give a reason for the amendment." } });
    const r = await db(ctx).prescription.updateMany({ where: { consultationId, status: "FINALIZED" }, data: { status: "DRAFT", amendReason: input.reason } });
    if (r.count !== 1) throw new AppError("CONFLICT", { message: "Only a finalized prescription can be amended." });
    const rx = await db(ctx).prescription.findFirst({ where: { consultationId }, select: { id: true, currentVersion: true } });
    await recordAudit({ action: AUDIT_ACTIONS.PRESCRIPTION_AMENDED, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "prescription", entityId: rx.id, metadata: { fromVersion: rx.currentVersion } });
    return { status: "DRAFT" };
  }
  const { rx } = await loadWritable(ctx, consultationId);
  if (!rx) throw new AppError("VALIDATION_ERROR", { message: "Add medicines first." });
  if (!ctx.permissions.has("prescription.finalize") && input.action !== "edit") throw new AppError("FORBIDDEN");
  if (input.action === "edit") { const r = await db(ctx).prescription.updateMany({ where: { id: rx.id, status: "REVIEW" }, data: { status: "DRAFT" } }); if (r.count !== 1) throw new AppError("CONFLICT", { message: "Nothing to edit." }); return { status: "DRAFT" }; }
  if (input.action === "review") {
    if (!(await db(ctx).prescriptionItem.count({ where: { prescriptionId: rx.id } }))) throw new AppError("VALIDATION_ERROR", { message: "Add at least one medicine before review." });
    const r = await db(ctx).prescription.updateMany({ where: { id: rx.id, status: "DRAFT" }, data: { status: "REVIEW" } });
    if (r.count !== 1) throw new AppError("CONFLICT", { message: "This prescription is already in review." });
    await recordAudit({ action: AUDIT_ACTIONS.PRESCRIPTION_REVIEWED, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "prescription", entityId: rx.id });
    return { status: "REVIEW" };
  }
  // finalize
  if (input.confirm !== true) throw new AppError("VALIDATION_ERROR", { message: "Confirm “Finalize prescription” to approve it.", fieldErrors: { confirm: "Please confirm." } });
  const out = await db(ctx).$transaction((tx: Client) => finalizePrescriptionTx(ctx, tx, consultationId, { requireReview: true, tz, reason: input.reason }));
  await recordAudit({ action: AUDIT_ACTIONS.PRESCRIPTION_FINALIZED, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "prescription", entityId: out!.id, metadata: { number: out!.number, version: out!.version, consultationId } });
  return { status: "FINALIZED", number: out!.number, version: out!.version };
}

/* ------------------------------------------------ document ------------------------------------------------ */
/** Finalized prescription for printing. Authenticated, tenant-checked, never public. Uses the CURRENT clinic branding with the SNAPSHOT content. */
export async function prescriptionDocument(ctx: TenantRequestContext, consultationId: string, version?: number) {
  guard(ctx);
  if (!ctx.permissions.has("prescription.print")) throw new AppError("FORBIDDEN");
  const rx = await db(ctx).prescription.findFirst({ where: { consultationId }, include: { versions: { orderBy: { version: "desc" } } } });
  if (!rx || !rx.versions.length) throw new AppError("NOT_FOUND", { message: "There is no finalized prescription for this consultation yet." });
  const v = version ? rx.versions.find((x: { version: number }) => x.version === version) : rx.versions[0];
  if (!v) throw new AppError("NOT_FOUND", { message: "That prescription version doesn't exist." });
  const t = ctx.tenant;
  return {
    snapshot: parseJson<PrescriptionSnapshot>(v.snapshot, null as never), version: v.version as number, latestVersion: rx.versions[0].version as number, hash: (v.contentHash as string).slice(0, 12),
    versions: rx.versions.map((x: { version: number; createdAt: Date; reason: string | null }) => ({ version: x.version, createdAt: x.createdAt.toISOString(), reason: x.reason })),
    clinic: { name: t.name, legalName: t.legalName, logoUrl: t.logoUrl, address: [t.address, t.city, t.state, t.pincode].filter(Boolean).join(", "), phone: t.contactPhone, email: t.contactEmail, color: t.brand.primary },
    generatedAt: `${utcToZoned(new Date(), t.timezone).date} ${timeInTz(new Date(), t.timezone)}`,
  };
}
export type PrescriptionDoc = Awaited<ReturnType<typeof prescriptionDocument>>;

export async function recordPrescriptionAccess(ctx: TenantRequestContext, consultationId: string, kind: "PRINTED" | "DOWNLOADED", version: number) {
  const doc = await prescriptionDocument(ctx, consultationId, version); // re-checks permission, tenant and that the version exists
  const rx = await db(ctx).prescription.findFirst({ where: { consultationId }, select: { id: true } });
  await recordAudit({ action: kind === "PRINTED" ? AUDIT_ACTIONS.PRESCRIPTION_PRINTED : AUDIT_ACTIONS.PRESCRIPTION_DOWNLOADED, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "prescription", entityId: rx.id, metadata: { number: doc.snapshot.number, version } });
  return { recorded: true };
}
