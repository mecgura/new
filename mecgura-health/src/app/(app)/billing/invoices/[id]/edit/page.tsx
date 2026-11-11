import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { InvoiceEditor } from "@/components/billing/invoice-editor";
import { requireTenantPagePermission } from "@/lib/auth/context";
import { bpToInput, formatMoney } from "@/lib/billing/money";
import { AppError } from "@/lib/errors";
import { getInvoice } from "@/lib/services/billing-invoices";
import { listServices, loadBillingSettings } from "@/lib/services/billing-master";
import { tenantDb } from "@/lib/tenant/db";

export const metadata: Metadata = { title: "Edit invoice" };
export const dynamic = "force-dynamic";

export default async function EditInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireTenantPagePermission("billing.edit");
  const { id } = await params;
  let d;
  try { d = await getInvoice(ctx, id); } catch (e) { if (e instanceof AppError) notFound(); throw e; }
  if (d.status !== "DRAFT" || !d.patient) redirect(`/billing/invoices/${id}`);
  const [{ services }, settings] = await Promise.all([listServices(ctx, {}), loadBillingSettings(tenantDb(ctx), ctx.tenantId)]);
  const rule = settings.discountRules[ctx.user.role]; const canDiscount = ctx.permissions.has("billing.discount") && !!rule;
  const hint = rule ? `Your limit is ${bpToInput(rule.maxPercentBp)}%${rule.maxFixedMinor != null ? ` and ${formatMoney(rule.maxFixedMinor, settings.currency)}` : ""} of the invoice. A reason is required.` : null;
  return <InvoiceEditor services={services} canDiscount={canDiscount} discountHint={hint} currency={settings.currency} initial={{ id: d.id, patient: { id: d.patient.id, name: d.patient.name, code: d.patient.code }, items: d.items.map((i) => ({ serviceId: i.serviceId, description: i.description, unitPriceMinor: i.unitPriceMinor, quantity: i.quantity, discountType: i.discountType, discountValue: i.discountValue })), discountType: d.discountType, discountValue: d.discountValue, discountReason: d.discountReason, dueDate: d.dueDate, invoiceDate: d.invoiceDate, notes: d.notes, links: { consultationId: d.links.consultationId, appointmentId: d.links.appointmentId } }} />;
}
