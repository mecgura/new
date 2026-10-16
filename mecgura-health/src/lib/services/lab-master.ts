import "server-only";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import type { TenantRequestContext } from "@/lib/auth/context";
import { SUGGESTED_CONFIG, type TestSnap } from "@/lib/lab/core";
import { AppError } from "@/lib/errors";
import { tenantDb } from "@/lib/tenant/db";
import { parseOrThrow } from "@/lib/validation";
import { configItemSchema, investigationSchema, partnerSchema } from "@/lib/validation/lab";
import { isUniqueViolation, type Client } from "./clinic-shared";
import { containsCI } from "./shared";
import { parseJson } from "@/lib/clinical/snapshot";

const db = (ctx: TenantRequestContext) => tenantDb(ctx) as Client;
/** Roles that may touch laboratory data at all. Platform admins, compounders, accountants and general staff may not. */
export const LAB_ROLES = ["DOCTOR", "LAB_STAFF", "NURSE", "RECEPTIONIST", "CLINIC_ADMIN"];
export function labGuard(ctx: TenantRequestContext) {
  if (ctx.user.role === "SUPER_ADMIN") throw new AppError("FORBIDDEN", { message: "Platform administrators don't open clinic laboratory records." });
  if (!LAB_ROLES.includes(ctx.user.role)) throw new AppError("FORBIDDEN");
}
const canSeeMaster = (ctx: TenantRequestContext) => ctx.permissions.has("tests.view") || ctx.permissions.has("tests.order") || ctx.permissions.has("lab.configure");

/* --------------------------------------------- configurable lists --------------------------------------------- */
export interface ConfigEntry { id: string; name: string; active: boolean }
export interface InvestigationView { id: string; testCode: string; testName: string; shortName: string | null; category: string; description: string | null; sampleType: string | null; department: string | null; preparation: string | null; turnaroundHours: number | null; active: boolean; parameters: { id: string; position: number; name: string; resultType: string; unit: string | null; options: { value: string; flag?: string | null }[]; ranges: import("@/lib/lab/core").RangeRule[] }[] }
export async function listConfig(ctx: TenantRequestContext) {
  labGuard(ctx); if (!canSeeMaster(ctx)) throw new AppError("FORBIDDEN");
  const rows = await db(ctx).labConfigItem.findMany({ orderBy: [{ kind: "asc" }, { name: "asc" }], take: 500 });
  const by = (k: string): ConfigEntry[] => rows.filter((r: { kind: string }) => r.kind === k).map((r: { id: string; name: string; active: boolean }) => ({ id: r.id, name: r.name, active: r.active }));
  return { CATEGORY: by("CATEGORY"), SAMPLE_TYPE: by("SAMPLE_TYPE"), DEPARTMENT: by("DEPARTMENT"), REJECTION_REASON: by("REJECTION_REASON"), suggested: ctx.permissions.has("lab.configure") ? SUGGESTED_CONFIG : null };
}
export async function addConfigItem(ctx: TenantRequestContext, raw: unknown) {
  labGuard(ctx); if (!ctx.permissions.has("lab.configure")) throw new AppError("FORBIDDEN");
  const i = parseOrThrow(configItemSchema, raw);
  try { const r = await db(ctx).labConfigItem.create({ data: { tenantId: ctx.tenantId, kind: i.kind, name: i.name } }); await recordAudit({ action: AUDIT_ACTIONS.LAB_CONFIG_CHANGED, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "lab_config", entityId: r.id, metadata: { kind: i.kind, change: "added" } }); return { id: r.id as string }; }
  catch (e) { if (isUniqueViolation(e)) throw new AppError("CONFLICT", { message: "That name is already in the list.", fieldErrors: { name: "That name is already in the list." } }); throw e; }
}
export async function setConfigActive(ctx: TenantRequestContext, id: string, active: boolean) {
  labGuard(ctx); if (!ctx.permissions.has("lab.configure")) throw new AppError("FORBIDDEN");
  const r = await db(ctx).labConfigItem.updateMany({ where: { id }, data: { active } });
  if (r.count !== 1) throw new AppError("NOT_FOUND");
  await recordAudit({ action: AUDIT_ACTIONS.LAB_CONFIG_CHANGED, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "lab_config", entityId: id, metadata: { change: active ? "enabled" : "disabled" } });
  return { active };
}

/* --------------------------------------------- investigation master --------------------------------------------- */
const shape = (i: Record<string, unknown> & { parameters?: Record<string, unknown>[] }) => ({ ...i, tenantId: undefined, parameters: (i.parameters ?? []).map((p) => ({ ...p, tenantId: undefined, investigationId: undefined, options: parseJson(p.options as string, []), ranges: parseJson(p.ranges as string, []) })) });

export async function searchInvestigations(ctx: TenantRequestContext, q: { q?: string; category?: string; all?: boolean }) {
  labGuard(ctx); if (!canSeeMaster(ctx)) throw new AppError("FORBIDDEN");
  const includeInactive = !!q.all && ctx.permissions.has("lab.configure");
  const text = q.q?.trim().slice(0, 60);
  const rows = await db(ctx).investigation.findMany({
    where: { ...(includeInactive ? {} : { active: true }), ...(q.category ? { category: q.category } : {}), ...(text ? { OR: [{ testName: containsCI(text) }, { testCode: containsCI(text) }, { shortName: containsCI(text) }] } : {}) },
    orderBy: [{ category: "asc" }, { testName: "asc" }], take: 40, include: { parameters: { orderBy: { position: "asc" } } },
  });
  return { items: rows.map(shape) as InvestigationView[] };
}
export async function saveInvestigation(ctx: TenantRequestContext, id: string | null, raw: unknown) {
  labGuard(ctx); if (!ctx.permissions.has("lab.configure")) throw new AppError("FORBIDDEN");
  const v = parseOrThrow(investigationSchema, raw);
  const params: (typeof v.parameters)[number][] = v.parameters.length ? v.parameters : [{ name: v.testName, resultType: "TEXT" } as (typeof v.parameters)[number]];
  const names = params.map((p) => p.name.toLowerCase());
  if (new Set(names).size !== names.length) throw new AppError("VALIDATION_ERROR", { message: "Two parameters have the same name.", fieldErrors: { parameters: "Two parameters have the same name." } });
  const data = { testCode: v.testCode, testName: v.testName, shortName: v.shortName ?? null, category: v.category, description: v.description ?? null, sampleType: v.sampleType ?? null, department: v.department ?? null, preparation: v.preparation ?? null, turnaroundHours: v.turnaroundHours ?? null, active: v.active };
  try {
    const out = await db(ctx).$transaction(async (tx: Client) => {
      let rid = id;
      if (rid) { const r = await tx.investigation.updateMany({ where: { id: rid }, data }); if (r.count !== 1) throw new AppError("NOT_FOUND"); await tx.investigationParameter.deleteMany({ where: { investigationId: rid } }); }
      else rid = (await tx.investigation.create({ data: { ...data, tenantId: ctx.tenantId } })).id;
      await tx.investigationParameter.createMany({ data: params.map((p, n) => ({ tenantId: ctx.tenantId, investigationId: rid!, position: n, name: p.name, resultType: p.resultType, unit: p.unit ?? null, options: p.options?.length ? JSON.stringify(p.options) : null, ranges: p.ranges?.length ? JSON.stringify(p.ranges) : null })) });
      return rid!;
    });
    await recordAudit({ action: AUDIT_ACTIONS.LAB_CONFIG_CHANGED, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "investigation", entityId: out, metadata: { change: id ? "updated" : "created", code: v.testCode } });
    return { id: out as string };
  } catch (e) {
    if (isUniqueViolation(e)) throw new AppError("CONFLICT", { message: "That test code is already used.", fieldErrors: { testCode: "That test code is already used." } });
    throw e;
  }
}
export async function snapshotOf(inv: { testCode: string; testName: string; shortName: string | null; category: string; sampleType: string | null; department: string | null; preparation: string | null; turnaroundHours: number | null; parameters: { name: string; resultType: string; unit: string | null; options: string | null; ranges: string | null }[] }): Promise<TestSnap> {
  return { code: inv.testCode, name: inv.testName, shortName: inv.shortName, category: inv.category, sampleType: inv.sampleType, department: inv.department, preparation: inv.preparation, turnaroundHours: inv.turnaroundHours, parameters: inv.parameters.map((p) => ({ name: p.name, resultType: p.resultType, unit: p.unit, options: parseJson(p.options, []), ranges: parseJson(p.ranges, []) })) };
}

/* ------------------------------------------------ lab partners ------------------------------------------------ */
export async function listPartners(ctx: TenantRequestContext) {
  labGuard(ctx); if (!canSeeMaster(ctx)) throw new AppError("FORBIDDEN");
  const rows = await db(ctx).labPartner.findMany({ orderBy: { name: "asc" }, take: 100 });
  return { integrationAvailable: false, partners: rows.map((p: { id: string; name: string; code: string; contact: string | null; address: string | null; integrationType: string; active: boolean }) => ({ id: p.id, name: p.name, code: p.code, contact: p.contact, address: p.address, integrationType: p.integrationType, active: p.active })) as { id: string; name: string; code: string; contact: string | null; address: string | null; integrationType: string; active: boolean }[] };
}
export async function addPartner(ctx: TenantRequestContext, raw: unknown) {
  labGuard(ctx); if (!ctx.permissions.has("lab.configure")) throw new AppError("FORBIDDEN");
  const v = parseOrThrow(partnerSchema, raw);
  try { const r = await db(ctx).labPartner.create({ data: { tenantId: ctx.tenantId, name: v.name, code: v.code, contact: v.contact ?? null, address: v.address ?? null, configRef: v.configRef ?? null } }); await recordAudit({ action: AUDIT_ACTIONS.LAB_CONFIG_CHANGED, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "lab_partner", entityId: r.id, metadata: { change: "added" } }); return { id: r.id as string }; }
  catch (e) { if (isUniqueViolation(e)) throw new AppError("CONFLICT", { message: "That partner code is already used.", fieldErrors: { code: "That partner code is already used." } }); throw e; }
}
export async function setPartnerActive(ctx: TenantRequestContext, id: string, active: boolean) {
  labGuard(ctx); if (!ctx.permissions.has("lab.configure")) throw new AppError("FORBIDDEN");
  const r = await db(ctx).labPartner.updateMany({ where: { id }, data: { active } });
  if (r.count !== 1) throw new AppError("NOT_FOUND");
  await recordAudit({ action: AUDIT_ACTIONS.LAB_CONFIG_CHANGED, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "lab_partner", entityId: id, metadata: { change: active ? "enabled" : "disabled" } });
  return { active };
}
