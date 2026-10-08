import "server-only";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import type { TenantRequestContext } from "@/lib/auth/context";
import { MANUAL_METHODS } from "@/lib/billing/money";
import { getPlatformSetting } from "@/lib/platform/runtime";
import { AppError } from "@/lib/errors";
import { tenantDb } from "@/lib/tenant/db";
import { parseOrThrow } from "@/lib/validation";
import { serviceSchema, settingsSchema, taxSchema } from "@/lib/validation/billing";
import { isUniqueViolation, type Client } from "./clinic-shared";
import { containsCI } from "./shared";

/** Billing configuration: settings, taxes and the service/price master. Nothing about prices, taxes, prefixes or discount limits is hard-coded. */
const db = (ctx: TenantRequestContext) => tenantDb(ctx) as Client;

export function billGuard(ctx: TenantRequestContext) {
  if (ctx.user.role === "SUPER_ADMIN") throw new AppError("FORBIDDEN", { message: "Platform administrators don't open clinic financial records." });
}
export const canBill = (ctx: TenantRequestContext) => ctx.permissions.has("billing.view");

export interface DiscountRule { maxPercentBp: number; maxFixedMinor?: number }
export interface BillingSettingsView {
  currency: string; invoicePrefix: string; receiptPrefix: string; paymentPrefix: string; refundPrefix: string; taxMode: "EXCLUSIVE" | "INCLUSIVE"; paymentMethods: string[]; discountRules: Record<string, DiscountRule>;
  invoiceFooter: string | null; receiptFooter: string | null; paymentTerms: string | null; dueDays: number | null; defaultConsultationServiceId: string | null; defaultFollowUpServiceId: string | null;
  autoBillConsultation: boolean; autoBillInvestigation: boolean; autoBillFollowUp: boolean; allowOverpayment: boolean; refundSelfApproval: boolean; useCashierSessions: boolean;
}
const parseJson = <T,>(s: string | null | undefined, fallback: T): T => { try { return s ? (JSON.parse(s) as T) : fallback; } catch { return fallback; } };
export async function loadBillingSettings(client: Client, tenantId: string): Promise<BillingSettingsView> {
  const s = await client.billingSettings.findFirst({ where: { tenantId } });
  const platform = s ? null : await getPlatformSetting<{ currency?: string }>("defaults", {}); // platform default currency applies only until the clinic saves billing settings
  return {
    currency: s?.currency ?? platform?.currency ?? "INR", invoicePrefix: s?.invoicePrefix ?? "INV", receiptPrefix: s?.receiptPrefix ?? "REC", paymentPrefix: s?.paymentPrefix ?? "PAY", refundPrefix: s?.refundPrefix ?? "REF",
    taxMode: (s?.taxMode ?? "EXCLUSIVE") as "EXCLUSIVE" | "INCLUSIVE", paymentMethods: parseJson<string[]>(s?.paymentMethods, [...MANUAL_METHODS]), discountRules: parseJson<Record<string, DiscountRule>>(s?.discountRules, {}),
    invoiceFooter: s?.invoiceFooter ?? null, receiptFooter: s?.receiptFooter ?? null, paymentTerms: s?.paymentTerms ?? null, dueDays: s?.dueDays ?? null,
    defaultConsultationServiceId: s?.defaultConsultationServiceId ?? null, defaultFollowUpServiceId: s?.defaultFollowUpServiceId ?? null,
    autoBillConsultation: s?.autoBillConsultation ?? false, autoBillInvestigation: s?.autoBillInvestigation ?? false, autoBillFollowUp: s?.autoBillFollowUp ?? false,
    allowOverpayment: s?.allowOverpayment ?? false, refundSelfApproval: s?.refundSelfApproval ?? false, useCashierSessions: s?.useCashierSessions ?? false,
  };
}

export async function getBillingSettings(ctx: TenantRequestContext) {
  billGuard(ctx);
  if (!canBill(ctx) && !ctx.permissions.has("billing.configure")) throw new AppError("FORBIDDEN");
  return { ...(await loadBillingSettings(db(ctx), ctx.tenantId)), canConfigure: ctx.permissions.has("billing.configure"), gateway: { configured: false, message: "Payment gateway not configured." } };
}
export async function updateBillingSettings(ctx: TenantRequestContext, raw: unknown) {
  billGuard(ctx); if (!ctx.permissions.has("billing.configure")) throw new AppError("FORBIDDEN");
  const v = parseOrThrow(settingsSchema, raw);
  const tdb = db(ctx);
  for (const k of ["defaultConsultationServiceId", "defaultFollowUpServiceId"] as const) if (v[k] && !(await tdb.billingService.findFirst({ where: { id: v[k], active: true }, select: { id: true } }))) throw new AppError("VALIDATION_ERROR", { message: "Choose an active service from this clinic.", fieldErrors: { [k]: "Choose an active service from this clinic." } });
  const data = { currency: v.currency, invoicePrefix: v.invoicePrefix, receiptPrefix: v.receiptPrefix, paymentPrefix: v.paymentPrefix, refundPrefix: v.refundPrefix, taxMode: v.taxMode, paymentMethods: JSON.stringify(v.paymentMethods), discountRules: JSON.stringify(v.discountRules),
    invoiceFooter: v.invoiceFooter ?? null, receiptFooter: v.receiptFooter ?? null, paymentTerms: v.paymentTerms ?? null, dueDays: v.dueDays ?? null, defaultConsultationServiceId: v.defaultConsultationServiceId ?? null, defaultFollowUpServiceId: v.defaultFollowUpServiceId ?? null,
    autoBillConsultation: v.autoBillConsultation, autoBillInvestigation: v.autoBillInvestigation, autoBillFollowUp: v.autoBillFollowUp, allowOverpayment: v.allowOverpayment, refundSelfApproval: v.refundSelfApproval, useCashierSessions: v.useCashierSessions, updatedById: ctx.user.id };
  const before = await loadBillingSettings(tdb, ctx.tenantId);
  await tdb.billingSettings.upsert({ where: { tenantId: ctx.tenantId }, update: data, create: { tenantId: ctx.tenantId, ...data } });
  const changed = (Object.keys(before) as (keyof BillingSettingsView)[]).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(k in v ? (v as Record<string, unknown>)[k] ?? null : before[k]));
  await recordAudit({ action: AUDIT_ACTIONS.BILLING_CONFIG_CHANGED, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "billing_settings", entityId: ctx.tenantId, metadata: { fields: changed } });
  return { saved: true };
}

/* ------------------------------------------------ taxes ------------------------------------------------ */
export async function listTaxes(ctx: TenantRequestContext) {
  billGuard(ctx); if (!canBill(ctx)) throw new AppError("FORBIDDEN");
  const rows = await db(ctx).billingTax.findMany({ orderBy: { name: "asc" }, take: 100 });
  return { taxes: rows.map((t: { id: string; name: string; rateBp: number; type: string; active: boolean }) => ({ id: t.id, name: t.name, rateBp: t.rateBp, type: t.type, active: t.active })) as { id: string; name: string; rateBp: number; type: string; active: boolean }[] };
}
export async function addTax(ctx: TenantRequestContext, raw: unknown) {
  billGuard(ctx); if (!ctx.permissions.has("billing.configure")) throw new AppError("FORBIDDEN");
  const v = parseOrThrow(taxSchema, raw);
  try {
    const t = await db(ctx).billingTax.create({ data: { tenantId: ctx.tenantId, name: v.name, rateBp: v.rateBp, type: v.type } });
    await recordAudit({ action: AUDIT_ACTIONS.BILLING_CONFIG_CHANGED, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "billing_tax", entityId: t.id, metadata: { change: "added", rateBp: v.rateBp } });
    return { id: t.id as string };
  } catch (e) { if (isUniqueViolation(e)) throw new AppError("CONFLICT", { message: "A tax with that name already exists.", fieldErrors: { name: "A tax with that name already exists." } }); throw e; }
}
export async function setTaxActive(ctx: TenantRequestContext, id: string, active: boolean) {
  billGuard(ctx); if (!ctx.permissions.has("billing.configure")) throw new AppError("FORBIDDEN");
  const r = await db(ctx).billingTax.updateMany({ where: { id }, data: { active } });
  if (r.count !== 1) throw new AppError("NOT_FOUND");
  await recordAudit({ action: AUDIT_ACTIONS.BILLING_CONFIG_CHANGED, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "billing_tax", entityId: id, metadata: { change: active ? "enabled" : "disabled" } });
  return { active };
}

/* ------------------------------------------------ services ------------------------------------------------ */
export interface ServiceView { id: string; serviceCode: string; serviceName: string; description: string | null; type: string; category: string | null; priceMinor: number; taxId: string | null; taxName: string | null; taxRateBp: number; discountEligible: boolean; investigationId: string | null; active: boolean }
export async function listServices(ctx: TenantRequestContext, q: { q?: string; type?: string; all?: boolean }) {
  billGuard(ctx); if (!canBill(ctx)) throw new AppError("FORBIDDEN");
  const tdb = db(ctx); const text = q.q?.trim().slice(0, 60); const all = !!q.all && ctx.permissions.has("billing.configure");
  const [rows, taxes] = await Promise.all([
    tdb.billingService.findMany({ where: { ...(all ? {} : { active: true }), ...(q.type ? { type: q.type } : {}), ...(text ? { OR: [{ serviceName: containsCI(text) }, { serviceCode: containsCI(text) }] } : {}) }, orderBy: [{ type: "asc" }, { serviceName: "asc" }], take: 200 }),
    tdb.billingTax.findMany({ take: 100 }),
  ]);
  const tm = new Map<string, { name: string; rateBp: number; active: boolean }>(taxes.map((t: { id: string; name: string; rateBp: number; active: boolean }) => [t.id, t]));
  return { services: rows.map((s: Record<string, any>) => { const t = s.taxId ? tm.get(s.taxId) : null; return { id: s.id, serviceCode: s.serviceCode, serviceName: s.serviceName, description: s.description, type: s.type, category: s.category, priceMinor: s.priceMinor, taxId: s.taxId, taxName: t?.name ?? null, taxRateBp: t && t.active ? t.rateBp : 0, discountEligible: s.discountEligible, investigationId: s.investigationId, active: s.active }; }) as ServiceView[] }; // eslint-disable-line @typescript-eslint/no-explicit-any
}
export async function saveService(ctx: TenantRequestContext, id: string | null, raw: unknown) {
  billGuard(ctx); if (!ctx.permissions.has("billing.configure")) throw new AppError("FORBIDDEN");
  const v = parseOrThrow(serviceSchema, raw);
  const tdb = db(ctx);
  if (v.taxId && !(await tdb.billingTax.findFirst({ where: { id: v.taxId }, select: { id: true } }))) throw new AppError("VALIDATION_ERROR", { message: "Choose a tax from this clinic.", fieldErrors: { taxId: "Choose a tax from this clinic." } });
  if (v.investigationId && !(await tdb.investigation.findFirst({ where: { id: v.investigationId }, select: { id: true } }))) throw new AppError("VALIDATION_ERROR", { message: "Choose an investigation from this clinic.", fieldErrors: { investigationId: "Choose an investigation from this clinic." } });
  const data = { serviceCode: v.serviceCode, serviceName: v.serviceName, description: v.description ?? null, type: v.type, category: v.category ?? null, priceMinor: v.priceMinor, taxId: v.taxId ?? null, discountEligible: v.discountEligible, investigationId: v.investigationId ?? null, active: v.active };
  try {
    let sid = id;
    if (id) { const old = await tdb.billingService.findFirst({ where: { id }, select: { priceMinor: true } }); if (!old) throw new AppError("NOT_FOUND"); await tdb.billingService.updateMany({ where: { id }, data }); await recordAudit({ action: AUDIT_ACTIONS.BILLING_CONFIG_CHANGED, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "billing_service", entityId: id, metadata: { change: "updated", priceChanged: old.priceMinor !== v.priceMinor } }); }
    else { const r = await tdb.billingService.create({ data: { tenantId: ctx.tenantId, ...data } }); sid = r.id; await recordAudit({ action: AUDIT_ACTIONS.BILLING_CONFIG_CHANGED, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "billing_service", entityId: r.id, metadata: { change: "created", type: v.type } }); }
    return { id: sid as string };
  } catch (e) { if (isUniqueViolation(e)) throw new AppError("CONFLICT", { message: "That service code is already used.", fieldErrors: { serviceCode: "That service code is already used." } }); throw e; }
}
