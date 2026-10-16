import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import type { RequestContext } from "@/lib/auth/context";
import { AppError } from "@/lib/errors";
import { getPlatformSettingRaw, invalidatePlatformSetting } from "@/lib/platform/runtime";
import { DEFAULT_POLICY, mergePolicy, type SubscriptionPolicy } from "@/lib/subscriptions/state";
import { DEFAULT_TAX, mergeTax, type TaxConfig } from "@/lib/subscriptions/tax";
import { guard } from "./platform-core";

/**
 * Platform-level billing configuration, stored in PlatformSetting. NOTHING here is invented: until the Super Admin fills in MECGURA's
 * legal / tax / support details they are empty, and documents say so instead of printing made-up values.
 */
export interface VendorProfile { legalName: string; brandName: string; gstin: string; pan: string; address: string; city: string; state: string; stateCode: string; pincode: string; email: string; phone: string; website: string; supportEmail: string; supportPhone: string; supportHours: string; invoiceFooter: string; bankDetails: string }
export const EMPTY_VENDOR: VendorProfile = { legalName: "", brandName: "MECGURA HEALTH", gstin: "", pan: "", address: "", city: "", state: "", stateCode: "", pincode: "", email: "", phone: "", website: "", supportEmail: "", supportPhone: "", supportHours: "", invoiceFooter: "", bankDetails: "" };

const KEYS = { policy: "subscription.policy", tax: "subscription.tax", vendor: "subscription.vendor" } as const;
async function read<T>(key: string): Promise<T | null> { try { const v = await getPlatformSettingRaw(key); return v ? (JSON.parse(v) as T) : null; } catch { return null; } }
export const getPolicy = async (): Promise<SubscriptionPolicy> => mergePolicy(await read<Partial<SubscriptionPolicy>>(KEYS.policy));
export const getTax = async (): Promise<TaxConfig> => mergeTax(await read<Partial<TaxConfig>>(KEYS.tax));
export async function getVendor(): Promise<VendorProfile> {
  const r = (await read<Partial<VendorProfile>>(KEYS.vendor)) ?? {}; const out = { ...EMPTY_VENDOR };
  for (const k of Object.keys(EMPTY_VENDOR) as (keyof VendorProfile)[]) if (typeof r[k] === "string") out[k] = r[k] as string;
  return out;
}

const txt = (max: number) => z.string().trim().max(max);
const vendorSchema = z.object({
  legalName: txt(120), brandName: txt(80).min(1), gstin: txt(15).regex(/^([0-9A-Z]{15})?$/, "GSTIN must be 15 letters/digits."), pan: txt(10), address: txt(200), city: txt(80), state: txt(80), stateCode: txt(2).regex(/^(\d{2})?$/, "Two-digit GST state code."), pincode: txt(10),
  email: txt(120), phone: txt(30), website: txt(120), supportEmail: txt(120), supportPhone: txt(30), supportHours: txt(120), invoiceFooter: txt(300), bankDetails: txt(300),
}).partial();
const policySchema = z.object({
  graceDays: z.number().int().min(0).max(90), dunningDays: z.number().int().min(0).max(30), renewalInvoiceLeadDays: z.number().int().min(0).max(60), invoiceDueDays: z.number().int().min(0).max(60),
  trial: z.object({ maxDays: z.number().int().min(1).max(90), requireBillingProfile: z.boolean(), allowExtension: z.boolean(), maxExtensionDays: z.number().int().min(0).max(90) }).partial(),
  access: z.object({ grace: z.enum(["FULL", "READ_ONLY", "BLOCK"]), paused: z.enum(["FULL", "READ_ONLY", "BLOCK"]), suspended: z.enum(["FULL", "READ_ONLY", "BLOCK"]), ended: z.enum(["FULL", "READ_ONLY", "BLOCK"]), pending: z.enum(["FULL", "READ_ONLY", "BLOCK"]) }).partial(),
  portalDuringSuspension: z.enum(["BLOCK", "READ_ONLY", "ALLOW"]),
}).partial();
const taxSchema = z.object({ enabled: z.boolean(), mode: z.enum(["EXCLUSIVE", "INCLUSIVE"]), name: txt(20).min(1), rateBp: z.number().int().min(0).max(5000), vendorStateCode: txt(2).regex(/^(\d{2})?$/).nullable() }).partial();

export async function billingSettings(ctx: RequestContext) {
  guard(ctx);
  const [policy, tax, vendor] = await Promise.all([getPolicy(), getTax(), getVendor()]);
  return { policy, tax, vendor, defaults: { policy: DEFAULT_POLICY, tax: DEFAULT_TAX }, vendorComplete: !!(vendor.legalName && vendor.address) };
}
async function put(ctx: RequestContext, key: string, value: unknown, what: string) {
  const before = await getPlatformSettingRaw(key);
  await db.platformSetting.upsert({ where: { key }, create: { key, value: JSON.stringify(value), updatedById: ctx.user.id }, update: { value: JSON.stringify(value), updatedById: ctx.user.id } });
  invalidatePlatformSetting(key);
  await recordAudit({ action: AUDIT_ACTIONS.SUBSCRIPTION_SETTINGS_SAVED, tenantId: null, actorId: ctx.user.id, entityType: "subscription_settings", entityId: what, metadata: { section: what, changed: before !== JSON.stringify(value) } });
}
function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const r = schema.safeParse(input); if (r.success) return r.data;
  const fe: Record<string, string> = {}; for (const i of r.error.issues) fe[i.path.join(".") || "form"] ??= i.message;
  throw new AppError("VALIDATION_ERROR", { fieldErrors: fe });
}
export async function savePolicy(ctx: RequestContext, input: unknown) { guard(ctx); const merged = mergePolicy({ ...(await getPolicy()), ...parse(policySchema, input) } as Partial<SubscriptionPolicy>); await put(ctx, KEYS.policy, merged, "policy"); return merged; }
export async function saveTax(ctx: RequestContext, input: unknown) {
  guard(ctx); const p = parse(taxSchema, input); const merged = mergeTax({ ...(await getTax()), ...p, vendorStateCode: p.vendorStateCode === "" ? null : p.vendorStateCode ?? (await getTax()).vendorStateCode } as Partial<TaxConfig>);
  await put(ctx, KEYS.tax, merged, "tax"); return merged;
}
export async function saveVendor(ctx: RequestContext, input: unknown) { guard(ctx); const merged = { ...(await getVendor()), ...parse(vendorSchema, input) }; await put(ctx, KEYS.vendor, merged, "vendor"); return merged; }
