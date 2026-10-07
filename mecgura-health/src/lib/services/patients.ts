import "server-only";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import type { TenantRequestContext } from "@/lib/auth/context";
import { AppError } from "@/lib/errors";
import { rateLimit } from "@/lib/security/rate-limit";
import { tenantDb } from "@/lib/tenant/db";
import { parseOrThrow } from "@/lib/validation";
import { phone } from "@/lib/validation/fields";
import { patientSearchSchema, patientRefSchema, type NewPatientInput, type PatientRef } from "@/lib/validation/scheduling";
import { ageLabel, isUniqueViolation, maskPhone, nextCounter, type Client } from "./clinic-shared";
import { containsCI } from "./shared";

/**
 * MINIMAL patient registry for the front desk (identity only). Full patient records are Phase 4.
 * Staff never open a patient by id alone: linking an existing patient needs verification, search results are masked,
 * and every lookup is tenant-scoped (another clinic's patient simply doesn't exist for the caller).
 */
const canUseRegistry = (ctx: TenantRequestContext) => ["patients.create", "patients.edit", "appointments.create", "opd.manage"].some((p) => ctx.permissions.has(p as never));
const guard = (ctx: TenantRequestContext) => { if (!canUseRegistry(ctx)) throw new AppError("FORBIDDEN"); };

export interface PatientCard { id: string; code: string; name: string; gender: string | null; age: string | null; phoneMasked: string }
const card = (p: { id: string; code: string; name: string; gender: string | null; phone: string | null; dateOfBirth: Date | null; ageYears: number | null }): PatientCard => ({ id: p.id, code: p.code, name: p.name, gender: p.gender, age: ageLabel(p), phoneMasked: maskPhone(p.phone) });
const select = { id: true, code: true, name: true, gender: true, phone: true, dateOfBirth: true, ageYears: true } as const;

export async function searchPatients(ctx: TenantRequestContext, raw: unknown): Promise<PatientCard[]> {
  guard(ctx);
  const { q } = parseOrThrow(patientSearchSchema, raw);
  const limited = await rateLimit(`psearch:${ctx.user.id}`, { limit: 60, windowMs: 60_000 });
  if (!limited.allowed) throw new AppError("RATE_LIMITED");
  const digits = q.replace(/\D/g, "");
  const or: object[] = [{ name: containsCI(q) }, { code: containsCI(q) }];
  if (digits.length >= 4) or.push({ phone: { contains: digits.length === 10 ? `+91${digits}` : digits } });
  const rows = await tenantDb(ctx).patient.findMany({ where: { OR: or, status: { not: "ARCHIVED" } }, orderBy: { name: "asc" }, take: 10, select });
  return rows.map(card);
}

/** Returns the patient only if the verification matches; failures are throttled so ids/phones can't be probed. */
export async function verifyPatient(ctx: TenantRequestContext, patientId: string, v: { phoneLast4?: string; dateOfBirth?: string; code?: string }) {
  guard(ctx);
  const p = await tenantDb(ctx).patient.findFirst({ where: { id: patientId }, select: { ...select, email: true, status: true } });
  if (!p) throw new AppError("NOT_FOUND", { message: "Patient not found." });
  if (p.status === "ARCHIVED") throw new AppError("CONFLICT", { message: "This patient record is archived. Ask a clinic admin to restore it first." });
  const ok =
    (v.phoneLast4 && p.phone && p.phone.slice(-4) === v.phoneLast4) ||
    (v.dateOfBirth && p.dateOfBirth && p.dateOfBirth.toISOString().slice(0, 10) === v.dateOfBirth) ||
    (v.code && p.code.toLowerCase() === v.code.toLowerCase());
  if (!ok) {
    const t = await rateLimit(`pverify:${ctx.user.id}`, { limit: 10, windowMs: 15 * 60_000 });
    throw new AppError(t.allowed ? "FORBIDDEN" : "RATE_LIMITED", { message: t.allowed ? "Verification failed. Check the details with the patient." : undefined });
  }
  return p;
}

export async function findDuplicates(ctx: TenantRequestContext, input: { phone?: string | null; email?: string | null; name?: string; dateOfBirth?: string | null }): Promise<PatientCard[]> {
  const or: object[] = [];
  if (input.phone) or.push({ phone: input.phone }, { alternatePhone: input.phone });
  if (input.email) or.push({ email: input.email.toLowerCase() });
  if (input.name && input.dateOfBirth) or.push({ AND: [{ name: containsCI(input.name.trim()) }, { dateOfBirth: new Date(`${input.dateOfBirth}T00:00:00Z`) }] });
  if (!or.length) return [];
  return (await tenantDb(ctx).patient.findMany({ where: { OR: or }, take: 5, select })).map(card);
}

export async function checkDuplicates(ctx: TenantRequestContext, raw: unknown) {
  guard(ctx);
  const b = (raw ?? {}) as { phone?: string; email?: string; name?: string; dateOfBirth?: string };
  const normalized = b.phone ? phone.safeParse(b.phone) : null;
  return findDuplicates(ctx, { phone: normalized?.success ? normalized.data : null, email: typeof b.email === "string" && b.email.includes("@") ? b.email.trim() : null, name: b.name, dateOfBirth: b.dateOfBirth || null });
}

export async function createPatient(ctx: TenantRequestContext, input: NewPatientInput, opts: { allowDuplicate?: boolean; client?: Client } = {}) {
  if (!ctx.permissions.has("patients.create")) throw new AppError("FORBIDDEN");
  const dupes = await findDuplicates(ctx, { phone: input.phone, name: input.name, dateOfBirth: input.dateOfBirth });
  if (dupes.length && !opts.allowDuplicate) {
    throw new AppError("CONFLICT", { message: "Possible existing patient found. Review the matches or confirm this is a new patient.", fieldErrors: { _duplicates: dupes.map((d) => `${d.code} · ${d.name}`).join(", ") } });
  }
  const tdb = opts.client ?? tenantDb(ctx);
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const create = async (tx: Client) => {
        const n = await nextCounter(tx, ctx.tenantId, "patient");
        return tx.patient.create({
          data: { code: `P-${String(n).padStart(6, "0")}`, name: input.name, phone: input.phone, email: input.email ?? null, gender: input.gender ?? null, dateOfBirth: input.dateOfBirth ? new Date(`${input.dateOfBirth}T00:00:00Z`) : null, ageYears: input.dateOfBirth ? null : (input.ageYears ?? null), createdById: ctx.user.id },
          select,
        });
      };
      const p = opts.client ? await create(opts.client) : await tdb.$transaction(create);
      await recordAudit({ action: AUDIT_ACTIONS.PATIENT_REGISTERED, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "patient", entityId: p.id, metadata: { code: p.code, duplicateConfirmed: dupes.length > 0 } });
      return p as Awaited<ReturnType<typeof create>>;
    } catch (e) {
      if (!isUniqueViolation(e) || attempt === 4) throw e;
    }
  }
  throw new AppError("INTERNAL");
}

/** Turns "existing (verified) or new patient" from a request into a patient row belonging to THIS clinic. */
export async function resolvePatientRef(ctx: TenantRequestContext, rawRef: unknown) {
  const ref: PatientRef = parseOrThrow(patientRefSchema, rawRef);
  if ("viaProfile" in ref) {
    if (!ctx.permissions.has("patients.view")) throw new AppError("FORBIDDEN");
    const p = await tenantDb(ctx).patient.findFirst({ where: { id: ref.patientId }, select: { ...select, status: true } });
    if (!p) throw new AppError("NOT_FOUND", { message: "Patient not found." });
    if (p.status === "ARCHIVED") throw new AppError("CONFLICT", { message: "This patient record is archived. Ask a clinic admin to restore it first." });
    return p;
  }
  if ("patientId" in ref) return verifyPatient(ctx, ref.patientId, ref.verification);
  return createPatient(ctx, ref.newPatient, { allowDuplicate: ref.allowDuplicate });
}
