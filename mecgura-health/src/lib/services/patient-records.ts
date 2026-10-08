import "server-only";
import type { z } from "zod";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import type { TenantRequestContext } from "@/lib/auth/context";
import { AppError } from "@/lib/errors";
import { tenantDb } from "@/lib/tenant/db";
import { parseOrThrow } from "@/lib/validation";
import { allergySchema, consentSchema, familyHistorySchema, familyLinkSchema, historySchema, medicationSchema, noteSchema } from "@/lib/validation/patients";
import { hasClinical, loadPatient, loadWritablePatient } from "./patient-crm";
import type { Client } from "./clinic-shared";

/**
 * Patient file records. They only STORE what staff enter — nothing here diagnoses, infers or recommends.
 * Reading clinical kinds needs patients.clinical, writing needs patients.clinical_edit. Notes are tiered by kind.
 */
type Kind = "allergies" | "medications" | "history" | "family-history" | "notes" | "consents";
export const RECORD_KINDS: readonly Kind[] = ["allergies", "medications", "history", "family-history", "notes", "consents"];

const CFG = {
  allergies: { model: "patientAllergy", schema: allergySchema, clinical: true, order: { recordedAt: "desc" as const } },
  medications: { model: "patientMedication", schema: medicationSchema, clinical: true, order: { recordedAt: "desc" as const } },
  history: { model: "patientHistory", schema: historySchema, clinical: true, order: { recordedAt: "desc" as const } },
  "family-history": { model: "patientFamilyHistory", schema: familyHistorySchema, clinical: true, order: { recordedAt: "desc" as const } },
} as const;

export const isKind = (k: string): k is Kind => (RECORD_KINDS as readonly string[]).includes(k);
const db = (ctx: TenantRequestContext) => tenantDb(ctx) as Client;

const view = <T extends { recordedAt?: Date; createdAt?: Date; updatedAt?: Date; tenantId?: string; patientId?: string; recordedById?: string | null }>(r: T) => {
  const { tenantId: _t, patientId: _p, recordedById: _r, ...rest } = r; void _t; void _p; void _r;
  return { ...rest, recordedAt: r.recordedAt?.toISOString(), createdAt: r.createdAt?.toISOString(), updatedAt: r.updatedAt?.toISOString() };
};

function readableNoteKinds(ctx: TenantRequestContext): string[] {
  const k = ["GENERAL", "RECEPTION"];
  if (hasClinical(ctx)) k.push("CLINICAL");
  return k;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type RecordItem = Record<string, any>;
export async function listRecords(ctx: TenantRequestContext, patientId: string, kind: Kind): Promise<{ items: RecordItem[]; canWrite: boolean | string[] }> {
  if (kind === "notes") {
    await loadPatient(ctx, patientId, "view");
    const rows = await db(ctx).patientNote.findMany({ where: { patientId, kind: { in: readableNoteKinds(ctx) } }, orderBy: { createdAt: "desc" }, take: 100 });
    const authors = await db(ctx).user.findMany({ where: { id: { in: [...new Set(rows.map((r: { authorId: string }) => r.authorId))] } }, select: { id: true, name: true } });
    const names = new Map(authors.map((a: { id: string; name: string }) => [a.id, a.name]));
    return { items: rows.map((r: { id: string; kind: string; content: string; authorId: string; authorRole: string; createdAt: Date }) => ({ id: r.id, kind: r.kind, content: r.content, author: names.get(r.authorId) ?? "Staff member", authorRole: r.authorRole, createdAt: r.createdAt.toISOString() })), canWrite: [...(ctx.permissions.has("patients.edit") || ctx.permissions.has("patients.clinical_edit") ? ["GENERAL", "RECEPTION"] : []), ...(ctx.permissions.has("patients.clinical_edit") ? ["CLINICAL"] : [])] };
  }
  if (kind === "consents") {
    await loadPatient(ctx, patientId, "view");
    const rows = await db(ctx).patientConsent.findMany({ where: { patientId }, orderBy: { recordedAt: "desc" }, take: 100 });
    return { items: rows.map(view), canWrite: ctx.permissions.has("patients.edit") };
  }
  await loadPatient(ctx, patientId, "clinical");
  const c = CFG[kind];
  const rows = await db(ctx)[c.model].findMany({ where: { patientId }, orderBy: c.order, take: 200 });
  return { items: rows.map(view), canWrite: ctx.permissions.has("patients.clinical_edit") };
}

export async function createRecord(ctx: TenantRequestContext, patientId: string, kind: Kind, raw: unknown) {
  const audit = (action: Parameters<typeof recordAudit>[0]["action"], id: string, metadata: Record<string, unknown>) =>
    recordAudit({ action, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "patient", entityId: patientId, metadata: { kind, recordId: id, ...metadata } });

  if (kind === "notes") {
    const input = parseOrThrow(noteSchema, raw);
    const clinicalNote = input.kind === "CLINICAL";
    if (clinicalNote ? !ctx.permissions.has("patients.clinical_edit") : !(ctx.permissions.has("patients.edit") || ctx.permissions.has("patients.clinical_edit"))) throw new AppError("FORBIDDEN");
    await loadWritablePatient(ctx, patientId, clinicalNote ? "clinical" : "view");
    const n = await db(ctx).patientNote.create({ data: { tenantId: ctx.tenantId, patientId, kind: input.kind, content: input.content, authorId: ctx.user.id, authorRole: ctx.user.role } });
    await audit(AUDIT_ACTIONS.PATIENT_NOTE_ADDED, n.id, { noteKind: input.kind }); // never the note text
    return { id: n.id };
  }
  if (kind === "consents") {
    if (!ctx.permissions.has("patients.edit")) throw new AppError("FORBIDDEN");
    const input = parseOrThrow(consentSchema, raw);
    await loadWritablePatient(ctx, patientId, "view");
    const c = await db(ctx).patientConsent.create({ data: { tenantId: ctx.tenantId, patientId, type: input.type, status: input.status, version: input.version, note: input.note ?? null, recordedById: ctx.user.id } });
    await recordAudit({ action: AUDIT_ACTIONS.PATIENT_CONSENT_RECORDED, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "patient", entityId: patientId, metadata: { type: input.type, status: input.status, version: input.version } });
    return { id: c.id };
  }
  if (!ctx.permissions.has("patients.clinical_edit")) throw new AppError("FORBIDDEN");
  await loadWritablePatient(ctx, patientId, "clinical");
  const c = CFG[kind];
  const input = parseOrThrow(c.schema as z.ZodType, raw) as Record<string, unknown>;
  const row = await db(ctx)[c.model].create({ data: { ...input, tenantId: ctx.tenantId, patientId, recordedById: ctx.user.id } });
  await audit(AUDIT_ACTIONS.PATIENT_RECORD_ADDED, row.id, {});
  return { id: row.id };
}

export async function updateRecord(ctx: TenantRequestContext, patientId: string, kind: Kind, recordId: string, raw: unknown) {
  if (kind === "notes" || kind === "consents") throw new AppError("VALIDATION_ERROR", { message: kind === "notes" ? "Notes can't be edited. Add a new note instead." : "Consent history can't be edited. Record a new consent decision." });
  if (!ctx.permissions.has("patients.clinical_edit")) throw new AppError("FORBIDDEN");
  await loadWritablePatient(ctx, patientId, "clinical");
  const c = CFG[kind];
  const input = parseOrThrow(c.schema as z.ZodType, raw) as Record<string, unknown>;
  const res = await db(ctx)[c.model].updateMany({ where: { id: recordId, patientId }, data: input });
  if (res.count !== 1) throw new AppError("NOT_FOUND");
  await recordAudit({ action: AUDIT_ACTIONS.PATIENT_RECORD_UPDATED, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "patient", entityId: patientId, metadata: { kind, recordId, fields: Object.keys(input) } });
  return { updated: true };
}

/* --------------------------------- family grouping --------------------------------- */
export interface FamilyMember { id: string; code: string; name: string; familyRelation: string | null; status: string }
export async function getFamily(ctx: TenantRequestContext, patientId: string): Promise<{ relation: string | null; members: FamilyMember[]; canEdit: boolean }> {
  const p = await loadPatient(ctx, patientId, "view");
  const members = p.familyGroupId ? await db(ctx).patient.findMany({ where: { familyGroupId: p.familyGroupId, id: { not: patientId } }, select: { id: true, code: true, name: true, familyRelation: true, status: true }, orderBy: { name: "asc" } }) : [];
  return { relation: p.familyRelation, members, canEdit: ctx.permissions.has("patients.edit") };
}

/** Links two patients of this clinic into a household. Records stay separate; this only records "these people are related". */
export async function linkFamily(ctx: TenantRequestContext, patientId: string, raw: unknown) {
  if (!ctx.permissions.has("patients.edit")) throw new AppError("FORBIDDEN");
  const input = parseOrThrow(familyLinkSchema, raw);
  if (input.otherPatientId === patientId) throw new AppError("VALIDATION_ERROR", { message: "Choose a different patient." });
  const me = await loadWritablePatient(ctx, patientId);
  const other = await loadWritablePatient(ctx, input.otherPatientId); // tenant-scoped: another clinic's patient is NOT_FOUND
  if (me.familyGroupId && other.familyGroupId && me.familyGroupId !== other.familyGroupId) throw new AppError("CONFLICT", { message: "These patients already belong to different family groups. Remove one from its group first." });
  const groupId = me.familyGroupId ?? other.familyGroupId ?? (await db(ctx).familyGroup.create({ data: { tenantId: ctx.tenantId } })).id;
  await db(ctx).$transaction(async (tx: Client) => {
    await tx.patient.updateMany({ where: { id: other.id }, data: { familyGroupId: groupId, familyRelation: input.relation ?? other.familyRelation } });
    if (!me.familyGroupId) await tx.patient.updateMany({ where: { id: me.id }, data: { familyGroupId: groupId } });
  });
  await recordAudit({ action: AUDIT_ACTIONS.PATIENT_FAMILY_CHANGED, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "patient", entityId: patientId, metadata: { change: "linked", otherPatientId: other.id } });
  return { linked: true };
}

export async function unlinkFamily(ctx: TenantRequestContext, patientId: string) {
  if (!ctx.permissions.has("patients.edit")) throw new AppError("FORBIDDEN");
  const p = await loadWritablePatient(ctx, patientId);
  if (!p.familyGroupId) throw new AppError("CONFLICT", { message: "This patient isn't in a family group." });
  const groupId = p.familyGroupId;
  await db(ctx).$transaction(async (tx: Client) => {
    await tx.patient.updateMany({ where: { id: patientId }, data: { familyGroupId: null, familyRelation: null } });
    const left = await tx.patient.findMany({ where: { familyGroupId: groupId }, select: { id: true } });
    if (left.length <= 1) {
      await tx.patient.updateMany({ where: { familyGroupId: groupId }, data: { familyGroupId: null, familyRelation: null } });
      await tx.familyGroup.deleteMany({ where: { id: groupId } });
    }
  });
  await recordAudit({ action: AUDIT_ACTIONS.PATIENT_FAMILY_CHANGED, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "patient", entityId: patientId, metadata: { change: "unlinked" } });
  return { unlinked: true };
}
