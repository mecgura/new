import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckStatusButton, PayButton } from "@/components/subscription/subscription-client";
import { Alert, ButtonLink, Card } from "@/components/ui";
import { requireTenantPagePermission } from "@/lib/auth/context";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { syncInvoicePayment } from "@/lib/services/sub-pay";

export const metadata: Metadata = { title: "Payment result", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/** Where the payment page sends the browser back. The URL proves NOTHING: on load we ask the provider, then show what the invoice's stored status really is. */
export default async function PaymentResult({ searchParams }: { searchParams: Promise<{ invoice?: string }> }) {
  const ctx = await requireTenantPagePermission("subscription.view"); const id = (await searchParams).invoice ?? "";
  if (!id) notFound();
  try { await syncInvoicePayment(ctx.tenantId, id); } catch (e) { if (e instanceof AppError && e.code === "NOT_FOUND") notFound(); throw e; }
  const inv = await db.saasInvoice.findFirst({ where: { id, tenantId: ctx.tenantId } }); if (!inv) notFound();
  const paid = inv.status === "PAID";
  return (
    <div className="mx-auto max-w-xl space-y-4">
      <h1 className="type-page-title">Payment status</h1>
      <Card className="space-y-3 p-card">
        {paid ? <Alert tone="success" title="Payment confirmed">Invoice {inv.invoiceNumber} is paid. Thank you.</Alert>
          : <Alert tone="info" title="Not confirmed yet">We have not received confirmation from the payment provider for invoice {inv.invoiceNumber}. If you just paid, it can take a minute — check again. We never mark an invoice paid until the provider confirms it.</Alert>}
        <div className="flex flex-wrap gap-3">{!paid && ["ISSUED", "OVERDUE", "PARTIALLY_PAID"].includes(inv.status) && <><CheckStatusButton invoiceId={inv.id} /><PayButton invoiceId={inv.id} label="Try paying again" /></>}<ButtonLink href="/subscription" variant="outline">Back to subscription</ButtonLink></div>
        <p className="type-caption">Invoice status: {inv.status.replace(/_/g, " ").toLowerCase()}. <Link href={`/subscription/documents/invoice/${inv.id}`}>View invoice</Link></p>
      </Card>
    </div>
  );
}
