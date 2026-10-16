import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PrintBar } from "@/components/subscription/subscription-client";
import { requireTenantPagePermission } from "@/lib/auth/context";
import { AppError } from "@/lib/errors";
import { renderSaasDoc } from "@/lib/subscriptions/html";
import { saasDocument, type DocKind } from "@/lib/services/sub-docs";

export const metadata: Metadata = { title: "Subscription document", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";
export default async function Page({ params }: { params: Promise<{ kind: string; id: string }> }) {
  const ctx = await requireTenantPagePermission("subscription.view"); const { kind, id } = await params;
  if (!["invoice", "receipt", "credit"].includes(kind)) notFound();
  let r; try { r = await saasDocument(ctx, kind as DocKind, id, ctx.tenantId); } catch (e) { if (e instanceof AppError) notFound(); throw e; }
  const { style, body } = renderSaasDoc(r.doc);
  return (<div className="space-y-4"><PrintBar downloadHref={`/api/subscription/documents/${kind}/${id}`} /><style dangerouslySetInnerHTML={{ __html: style }} /><div dangerouslySetInnerHTML={{ __html: body }} /></div>);
}
