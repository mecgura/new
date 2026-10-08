import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { InvoiceEditor } from "@/components/billing/invoice-editor";
import { requireTenantPagePermission } from "@/lib/auth/context";
import { bpToInput, formatMoney } from "@/lib/billing/money";
import { loadBillingSettings, listServices } from "@/lib/services/billing-master";
import { tenantDb } from "@/lib/tenant/db";

export const metadata: Metadata = { title: "New invoice" };
export const dynamic = "force-dynamic";

export default async function NewInvoicePage({ searchParams }: { searchParams: Promise<{ patientId?: string }> }) {
  const ctx = await requireTenantPagePermission("billing.create");
  const sp = await searchParams;
  const tdb = tenantDb(ctx);
  const [{ services }, settings, patient] = await Promise.all([listServices(ctx, {}), loadBillingSettings(tdb, ctx.tenantId), sp.patientId ? tdb.patient.findFirst({ where: { id: sp.patientId }, select: { id: true, name: true, code: true } }) : null]);
  if (sp.patientId && !patient) notFound();
  const rule = settings.discountRules[ctx.user.role];
  const canDiscount = ctx.permissions.has("billing.discount") && !!rule;
  const hint = rule ? `Your limit is ${bpToInput(rule.maxPercentBp)}%${rule.maxFixedMinor != null ? ` and ${formatMoney(rule.maxFixedMinor, settings.currency)}` : ""} of the invoice. A reason is required.` : null;
  return <InvoiceEditor services={services} presetPatient={patient ?? undefined} canDiscount={canDiscount} discountHint={hint} currency={settings.currency} />;
}
