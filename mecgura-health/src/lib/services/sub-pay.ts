import "server-only";
import { db } from "@/lib/db";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import type { RequestContext, TenantRequestContext } from "@/lib/auth/context";
import { AppError } from "@/lib/errors";
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import { onlineProvider, providerByKey } from "@/lib/subscriptions/providers/registry";
import { ProviderError } from "@/lib/subscriptions/providers/types";
import { applyPayment, outstandingOf } from "./sub-billing";
import { requireReason, stepUp } from "./platform-core";
import { uniqueViolation } from "./shared";

const OPEN = ["ISSUED", "OVERDUE", "PARTIALLY_PAID"];
async function ownInvoice(tenantId: string, invoiceId: string) {
  const inv = await db.saasInvoice.findFirst({ where: { id: invoiceId, tenantId } }); // another clinic's invoice is simply "not found"
  if (!inv) throw new AppError("NOT_FOUND", { message: "That invoice doesn't exist." });
  return inv;
}

/** Creates a hosted checkout for an unpaid invoice. The amount comes from the SERVER's invoice — never from the browser. Returns a URL to redirect to; no payment is assumed. */
export async function startCheckout(ctx: TenantRequestContext, invoiceId: string) {
  const inv = await ownInvoice(ctx.tenantId, invoiceId);
  if (!OPEN.includes(inv.status)) throw new AppError("CONFLICT", { message: inv.status === "PAID" ? "This invoice is already paid." : "This invoice can't be paid online." });
  const due = outstandingOf(inv); if (due <= 0) throw new AppError("CONFLICT", { message: "Nothing is due on this invoice." });
  const provider = onlineProvider(); if (!provider) throw new AppError("CONFLICT", { message: "Online payment isn't available yet. Please contact support to pay by bank transfer or UPI." });
  const profile = await db.subscriptionBillingProfile.findUnique({ where: { tenantId: ctx.tenantId } });
  const email = profile?.billingEmail ?? ctx.tenant.contactEmail ?? ctx.user.email;
  let r;
  try { r = await provider.createCheckout({ tenantId: ctx.tenantId, invoiceId: inv.id, invoiceNumber: inv.invoiceNumber, amountMinor: due, currency: inv.currency, customer: { name: profile?.legalName ?? ctx.tenant.name, email, phone: profile?.billingPhone ?? ctx.tenant.contactPhone }, callbackUrl: `${getEnv().APP_URL}/subscription/payment-result?invoice=${inv.id}`, description: `${inv.planName ?? "Subscription"} — ${inv.invoiceNumber}` }); }
  catch (e) { logger.warn("checkout failed", { code: e instanceof ProviderError ? e.code : "UNKNOWN" }); throw new AppError("CONFLICT", { message: "The payment page couldn't be opened right now. Please try again in a moment." }); }
  try { await db.saasPayment.create({ data: { tenantId: inv.tenantId, subscriptionId: inv.subscriptionId, invoiceId: inv.id, amountMinor: due, currency: inv.currency, status: "PENDING", provider: provider.key, providerOrderId: r.providerOrderId, idempotencyKey: `checkout:${provider.key}:${r.providerOrderId}`, attempt: (await db.saasPayment.count({ where: { invoiceId: inv.id } })) + 1 } }); }
  catch (e) { if (!uniqueViolation(e)) throw e; }
  return { checkoutUrl: r.checkoutUrl };
}

/** Asks the PROVIDER what happened to this invoice's checkouts and applies any confirmed payment. The browser return URL is never evidence; this is what the "payment result" page uses. */
export async function syncInvoicePayment(tenantId: string, invoiceId: string) {
  const inv = await ownInvoice(tenantId, invoiceId); let applied = 0, pending = 0, failed = 0;
  const attempts = await db.saasPayment.findMany({ where: { invoiceId, status: "PENDING", providerOrderId: { not: null } } });
  for (const a of attempts) {
    const prov = providerByKey(a.provider); if (!prov || !a.providerOrderId) continue;
    try {
      const st = await prov.getPaymentStatus(a.providerOrderId);
      if (st.status === "SUCCEEDED" && st.providerPaymentId) { const o = await applyPayment({ invoiceId, provider: a.provider, providerPaymentId: st.providerPaymentId, providerOrderId: a.providerOrderId, amountMinor: st.amountMinor, currency: st.currency, method: methodOf(st.method), reference: st.reference, actor: { id: null, source: "SYSTEM" }, idempotencyKey: `pay:${a.provider}:${st.providerPaymentId}` }); if (!o.duplicate) applied++; }
      else if (st.status === "FAILED") { failed++; await db.saasPayment.updateMany({ where: { id: a.id, status: "PENDING" }, data: { status: "CANCELLED", failureReason: st.failureReason?.slice(0, 200) ?? "Not completed" } }); }
      else pending++;
    } catch (e) { logger.warn("payment status lookup failed", { code: e instanceof ProviderError ? e.code : "UNKNOWN" }); pending++; }
  }
  const fresh = await db.saasInvoice.findUnique({ where: { id: inv.id } });
  return { status: fresh!.status, applied, pending, failed };
}
export const methodOf = (m: string | null | undefined) => (m?.toLowerCase() === "upi" ? "UPI" : m?.toLowerCase() === "card" ? "CARD" : "ONLINE");

/** Offline payment (bank transfer, cheque, cash…) recorded by a Super Admin after the money is really received. Same idempotent path as online payments. */
export async function recordManualPayment(ctx: RequestContext, invoiceId: string, input: { amountMinor?: number; amountRupees?: string; method?: string; reference?: string; reason?: string; password?: string; paidAt?: string }) {
  await stepUp(ctx, input.password, "subscription_manual_payment"); requireReason(input.reason, 5);
  const inv = await db.saasInvoice.findUnique({ where: { id: invoiceId } }); if (!inv) throw new AppError("NOT_FOUND", { message: "That invoice doesn't exist." });
  if (!OPEN.includes(inv.status)) throw new AppError("CONFLICT", { message: "Only an unpaid invoice can take a payment." });
  const ref = (input.reference ?? "").trim().slice(0, 80); if (!ref) throw new AppError("VALIDATION_ERROR", { fieldErrors: { reference: "Enter the bank / UPI / cheque reference." } });
  const amount = input.amountRupees !== undefined ? Math.round(parseFloat(input.amountRupees) * 100) : Number(input.amountMinor); if (!Number.isInteger(amount) || amount <= 0 || amount > outstandingOf(inv)) throw new AppError("VALIDATION_ERROR", { fieldErrors: { amountMinor: "Enter an amount up to the balance due." } });
  const method = ["BANK_TRANSFER", "UPI", "CARD", "OTHER"].includes(input.method ?? "") ? input.method! : "BANK_TRANSFER"; const paidAt = input.paidAt && !Number.isNaN(Date.parse(input.paidAt)) ? new Date(input.paidAt) : new Date();
  if (paidAt.getTime() > Date.now() + 86_400_000) throw new AppError("VALIDATION_ERROR", { fieldErrors: { paidAt: "The payment date can't be in the future." } });
  return applyPayment({ invoiceId, provider: "manual", providerPaymentId: `${invoiceId}:${ref}`, amountMinor: amount, method, reference: ref, paidAt, actor: { id: ctx.user.id, source: "SUPER_ADMIN" }, idempotencyKey: `manual:${invoiceId}:${ref}`, metadata: { offline: true } });
}

/* ------------------------------------------------------------------- billing details (what appears on invoices) ------------------------------------------------------------------- */
import { z } from "zod";
import { changedKeys } from "./shared";
const GSTIN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const t = (max: number) => z.string().trim().max(max).optional().or(z.literal("")).transform((v) => v || null);
const profileSchema = z.object({
  legalName: z.string().trim().min(2, "Enter the clinic's legal / billing name.").max(120), billingName: t(120), billingEmail: z.string().trim().toLowerCase().email("Enter a valid billing email.").max(120), billingPhone: t(30), contactName: t(80),
  addressLine: t(200), city: t(80), state: t(80), stateCode: z.string().trim().regex(/^\d{2}$/, "Use the two-digit GST state code.").optional().or(z.literal("")).transform((v) => v || null), country: z.string().trim().max(60).default("India"), pincode: t(10),
  gstin: z.string().trim().toUpperCase().regex(GSTIN, "Enter a valid 15-character GSTIN.").optional().or(z.literal("")).transform((v) => v || null), taxId: t(40),
}).superRefine((v, c) => { if (v.gstin && v.stateCode && v.gstin.slice(0, 2) !== v.stateCode) c.addIssue({ code: "custom", path: ["gstin"], message: "The GSTIN's first two digits must match the state code." }); });
/** GSTIN is optional for a clinic (many are unregistered); when given it is validated. Already-issued invoices keep their own snapshot. */
export async function saveBillingProfile(ctx: TenantRequestContext, input: unknown) {
  const r = profileSchema.safeParse(input); if (!r.success) { const fe: Record<string, string> = {}; for (const i of r.error.issues) fe[i.path.join(".")] ??= i.message; throw new AppError("VALIDATION_ERROR", { fieldErrors: fe }); }
  const before = await db.subscriptionBillingProfile.findUnique({ where: { tenantId: ctx.tenantId } });
  const saved = await db.subscriptionBillingProfile.upsert({ where: { tenantId: ctx.tenantId }, create: { tenantId: ctx.tenantId, ...r.data, updatedById: ctx.user.id }, update: { ...r.data, updatedById: ctx.user.id } });
  await recordAudit({ action: AUDIT_ACTIONS.SUBSCRIPTION_PROFILE_SAVED, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "billing_profile", entityId: saved.id, metadata: { changed: before ? changedKeys(before as unknown as Record<string, unknown>, r.data) : ["created"] } });
  return saved;
}
