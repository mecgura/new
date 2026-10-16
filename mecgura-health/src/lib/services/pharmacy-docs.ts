import "server-only";
import type { TenantRequestContext } from "@/lib/auth/context";
import { AppError } from "@/lib/errors";
import { timeInTz, utcToZoned } from "@/lib/scheduling/time";
import { tenantTimezone } from "./clinic-shared";
import { AUDIT_ACTIONS, audit, db, guard, loadPharmacySettings, userNames } from "./pharmacy-core";
import { getDispensing } from "./pharmacy-dispensing";
import { getPurchase } from "./pharmacy-inventory";
import { pharmacyReport, type ReportResult } from "./pharmacy-reports";

/**
 * Pharmacy documents (purchase invoice, pharmacy bill, dispensing slip, stock report, expiry report, return document).
 * Private: authenticated + tenant-checked + permission-checked, clinic branding only, content from stored snapshots. Every view / print /
 * download is audited. The dispensing slip and bill carry no diagnosis or clinical notes.
 */
export const DOC_KINDS = ["purchase", "bill", "slip", "stock", "expiry", "return"] as const;
export type DocKind = (typeof DOC_KINDS)[number];

async function clinic(ctx: TenantRequestContext) {
  const t = ctx.tenant; const tz = await tenantTimezone(ctx.tenantId);
  return { name: t.name, logoUrl: t.logoUrl, address: [t.address, t.city, t.state, t.pincode].filter(Boolean).join(", "), phone: t.contactPhone, email: t.contactEmail, color: t.brand.primary, generatedAt: `${utcToZoned(new Date(), tz).date} ${timeInTz(new Date(), tz)}` };
}
export type DocClinic = Awaited<ReturnType<typeof clinic>>;

export async function pharmacyDocument(ctx: TenantRequestContext, kind: string, id: string) {
  if (!(DOC_KINDS as readonly string[]).includes(kind)) throw new AppError("NOT_FOUND", { message: "Unknown document." });
  const c = await clinic(ctx); const settings = await loadPharmacySettings(db(ctx), ctx.tenantId); const currency = (await db(ctx).billingSettings.findFirst({ where: { tenantId: ctx.tenantId }, select: { currency: true } }))?.currency ?? "INR";
  switch (kind as DocKind) {
    case "purchase": { guard(ctx, "pharmacy.purchase", "pharmacy.receive", "pharmacy.reports"); const p = await getPurchase(ctx, id); if (p.status === "DRAFT" || p.status === "CANCELLED") throw new AppError("CONFLICT", { message: "Only a received purchase has a purchase invoice." }); return { kind: "purchase" as const, clinic: c, currency, purchase: p, file: p.purchaseNumber }; }
    case "bill": case "slip": {
      guard(ctx, "pharmacy.dispense", "pharmacy.reports"); const d = await getDispensing(ctx, id);
      if (d.status === "CANCELLED") throw new AppError("CONFLICT", { message: "This dispensing was cancelled." });
      if (kind === "bill") return { kind: "bill" as const, clinic: c, currency, dispensing: d, footer: settings.billFooter, file: `${d.dispensingNumber}-bill` };
      const rx = await db(ctx).prescription.findFirst({ where: { id: d.prescriptionId }, include: { items: { orderBy: { position: "asc" } } } });
      const doc = await userNames(db(ctx), [rx?.doctorUserId]);
      return { kind: "slip" as const, clinic: c, dispensing: d, doctorName: rx?.doctorUserId ? doc.get(rx.doctorUserId) ?? null : null, instructions: ((rx?.items ?? []) as Record<string, any>[]).map((i) => ({ name: i.name as string, dose: i.dose as string | null, frequency: i.frequency as string | null, foodTiming: i.foodTiming as string | null, durationDays: i.durationDays as number | null, instructions: i.instructions as string | null })), file: `${d.dispensingNumber}-slip` };
    }
    case "stock": case "expiry": { guard(ctx, "pharmacy.reports"); const rep = await pharmacyReport(ctx, kind === "stock" ? "stock_summary" : "expiry", {}); return { kind: kind as "stock" | "expiry", clinic: c, currency, report: rep as ReportResult, file: `${kind}-report-${rep.to}` }; }
    case "return": {
      guard(ctx, "pharmacy.return_request", "pharmacy.return_approve", "pharmacy.reports");
      const r = await db(ctx).medicineReturn.findFirst({ where: { id } });
      if (!r) throw new AppError("NOT_FOUND", { message: "Return not found." });
      const [m, b, s] = await Promise.all([db(ctx).medicine.findFirst({ where: { id: r.medicineId }, select: { genericName: true, brandName: true, strength: true } }), db(ctx).medicineBatch.findFirst({ where: { id: r.batchId }, select: { batchNumber: true, expiryDate: true } }), r.supplierId ? db(ctx).supplier.findFirst({ where: { id: r.supplierId }, select: { supplierName: true, supplierCode: true } }) : null]);
      const names = await userNames(db(ctx), [r.requestedById, r.approvedById, r.receivedById, r.resolvedById]);
      return { kind: "return" as const, clinic: c, ret: { returnNumber: r.returnNumber as string, type: r.type as string, status: r.status as string, medicine: m ? [m.brandName ?? m.genericName, m.strength].filter(Boolean).join(" ") : "—", batchNumber: (b?.batchNumber ?? "—") as string, expiryDate: (b?.expiryDate ?? "") as string, quantity: r.quantity as number, reason: r.reason as string, condition: r.condition as string | null, reference: r.reference as string | null, supplier: s ? `${s.supplierName} (${s.supplierCode})` : null, requestedBy: names.get(r.requestedById) ?? null, approvedBy: r.approvedById ? names.get(r.approvedById) ?? null : null, receivedBy: r.receivedById ? names.get(r.receivedById) ?? null : null, date: (r.createdAt as Date).toISOString().slice(0, 10) }, file: r.returnNumber as string };
    }
  }
  throw new AppError("NOT_FOUND", { message: "Unknown document." });
}
export type PharmacyDoc = Awaited<ReturnType<typeof pharmacyDocument>>;

export async function recordPharmacyDocAccess(ctx: TenantRequestContext, kind: string, id: string, access: "VIEWED" | "PRINTED" | "DOWNLOADED") {
  await pharmacyDocument(ctx, kind, id);
  await audit(ctx, access === "PRINTED" ? AUDIT_ACTIONS.PHARMACY_DOC_PRINTED : access === "DOWNLOADED" ? AUDIT_ACTIONS.PHARMACY_DOC_DOWNLOADED : AUDIT_ACTIONS.PHARMACY_DOC_VIEWED, `pharmacy_${kind}`, id, { kind });
  return { recorded: true };
}
