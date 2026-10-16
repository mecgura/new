import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ReportActions } from "@/components/lab/report-actions";
import { requireTenantPagePermission } from "@/lib/auth/context";
import { renderLabReport } from "@/lib/lab/lab-html";
import { AppError } from "@/lib/errors";
import { labReportDocument, recordReportAccess } from "@/lib/services/lab-results";
import { Card, CardBody, CardHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Laboratory report", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/** Authenticated, tenant-checked view of a RELEASED report version. Branding from the clinic; content from the immutable snapshot. */
export default async function ReportPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ version?: string }> }) {
  const ctx = await requireTenantPagePermission("tests.view");
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  let doc;
  try { doc = await labReportDocument(ctx, id, Number(sp.version) || undefined); } catch (e) {
    if (e instanceof AppError && e.code === "NOT_FOUND") return <Card className="mx-auto max-w-xl"><CardHeader title="No released report" /><CardBody><p className="type-secondary">{e.message}</p></CardBody></Card>;
    if (e instanceof AppError && e.code === "FORBIDDEN") notFound();
    throw e;
  }
  await recordReportAccess(ctx, id, "VIEWED", doc.version);
  const { style, body } = renderLabReport(doc);
  return (
    <div className="space-y-4">
      <ReportActions reportId={id} orderId={doc.orderId} version={doc.version} latestVersion={doc.latestVersion} versions={doc.versions} review={doc.review} canReview={doc.canReview} status={doc.status} />
      <style dangerouslySetInnerHTML={{ __html: style }} />
      <div dangerouslySetInnerHTML={{ __html: body }} />
    </div>
  );
}
