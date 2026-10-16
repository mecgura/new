import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LabPrintButton } from "@/components/lab/lab-print-button";
import { requireTenantPagePermission } from "@/lib/auth/context";
import { renderSampleLabel } from "@/lib/lab/lab-html";
import { AppError } from "@/lib/errors";
import { sampleLabelDocument } from "@/lib/services/lab-results";

export const metadata: Metadata = { title: "Sample label", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function LabelPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireTenantPagePermission("tests.print");
  const { id } = await params;
  let doc;
  try { doc = await sampleLabelDocument(ctx, id); } catch (e) { if (e instanceof AppError) notFound(); throw e; }
  const { style, body } = renderSampleLabel(doc);
  return (
    <div className="space-y-4">
      <div className="flex justify-end print:hidden"><LabPrintButton auditUrl={`/api/lab/samples/${id}/label/print`} /></div>
      <style dangerouslySetInnerHTML={{ __html: style }} />
      <div dangerouslySetInnerHTML={{ __html: body }} />
      <p className="type-caption print:hidden">The ID above is an opaque identifier prepared for barcode/QR scanning later. No scanner is connected yet.</p>
    </div>
  );
}
