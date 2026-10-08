import { z } from "zod";
import { MANUAL_METHODS, MAX_MINOR, MAX_QTY, PAYMENT_METHODS, SERVICE_TYPES } from "@/lib/billing/money";
import { DATE_RE, isValidDate } from "@/lib/scheduling/time";
import { requiredText } from "./fields";

const txt = (label: string, max: number) => z.string().trim().max(max, `${label} must be ${max} characters or fewer.`).nullish().transform((v) => (v ? v : undefined));
const id = z.string().trim().min(1).max(60).nullish().or(z.literal("").transform(() => undefined)).transform((v) => v ?? undefined);
const date = (label: string) => z.string().regex(DATE_RE, `${label} must be a date.`).refine(isValidDate, `${label} is not a real date.`);
const minor = (label: string) => z.preprocess((v) => (typeof v === "string" && v.trim() !== "" ? Number(v) : v), z.number({ error: `${label} must be a number.` }).int(`${label} must be a whole number of paise.`).min(0, `${label} can't be negative.`).max(MAX_MINOR, `${label} is too large.`));
const prefix = z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9]{0,7}$/, "Use 1–8 letters or numbers, starting with a letter.");

export const taxSchema = z.object({ name: requiredText("Tax name", { max: 40, min: 2 }), rateBp: minor("Rate").refine((v) => v <= 10000, "A tax rate can't exceed 100%."), type: z.enum(["GST", "VAT", "SALES", "OTHER"]).default("OTHER") });
export const serviceSchema = z.object({
  serviceCode: z.string().trim().toUpperCase().min(1, "Enter a service code.").max(20).regex(/^[A-Z0-9._-]+$/, "Use letters, numbers, dots, dashes or underscores."),
  serviceName: requiredText("Service name", { max: 120, min: 2 }), description: txt("Description", 300), type: z.enum(SERVICE_TYPES, { error: "Choose a type." }), category: txt("Category", 60),
  priceMinor: minor("Price"), taxId: id, discountEligible: z.boolean().default(true), investigationId: id, active: z.boolean().default(true),
});

const discount = z.object({ type: z.enum(["PERCENT", "FIXED"]), value: minor("Discount") });
export const invoiceItemSchema = z.object({
  serviceId: id, description: txt("Description", 160), unitPriceMinor: minor("Price").optional(), quantity: z.preprocess((v) => (typeof v === "string" ? Number(v) : v), z.number().int().min(1, "Quantity must be at least 1.").max(MAX_QTY)).default(1),
  discount: discount.optional().nullable(), sourceType: z.enum(SERVICE_TYPES).optional(), sourceId: id,
}).superRefine((v, c) => { if (!v.serviceId && (!v.description || v.unitPriceMinor == null)) c.addIssue({ code: "custom", path: ["description"], message: "Choose a service, or enter a description and price." }); });
export const invoiceInputSchema = z.object({
  patientId: z.string().trim().min(1, "Choose the patient."), items: z.array(invoiceItemSchema).min(1, "Add at least one item.").max(40, "At most 40 items."),
  discount: discount.optional().nullable(), discountReason: txt("Discount reason", 200), invoiceDate: date("Invoice date").optional().or(z.literal("").transform(() => undefined)), dueDate: date("Due date").optional().or(z.literal("").transform(() => undefined)),
  notes: txt("Notes", 500), doctorUserId: id, appointmentId: id, consultationId: id, investigationOrderId: id, followUpId: id, opdVisitId: id,
});
export const fromSourceSchema = z.object({ kind: z.enum(["consultation", "appointment", "investigation", "followup"], { error: "Unknown source." }), id: z.string().trim().min(1) });

export const paymentSchema = z.object({
  amountMinor: minor("Amount").refine((v) => v > 0, "Enter an amount greater than zero."), method: z.enum(PAYMENT_METHODS, { error: "Choose a payment method." }),
  transactionReference: txt("Reference", 80), notes: txt("Notes", 300), paymentDate: date("Payment date").optional().or(z.literal("").transform(() => undefined)),
  idempotencyKey: z.string().trim().min(8, "Missing request key.").max(80),
});
export const cancelSchema = z.object({ reason: requiredText("Reason", { max: 300, min: 2 }) });
export const refundRequestSchema = z.object({ paymentId: z.string().min(1), amountMinor: minor("Amount").refine((v) => v > 0, "Enter an amount greater than zero."), reason: requiredText("Reason", { max: 300, min: 2 }), method: z.enum(MANUAL_METHODS).optional() });
export const refundActionSchema = z.object({ action: z.enum(["approve", "reject", "process", "cancel"], { error: "Unknown action." }), reason: txt("Reason", 300), reference: txt("Reference", 80) });
export const sessionSchema = z.object({ openingMinor: minor("Opening balance").optional(), closingMinor: minor("Closing balance").optional(), notes: txt("Notes", 300) });

export const settingsSchema = z.object({
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "Use a 3-letter currency code, e.g. INR."),
  invoicePrefix: prefix, receiptPrefix: prefix, paymentPrefix: prefix, refundPrefix: prefix,
  taxMode: z.enum(["EXCLUSIVE", "INCLUSIVE"]),
  paymentMethods: z.array(z.enum(PAYMENT_METHODS)).min(1, "Enable at least one payment method.").refine((a) => !a.includes("ONLINE"), "Payment gateway not configured."),
  discountRules: z.record(z.string(), z.object({ maxPercentBp: minor("Maximum percentage").refine((v) => v <= 10000, "Can't exceed 100%."), maxFixedMinor: minor("Maximum amount").optional() })).default({}),
  invoiceFooter: txt("Invoice footer", 300), receiptFooter: txt("Receipt footer", 300), paymentTerms: txt("Payment terms", 300),
  dueDays: z.preprocess((v) => (v === "" || v === null ? undefined : v), z.coerce.number().int().min(0).max(365).optional()),
  defaultConsultationServiceId: id, defaultFollowUpServiceId: id,
  autoBillConsultation: z.boolean(), autoBillInvestigation: z.boolean(), autoBillFollowUp: z.boolean(), allowOverpayment: z.boolean(), refundSelfApproval: z.boolean(), useCashierSessions: z.boolean(),
});
