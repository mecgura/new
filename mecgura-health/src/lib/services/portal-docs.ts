import "server-only";
import { AppError } from "@/lib/errors";
import type { PatientContext } from "@/lib/portal/ctx";
import { timeInTz, utcToZoned } from "@/lib/scheduling/time";
import type { PrescriptionSnapshot } from "@/lib/clinical/snapshot";
import type { PrescriptionDoc } from "./prescription";
import type { LabReportDoc } from "./lab-results";
import { invoiceDocument, receiptDocument } from "./billing-docs";
import { AUDIT_ACTIONS, loadPortalSettings, paudit, pdb } from "./portal-core";
import { RELEASED_REPORT } from "./portal-records";

/**
 * Patient copies of the clinic's own documents. Each builder FIRST proves ownership (the record's patient is the session's patient and the
 * record is in a patient-visible state), then reuses the clinic's renderer data shape. Internal fields (amendment reasons, reviewer notes,
 * staff names, invoice notes) are removed. Nothing here accepts or trusts a patient id from the browser.
 */
const parse = <T,>(s: string): T => JSON.parse(s) as T;
const clinic = (ctx: PatientContext) => { const t = ctx.tenant; return { name: t.name, legalName: t.legalName, logoUrl: t.logoUrl, address: [t.address, t.city, t.state, t.pincode].filter(Boolean).join(", "), phone: t.contactPhone, email: t.contactEmail, color: t.brand.primary }; };
const stamp = (ctx: PatientContext) => `${utcToZoned(new Date(), ctx.tenant.timezone).date} ${timeInTz(new Date(), ctx.tenant.timezone)}`;
const notFound = (what: string) => new AppError("NOT_FOUND", { message: `We couldn't find that ${what}.` });

export async function portalPrescriptionDoc(ctx: PatientContext, prescriptionId: string, version?: number): Promise<PrescriptionDoc> {
  const tdb = pdb(ctx); const settings = await loadPortalSettings(tdb, ctx.tenantId);
  const rx = await tdb.prescription.findFirst({ where: { id: prescriptionId, patientId: ctx.patientId, currentVersion: { gt: 0 } }, include: { versions: { orderBy: { version: "desc" } } } });
  if (!rx || !rx.versions.length) throw notFound("prescription");
  const v = version ? rx.versions.find((x: { version: number }) => x.version === version) : rx.versions[0];
  if (!v) throw notFound("prescription");
  const snap = parse<PrescriptionSnapshot>(v.snapshot);
  return {
    snapshot: { ...snap, reason: null, diagnoses: settings.showDiagnoses ? snap.diagnoses : [] }, version: v.version, latestVersion: rx.versions[0].version, hash: (v.contentHash as string).slice(0, 12),
    versions: rx.versions.map((x: { version: number; createdAt: Date }) => ({ version: x.version, createdAt: x.createdAt.toISOString(), reason: null })), clinic: clinic(ctx), generatedAt: stamp(ctx),
  } as PrescriptionDoc;
}
export async function portalReportDoc(ctx: PatientContext, reportId: string, version?: number): Promise<LabReportDoc> {
  const tdb = pdb(ctx);
  const rep = await tdb.labReport.findFirst({ where: { id: reportId, patientId: ctx.patientId, ...RELEASED_REPORT }, include: { versions: { orderBy: { version: "desc" } } } });
  if (!rep || !rep.versions.length) throw notFound("report");
  const v = version ? rep.versions.find((x: { version: number }) => x.version === version) : rep.versions[0];
  if (!v) throw notFound("report");
  const snap = parse<LabReportDoc["snapshot"] & { reason?: string | null }>(v.snapshot);
  return {
    id: rep.id, orderId: rep.investigationOrderId, status: rep.status, snapshot: { ...snap, reason: null } as LabReportDoc["snapshot"], version: v.version, latestVersion: rep.versions[0].version, hash: (v.contentHash as string).slice(0, 12),
    versions: rep.versions.map((x: { version: number; createdAt: Date }) => ({ version: x.version, createdAt: x.createdAt.toISOString(), reason: null })), review: null, canReview: false, clinic: clinic(ctx), generatedAt: stamp(ctx),
  } as LabReportDoc;
}
/** The clinic's invoice builder, run only after the invoice is proven to be this patient's. Staff names and internal notes are removed. */
const billingView = (ctx: PatientContext) => ({ ...ctx, permissions: new Set(["billing.view"]) as never });
export async function portalInvoiceDoc(ctx: PatientContext, invoiceId: string) {
  const own = await pdb(ctx).invoice.findFirst({ where: { id: invoiceId, patientId: ctx.patientId, status: { not: "DRAFT" } }, select: { id: true } });
  if (!own) throw notFound("bill");
  const d = await invoiceDocument(billingView(ctx), own.id);
  return { ...d, notes: null, doctorName: d.doctorName, payments: d.payments.map((p) => ({ ...p, receivedBy: null })) };
}
export async function portalReceiptDoc(ctx: PatientContext, paymentId: string) {
  const own = await pdb(ctx).payment.findFirst({ where: { id: paymentId, patientId: ctx.patientId, status: { in: ["SUCCESS", "PARTIALLY_REFUNDED", "REFUNDED"] } }, select: { id: true } });
  if (!own) throw notFound("receipt");
  const d = await receiptDocument(billingView(ctx), own.id);
  return { ...d, receivedBy: null };
}

export const PORTAL_DOC_KINDS = ["prescription", "report", "invoice", "receipt"] as const;
export type PortalDocKind = (typeof PORTAL_DOC_KINDS)[number];
export async function portalDocument(ctx: PatientContext, kind: string, id: string, version?: number) {
  switch (kind) {
    case "prescription": return { kind: "prescription" as const, doc: await portalPrescriptionDoc(ctx, id, version), file: "prescription" };
    case "report": return { kind: "report" as const, doc: await portalReportDoc(ctx, id, version), file: "lab-report" };
    case "invoice": return { kind: "invoice" as const, doc: await portalInvoiceDoc(ctx, id), file: "bill" };
    case "receipt": return { kind: "receipt" as const, doc: await portalReceiptDoc(ctx, id), file: "receipt" };
  }
  throw new AppError("NOT_FOUND", { message: "We couldn't find that document." });
}
export async function recordPortalDocAccess(ctx: PatientContext, kind: string, id: string, access: "VIEWED" | "PRINTED" | "DOWNLOADED") {
  await portalDocument(ctx, kind, id); // re-checks ownership and visibility
  await paudit(ctx, access === "DOWNLOADED" ? AUDIT_ACTIONS.PORTAL_DOC_DOWNLOADED : AUDIT_ACTIONS.PORTAL_DOC_VIEWED, `portal_${kind}`, id, { kind, access: access.toLowerCase() });
  return { recorded: true };
}
