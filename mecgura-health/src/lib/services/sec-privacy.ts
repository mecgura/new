import "server-only";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import type { TenantRequestContext } from "@/lib/auth/context";
import { AppError } from "@/lib/errors";
import type { PatientContext } from "@/lib/portal/ctx";
import { todayIn } from "@/lib/scheduling/time";
import { rateLimit } from "@/lib/security/rate-limit";
import { tenantDb } from "@/lib/tenant/db";
import { nextCounter, type Client } from "./clinic-shared";
import { isUnderHold } from "./sec-audit";
import { exportPatient } from "./patient-crm";
import { securityEvent } from "./sec-events";

const tdb = (ctx: { tenantId: string }) => tenantDb(ctx) as Client;
const pad = (n: number) => String(n).padStart(6, "0");
export const RIGHTS_KINDS = { DATA_ACCESS: "Access to my data", DATA_EXPORT: "A copy of my data", CONSENT_WITHDRAWAL: "Withdraw my consent", ERASURE: "Erase my data", RESTRICTION: "Restrict how my data is used", GRIEVANCE: "Grievance / complaint" } as const;
export type RightsKind = keyof typeof RIGHTS_KINDS;
export const OUTCOMES = ["FULFILLED", "PARTIALLY_FULFILLED", "RETENTION_EXCEPTION", "LEGAL_HOLD", "NOT_APPLICABLE"] as const;
const RESPONSE_DAYS = 30;

/* -------------------------------------------------------------------- consents -------------------------------------------------------------------- */
export const CONSENT_TYPES = ["PRIVACY", "COMMUNICATION", "DATA_PROCESSING", "WHATSAPP", "SMS", "EMAIL", "MARKETING", "DOCUMENT_SHARING", "PORTAL"] as const;
/** Records a consent decision. Each type is independent: agreeing to appointment reminders (COMMUNICATION / transactional) never grants MARKETING. History is never edited — a new row supersedes the old. */
export async function recordConsent(ctx: TenantRequestContext, patientId: string, i: { type?: string; status?: string; version?: string; purpose?: string; source?: string; note?: string }) {
  if (!ctx.permissions.has("privacy.manage") && !ctx.permissions.has("patients.edit")) throw new AppError("FORBIDDEN");
  if (!(CONSENT_TYPES as readonly string[]).includes(i.type ?? "")) throw new AppError("VALIDATION_ERROR", { fieldErrors: { type: "Choose a consent type." } });
  if (i.status !== "GRANTED" && i.status !== "WITHDRAWN") throw new AppError("VALIDATION_ERROR", { fieldErrors: { status: "Granted or withdrawn." } });
  const version = (i.version ?? "").trim().slice(0, 40); if (!version) throw new AppError("VALIDATION_ERROR", { fieldErrors: { version: "Enter the notice / policy version the patient agreed to." } });
  const p = await tdb(ctx).patient.findFirst({ where: { id: patientId }, select: { id: true } }); if (!p) throw new AppError("NOT_FOUND");
  const { getRequestMeta } = await import("@/lib/security/request"); const meta = await getRequestMeta().catch(() => ({ ip: null }));
  const row = await tdb(ctx).patientConsent.create({ data: { tenantId: ctx.tenantId, patientId, type: i.type, status: i.status, version, note: i.note?.slice(0, 300) ?? null, recordedById: ctx.user.id, purpose: i.purpose === "MARKETING" || i.purpose === "TRANSACTIONAL" ? i.purpose : null, source: ["STAFF", "PORTAL", "WEBSITE", "IMPORT"].includes(i.source ?? "") ? i.source : "STAFF", ip: meta.ip } });
  await recordAudit({ action: AUDIT_ACTIONS.PRIVACY_CONSENT_RECORDED, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "patient", entityId: patientId, metadata: { type: i.type, status: i.status, version } });
  return { id: row.id as string };
}
/** Latest decision per consent type (and purpose). */
export async function consentState(ctx: TenantRequestContext, patientId: string) {
  if (!ctx.permissions.has("privacy.manage") && !ctx.permissions.has("patients.view")) throw new AppError("FORBIDDEN");
  const rows = (await tdb(ctx).patientConsent.findMany({ where: { patientId }, orderBy: { recordedAt: "desc" }, take: 300 })) as { type: string; purpose: string | null; status: string; version: string; recordedAt: Date; source: string | null }[];
  const seen = new Set<string>(); const latest = rows.filter((r) => { const k = `${r.type}:${r.purpose ?? ""}`; if (seen.has(k)) return false; seen.add(k); return true; });
  return { current: latest, history: rows.slice(0, 50) };
}

/* ----------------------------------------------------------- data-rights requests (patient side) ----------------------------------------------------------- */
export async function submitRightsRequest(ctx: PatientContext, raw: { kind?: string; reason?: string }) {
  if (!(raw.kind && raw.kind in RIGHTS_KINDS)) throw new AppError("VALIDATION_ERROR", { fieldErrors: { kind: "Choose a request type." } });
  const reason = (raw.reason ?? "").trim(); if (reason.length < 3 || reason.length > 500) throw new AppError("VALIDATION_ERROR", { fieldErrors: { reason: "Tell the clinic briefly what you need (3–500 characters)." } });
  const lim = await rateLimit(`rights:${ctx.user.id}`, { limit: 5, windowMs: 60 * 60_000 }); if (!lim.allowed) throw new AppError("RATE_LIMITED");
  const open = await tdb(ctx).patientRequest.count({ where: { patientId: ctx.patientId, kind: raw.kind, status: { in: ["PENDING", "UNDER_REVIEW"] } } }); if (open) throw new AppError("CONFLICT", { message: "You already have an open request of this kind." });
  const yr = todayIn(ctx.tenant.timezone).slice(0, 4);
  const row = await tdb(ctx).$transaction(async (tx: Client) => { const n = await nextCounter(tx, ctx.tenantId, `prq:${yr}`); return tx.patientRequest.create({ data: { tenantId: ctx.tenantId, requestNumber: `PRQ-${yr}-${pad(n)}`, patientId: ctx.patientId, kind: raw.kind!, reason, dueAt: new Date(Date.now() + RESPONSE_DAYS * 86_400_000) } }); });
  await recordAudit({ action: AUDIT_ACTIONS.PRIVACY_REQUEST_CHANGED, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "patient_request", entityId: row.id, metadata: { number: row.requestNumber, kind: raw.kind, created: true } });
  return { id: row.id as string, requestNumber: row.requestNumber as string, dueAt: row.dueAt as Date };
}

/* -------------------------------------------------------------------- clinic side -------------------------------------------------------------------- */
const need = (ctx: TenantRequestContext) => { if (!ctx.permissions.has("privacy.manage")) throw new AppError("FORBIDDEN"); };
export async function listRightsRequests(ctx: TenantRequestContext, q: { status?: string; page?: number } = {}) {
  need(ctx); const page = Math.max(1, Math.floor(q.page ?? 1)); const where = { kind: { in: Object.keys(RIGHTS_KINDS) }, ...(q.status ? { status: q.status } : {}) };
  const [total, rows] = await Promise.all([tdb(ctx).patientRequest.count({ where }), tdb(ctx).patientRequest.findMany({ where, orderBy: [{ status: "asc" }, { createdAt: "desc" }], skip: (page - 1) * 20, take: 20 })]) as [number, { id: string; requestNumber: string; patientId: string; kind: string; reason: string; status: string; dueAt: Date | null; outcome: string | null; createdAt: Date; resolvedAt: Date | null }[]];
  const pts = (await tdb(ctx).patient.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.patientId))] } }, select: { id: true, code: true, name: true } })) as { id: string; code: string; name: string }[];
  const now = Date.now();
  return { total, page, pageSize: 20, rows: rows.map((r) => ({ ...r, label: RIGHTS_KINDS[r.kind as RightsKind], patient: pts.find((p) => p.id === r.patientId) ?? null, overdue: !r.resolvedAt && !!r.dueAt && r.dueAt.getTime() < now })) };
}
/**
 * Closes a data-rights request. The platform never silently deletes medical records:
 *  - CONSENT_WITHDRAWAL / RESTRICTION fulfilled → every communication-type consent is recorded as WITHDRAWN (clinical records are kept);
 *  - ERASURE can only end as RETENTION_EXCEPTION (records the legal reason), LEGAL_HOLD (refused while a hold exists), NOT_APPLICABLE, or PARTIALLY_FULFILLED
 *    (non-clinical contact/marketing consents withdrawn). It cannot end as FULFILLED, because no automatic deletion exists.
 *  - DATA_ACCESS / DATA_EXPORT fulfilled → a tenant-scoped export is generated for the reviewer to hand over (audited).
 */
export async function resolveRightsRequest(ctx: TenantRequestContext, id: string, i: { outcome?: string; note?: string }) {
  need(ctx); const r = (await tdb(ctx).patientRequest.findFirst({ where: { id, kind: { in: Object.keys(RIGHTS_KINDS) } } })) as { id: string; kind: string; status: string; patientId: string; requestNumber: string } | null; if (!r) throw new AppError("NOT_FOUND");
  if (["APPROVED", "REJECTED", "CANCELLED"].includes(r.status)) throw new AppError("CONFLICT", { message: "This request is already closed." });
  if (!(OUTCOMES as readonly string[]).includes(i.outcome ?? "")) throw new AppError("VALIDATION_ERROR", { fieldErrors: { outcome: "Choose an outcome." } });
  const note = (i.note ?? "").trim(); if (note.length < 10) throw new AppError("VALIDATION_ERROR", { fieldErrors: { note: "Explain the decision (at least 10 characters) — the patient will see it." } });
  const held = await isUnderHold(ctx.tenantId, "PATIENT", r.patientId);
  if (r.kind === "ERASURE" && i.outcome === "FULFILLED") throw new AppError("CONFLICT", { message: "Medical records are not deleted automatically. Choose “retention exception” (with the legal reason) or “partially fulfilled”." });
  if (held && ["FULFILLED", "PARTIALLY_FULFILLED"].includes(i.outcome!) && ["ERASURE", "RESTRICTION", "CONSENT_WITHDRAWAL"].includes(r.kind)) throw new AppError("CONFLICT", { message: "A legal hold applies to this patient, so their data can't be changed. Choose “legal hold”." });
  let exportBundle: unknown = null;
  if ((r.kind === "DATA_ACCESS" || r.kind === "DATA_EXPORT") && i.outcome === "FULFILLED") { exportBundle = await exportPatient(ctx, r.patientId); await recordAudit({ action: AUDIT_ACTIONS.PRIVACY_DATA_EXPORTED, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "patient", entityId: r.patientId, metadata: { requestNumber: r.requestNumber } }); }
  if (["CONSENT_WITHDRAWAL", "RESTRICTION"].includes(r.kind) && ["FULFILLED", "PARTIALLY_FULFILLED"].includes(i.outcome!) || (r.kind === "ERASURE" && i.outcome === "PARTIALLY_FULFILLED")) {
    for (const type of ["COMMUNICATION", "WHATSAPP", "SMS", "EMAIL", "MARKETING"]) await tdb(ctx).patientConsent.create({ data: { tenantId: ctx.tenantId, patientId: r.patientId, type, status: "WITHDRAWN", version: "data-rights", note: `Request ${r.requestNumber}`, recordedById: ctx.user.id, source: "STAFF" } });
  }
  const status = ["NOT_APPLICABLE", "LEGAL_HOLD", "RETENTION_EXCEPTION"].includes(i.outcome!) ? "REJECTED" : "APPROVED";
  await tdb(ctx).patientRequest.updateMany({ where: { id, status: { in: ["PENDING", "UNDER_REVIEW"] } }, data: { status, outcome: i.outcome, resolvedAt: new Date(), reviewedById: ctx.user.id, reviewedAt: new Date(), reviewNote: note.slice(0, 500) } });
  await recordAudit({ action: AUDIT_ACTIONS.PRIVACY_REQUEST_CHANGED, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "patient_request", entityId: id, reason: note, metadata: { number: r.requestNumber, kind: r.kind, outcome: i.outcome } });
  if (r.kind === "ERASURE") await securityEvent({ severity: "INFO", category: "PRIVACY", type: "ERASURE_DECIDED", summary: `Erasure request closed: ${i.outcome}`, tenantId: ctx.tenantId, actorId: ctx.user.id });
  return { status, outcome: i.outcome, export: exportBundle };
}
