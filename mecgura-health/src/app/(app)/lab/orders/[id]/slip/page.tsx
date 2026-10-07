import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LabPrintButton } from "@/components/lab/lab-print-button";
import { requireTenantPagePermission } from "@/lib/auth/context";
import { renderLabSlip } from "@/lib/lab/lab-html";
import { AppError } from "@/lib/errors";
import { labSlipDocument } from "@/lib/services/lab-results";

export const metadata: Metadata = { title: "Test slip", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function SlipPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireTenantPagePermission("tests.print");
  const { id } = await params;
  let doc;
  try { doc = await labSlipDocument(ctx, id); } catch (e) { if (e instanceof AppError) notFound(); throw e; }
  const { style, body } = renderLabSlip(doc);
  return (
    <div className="space-y-4">
      <div className="flex justify-end print:hidden"><LabPrintButton auditUrl={`/api/lab/orders/${id}/slip/print`} /></div>
      <style dangerouslySetInnerHTML={{ __html: style }} />
      <div dangerouslySetInnerHTML={{ __html: body }} />
    </div>
  );
}
