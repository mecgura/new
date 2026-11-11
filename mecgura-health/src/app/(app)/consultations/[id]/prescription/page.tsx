import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/consultation/print-button";
import { Card, CardBody, CardHeader } from "@/components/ui";
import { requireTenantPagePermission } from "@/lib/auth/context";
import { renderPrescription } from "@/lib/clinical/prescription-html";
import { AppError } from "@/lib/errors";
import { prescriptionDocument } from "@/lib/services/prescription";

export const metadata: Metadata = { title: "Prescription", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/** Authenticated, tenant-checked prescription view/print page. Branding comes from the clinic; content from the finalized snapshot. */
export default async function PrescriptionPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ version?: string }> }) {
  const ctx = await requireTenantPagePermission("prescription.print");
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  let doc;
  try { doc = await prescriptionDocument(ctx, id, Number(sp.version) || undefined); } catch (e) {
    if (e instanceof AppError && e.code === "NOT_FOUND") return <Card className="mx-auto max-w-xl"><CardHeader title="No finalized prescription" /><CardBody><p className="type-secondary">{e.message}</p></CardBody></Card>;
    if (e instanceof AppError && e.code === "FORBIDDEN") notFound();
    throw e;
  }
  const { style, body } = renderPrescription(doc);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <p className="type-secondary">Version {doc.version}{doc.version !== doc.latestVersion ? ` (latest is v${doc.latestVersion})` : ""} · {doc.versions.length} version{doc.versions.length === 1 ? "" : "s"} on record</p>
        <PrintButton consultationId={id} version={doc.version} />
      </div>
      <style dangerouslySetInnerHTML={{ __html: style }} />
      <div dangerouslySetInnerHTML={{ __html: body }} />
    </div>
  );
}
