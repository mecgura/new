import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BillingDocToolbar } from "@/components/billing/billing-doc-page";
import { requireTenantPagePermission } from "@/lib/auth/context";
import { renderInvoice } from "@/lib/billing/billing-html";
import { AppError } from "@/lib/errors";
import { invoiceDocument } from "@/lib/services/billing-docs";

export const metadata: Metadata = { title: "Invoice", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/** Authenticated, tenant-checked financial document (clinic branding, snapshot content). Never public. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireTenantPagePermission("billing.view");
  const { id: id } = await params;
  let doc;
  try { doc = await invoiceDocument(ctx, id); } catch (e) { if (e instanceof AppError) notFound(); throw e; }
  const { style, body } = renderInvoice(doc);
  return (
    <div className="space-y-4">
      <BillingDocToolbar kind="invoice" id={id} back={{ href: "/billing/invoices", label: "Back" }} />
      <style dangerouslySetInnerHTML={{ __html: style }} />
      <div dangerouslySetInnerHTML={{ __html: body }} />
    </div>
  );
}
