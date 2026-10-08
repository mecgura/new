import "server-only";
import { notifyPayment, notifyRefundRequested } from "@/lib/notifications/events";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import type { TenantRequestContext } from "@/lib/auth/context";
import { COLLECTIBLE, dueOf } from "@/lib/billing/money";
import { AppError } from "@/lib/errors";
import { todayIn } from "@/lib/scheduling/time";
import { tenantDb } from "@/lib/tenant/db";
import { parseOrThrow } from "@/lib/validation";
import { cancelSchema, paymentSchema, refundActionSchema, refundRequestSchema, sessionSchema } from "@/lib/validation/billing";
import { isUniqueViolation, nextCounter, tenantTimezone, type Client } from "./clinic-shared";
import { loadBillingSettings } from "./billing-master";
import { addInvoiceEvent, recomputeInvoice, viewGuard } from "./billing-invoices";
import { containsCI } from "./shared";

/**
 * Payments, receipts, refunds and cashier sessions.
 *  - a payment is recorded only by hand ("Record payment") and is SUCCESS only because staff confirm money was received;
 *    online payments are refused until a real gateway exists (never trust a browser "success");
 *  - invoice money is changed with a compare-and-swap on collectedMinor inside a transaction, so concurrent payments can't over-allocate;
 *  - the same idempotency key (or the same method + reference) can't be recorded twice;
 *  - a refund is requested → approved → processed by different permissions; nothing refunds in one click.
 */
const db = (ctx: TenantRequestContext) => tenantDb(ctx) as Client;
const pad = (n: number) => String(n).padStart(6, "0");
const iso = (d: Date | null | undefined) => d?.toISOString() ?? null;
const PAGE = 20;
const MONEY_IN = ["SUCCESS", "PARTIALLY_REFUNDED", "REFUNDED"];
const stale = () => new AppError("CONFLICT", { message: "This invoice was just changed by someone else. Refresh and try again." });

function requireFull(ctx: TenantRequestContext) { viewGuard(ctx); if (!ctx.permissions.has("billing.view")) throw new AppError("FORBIDDEN"); }

export async function recordPayment(ctx: TenantRequestContext, invoiceId: string, raw: unknown) {
  requireFull(ctx); if (!ctx.permissions.has("billing.collect")) throw new AppError("FORBIDDEN");
  const v = parseOrThrow(paymentSchema, raw);
  const tdb = db(ctx); const tenantId = ctx.tenantId;
  const settings = await loadBillingSettings(tdb, tenantId);
  if (v.method === "ONLINE") throw new AppError("VALIDATION_ERROR", { message: "Payment gateway not configured.", fieldErrors: { method: "Payment gateway not configured." } });
  if (!settings.paymentMethods.includes(v.method)) throw new AppError("VALIDATION_ERROR", { message: "This clinic doesn't accept that payment method.", fieldErrors: { method: "This clinic doesn't accept that payment method." } });
  const tz = await tenantTimezone(tenantId); const today = todayIn(tz); const yr = today.slice(0, 4);
  const paymentDate = v.paymentDate ?? today;
  if (paymentDate > today) throw new AppError("VALIDATION_ERROR", { message: "The payment date can't be in the future.", fieldErrors: { paymentDate: "The payment date can't be in the future." } });
  const dup = await tdb.payment.findFirst({ where: { idempotencyKey: v.idempotencyKey } });
  if (dup) { if (dup.invoiceId !== invoiceId) throw new AppError("CONFLICT", { message: "That request was already used." }); return { id: dup.id as string, paymentNumber: dup.paymentNumber as string, receiptNumber: dup.receiptNumber as string | null, duplicate: true }; }
  if (settings.useCashierSessions && v.method === "CASH" && !(await tdb.cashierSession.findFirst({ where: { openedById: ctx.user.id, status: "OPEN" }, select: { id: true } }))) throw new AppError("CONFLICT", { message: "Open your cashier session before taking cash." });
  for (let attempt = 0; attempt < 4; attempt++) {
    const inv = await tdb.invoice.findFirst({ where: { id: invoiceId } });
    if (!inv) throw new AppError("NOT_FOUND", { message: "Invoice not found." });
    if (!(COLLECTIBLE as readonly string[]).includes(inv.status) || dueOf(inv) <= 0 && !settings.allowOverpayment) throw new AppError("CONFLICT", { message: inv.status === "DRAFT" ? "Issue the invoice before taking payment." : "This invoice isn't open for payment." });
    const due = dueOf(inv);
    if (v.amountMinor > due && !settings.allowOverpayment) throw new AppError("VALIDATION_ERROR", { message: "The amount is more than the outstanding balance.", fieldErrors: { amountMinor: "The amount is more than the outstanding balance." } });
    try {
      const out = await tdb.$transaction(async (tx: Client) => {
        const cas = await tx.invoice.updateMany({ where: { id: invoiceId, tenantId, collectedMinor: inv.collectedMinor, status: inv.status }, data: { collectedMinor: inv.collectedMinor + v.amountMinor } });
        if (cas.count !== 1) throw stale();
        const pn = await nextCounter(tx, tenantId, `pay:${yr}`); const rn = await nextCounter(tx, tenantId, `rec:${yr}`);
        const p = await tx.payment.create({ data: { tenantId, invoiceId, patientId: inv.patientId, paymentNumber: `${settings.paymentPrefix}-${yr}-${pad(pn)}`, receiptNumber: `${settings.receiptPrefix}-${yr}-${pad(rn)}`, amountMinor: v.amountMinor, method: v.method, status: "SUCCESS", transactionReference: v.transactionReference ?? null, idempotencyKey: v.idempotencyKey, paymentDate, notes: v.notes ?? null, receivedById: ctx.user.id } });
        await recomputeInvoice(tx, tenantId, invoiceId);
        await addInvoiceEvent(tx, tenantId, inv, "PAYMENT_RECEIVED", ctx.user.id, { amountMinor: v.amountMinor, ref: p.paymentNumber, note: v.method });
        return { id: p.id as string, paymentNumber: p.paymentNumber as string, receiptNumber: p.receiptNumber as string, duplicate: false };
      });
      await recordAudit({ action: AUDIT_ACTIONS.PAYMENT_RECORDED, tenantId, actorId: ctx.user.id, entityType: "payment", entityId: out.id, metadata: { number: out.paymentNumber, invoiceId, amountMinor: v.amountMinor, method: v.method } });
      await recordAudit({ action: AUDIT_ACTIONS.RECEIPT_GENERATED, tenantId, actorId: ctx.user.id, entityType: "payment", entityId: out.id, metadata: { receipt: out.receiptNumber } });
      await notifyPayment(tenantId, out.id, ctx.user.id);
      return out;
    } catch (e) {
      if (isUniqueViolation(e)) {
        const again = await tdb.payment.findFirst({ where: { idempotencyKey: v.idempotencyKey } });
        if (again) return { id: again.id as string, paymentNumber: again.paymentNumber as string, receiptNumber: again.receiptNumber as string | null, duplicate: true };
        throw new AppError("CONFLICT", { message: "That transaction reference was already recorded.", fieldErrors: { transactionReference: "That transaction reference was already recorded." } });
      }
      if (e instanceof AppError && e.code === "CONFLICT" && attempt < 3) { await new Promise((r) => setTimeout(r, 30 * (attempt + 1))); continue; }
      throw e;
    }
  }
  throw stale();
}

export async function cancelPayment(ctx: TenantRequestContext, paymentId: string, raw: unknown) {
  requireFull(ctx); if (!ctx.permissions.has("billing.cancel")) throw new AppError("FORBIDDEN");
  const { reason } = parseOrThrow(cancelSchema, raw);
  const tdb = db(ctx);
  const p = await tdb.payment.findFirst({ where: { id: paymentId } });
  if (!p) throw new AppError("NOT_FOUND", { message: "Payment not found." });
  if (p.status !== "SUCCESS" || p.refundedMinor > 0) throw new AppError("CONFLICT", { message: "Only a payment that has not been refunded can be cancelled." });
  await tdb.$transaction(async (tx: Client) => {
    if (await tx.refund.count({ where: { tenantId: ctx.tenantId, paymentId, status: { in: ["REQUESTED", "APPROVED"] } } })) throw new AppError("CONFLICT", { message: "Resolve the open refund request first." });
    const r = await tx.payment.updateMany({ where: { id: paymentId, tenantId: ctx.tenantId, status: "SUCCESS", refundedMinor: 0 }, data: { status: "CANCELLED", cancelledAt: new Date(), cancelledById: ctx.user.id, cancelReason: reason } });
    if (r.count !== 1) throw stale();
    await recomputeInvoice(tx, ctx.tenantId, p.invoiceId);
    await addInvoiceEvent(tx, ctx.tenantId, { id: p.invoiceId, patientId: p.patientId }, "PAYMENT_CANCELLED", ctx.user.id, { amountMinor: p.amountMinor, ref: p.paymentNumber, note: reason });
  });
  await recordAudit({ action: AUDIT_ACTIONS.PAYMENT_CANCELLED, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "payment", entityId: paymentId, metadata: { number: p.paymentNumber, amountMinor: p.amountMinor } });
  return { status: "CANCELLED" };
}

export interface PaymentRow { id: string; paymentNumber: string; receiptNumber: string | null; invoiceId: string; invoiceNumber: string; amountMinor: number; refundedMinor: number; method: string; status: string; transactionReference: string | null; paymentDate: string; receivedBy: string | null; patient: { id: string; code: string; name: string } | null }
export async function listPayments(ctx: TenantRequestContext, q: { q?: string; from?: string; to?: string; method?: string; status?: string; staffId?: string; patientId?: string; page?: number }) {
  requireFull(ctx);
  const tdb = db(ctx); const page = Math.max(1, q.page ?? 1); const text = q.q?.trim().slice(0, 60); const dt = /^\d{4}-\d{2}-\d{2}$/;
  const and: Record<string, unknown>[] = [];
  if (q.from && dt.test(q.from)) and.push({ paymentDate: { gte: q.from } }); if (q.to && dt.test(q.to)) and.push({ paymentDate: { lte: q.to } });
  if (q.method) and.push({ method: q.method }); if (q.status) and.push({ status: q.status }); if (q.staffId) and.push({ receivedById: q.staffId }); if (q.patientId) and.push({ patientId: q.patientId });
  if (text) and.push({ OR: [{ paymentNumber: containsCI(text) }, { receiptNumber: containsCI(text) }, { transactionReference: containsCI(text) }, { invoice: { invoiceNumber: containsCI(text) } }, { patient: { name: containsCI(text) } }, { patient: { code: containsCI(text) } }, { patient: { phone: containsCI(text.replace(/[\s-]/g, "")) } }] });
  const where = { AND: and };
  const [rows, total] = await Promise.all([tdb.payment.findMany({ where, orderBy: [{ createdAt: "desc" }], skip: (page - 1) * PAGE, take: PAGE, include: { patient: { select: { id: true, code: true, name: true } }, invoice: { select: { invoiceNumber: true } } } }), tdb.payment.count({ where })]);
  const ids = [...new Set(rows.map((r: { receivedById: string }) => r.receivedById))] as string[];
  const users = ids.length ? await tdb.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
  const nm = new Map<string, string>(users.map((u: { id: string; name: string }) => [u.id, u.name]));
  return { page, pageSize: PAGE, total, rows: rows.map((p: Record<string, any>) => ({ id: p.id, paymentNumber: p.paymentNumber, receiptNumber: p.receiptNumber, invoiceId: p.invoiceId, invoiceNumber: p.invoice.invoiceNumber, amountMinor: p.amountMinor, refundedMinor: p.refundedMinor, method: p.method, status: p.status, transactionReference: p.transactionReference, paymentDate: p.paymentDate, receivedBy: nm.get(p.receivedById) ?? null, patient: { id: p.patient.id, code: p.patient.code, name: p.patient.name } })) as PaymentRow[] }; // eslint-disable-line @typescript-eslint/no-explicit-any
}

/* ------------------------------------------------ refunds ------------------------------------------------ */
const ACTIVE_REFUND = ["REQUESTED", "APPROVED", "PROCESSED"];
export async function requestRefund(ctx: TenantRequestContext, raw: unknown) {
  requireFull(ctx); if (!ctx.permissions.has("billing.refund_request")) throw new AppError("FORBIDDEN");
  const v = parseOrThrow(refundRequestSchema, raw);
  const tdb = db(ctx); const settings = await loadBillingSettings(tdb, ctx.tenantId);
  const p = await tdb.payment.findFirst({ where: { id: v.paymentId } });
  if (!p) throw new AppError("NOT_FOUND", { message: "Payment not found." });
  if (!["SUCCESS", "PARTIALLY_REFUNDED"].includes(p.status)) throw new AppError("CONFLICT", { message: "Only a successful payment can be refunded." });
  const yr = todayIn(await tenantTimezone(ctx.tenantId)).slice(0, 4);
  const out = await tdb.$transaction(async (tx: Client) => {
    const existing = await tx.refund.findMany({ where: { tenantId: ctx.tenantId, paymentId: p.id, status: { in: ACTIVE_REFUND } }, select: { amountMinor: true } });
    const used = existing.reduce((a: number, r: { amountMinor: number }) => a + r.amountMinor, 0);
    if (v.amountMinor > p.amountMinor - used) throw new AppError("VALIDATION_ERROR", { message: "The refund is more than what can still be refunded for this payment.", fieldErrors: { amountMinor: "The refund is more than what can still be refunded for this payment." } });
    const n = await nextCounter(tx, ctx.tenantId, `ref:${yr}`);
    const r = await tx.refund.create({ data: { tenantId: ctx.tenantId, invoiceId: p.invoiceId, paymentId: p.id, refundNumber: `${settings.refundPrefix}-${yr}-${pad(n)}`, amountMinor: v.amountMinor, reason: v.reason, method: v.method ?? p.method, requestedById: ctx.user.id } });
    await addInvoiceEvent(tx, ctx.tenantId, { id: p.invoiceId, patientId: p.patientId }, "REFUND_REQUESTED", ctx.user.id, { amountMinor: v.amountMinor, ref: r.refundNumber, note: v.reason });
    return { id: r.id as string, refundNumber: r.refundNumber as string };
  });
  await notifyRefundRequested(ctx.tenantId, out.id, ctx.user.id);
  await recordAudit({ action: AUDIT_ACTIONS.REFUND_REQUESTED, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "refund", entityId: out.id, metadata: { number: out.refundNumber, paymentId: p.id, invoiceId: p.invoiceId, amountMinor: v.amountMinor } });
  return out;
}

export async function refundAction(ctx: TenantRequestContext, id: string, raw: unknown) {
  requireFull(ctx);
  const a = parseOrThrow(refundActionSchema, raw);
  const tdb = db(ctx); const tenantId = ctx.tenantId; const uid = ctx.user.id;
  const r = await tdb.refund.findFirst({ where: { id }, include: { payment: true } });
  if (!r) throw new AppError("NOT_FOUND", { message: "Refund not found." });
  const guardMove = (cnt: number) => { if (cnt !== 1) throw new AppError("CONFLICT", { message: "This refund was just changed by someone else. Refresh and try again." }); };
  if (a.action === "approve") {
    if (!ctx.permissions.has("billing.refund_approve")) throw new AppError("FORBIDDEN", { message: "Only an authorised approver can approve refunds." });
    if (r.requestedById === uid && !(await loadBillingSettings(tdb, tenantId)).refundSelfApproval) throw new AppError("FORBIDDEN", { message: "You can't approve a refund you requested." });
    await tdb.$transaction(async (tx: Client) => { guardMove((await tx.refund.updateMany({ where: { id, tenantId, status: "REQUESTED" }, data: { status: "APPROVED", approvedById: uid, approvedAt: new Date() } })).count); await addInvoiceEvent(tx, tenantId, { id: r.invoiceId, patientId: r.payment.patientId }, "REFUND_APPROVED", uid, { amountMinor: r.amountMinor, ref: r.refundNumber }); });
    await recordAudit({ action: AUDIT_ACTIONS.REFUND_APPROVED, tenantId, actorId: uid, entityType: "refund", entityId: id, metadata: { number: r.refundNumber, amountMinor: r.amountMinor, requestedBy: r.requestedById } });
    return { status: "APPROVED" };
  }
  if (a.action === "reject") {
    if (!ctx.permissions.has("billing.refund_approve")) throw new AppError("FORBIDDEN");
    if (!a.reason) throw new AppError("VALIDATION_ERROR", { message: "Enter a reason.", fieldErrors: { reason: "Enter a reason." } });
    await tdb.$transaction(async (tx: Client) => { guardMove((await tx.refund.updateMany({ where: { id, tenantId, status: { in: ["REQUESTED", "APPROVED"] } }, data: { status: "REJECTED", rejectedById: uid, rejectedAt: new Date(), rejectReason: a.reason } })).count); await addInvoiceEvent(tx, tenantId, { id: r.invoiceId, patientId: r.payment.patientId }, "REFUND_REJECTED", uid, { amountMinor: r.amountMinor, ref: r.refundNumber, note: a.reason }); });
    await recordAudit({ action: AUDIT_ACTIONS.REFUND_REJECTED, tenantId, actorId: uid, entityType: "refund", entityId: id, metadata: { number: r.refundNumber, amountMinor: r.amountMinor } });
    return { status: "REJECTED" };
  }
  if (a.action === "cancel") {
    if (r.requestedById !== uid && !ctx.permissions.has("billing.refund_approve")) throw new AppError("FORBIDDEN", { message: "Only the requester or an approver can cancel a refund request." });
    await tdb.$transaction(async (tx: Client) => { guardMove((await tx.refund.updateMany({ where: { id, tenantId, status: { in: ["REQUESTED", "APPROVED"] } }, data: { status: "CANCELLED" } })).count); await addInvoiceEvent(tx, tenantId, { id: r.invoiceId, patientId: r.payment.patientId }, "REFUND_REJECTED", uid, { amountMinor: r.amountMinor, ref: r.refundNumber, note: "Cancelled" }); });
    return { status: "CANCELLED" };
  }
  // process
  if (!ctx.permissions.has("billing.refund_process")) throw new AppError("FORBIDDEN", { message: "Only finance staff can process refunds." });
  if (r.method === "ONLINE") throw new AppError("VALIDATION_ERROR", { message: "Payment gateway not configured." });
  const day = todayIn(await tenantTimezone(tenantId));
  await tdb.$transaction(async (tx: Client) => {
    const cur = await tx.payment.findFirst({ where: { id: r.paymentId, tenantId } });
    if (!cur || !["SUCCESS", "PARTIALLY_REFUNDED"].includes(cur.status) || cur.refundedMinor + r.amountMinor > cur.amountMinor) throw new AppError("CONFLICT", { message: "This refund is more than the payment can still return." });
    guardMove((await tx.refund.updateMany({ where: { id, tenantId, status: "APPROVED" }, data: { status: "PROCESSED", processedById: uid, processedAt: new Date(), reference: a.reference ?? null } })).count);
    const nextRef = cur.refundedMinor + r.amountMinor;
    guardMove((await tx.payment.updateMany({ where: { id: cur.id, tenantId, refundedMinor: cur.refundedMinor }, data: { refundedMinor: nextRef, status: nextRef >= cur.amountMinor ? "REFUNDED" : "PARTIALLY_REFUNDED" } })).count);
    await recomputeInvoice(tx, tenantId, r.invoiceId);
    await addInvoiceEvent(tx, tenantId, { id: r.invoiceId, patientId: cur.patientId }, "REFUND_PROCESSED", uid, { amountMinor: r.amountMinor, ref: r.refundNumber, note: day });
  });
  await recordAudit({ action: AUDIT_ACTIONS.REFUND_PROCESSED, tenantId, actorId: uid, entityType: "refund", entityId: id, metadata: { number: r.refundNumber, amountMinor: r.amountMinor, paymentId: r.paymentId, invoiceId: r.invoiceId, approvedBy: r.approvedById } });
  return { status: "PROCESSED" };
}

export interface RefundRow { id: string; refundNumber: string; invoiceId: string; invoiceNumber: string; paymentNumber: string; amountMinor: number; reason: string; status: string; method: string; requestedBy: string | null; approvedBy: string | null; processedAt: string | null; createdAt: string | null; patient: { id: string; code: string; name: string } | null; can: { approve: boolean; reject: boolean; process: boolean; cancel: boolean } }
export async function listRefunds(ctx: TenantRequestContext, q: { status?: string; q?: string; page?: number }) {
  requireFull(ctx);
  const tdb = db(ctx); const page = Math.max(1, q.page ?? 1); const text = q.q?.trim().slice(0, 60);
  const and: Record<string, unknown>[] = []; if (q.status) and.push({ status: q.status });
  if (text) and.push({ OR: [{ refundNumber: containsCI(text) }, { invoice: { invoiceNumber: containsCI(text) } }, { invoice: { patient: { name: containsCI(text) } } }, { invoice: { patient: { code: containsCI(text) } } }] });
  const where = { AND: and };
  const [rows, total] = await Promise.all([tdb.refund.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * PAGE, take: PAGE, include: { invoice: { select: { invoiceNumber: true, patient: { select: { id: true, code: true, name: true } } } }, payment: { select: { paymentNumber: true } } } }), tdb.refund.count({ where })]);
  const ids = [...new Set(rows.flatMap((r: { requestedById: string; approvedById: string | null }) => [r.requestedById, r.approvedById]).filter(Boolean))] as string[];
  const users = ids.length ? await tdb.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
  const nm = new Map<string, string>(users.map((u: { id: string; name: string }) => [u.id, u.name]));
  const settings = await loadBillingSettings(tdb, ctx.tenantId);
  return { page, pageSize: PAGE, total, rows: rows.map((r: Record<string, any>) => ({ id: r.id, refundNumber: r.refundNumber, invoiceId: r.invoiceId, invoiceNumber: r.invoice.invoiceNumber, paymentNumber: r.payment.paymentNumber, amountMinor: r.amountMinor, reason: r.reason, status: r.status, method: r.method, requestedBy: nm.get(r.requestedById) ?? null, approvedBy: r.approvedById ? nm.get(r.approvedById) ?? null : null, processedAt: iso(r.processedAt), createdAt: iso(r.createdAt), patient: r.invoice.patient, // eslint-disable-line @typescript-eslint/no-explicit-any
    can: { approve: r.status === "REQUESTED" && ctx.permissions.has("billing.refund_approve") && (r.requestedById !== ctx.user.id || settings.refundSelfApproval), reject: ["REQUESTED", "APPROVED"].includes(r.status) && ctx.permissions.has("billing.refund_approve"), process: r.status === "APPROVED" && ctx.permissions.has("billing.refund_process"), cancel: ["REQUESTED", "APPROVED"].includes(r.status) && (r.requestedById === ctx.user.id || ctx.permissions.has("billing.refund_approve")) } })) as RefundRow[] };
}

/* ------------------------------------------------ cashier sessions (optional) ------------------------------------------------ */
export async function currentSession(ctx: TenantRequestContext) {
  requireFull(ctx);
  const s = await db(ctx).cashierSession.findFirst({ where: { openedById: ctx.user.id, status: "OPEN" } });
  const settings = await loadBillingSettings(db(ctx), ctx.tenantId);
  return { enabled: settings.useCashierSessions, session: s ? { id: s.id as string, openedAt: iso(s.openedAt) as string, openingMinor: s.openingMinor as number } : null };
}
export async function openSession(ctx: TenantRequestContext, raw: unknown) {
  requireFull(ctx); if (!ctx.permissions.has("billing.collect")) throw new AppError("FORBIDDEN");
  const v = parseOrThrow(sessionSchema, raw); const tdb = db(ctx);
  if (!(await loadBillingSettings(tdb, ctx.tenantId)).useCashierSessions) throw new AppError("CONFLICT", { message: "Cashier sessions are not switched on for this clinic." });
  if (await tdb.cashierSession.findFirst({ where: { openedById: ctx.user.id, status: "OPEN" }, select: { id: true } })) throw new AppError("CONFLICT", { message: "You already have an open session." });
  const s = await tdb.cashierSession.create({ data: { tenantId: ctx.tenantId, openedById: ctx.user.id, openingMinor: v.openingMinor ?? 0, notes: v.notes ?? null } });
  await recordAudit({ action: AUDIT_ACTIONS.CASHIER_OPENED, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "cashier_session", entityId: s.id, metadata: { openingMinor: s.openingMinor } });
  return { id: s.id as string };
}
export async function closeSession(ctx: TenantRequestContext, raw: unknown) {
  requireFull(ctx); if (!ctx.permissions.has("billing.collect")) throw new AppError("FORBIDDEN");
  const v = parseOrThrow(sessionSchema, raw); const tdb = db(ctx);
  if (v.closingMinor == null) throw new AppError("VALIDATION_ERROR", { message: "Enter the cash counted.", fieldErrors: { closingMinor: "Enter the cash counted." } });
  const s = await tdb.cashierSession.findFirst({ where: { openedById: ctx.user.id, status: "OPEN" } });
  if (!s) throw new AppError("NOT_FOUND", { message: "You have no open session." });
  const cash = await tdb.payment.findMany({ where: { receivedById: ctx.user.id, method: "CASH", status: { in: MONEY_IN }, createdAt: { gte: s.openedAt } }, select: { amountMinor: true } });
  const refunds = await tdb.refund.findMany({ where: { processedById: ctx.user.id, method: "CASH", status: "PROCESSED", processedAt: { gte: s.openedAt } }, select: { amountMinor: true } });
  const expected = s.openingMinor + cash.reduce((a: number, p: { amountMinor: number }) => a + p.amountMinor, 0) - refunds.reduce((a: number, p: { amountMinor: number }) => a + p.amountMinor, 0);
  const r = await tdb.cashierSession.updateMany({ where: { id: s.id, tenantId: ctx.tenantId, status: "OPEN" }, data: { status: "CLOSED", closedById: ctx.user.id, closedAt: new Date(), closingMinor: v.closingMinor, expectedMinor: expected, notes: v.notes ?? s.notes } });
  if (r.count !== 1) throw stale();
  await recordAudit({ action: AUDIT_ACTIONS.CASHIER_CLOSED, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "cashier_session", entityId: s.id, metadata: { closingMinor: v.closingMinor, expectedMinor: expected, differenceMinor: v.closingMinor - expected } });
  return { expectedMinor: expected, closingMinor: v.closingMinor, differenceMinor: v.closingMinor - expected };
}
