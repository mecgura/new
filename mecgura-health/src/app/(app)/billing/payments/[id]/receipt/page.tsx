import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BillingDocToolbar } from "@/components/billing/billing-doc-page";
import { requireTenantPagePermission } from "@/lib/auth/context";
import { renderReceipt } from "@/lib/billing/billing-html";
import { AppError } from "@/lib/errors";
import { receiptDocument } from "@/lib/services/billing-docs";

export const metadata: Metadata = { title: "Receipt", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/** Authenticated, tenant-checked financial document (clinic branding, snapshot content). Never public. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireTenantPagePermission("billing.view");
  const { id: id } = await params;
  let doc;
  try { doc = await receiptDocument(ctx, id); } catch (e) { if (e instanceof AppError) notFound(); throw e; }
  const { style, body } = renderReceipt(doc);
  return (
    <div className="space-y-4">
      <BillingDocToolbar kind="receipt" id={id} back={{ href: "/billing/payments?view=receipts", label: "Back" }} />
      <style dangerouslySetInnerHTML={{ __html: style }} />
      <div dangerouslySetInnerHTML={{ __html: body }} />
    </div>
  );
}
