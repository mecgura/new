import "server-only";
import { db } from "@/lib/db";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import type { RequestContext } from "@/lib/auth/context";
import { AppError } from "@/lib/errors";
import { renderSaasDoc, type SaasDoc } from "@/lib/subscriptions/html";
import { parseJson } from "@/lib/subscriptions/catalog";
import { billHtmlFile } from "@/lib/billing/billing-html";
import { EMPTY_VENDOR, type VendorProfile } from "./sub-config";

export type DocKind = "invoice" | "receipt" | "credit";
const fmt = (d: Date | null | undefined, tz: string) => (d ? new Intl.DateTimeFormat("en-IN", { timeZone: tz, day: "2-digit", month: "short", year: "numeric" }).format(d) : "");
const fmtDT = (d: Date, tz: string) => `${new Intl.DateTimeFormat("en-IN", { timeZone: tz, day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true }).format(d)} (${tz})`;
const addr = (b: { address?: string | null; city?: string | null; state?: string | null; pincode?: string | null }) => [b.address, b.city, b.state, b.pincode].filter(Boolean).join(", ");

/**
 * `tenantId` is given for a clinic (the document must belong to it — someone else's id is "not found") and null for a Super Admin.
 * All values come from the invoice's own snapshots, so a document never changes after it is issued.
 */
export async function saasDocument(ctx: RequestContext, kind: DocKind, id: string, tenantId: string | null): Promise<{ doc: SaasDoc; file: string; tenantId: string }> {
  if (tenantId === null && (ctx.user.role !== "SUPER_ADMIN" || !ctx.permissions.has("platform.manage"))) throw new AppError("FORBIDDEN");
  const scope = tenantId ? { tenantId } : {}; const nf = () => new AppError("NOT_FOUND", { message: "That document doesn't exist." });
  let invoiceId = id, payment = null as Awaited<ReturnType<typeof db.saasPayment.findFirst>>, refund = null as Awaited<ReturnType<typeof db.saasRefund.findFirst>>;
  if (kind === "receipt") { payment = await db.saasPayment.findFirst({ where: { id, ...scope, status: { in: ["SUCCEEDED", "PARTIALLY_REFUNDED", "REFUNDED"] } } }); if (!payment) throw nf(); invoiceId = payment.invoiceId; }
  if (kind === "credit") { refund = await db.saasRefund.findFirst({ where: { id, ...scope, status: "PROCESSED" } }); if (!refund) throw nf(); invoiceId = refund.invoiceId; }
  const inv = await db.saasInvoice.findFirst({ where: { id: invoiceId, ...scope }, include: { items: { orderBy: { position: "asc" } } } }); if (!inv) throw nf();
  if (kind === "invoice" && inv.status === "DRAFT") throw new AppError("CONFLICT", { message: "A draft invoice can't be printed." });
  const tz = tenantId ? (await db.tenant.findUnique({ where: { id: tenantId }, select: { timezone: true } }))?.timezone ?? "Asia/Kolkata" : "Asia/Kolkata";
  const vendor = { ...EMPTY_VENDOR, ...parseJson<Partial<VendorProfile>>(inv.vendorSnapshot, {}) }; const b = parseJson<Record<string, string | null>>(inv.billToSnapshot, {}); const tax = parseJson<{ lines?: { name: string; rateBp: number; amountMinor: number }[] }>(inv.taxSnapshot, {});
  const pays = await db.saasPayment.findMany({ where: { invoiceId: inv.id, status: { in: ["SUCCEEDED", "PARTIALLY_REFUNDED", "REFUNDED"] } }, orderBy: { paidAt: "asc" } });
  const base: Omit<SaasDoc, "kind" | "number" | "related"> = {
    status: inv.status, currency: inv.currency, issuedOn: fmt(inv.issuedAt ?? inv.createdAt, tz), dueOn: inv.dueAt ? fmt(inv.dueAt, tz) : null, periodText: `${fmt(inv.periodStart, tz)} – ${fmt(inv.periodEnd, tz)}`,
    vendor: { legalName: vendor.legalName, brandName: vendor.brandName || "MECGURA HEALTH", gstin: vendor.gstin, pan: vendor.pan, address: addr(vendor), email: vendor.email, phone: vendor.phone, website: vendor.website, supportEmail: vendor.supportEmail, supportPhone: vendor.supportPhone, invoiceFooter: vendor.invoiceFooter, bankDetails: vendor.bankDetails },
    billTo: { name: b.name ?? "", email: b.email ?? null, phone: b.phone ?? null, address: addr(b), gstin: b.gstin ?? null, taxId: b.taxId ?? null }, planName: inv.planName,
    items: inv.items.map((i) => ({ description: i.description, quantity: i.quantity, unitMinor: i.unitMinor, totalMinor: i.totalMinor })), subtotalMinor: inv.subtotalMinor, discountMinor: inv.discountMinor, taxMinor: inv.taxMinor, totalMinor: inv.totalMinor, paidMinor: inv.paidMinor, refundedMinor: inv.refundedMinor, taxMode: inv.taxMode, taxLines: tax.lines ?? [],
    payments: pays.map((p) => ({ receipt: p.receiptNumber, date: fmt(p.paidAt, tz), method: p.method, amountMinor: p.amountMinor, reference: p.transactionReference })), generatedAt: fmtDT(new Date(), tz),
  };
  if (kind === "invoice") return { doc: { ...base, kind, number: inv.invoiceNumber }, file: `${inv.invoiceNumber}.html`, tenantId: inv.tenantId };
  if (kind === "receipt") return { doc: { ...base, kind, number: payment!.receiptNumber ?? payment!.id, status: payment!.status === "SUCCEEDED" ? "paid" : payment!.status, issuedOn: fmt(payment!.paidAt, tz), dueOn: null, related: { invoiceNumber: inv.invoiceNumber, paymentMethod: payment!.method, reference: payment!.transactionReference, amountMinor: payment!.amountMinor } }, file: `${payment!.receiptNumber ?? "receipt"}.html`, tenantId: inv.tenantId };
  return { doc: { ...base, kind: "credit", number: refund!.refundNumber, status: "processed", issuedOn: fmt(refund!.processedAt, tz), dueOn: null, related: { invoiceNumber: inv.invoiceNumber, amountMinor: refund!.amountMinor, reason: refund!.reason } }, file: `${refund!.refundNumber}.html`, tenantId: inv.tenantId };
}
export async function saasDocumentHtml(ctx: RequestContext, kind: DocKind, id: string, tenantId: string | null) {
  const r = await saasDocument(ctx, kind, id, tenantId); const rendered = renderSaasDoc(r.doc);
  await recordAudit({ action: AUDIT_ACTIONS.SUBSCRIPTION_DOCUMENT_ACCESSED, tenantId: r.tenantId, actorId: ctx.user.id, entityType: "saas_document", entityId: id, metadata: { kind, access: "downloaded" } });
  return { file: r.file, html: billHtmlFile(`${r.doc.number}`, rendered), ...rendered };
}
