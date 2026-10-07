import "server-only";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import type { TenantRequestContext } from "@/lib/auth/context";
import { COLLECTIBLE, dueOf } from "@/lib/billing/money";
import { AppError } from "@/lib/errors";
import { timeInTz, todayIn, utcToZoned } from "@/lib/scheduling/time";
import { tenantDb } from "@/lib/tenant/db";
import { tenantTimezone, type Client } from "./clinic-shared";
import { billGuard } from "./billing-master";

/**
 * Financial documents (invoice, payment receipt, refund receipt, outstanding statement). Private: authenticated, tenant-checked,
 * `billing.view` only. Branding is the clinic's. Content comes from the invoice's own SNAPSHOT (names, prices, tax, totals) — never from the
 * live service list — and contains no clinical information.
 */
const db = (ctx: TenantRequestContext) => tenantDb(ctx) as Client;
function guard(ctx: TenantRequestContext) { billGuard(ctx); if (!ctx.permissions.has("billing.view")) throw new AppError("FORBIDDEN"); }
async function clinic(ctx: TenantRequestContext) {
  const t = ctx.tenant; const tz = await tenantTimezone(ctx.tenantId);
  return { name: t.name, logoUrl: t.logoUrl, address: [t.address, t.city, t.state, t.pincode].filter(Boolean).join(", "), phone: t.contactPhone, email: t.contactEmail, color: t.brand.primary, generatedAt: `${utcToZoned(new Date(), tz).date} ${timeInTz(new Date(), tz)}` };
}
const nm = async (tdb: Client, ids: (string | null | undefined)[]) => { const l = [...new Set(ids.filter(Boolean))] as string[]; const u = l.length ? await tdb.user.findMany({ where: { id: { in: l } }, select: { id: true, name: true } }) : []; return new Map<string, string>(u.map((x: { id: string; name: string }) => [x.id, x.name])); };
const pat = (p: { code: string; name: string; phone: string | null }) => ({ code: p.code, name: p.name, phone: p.phone });

export async function invoiceDocument(ctx: TenantRequestContext, id: string) {
  guard(ctx); const tdb = db(ctx);
  const i = await tdb.invoice.findFirst({ where: { id }, include: { patient: true, items: { orderBy: { position: "asc" } }, payments: { where: { status: { in: ["SUCCESS", "PARTIALLY_REFUNDED", "REFUNDED"] } }, orderBy: { createdAt: "asc" } } } });
  if (!i) throw new AppError("NOT_FOUND", { message: "Invoice not found." });
  if (i.status === "DRAFT") throw new AppError("CONFLICT", { message: "A draft invoice can't be printed. Issue it first." });
  const names = await nm(tdb, [i.doctorUserId, ...i.payments.map((p: { receivedById: string }) => p.receivedById)]);
  return {
    number: i.invoiceNumber as string, status: i.status as string, date: i.invoiceDate as string, dueDate: i.dueDate as string | null, currency: i.currency as string, taxMode: i.taxMode as string, patient: pat(i.patient), doctorName: i.doctorUserId ? names.get(i.doctorUserId) ?? null : null,
    items: i.items.map((x: Record<string, any>) => ({ code: x.serviceCodeSnapshot, description: x.descriptionSnapshot, quantity: x.quantity, unitPriceMinor: x.unitPriceMinor, discountMinor: x.discountMinor + x.invoiceDiscountMinor, taxName: x.taxName, taxRateBp: x.taxRateBp, taxMinor: x.taxMinor, lineTotalMinor: x.lineTotalMinor })) as { code: string | null; description: string; quantity: number; unitPriceMinor: number; discountMinor: number; taxName: string | null; taxRateBp: number; taxMinor: number; lineTotalMinor: number }[], // eslint-disable-line @typescript-eslint/no-explicit-any
    subtotalMinor: i.subtotalMinor as number, discountMinor: i.discountMinor as number, taxMinor: i.taxMinor as number, totalMinor: i.totalMinor as number, collectedMinor: i.collectedMinor as number, refundedMinor: i.refundedMinor as number, dueMinor: i.status === "CANCELLED" ? 0 : dueOf(i),
    payments: i.payments.map((p: Record<string, any>) => ({ number: p.paymentNumber, receipt: p.receiptNumber, date: p.paymentDate, method: p.method, amountMinor: p.amountMinor, receivedBy: names.get(p.receivedById) ?? null })) as { number: string; receipt: string | null; date: string; method: string; amountMinor: number; receivedBy: string | null }[], // eslint-disable-line @typescript-eslint/no-explicit-any
    notes: i.notes as string | null, footer: i.footerSnapshot as string | null, terms: i.termsSnapshot as string | null, cancelled: i.status === "CANCELLED", clinic: await clinic(ctx),
  };
}
export type InvoiceDoc = Awaited<ReturnType<typeof invoiceDocument>>;

export async function receiptDocument(ctx: TenantRequestContext, paymentId: string) {
  guard(ctx); const tdb = db(ctx);
  const p = await tdb.payment.findFirst({ where: { id: paymentId }, include: { patient: true, invoice: true } });
  if (!p) throw new AppError("NOT_FOUND", { message: "Payment not found." });
  if (!["SUCCESS", "PARTIALLY_REFUNDED", "REFUNDED"].includes(p.status)) throw new AppError("CONFLICT", { message: "There is no receipt for a payment that was not completed." });
  const names = await nm(tdb, [p.receivedById]); const s = await tdb.billingSettings.findFirst({ where: { tenantId: ctx.tenantId }, select: { receiptFooter: true } });
  return { receiptNumber: p.receiptNumber as string, paymentNumber: p.paymentNumber as string, invoiceNumber: p.invoice.invoiceNumber as string, currency: p.invoice.currency as string, date: p.paymentDate as string, method: p.method as string, reference: p.transactionReference as string | null, amountMinor: p.amountMinor as number, refundedMinor: p.refundedMinor as number, receivedBy: names.get(p.receivedById) ?? null, patient: pat(p.patient), invoiceTotalMinor: p.invoice.totalMinor as number, balanceMinor: p.invoice.status === "CANCELLED" ? 0 : dueOf(p.invoice), footer: (s?.receiptFooter ?? null) as string | null, clinic: await clinic(ctx) };
}
export type ReceiptDoc = Awaited<ReturnType<typeof receiptDocument>>;

export async function refundReceiptDocument(ctx: TenantRequestContext, refundId: string) {
  guard(ctx); const tdb = db(ctx);
  const r = await tdb.refund.findFirst({ where: { id: refundId }, include: { invoice: { include: { patient: true } }, payment: true } });
  if (!r) throw new AppError("NOT_FOUND", { message: "Refund not found." });
  if (r.status !== "PROCESSED") throw new AppError("CONFLICT", { message: "A refund receipt exists only after the refund is processed." });
  const names = await nm(tdb, [r.processedById, r.approvedById]);
  return { refundNumber: r.refundNumber as string, invoiceNumber: r.invoice.invoiceNumber as string, paymentNumber: r.payment.paymentNumber as string, currency: r.invoice.currency as string, date: (r.processedAt as Date).toISOString().slice(0, 10), method: r.method as string, reference: r.reference as string | null, reason: r.reason as string, amountMinor: r.amountMinor as number, processedBy: r.processedById ? names.get(r.processedById) ?? null : null, approvedBy: r.approvedById ? names.get(r.approvedById) ?? null : null, patient: pat(r.invoice.patient), clinic: await clinic(ctx) };
}
export type RefundReceiptDoc = Awaited<ReturnType<typeof refundReceiptDocument>>;

export async function statementDocument(ctx: TenantRequestContext, patientId: string) {
  guard(ctx); const tdb = db(ctx); const today = todayIn(await tenantTimezone(ctx.tenantId));
  const p = await tdb.patient.findFirst({ where: { id: patientId } });
  if (!p) throw new AppError("NOT_FOUND", { message: "Patient not found." });
  const rows = await tdb.invoice.findMany({ where: { patientId, status: { in: [...COLLECTIBLE] }, dueMinor: { gt: 0 } }, orderBy: { invoiceDate: "asc" }, take: 200 });
  const list = rows.map((i: Record<string, any>) => ({ number: i.invoiceNumber, date: i.invoiceDate, dueDate: i.dueDate, totalMinor: i.totalMinor, paidMinor: i.collectedMinor, dueMinor: dueOf(i as never), overdue: !!i.dueDate && i.dueDate < today })) as { number: string; date: string; dueDate: string | null; totalMinor: number; paidMinor: number; dueMinor: number; overdue: boolean }[]; // eslint-disable-line @typescript-eslint/no-explicit-any
  return { patient: pat(p), asOf: today, currency: (rows[0]?.currency ?? "INR") as string, invoices: list, totalDueMinor: list.reduce((a, r) => a + r.dueMinor, 0), clinic: await clinic(ctx) };
}
export type StatementDoc = Awaited<ReturnType<typeof statementDocument>>;

export async function recordDocAccess(ctx: TenantRequestContext, kind: "invoice" | "receipt" | "refund" | "statement", id: string, access: "VIEWED" | "PRINTED" | "DOWNLOADED") {
  if (kind === "invoice") await invoiceDocument(ctx, id); else if (kind === "receipt") await receiptDocument(ctx, id); else if (kind === "refund") await refundReceiptDocument(ctx, id); else await statementDocument(ctx, id);
  await recordAudit({ action: access === "PRINTED" ? AUDIT_ACTIONS.BILLING_DOC_PRINTED : access === "DOWNLOADED" ? AUDIT_ACTIONS.BILLING_DOC_DOWNLOADED : AUDIT_ACTIONS.BILLING_DOC_VIEWED, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: kind, entityId: id, metadata: { access: access.toLowerCase() } });
  return { recorded: true };
}

/* ------------------------------------------------ Patient 360 ------------------------------------------------ */
export async function patientBilling(ctx: TenantRequestContext, patientId: string) {
  guard(ctx); const tdb = db(ctx); const today = todayIn(await tenantTimezone(ctx.tenantId));
  if (!(await tdb.patient.findFirst({ where: { id: patientId }, select: { id: true } }))) throw new AppError("NOT_FOUND", { message: "Patient not found." });
  const [invoices, payments, refunds] = await Promise.all([
    tdb.invoice.findMany({ where: { patientId, status: { not: "DRAFT" } }, orderBy: { invoiceDate: "desc" }, take: 100 }),
    tdb.payment.findMany({ where: { patientId, status: { in: ["SUCCESS", "PARTIALLY_REFUNDED", "REFUNDED"] } }, orderBy: { createdAt: "desc" }, take: 100, include: { invoice: { select: { invoiceNumber: true } } } }),
    tdb.refund.findMany({ where: { invoice: { is: { patientId } } }, orderBy: { createdAt: "desc" }, take: 50, include: { invoice: { select: { invoiceNumber: true } } } }),
  ]);
  const outstanding = invoices.filter((i: { status: string }) => (COLLECTIBLE as readonly string[]).includes(i.status)).reduce((a: number, i: { totalMinor: number; collectedMinor: number }) => a + dueOf(i), 0);
  return {
    outstandingMinor: outstanding as number, currency: (invoices[0]?.currency ?? "INR") as string,
    invoices: invoices.map((i: Record<string, any>) => ({ id: i.id, invoiceNumber: i.invoiceNumber, invoiceDate: i.invoiceDate, status: i.status, overdue: (COLLECTIBLE as readonly string[]).includes(i.status) && !!i.dueDate && i.dueDate < today && dueOf(i as never) > 0, totalMinor: i.totalMinor, dueMinor: i.status === "CANCELLED" ? 0 : dueOf(i as never) })) as { id: string; invoiceNumber: string; invoiceDate: string; status: string; overdue: boolean; totalMinor: number; dueMinor: number }[], // eslint-disable-line @typescript-eslint/no-explicit-any
    payments: payments.map((p: Record<string, any>) => ({ id: p.id, paymentNumber: p.paymentNumber, receiptNumber: p.receiptNumber, invoiceNumber: p.invoice.invoiceNumber, amountMinor: p.amountMinor, method: p.method, status: p.status, date: p.paymentDate })) as { id: string; paymentNumber: string; receiptNumber: string | null; invoiceNumber: string; amountMinor: number; method: string; status: string; date: string }[], // eslint-disable-line @typescript-eslint/no-explicit-any
    refunds: refunds.map((r: Record<string, any>) => ({ id: r.id, refundNumber: r.refundNumber, invoiceNumber: r.invoice.invoiceNumber, amountMinor: r.amountMinor, status: r.status })) as { id: string; refundNumber: string; invoiceNumber: string; amountMinor: number; status: string }[], // eslint-disable-line @typescript-eslint/no-explicit-any
    can: { newInvoice: ctx.permissions.has("billing.create"), statement: true },
  };
}
export interface BillingTimelineItem { id: string; type: string; title: string; at: string; detail: string; href: string }
export async function billingTimeline(ctx: TenantRequestContext, patientId: string): Promise<BillingTimelineItem[]> {
  if (ctx.user.role === "SUPER_ADMIN" || !ctx.permissions.has("billing.view")) return [];
  const tdb = db(ctx);
  const ev = await tdb.invoiceEvent.findMany({ where: { patientId }, orderBy: { at: "desc" }, take: 80, include: { invoice: { select: { id: true, invoiceNumber: true, currency: true } } } });
  const MAP: Record<string, [string, string]> = { CREATED: ["INVOICE_CREATED", "Invoice created"], ISSUED: ["INVOICE_ISSUED", "Invoice issued"], PAYMENT_RECEIVED: ["PAYMENT_RECEIVED", "Payment received"], PAYMENT_CANCELLED: ["PAYMENT_CANCELLED", "Payment cancelled"], CANCELLED: ["INVOICE_CANCELLED", "Invoice cancelled"], REFUND_REQUESTED: ["REFUND_REQUESTED", "Refund requested"], REFUND_PROCESSED: ["REFUND_PROCESSED", "Refund processed"], REFUND_APPROVED: ["REFUND_APPROVED", "Refund approved"], REFUND_REJECTED: ["REFUND_REJECTED", "Refund declined"] };
  const { formatMoney } = await import("@/lib/billing/money");
  return ev.filter((e: { type: string }) => MAP[e.type]).map((e: Record<string, any>) => ({ id: `bl-${e.id}`, type: MAP[e.type][0], title: MAP[e.type][1], at: e.at.toISOString(), detail: `${e.invoice.invoiceNumber}${e.amountMinor != null ? ` · ${formatMoney(e.amountMinor, e.invoice.currency)}` : ""}`, href: `/billing/invoices/${e.invoice.id}` })); // eslint-disable-line @typescript-eslint/no-explicit-any
}
