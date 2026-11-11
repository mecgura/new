import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PharmacyDocToolbar } from "@/components/pharmacy/pharmacy-doc-toolbar";
import { requireTenantPagePermission } from "@/lib/auth/context";
import { renderPharmacyDoc } from "@/lib/pharmacy/pharmacy-html";
import { AppError } from "@/lib/errors";
import { pharmacyDocument } from "@/lib/services/pharmacy-docs";

export const metadata: Metadata = { title: "Pharmacy document", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/** Authenticated, tenant-checked pharmacy document (clinic branding, snapshot content). Never public. */
export default async function Page({ params }: { params: Promise<{ kind: string; id: string }> }) {
  const ctx = await requireTenantPagePermission("pharmacy.view");
  const { kind, id } = await params;
  let doc;
  try { doc = await pharmacyDocument(ctx, kind, id); } catch (e) { if (e instanceof AppError) notFound(); throw e; }
  const { style, body } = renderPharmacyDoc(doc);
  const back = kind === "purchase" ? { href: `/pharmacy/purchases/${id}`, label: "Purchase" } : kind === "bill" || kind === "slip" ? { href: `/pharmacy/dispensed/${id}`, label: "Dispensing" } : kind === "return" ? { href: "/pharmacy/returns", label: "Returns" } : { href: "/pharmacy/reports", label: "Reports" };
  return (
    <div className="space-y-4">
      <PharmacyDocToolbar kind={kind} id={id} back={back} />
      <style dangerouslySetInnerHTML={{ __html: style }} />
      <div dangerouslySetInnerHTML={{ __html: body }} />
    </div>
  );
}
