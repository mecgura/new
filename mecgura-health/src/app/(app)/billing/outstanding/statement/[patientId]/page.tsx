import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BillingDocToolbar } from "@/components/billing/billing-doc-page";
import { requireTenantPagePermission } from "@/lib/auth/context";
import { renderStatement } from "@/lib/billing/billing-html";
import { AppError } from "@/lib/errors";
import { statementDocument } from "@/lib/services/billing-docs";

export const metadata: Metadata = { title: "Outstanding statement", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/** Authenticated, tenant-checked financial document (clinic branding, snapshot content). Never public. */
export default async function Page({ params }: { params: Promise<{ patientId: string }> }) {
  const ctx = await requireTenantPagePermission("billing.view");
  const { patientId: id } = await params;
  let doc;
  try { doc = await statementDocument(ctx, id); } catch (e) { if (e instanceof AppError) notFound(); throw e; }
  const { style, body } = renderStatement(doc);
  return (
    <div className="space-y-4">
      <BillingDocToolbar kind="statement" id={id} back={{ href: "/billing/outstanding", label: "Back" }} />
      <style dangerouslySetInnerHTML={{ __html: style }} />
      <div dangerouslySetInnerHTML={{ __html: body }} />
    </div>
  );
}
