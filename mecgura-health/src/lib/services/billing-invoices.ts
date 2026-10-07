import "server-only";
import { notifyInvoiceIssued } from "@/lib/communications/triggers";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import type { TenantRequestContext } from "@/lib/auth/context";
import { COLLECTIBLE, computeInvoice, deriveInvoiceStatus, dueOf, isOverdue, MoneyError, type Discount, type LineInput } from "@/lib/billing/money";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { addDays, todayIn } from "@/lib/scheduling/time";
import { tenantDb } from "@/lib/tenant/db";
import { parseOrThrow } from "@/lib/validation";
import { cancelSchema, fromSourceSchema, invoiceInputSchema } from "@/lib/validation/billing";
import { nextCounter, tenantTimezone, type Client } from "./clinic-shared";
import { billGuard, loadBillingSettings, type BillingSettingsView } from "./billing-master";
import { containsCI } from "./shared";

/**
 * Invoices. The server computes every amount (integer minor units) and is the only source of truth. A DRAFT can be edited; once ISSUED
 * the lines, prices, discount and tax are frozen (snapshots) and money only changes through payments, refunds or cancellation.
 * Invoice status for money states is derived from what was actually collected/refunded, never set from the browser.
 */
const db = (ctx: TenantRequestContext) => tenantDb(ctx) as Client;
const pad = (n: number) => String(n).padStart(6, "0");
const iso = (d: Date | null | undefined) => d?.toISOString() ?? null;
const tzToday = async (tenantId: string) => todayIn(await tenantTimezone(tenantId));
const PAGE = 20;

export function viewGuard(ctx: TenantRequestContext) {
  billGuard(ctx);
  if (!ctx.permissions.has("billing.view") && !ctx.permissions.has("billing.view_own")) throw new AppError("FORBIDDEN");
}
const scope = (ctx: TenantRequestContext): Record<string, unknown> => (ctx.permissions.has("billing.view") ? {} : { doctorUserId: ctx.user.id });
export async function addInvoiceEvent(tx: Client, tenantId: string, inv: { id: string; patientId: string }, type: string, userId: string | null, extra: { amountMinor?: number | null; ref?: string | null; note?: string | null } = {}) {
  await tx.invoiceEvent.create({ data: { tenantId, invoiceId: inv.id, patientId: inv.patientId, type, userId, amountMinor: extra.amountMinor ?? null, ref: extra.ref ?? null, note: extra.note ?? null } });
}

/* --------------------------------------------- pricing --------------------------------------------- */
interface ResolvedLine extends LineInput { serviceId: string | null; code: string | null; description: string; type: string | null; taxName: string | null; sourceType: string | null; sourceId: string | null; discountInput: { type: string; value: number } | null }
async function resolveLines(tdb: Client, items: ReturnType<typeof invoiceInputSchema.parse>["items"]): Promise<ResolvedLine[]> {
  const ids = [...new Set(items.map((i) => i.serviceId).filter(Boolean))] as string[];
  const services = ids.length ? await tdb.billingService.findMany({ where: { id: { in: ids } } }) : [];
  const taxIds = [...new Set(services.map((s: { taxId: string | null }) => s.taxId).filter(Boolean))] as string[];
  const taxes = taxIds.length ? await tdb.billingTax.findMany({ where: { id: { in: taxIds } } }) : [];
  return items.map((it, n) => {
    if (!it.serviceId) return { serviceId: null, code: null, description: it.description!, type: it.sourceType ?? "OTHER", taxName: null, taxRateBp: 0, quantity: it.quantity, unitPriceMinor: it.unitPriceMinor!, discount: it.discount ?? null, discountEligible: true, sourceType: it.sourceType ?? "OTHER", sourceId: it.sourceId ?? null, discountInput: it.discount ?? null };
    const s = services.find((x: { id: string }) => x.id === it.serviceId);
    if (!s || !s.active) throw new AppError("VALIDATION_ERROR", { message: "That service is no longer available.", fieldErrors: { [`items.${n}.serviceId`]: "That service is no longer available." } });
    const t = s.taxId ? taxes.find((x: { id: string }) => x.id === s.taxId) : null;
    const tax = t && t.active ? t : null;
    return { serviceId: s.id, code: s.serviceCode, description: s.serviceName, type: s.type, taxName: tax?.name ?? null, taxRateBp: tax?.rateBp ?? 0, quantity: it.quantity, unitPriceMinor: s.priceMinor, discount: it.discount ?? null, discountEligible: s.discountEligible, sourceType: it.sourceType ?? s.type, sourceId: it.sourceId ?? null, discountInput: it.discount ?? null };
  });
}
function assertDiscountAllowed(ctx: TenantRequestContext, settings: BillingSettingsView, subtotal: number, discountTotal: number, reason: string | undefined) {
  if (discountTotal <= 0) return;
  if (!ctx.permissions.has("billing.discount")) throw new AppError("FORBIDDEN", { message: "You can't give discounts." });
  const rule = settings.discountRules[ctx.user.role];
  if (!rule) throw new AppError("FORBIDDEN", { message: "Your role isn't allowed to give discounts. A clinic admin sets the limits in billing settings." });
  if (discountTotal * 10000 > subtotal * rule.maxPercentBp) throw new AppError("VALIDATION_ERROR", { message: `Your discount limit is ${(rule.maxPercentBp / 100).toFixed(2).replace(/\.00$/, "")}% of the invoice.`, fieldErrors: { discount: "This discount is above your limit." } });
  if (rule.maxFixedMinor != null && discountTotal > rule.maxFixedMinor) throw new AppError("VALIDATION_ERROR", { message: "This discount is above your amount limit.", fieldErrors: { discount: "This discount is above your amount limit." } });
  if (!reason) throw new AppError("VALIDATION_ERROR", { message: "Enter a reason for the discount.", fieldErrors: { discountReason: "Enter a reason for the discount." } });
}
function compute(lines: ResolvedLine[], discount: Discount | null, taxMode: "EXCLUSIVE" | "INCLUSIVE") {
  try { return computeInvoice(lines, discount, taxMode); } catch (e) { if (e instanceof MoneyError) throw new AppError("VALIDATION_ERROR", { message: e.message, fieldErrors: { [e.field]: e.message } }); throw e; }
}

export async function previewInvoice(ctx: TenantRequestContext, raw: unknown) {
  viewGuard(ctx); if (!ctx.permissions.has("billing.create") && !ctx.permissions.has("billing.edit")) throw new AppError("FORBIDDEN");
  const v = parseOrThrow(invoiceInputSchema, raw);
  const tdb = db(ctx); const settings = await loadBillingSettings(tdb, ctx.tenantId);
  const lines = await resolveLines(tdb, v.items);
  const r = compute(lines, v.discount ?? null, settings.taxMode);
  assertDiscountAllowed(ctx, settings, r.subtotalMinor, r.discountMinor, v.discountReason);
  return { currency: settings.currency, taxMode: settings.taxMode, ...r, lines: r.lines.map((l, n) => ({ ...l, description: lines[n].description, code: lines[n].code, quantity: lines[n].quantity, unitPriceMinor: lines[n].unitPriceMinor, taxName: lines[n].taxName, taxRateBp: lines[n].taxRateBp })) };
}

/* --------------------------------------------- create / edit --------------------------------------------- */
async function checkLinks(tdb: Client, patientId: string, v: { appointmentId?: string; consultationId?: string; investigationOrderId?: string; followUpId?: string; opdVisitId?: string; doctorUserId?: string }) {
  let doctor: string | null = v.doctorUserId ?? null;
  const own = async (model: string, id: string | undefined, label: string) => {
    if (!id) return null;
    const r = await tdb[model].findFirst({ where: { id }, select: { patientId: true, doctorUserId: true } });
    if (!r || r.patientId !== patientId) throw new AppError("VALIDATION_ERROR", { message: `That ${label} doesn't belong to this patient.`, fieldErrors: { [`${label}Id`]: `That ${label} doesn't belong to this patient.` } });
    return r as { doctorUserId?: string };
  };
  const c = await own("consultation", v.consultationId, "consultation"); const a = await own("appointment", v.appointmentId, "appointment");
  await own("investigationOrder", v.investigationOrderId, "investigationOrder"); await own("followUp", v.followUpId, "followUp"); await own("opdVisit", v.opdVisitId, "opdVisit");
  doctor = c?.doctorUserId ?? a?.doctorUserId ?? doctor;
  if (doctor && !(await tdb.user.findFirst({ where: { id: doctor, role: { key: "DOCTOR" }, deletedAt: null }, select: { id: true } }))) throw new AppError("VALIDATION_ERROR", { message: "Choose a doctor from this clinic.", fieldErrors: { doctorUserId: "Choose a doctor from this clinic." } });
  return doctor;
}
const discountKey = (d: { type: string; value: number } | null | undefined) => (d ? `${d.type}:${d.value}` : "");
async function persistItems(tx: Client, tenantId: string, invoiceId: string, lines: ResolvedLine[], res: ReturnType<typeof computeInvoice>) {
  await tx.invoiceItem.deleteMany({ where: { tenantId, invoiceId } });
  await tx.invoiceItem.createMany({ data: lines.map((l, n) => ({ tenantId, invoiceId, position: n, serviceId: l.serviceId, serviceCodeSnapshot: l.code, descriptionSnapshot: l.description, serviceTypeSnapshot: l.type, quantity: l.quantity, unitPriceMinor: l.unitPriceMinor, discountType: l.discountInput?.type ?? null, discountValue: l.discountInput?.value ?? null, discountMinor: res.lines[n].discountMinor, invoiceDiscountMinor: res.lines[n].invoiceDiscountMinor, taxName: l.taxName, taxRateBp: l.taxRateBp, taxMinor: res.lines[n].taxMinor, lineSubtotalMinor: res.lines[n].lineSubtotalMinor, lineTotalMinor: res.lines[n].lineTotalMinor, sourceType: l.sourceType, sourceId: l.sourceId })) });
}

export async function createInvoice(ctx: TenantRequestContext, raw: unknown, opts: { sourceKey?: string; system?: boolean } = {}) {
  viewGuard(ctx);
  if (!opts.system && !ctx.permissions.has("billing.create")) throw new AppError("FORBIDDEN");
  const v = parseOrThrow(invoiceInputSchema, raw);
  const tdb = db(ctx); const settings = await loadBillingSettings(tdb, ctx.tenantId);
  const patient = await tdb.patient.findFirst({ where: { id: v.patientId }, select: { id: true, status: true } });
  if (!patient) throw new AppError("NOT_FOUND", { message: "Patient not found." });
  if (patient.status === "ARCHIVED") throw new AppError("CONFLICT", { message: "This patient record is archived." });
  const doctorUserId = await checkLinks(tdb, v.patientId, v);
  const lines = await resolveLines(tdb, v.items);
  const res = compute(lines, v.discount ?? null, settings.taxMode);
  if (!opts.system) assertDiscountAllowed(ctx, settings, res.subtotalMinor, res.discountMinor, v.discountReason);
  const today = await tzToday(ctx.tenantId); const yr = today.slice(0, 4);
  const invoiceDate = v.invoiceDate ?? today;
  const out = await tdb.$transaction(async (tx: Client) => {
    if (opts.sourceKey) { const ex = await tx.invoice.findFirst({ where: { tenantId: ctx.tenantId, sourceKey: opts.sourceKey }, select: { id: true, invoiceNumber: true } }); if (ex) return { ...ex, existing: true as const }; }
    const n = await nextCounter(tx, ctx.tenantId, `inv:${yr}`);
    const inv = await tx.invoice.create({ data: { tenantId: ctx.tenantId, invoiceNumber: `${settings.invoicePrefix}-${yr}-${pad(n)}`, patientId: v.patientId, appointmentId: v.appointmentId ?? null, consultationId: v.consultationId ?? null, investigationOrderId: v.investigationOrderId ?? null, followUpId: v.followUpId ?? null, opdVisitId: v.opdVisitId ?? null, doctorUserId, sourceKey: opts.sourceKey ?? null, currency: settings.currency, taxMode: settings.taxMode, invoiceDate, dueDate: v.dueDate ?? null, discountType: v.discount?.type ?? null, discountValue: v.discount?.value ?? null, discountReason: res.discountMinor > 0 ? v.discountReason ?? null : null, discountById: res.discountMinor > 0 ? ctx.user.id : null, subtotalMinor: res.subtotalMinor, discountMinor: res.discountMinor, taxMinor: res.taxMinor, totalMinor: res.totalMinor, dueMinor: 0, notes: v.notes ?? null, createdById: ctx.user.id } });
    await persistItems(tx, ctx.tenantId, inv.id, lines, res);
    await addInvoiceEvent(tx, ctx.tenantId, inv, "CREATED", ctx.user.id, { amountMinor: res.totalMinor, note: opts.system ? "Created by clinic rule" : null });
    return { id: inv.id as string, invoiceNumber: inv.invoiceNumber as string, existing: false as const };
  });
  if (!out.existing) {
    await recordAudit({ action: AUDIT_ACTIONS.INVOICE_CREATED, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "invoice", entityId: out.id, metadata: { number: out.invoiceNumber, items: lines.length, totalMinor: res.totalMinor, auto: !!opts.system } });
    if (res.discountMinor > 0) await recordAudit({ action: AUDIT_ACTIONS.DISCOUNT_APPLIED, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "invoice", entityId: out.id, metadata: { discountMinor: res.discountMinor, percentBp: Math.round((res.discountMinor * 10000) / Math.max(1, res.subtotalMinor)), reason: v.discountReason ?? null } });
  }
  return out;
}

export async function updateDraft(ctx: TenantRequestContext, id: string, raw: unknown) {
  viewGuard(ctx); if (!ctx.permissions.has("billing.edit")) throw new AppError("FORBIDDEN");
  const v = parseOrThrow(invoiceInputSchema, raw);
  const tdb = db(ctx); const settings = await loadBillingSettings(tdb, ctx.tenantId);
  const cur = await tdb.invoice.findFirst({ where: { id }, include: { items: true } });
  if (!cur) throw new AppError("NOT_FOUND", { message: "Invoice not found." });
  if (cur.status !== "DRAFT") throw new AppError("CONFLICT", { message: "An issued invoice can't be edited. Cancel it or use a refund." });
  if (v.patientId !== cur.patientId) throw new AppError("VALIDATION_ERROR", { message: "The patient of an invoice can't be changed.", fieldErrors: { patientId: "The patient of an invoice can't be changed." } });
  const doctorUserId = await checkLinks(tdb, cur.patientId, { appointmentId: v.appointmentId ?? cur.appointmentId ?? undefined, consultationId: v.consultationId ?? cur.consultationId ?? undefined, investigationOrderId: cur.investigationOrderId ?? undefined, followUpId: cur.followUpId ?? undefined, opdVisitId: cur.opdVisitId ?? undefined, doctorUserId: v.doctorUserId ?? cur.doctorUserId ?? undefined });
  const lines = await resolveLines(tdb, v.items);
  const res = compute(lines, v.discount ?? null, settings.taxMode);
  const unchanged = discountKey(v.discount) === discountKey(cur.discountType ? { type: cur.discountType, value: cur.discountValue } : null) && lines.map((l) => discountKey(l.discountInput)).join("|") === [...cur.items].sort((a: { position: number }, b: { position: number }) => a.position - b.position).map((i: { discountType: string | null; discountValue: number | null }) => discountKey(i.discountType ? { type: i.discountType, value: i.discountValue! } : null)).join("|");
  if (!unchanged) assertDiscountAllowed(ctx, settings, res.subtotalMinor, res.discountMinor, v.discountReason ?? cur.discountReason ?? undefined);
  await tdb.$transaction(async (tx: Client) => {
    const r = await tx.invoice.updateMany({ where: { id, tenantId: ctx.tenantId, status: "DRAFT" }, data: { doctorUserId, taxMode: settings.taxMode, currency: settings.currency, invoiceDate: v.invoiceDate ?? cur.invoiceDate, dueDate: v.dueDate ?? null, discountType: v.discount?.type ?? null, discountValue: v.discount?.value ?? null, discountReason: res.discountMinor > 0 ? v.discountReason ?? cur.discountReason ?? null : null, discountById: res.discountMinor > 0 && !unchanged ? ctx.user.id : res.discountMinor > 0 ? cur.discountById : null, subtotalMinor: res.subtotalMinor, discountMinor: res.discountMinor, taxMinor: res.taxMinor, totalMinor: res.totalMinor, notes: v.notes ?? null } });
    if (r.count !== 1) throw new AppError("CONFLICT", { message: "This invoice was just issued or changed. Refresh and try again." });
    await persistItems(tx, ctx.tenantId, id, lines, res);
    await addInvoiceEvent(tx, ctx.tenantId, cur, "EDITED", ctx.user.id, { amountMinor: res.totalMinor });
  });
  await recordAudit({ action: AUDIT_ACTIONS.INVOICE_EDITED, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "invoice", entityId: id, metadata: { number: cur.invoiceNumber, totalMinor: res.totalMinor, discountChanged: !unchanged } });
  if (!unchanged && res.discountMinor > 0) await recordAudit({ action: AUDIT_ACTIONS.DISCOUNT_APPLIED, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "invoice", entityId: id, metadata: { discountMinor: res.discountMinor, percentBp: Math.round((res.discountMinor * 10000) / Math.max(1, res.subtotalMinor)), reason: v.discountReason ?? null } });
  return { id };
}

export async function issueInvoice(ctx: TenantRequestContext, id: string) {
  viewGuard(ctx); if (!ctx.permissions.has("billing.create")) throw new AppError("FORBIDDEN");
  const tdb = db(ctx); const settings = await loadBillingSettings(tdb, ctx.tenantId);
  const cur = await tdb.invoice.findFirst({ where: { id }, include: { items: { select: { id: true } } } });
  if (!cur) throw new AppError("NOT_FOUND", { message: "Invoice not found." });
  if (cur.status !== "DRAFT") throw new AppError("CONFLICT", { message: "This invoice is already issued or closed." });
  if (!cur.items.length || cur.totalMinor <= 0) throw new AppError("VALIDATION_ERROR", { message: "An invoice needs at least one item and a total above zero before it is issued." });
  const today = await tzToday(ctx.tenantId);
  const dueDate = cur.dueDate ?? (settings.dueDays != null ? addDays(cur.invoiceDate, settings.dueDays) : null);
  await tdb.$transaction(async (tx: Client) => {
    const r = await tx.invoice.updateMany({ where: { id, tenantId: ctx.tenantId, status: "DRAFT" }, data: { status: "ISSUED", issuedAt: new Date(), issuedById: ctx.user.id, dueDate, dueMinor: cur.totalMinor, footerSnapshot: settings.invoiceFooter, termsSnapshot: settings.paymentTerms, invoiceDate: cur.invoiceDate > today ? today : cur.invoiceDate } });
    if (r.count !== 1) throw new AppError("CONFLICT", { message: "This invoice was just issued or changed. Refresh and try again." });
    await addInvoiceEvent(tx, ctx.tenantId, cur, "ISSUED", ctx.user.id, { amountMinor: cur.totalMinor });
  });
  await recordAudit({ action: AUDIT_ACTIONS.INVOICE_ISSUED, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "invoice", entityId: id, metadata: { number: cur.invoiceNumber, totalMinor: cur.totalMinor, taxMode: cur.taxMode } });
  await notifyInvoiceIssued(ctx.tenantId, id);
  return { status: "ISSUED" };
}

export async function cancelInvoice(ctx: TenantRequestContext, id: string, raw: unknown) {
  viewGuard(ctx);
  const { reason } = parseOrThrow(cancelSchema, raw);
  const tdb = db(ctx);
  const cur = await tdb.invoice.findFirst({ where: { id } });
  if (!cur) throw new AppError("NOT_FOUND", { message: "Invoice not found." });
  if (cur.status === "CANCELLED") throw new AppError("CONFLICT", { message: "This invoice is already cancelled." });
  if (cur.status === "DRAFT") { if (!ctx.permissions.has("billing.edit") && !ctx.permissions.has("billing.create")) throw new AppError("FORBIDDEN"); }
  else if (!ctx.permissions.has("billing.cancel")) throw new AppError("FORBIDDEN", { message: "Only finance staff can cancel an issued invoice." });
  if (cur.collectedMinor > 0 || cur.refundedMinor > 0) throw new AppError("CONFLICT", { message: "Payments were recorded on this invoice. Cancel the payments or refund them first." });
  await tdb.$transaction(async (tx: Client) => {
    const open = await tx.refund.count({ where: { tenantId: ctx.tenantId, invoiceId: id, status: { in: ["REQUESTED", "APPROVED"] } } });
    if (open) throw new AppError("CONFLICT", { message: "Resolve the open refund requests first." });
    const r = await tx.invoice.updateMany({ where: { id, tenantId: ctx.tenantId, status: cur.status, collectedMinor: 0 }, data: { status: "CANCELLED", cancelledAt: new Date(), cancelledById: ctx.user.id, cancelReason: reason, dueMinor: 0 } });
    if (r.count !== 1) throw new AppError("CONFLICT", { message: "This invoice was just changed. Refresh and try again." });
    await addInvoiceEvent(tx, ctx.tenantId, cur, "CANCELLED", ctx.user.id, { note: reason });
  });
  await recordAudit({ action: AUDIT_ACTIONS.INVOICE_CANCELLED, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "invoice", entityId: id, metadata: { number: cur.invoiceNumber, wasDraft: cur.status === "DRAFT" } });
  return { status: "CANCELLED" };
}

/* --------------------------------------------- reads --------------------------------------------- */
export interface InvoiceRow { id: string; invoiceNumber: string; invoiceDate: string; dueDate: string | null; status: string; displayStatus: string; currency: string; totalMinor: number; collectedMinor: number; refundedMinor: number; paidMinor: number; dueMinor: number; patient: { id: string; code: string; name: string } | null }
const rowOf = (i: Record<string, any>, today: string, showPatient: boolean): InvoiceRow => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
  id: i.id, invoiceNumber: i.invoiceNumber, invoiceDate: i.invoiceDate, dueDate: i.dueDate, status: i.status, displayStatus: isOverdue(i as never, today) ? "OVERDUE" : i.status, currency: i.currency, totalMinor: i.totalMinor, collectedMinor: i.collectedMinor, refundedMinor: i.refundedMinor,
  paidMinor: i.collectedMinor - i.refundedMinor, dueMinor: i.status === "CANCELLED" || i.status === "DRAFT" ? 0 : dueOf(i as never), patient: showPatient && i.patient ? { id: i.patient.id, code: i.patient.code, name: i.patient.name } : null,
});

export async function listInvoices(ctx: TenantRequestContext, q: { status?: string; q?: string; from?: string; to?: string; doctorId?: string; method?: string; serviceId?: string; staffId?: string; patientId?: string; outstanding?: boolean; page?: number }) {
  viewGuard(ctx);
  const tdb = db(ctx); const today = await tzToday(ctx.tenantId); const page = Math.max(1, q.page ?? 1); const text = q.q?.trim().slice(0, 60);
  const and: Record<string, unknown>[] = [scope(ctx)];
  if (q.status === "OVERDUE") and.push({ status: { in: [...COLLECTIBLE] }, dueDate: { lt: today }, dueMinor: { gt: 0 } });
  else if (q.status) and.push({ status: q.status });
  if (q.outstanding) and.push({ status: { in: [...COLLECTIBLE] }, dueMinor: { gt: 0 } });
  const dt = /^\d{4}-\d{2}-\d{2}$/;
  if (q.from && dt.test(q.from)) and.push({ invoiceDate: { gte: q.from } });
  if (q.to && dt.test(q.to)) and.push({ invoiceDate: { lte: q.to } });
  if (q.doctorId) and.push({ doctorUserId: q.doctorId });
  if (q.staffId) and.push({ createdById: q.staffId });
  if (q.patientId) and.push({ patientId: q.patientId });
  if (q.method) and.push({ payments: { some: { method: q.method } } });
  if (q.serviceId) and.push({ items: { some: { serviceId: q.serviceId } } });
  if (text) and.push({ OR: [{ invoiceNumber: containsCI(text) }, { patient: { name: containsCI(text) } }, { patient: { code: containsCI(text) } }, { patient: { phone: containsCI(text.replace(/[\s-]/g, "")) } }, { payments: { some: { OR: [{ paymentNumber: containsCI(text) }, { receiptNumber: containsCI(text) }, { transactionReference: containsCI(text) }] } } }] });
  const where = { AND: and };
  const showPatient = ctx.permissions.has("billing.view");
  const [rows, total] = await Promise.all([tdb.invoice.findMany({ where, orderBy: q.outstanding ? [{ dueDate: "asc" }, { invoiceDate: "asc" }] : [{ invoiceDate: "desc" }, { createdAt: "desc" }], skip: (page - 1) * PAGE, take: PAGE, include: { patient: { select: { id: true, code: true, name: true } } } }), tdb.invoice.count({ where })]);
  return { page, pageSize: PAGE, total, today, rows: rows.map((r: Record<string, unknown>) => rowOf(r, today, showPatient)) as InvoiceRow[] };
}

async function userNames(tdb: Client, ids: (string | null | undefined)[]) {
  const list = [...new Set(ids.filter(Boolean))] as string[];
  const users = list.length ? await tdb.user.findMany({ where: { id: { in: list } }, select: { id: true, name: true } }) : [];
  return new Map<string, string>(users.map((u: { id: string; name: string }) => [u.id, u.name]));
}
export async function getInvoice(ctx: TenantRequestContext, id: string) {
  viewGuard(ctx);
  const tdb = db(ctx); const today = await tzToday(ctx.tenantId);
  const i = await tdb.invoice.findFirst({ where: { AND: [{ id }, scope(ctx)] }, include: { patient: true, items: { orderBy: { position: "asc" } }, payments: { orderBy: { createdAt: "asc" } }, refunds: { orderBy: { createdAt: "asc" } }, events: { orderBy: { at: "desc" }, take: 100 } } });
  if (!i) throw new AppError("NOT_FOUND", { message: "Invoice not found." });
  const nm = await userNames(tdb, [i.createdById, i.issuedById, i.cancelledById, i.discountById, i.doctorUserId, ...i.payments.map((p: { receivedById: string }) => p.receivedById), ...i.refunds.flatMap((r: { requestedById: string; approvedById: string | null; processedById: string | null }) => [r.requestedById, r.approvedById, r.processedById]), ...i.events.map((e: { userId: string | null }) => e.userId)]);
  const settings = await loadBillingSettings(tdb, ctx.tenantId);
  const full = ctx.permissions.has("billing.view");
  const row = rowOf(i, today, full);
  const active = i.refunds.filter((r: { status: string }) => ["REQUESTED", "APPROVED", "PROCESSED"].includes(r.status));
  const payments = i.payments.map((p: Record<string, any>) => ({ id: p.id, paymentNumber: p.paymentNumber, receiptNumber: p.receiptNumber, amountMinor: p.amountMinor, method: p.method, status: p.status, transactionReference: p.transactionReference, paymentDate: p.paymentDate, notes: p.notes, receivedBy: nm.get(p.receivedById) ?? null, refundedMinor: p.refundedMinor, refundableMinor: ["SUCCESS", "PARTIALLY_REFUNDED"].includes(p.status) ? p.amountMinor - active.filter((r: { paymentId: string }) => r.paymentId === p.id).reduce((a: number, r: { amountMinor: number }) => a + r.amountMinor, 0) : 0 })) as { id: string; paymentNumber: string; receiptNumber: string | null; amountMinor: number; method: string; status: string; transactionReference: string | null; paymentDate: string; notes: string | null; receivedBy: string | null; refundedMinor: number; refundableMinor: number }[]; // eslint-disable-line @typescript-eslint/no-explicit-any
  const open = (COLLECTIBLE as readonly string[]).includes(i.status);
  return {
    ...row, taxMode: i.taxMode, subtotalMinor: i.subtotalMinor, discountMinor: i.discountMinor, taxMinor: i.taxMinor, notes: i.notes, discountType: i.discountType, discountValue: i.discountValue, discountReason: i.discountReason, discountBy: i.discountById ? nm.get(i.discountById) ?? null : null,
    footer: i.footerSnapshot, terms: i.termsSnapshot, issuedAt: iso(i.issuedAt), issuedBy: i.issuedById ? nm.get(i.issuedById) ?? null : null, createdBy: nm.get(i.createdById) ?? null, createdAt: iso(i.createdAt), cancelledAt: iso(i.cancelledAt), cancelReason: i.cancelReason, doctorUserId: i.doctorUserId, doctorName: i.doctorUserId ? nm.get(i.doctorUserId) ?? null : null,
    links: { appointmentId: i.appointmentId, consultationId: ctx.permissions.has("patients.clinical") ? i.consultationId : null, investigationOrderId: ctx.permissions.has("tests.view") ? i.investigationOrderId : null, followUpId: i.followUpId },
    patient: full ? { id: i.patient.id, code: i.patient.code, name: i.patient.name, phone: i.patient.phone } : null,
    items: i.items.map((x: Record<string, any>) => ({ id: x.id, serviceId: x.serviceId, serviceCode: x.serviceCodeSnapshot, description: x.descriptionSnapshot, type: x.serviceTypeSnapshot, quantity: x.quantity, unitPriceMinor: x.unitPriceMinor, discountType: x.discountType, discountValue: x.discountValue, discountMinor: x.discountMinor, invoiceDiscountMinor: x.invoiceDiscountMinor, taxName: x.taxName, taxRateBp: x.taxRateBp, taxMinor: x.taxMinor, lineSubtotalMinor: x.lineSubtotalMinor, lineTotalMinor: x.lineTotalMinor, sourceType: x.sourceType })) as { id: string; serviceId: string | null; serviceCode: string | null; description: string; type: string | null; quantity: number; unitPriceMinor: number; discountType: string | null; discountValue: number | null; discountMinor: number; invoiceDiscountMinor: number; taxName: string | null; taxRateBp: number; taxMinor: number; lineSubtotalMinor: number; lineTotalMinor: number; sourceType: string | null }[], // eslint-disable-line @typescript-eslint/no-explicit-any
    payments,
    refunds: i.refunds.map((r: Record<string, any>) => ({ id: r.id, refundNumber: r.refundNumber, paymentId: r.paymentId, amountMinor: r.amountMinor, reason: r.reason, method: r.method, status: r.status, requestedBy: nm.get(r.requestedById) ?? null, approvedBy: r.approvedById ? nm.get(r.approvedById) ?? null : null, processedBy: r.processedById ? nm.get(r.processedById) ?? null : null, processedAt: iso(r.processedAt), createdAt: iso(r.createdAt) })) as { id: string; refundNumber: string; paymentId: string; amountMinor: number; reason: string; method: string; status: string; requestedBy: string | null; approvedBy: string | null; processedBy: string | null; processedAt: string | null; createdAt: string | null }[], // eslint-disable-line @typescript-eslint/no-explicit-any
    events: i.events.map((e: Record<string, any>) => ({ id: e.id, type: e.type, by: e.userId ? nm.get(e.userId) ?? null : "System", amountMinor: e.amountMinor, note: e.note, at: iso(e.at) })) as { id: string; type: string; by: string | null; amountMinor: number | null; note: string | null; at: string | null }[], // eslint-disable-line @typescript-eslint/no-explicit-any
    settings: { paymentMethods: settings.paymentMethods, allowOverpayment: settings.allowOverpayment, currency: settings.currency },
    can: {
      edit: full && i.status === "DRAFT" && ctx.permissions.has("billing.edit"), issue: full && i.status === "DRAFT" && ctx.permissions.has("billing.create"),
      cancel: full && ((i.status === "DRAFT" && (ctx.permissions.has("billing.edit") || ctx.permissions.has("billing.create"))) || (open && ctx.permissions.has("billing.cancel") && i.collectedMinor === 0)),
      collect: full && open && dueOf(i) > 0 && ctx.permissions.has("billing.collect"), cancelPayment: full && ctx.permissions.has("billing.cancel"),
      refund: full && ctx.permissions.has("billing.refund_request") && payments.some((p: { refundableMinor: number }) => p.refundableMinor > 0), print: full && i.status !== "DRAFT",
    },
  };
}
export type InvoiceDetail = Awaited<ReturnType<typeof getInvoice>>;

/* --------------------------------------------- status on clinical records + automatic drafts --------------------------------------------- */
export async function billingStatusFor(ctx: TenantRequestContext, kind: string, id: string) {
  viewGuard(ctx);
  const tdb = db(ctx); const today = await tzToday(ctx.tenantId);
  const key = ({ consultation: "consultationId", appointment: "appointmentId", investigation: "investigationOrderId", followup: "followUpId" } as Record<string, string>)[kind];
  if (!key) throw new AppError("VALIDATION_ERROR", { message: "Unknown record type." });
  const rows = await tdb.invoice.findMany({ where: { AND: [{ [key]: id }, { status: { not: "CANCELLED" } }, scope(ctx)] }, orderBy: { createdAt: "desc" }, take: 5 });
  if (!rows.length) return { status: "NOT_BILLED" as string, invoiceId: null as string | null, invoiceNumber: null as string | null, totalMinor: 0, dueMinor: 0, currency: null as string | null, canCreate: ctx.permissions.has("billing.create") };
  const issued = rows.filter((r: { status: string }) => r.status !== "DRAFT");
  const pick = (issued[0] ?? rows[0]) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const status = pick.status === "DRAFT" ? "DRAFT" : isOverdue(pick as never, today) ? "OVERDUE" : pick.status === "ISSUED" ? "UNPAID" : pick.status;
  return { status, invoiceId: ctx.permissions.has("billing.view") ? (pick.id as string) : null, invoiceNumber: pick.invoiceNumber as string, totalMinor: pick.totalMinor as number, dueMinor: pick.status === "DRAFT" ? pick.totalMinor : dueOf(pick as never), currency: pick.currency as string, canCreate: false };
}

/** Builds a DRAFT from a clinical record using the clinic's configured services only. Never issues, never marks paid. */
async function draftFromSource(ctx: TenantRequestContext, kind: string, id: string, system: boolean) {
  const tdb = db(ctx); const settings = await loadBillingSettings(tdb, ctx.tenantId);
  const svc = async (serviceId: string | null) => (serviceId ? tdb.billingService.findFirst({ where: { id: serviceId, active: true }, select: { id: true } }) : null);
  let patientId = ""; const link: Record<string, string> = {}; const items: Record<string, unknown>[] = []; const skipped: string[] = []; let key = "";
  if (kind === "consultation" || kind === "appointment") {
    const r = kind === "consultation" ? await tdb.consultation.findFirst({ where: { id }, select: { patientId: true, opdVisit: { select: { visitType: true } }, appointment: { select: { type: true, id: true } } } }) : await tdb.appointment.findFirst({ where: { id }, select: { patientId: true, type: true } });
    if (!r) throw new AppError("NOT_FOUND", { message: "Record not found." });
    if (!r.patientId) throw new AppError("VALIDATION_ERROR", { message: "This record has no patient to bill." });
    patientId = r.patientId; link[kind === "consultation" ? "consultationId" : "appointmentId"] = id; key = `${kind === "consultation" ? "consult" : "appt"}:${id}`;
    const follow = kind === "consultation" ? r.opdVisit?.visitType === "FOLLOW_UP" || r.appointment?.type === "FOLLOW_UP" : r.type === "FOLLOW_UP";
    const sid = follow ? settings.defaultFollowUpServiceId ?? settings.defaultConsultationServiceId : settings.defaultConsultationServiceId;
    const s = await svc(sid);
    if (!s) throw new AppError("VALIDATION_ERROR", { message: "No billable service is configured for this visit. Set the default services in billing settings." });
    items.push({ serviceId: s.id, quantity: 1, sourceType: follow ? "FOLLOW_UP" : "CONSULTATION", sourceId: id });
  } else if (kind === "investigation") {
    const o = await tdb.investigationOrder.findFirst({ where: { id }, include: { items: true } });
    if (!o) throw new AppError("NOT_FOUND", { message: "Order not found." });
    patientId = o.patientId; link.investigationOrderId = id; link.consultationId = o.consultationId ?? ""; key = `invorder:${id}`;
    for (const it of o.items.filter((x: { status: string }) => x.status !== "CANCELLED")) {
      const s = it.investigationId ? await tdb.billingService.findFirst({ where: { investigationId: it.investigationId, active: true }, select: { id: true } }) : null;
      if (s) items.push({ serviceId: s.id, quantity: 1, sourceType: "INVESTIGATION", sourceId: it.id }); else skipped.push(it.testNameSnapshot);
    }
    if (!items.length) throw new AppError("VALIDATION_ERROR", { message: "None of these tests has a price in the service list." });
  } else {
    const f = await tdb.followUp.findFirst({ where: { id }, select: { patientId: true, doctorUserId: true, appointmentId: true } });
    if (!f) throw new AppError("NOT_FOUND", { message: "Follow-up not found." });
    patientId = f.patientId; link.followUpId = id; key = `followup:${id}`; if (f.appointmentId) link.appointmentId = f.appointmentId;
    const s = await svc(settings.defaultFollowUpServiceId ?? settings.defaultConsultationServiceId);
    if (!s) throw new AppError("VALIDATION_ERROR", { message: "No follow-up service is configured. Set it in billing settings." });
    items.push({ serviceId: s.id, quantity: 1, sourceType: "FOLLOW_UP", sourceId: id });
  }
  const payload = { patientId, items, ...Object.fromEntries(Object.entries(link).filter(([, v]) => v)) };
  const r = await createInvoice(ctx, payload, { sourceKey: key, system });
  return { ...r, skipped };
}
export async function createInvoiceFromSource(ctx: TenantRequestContext, raw: unknown) {
  viewGuard(ctx); if (!ctx.permissions.has("billing.create")) throw new AppError("FORBIDDEN");
  const v = parseOrThrow(fromSourceSchema, raw);
  return draftFromSource(ctx, v.kind, v.id, false);
}
/** Clinic-rule hook (billing settings). Does nothing unless the clinic enabled it; creates a DRAFT only; never blocks the clinical action. */
export async function autoBill(ctx: TenantRequestContext, kind: "consultation" | "investigation" | "followup", id: string) {
  try {
    const s = await loadBillingSettings(db(ctx), ctx.tenantId);
    if (kind === "consultation" ? !s.autoBillConsultation : kind === "investigation" ? !s.autoBillInvestigation : !s.autoBillFollowUp) return;
    await draftFromSource(ctx, kind, id, true);
  } catch (e) { logger.error("billing.auto_failed", { kind, id, error: e instanceof Error ? e.message : String(e) }); }
}

/** Re-derives the stored money fields of an invoice from its payments and refunds (call inside the caller's transaction). */
export async function recomputeInvoice(tx: Client, tenantId: string, invoiceId: string) {
  const inv = await tx.invoice.findFirst({ where: { id: invoiceId, tenantId }, select: { totalMinor: true, status: true } });
  const pay = await tx.payment.findMany({ where: { tenantId, invoiceId, status: { in: ["SUCCESS", "PARTIALLY_REFUNDED", "REFUNDED"] } }, select: { amountMinor: true } });
  const ref = await tx.refund.findMany({ where: { tenantId, invoiceId, status: "PROCESSED" }, select: { amountMinor: true } });
  const collectedMinor = pay.reduce((a: number, p: { amountMinor: number }) => a + p.amountMinor, 0); const refundedMinor = ref.reduce((a: number, r: { amountMinor: number }) => a + r.amountMinor, 0);
  const status = inv.status === "CANCELLED" || inv.status === "DRAFT" ? inv.status : deriveInvoiceStatus({ totalMinor: inv.totalMinor, collectedMinor, refundedMinor });
  await tx.invoice.updateMany({ where: { id: invoiceId, tenantId }, data: { collectedMinor, refundedMinor, dueMinor: Math.max(0, inv.totalMinor - collectedMinor), status } });
  return { collectedMinor, refundedMinor, status };
}

/**
 * Pharmacy hook: an ISSUED invoice built from the dispensing snapshot, created inside the caller's transaction so a bill can't exist
 * without the stock movement (or the other way round). Idempotent through `sourceKey`. Payment is collected in Billing like any invoice.
 */
export interface PharmacyBillLine { description: string; code: string; quantity: number; unitPriceMinor: number; taxRateBp: number; sourceId: string }
export async function createPharmacyInvoice(tx: Client, ctx: TenantRequestContext, a: { patientId: string; consultationId?: string | null; doctorUserId?: string | null; sourceKey: string; lines: PharmacyBillLine[] }) {
  const settings = await loadBillingSettings(tx, ctx.tenantId);
  const existing = await tx.invoice.findFirst({ where: { tenantId: ctx.tenantId, sourceKey: a.sourceKey }, select: { id: true, invoiceNumber: true, totalMinor: true } });
  if (existing) return { ...existing, lines: null as null, existing: true as const };
  let res: ReturnType<typeof computeInvoice>;
  try { res = computeInvoice(a.lines.map((l) => ({ quantity: l.quantity, unitPriceMinor: l.unitPriceMinor, taxRateBp: l.taxRateBp, discountEligible: true })), null, settings.taxMode); }
  catch (e) { if (e instanceof MoneyError) throw new AppError("VALIDATION_ERROR", { message: e.message }); throw e; }
  if (res.totalMinor <= 0) throw new AppError("VALIDATION_ERROR", { message: "The bill total must be above zero. Set a selling price for the medicine." });
  const today = await tzToday(ctx.tenantId); const yr = today.slice(0, 4);
  const n = await nextCounter(tx, ctx.tenantId, `inv:${yr}`);
  const inv = await tx.invoice.create({ data: { tenantId: ctx.tenantId, invoiceNumber: `${settings.invoicePrefix}-${yr}-${pad(n)}`, patientId: a.patientId, consultationId: a.consultationId ?? null, doctorUserId: a.doctorUserId ?? null, sourceKey: a.sourceKey, status: "ISSUED", currency: settings.currency, taxMode: settings.taxMode, invoiceDate: today, dueDate: settings.dueDays != null ? addDays(today, settings.dueDays) : null, subtotalMinor: res.subtotalMinor, discountMinor: 0, taxMinor: res.taxMinor, totalMinor: res.totalMinor, dueMinor: res.totalMinor, notes: "Pharmacy bill", footerSnapshot: settings.invoiceFooter, termsSnapshot: settings.paymentTerms, issuedAt: new Date(), issuedById: ctx.user.id, createdById: ctx.user.id }, select: { id: true, invoiceNumber: true, patientId: true } });
  const lines = a.lines.map((l) => ({ serviceId: null, code: l.code, description: l.description, type: "MEDICINE", taxName: l.taxRateBp ? "Tax" : null, taxRateBp: l.taxRateBp, quantity: l.quantity, unitPriceMinor: l.unitPriceMinor, discount: null, discountInput: null, discountEligible: true, sourceType: "MEDICINE", sourceId: l.sourceId } as ResolvedLine));
  await persistItems(tx, ctx.tenantId, inv.id, lines, res);
  await addInvoiceEvent(tx, ctx.tenantId, inv, "CREATED", ctx.user.id, { amountMinor: res.totalMinor, note: "Pharmacy dispensing" });
  await addInvoiceEvent(tx, ctx.tenantId, inv, "ISSUED", ctx.user.id, { amountMinor: res.totalMinor });
  return { id: inv.id as string, invoiceNumber: inv.invoiceNumber as string, totalMinor: res.totalMinor, lines: res.lines, existing: false as const };
}
