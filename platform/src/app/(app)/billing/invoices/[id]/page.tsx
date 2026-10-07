import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getInboxContext } from "@/lib/inbox-context";
import { idSchema } from "@/lib/validations";
import { formatINR } from "@/lib/catalog";
import { getInvoice } from "@/services/billing/billing";
import { ApiError } from "@/lib/api";
import { NoWorkspace } from "@/components/whatsapp/states";
import { PrintButton } from "@/components/billing/print-button";
import { Badge, Card, PageHeader } from "@/components/ds";

export const metadata: Metadata = { title: "Invoice" };

const fmt = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "long", year: "numeric" });

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getInboxContext();
  if (!ctx.active) return <NoWorkspace />;
  if (!ctx.perms["billing:read"]) notFound();
  const id = idSchema.safeParse((await params).id);
  if (!id.success) notFound();
  const inv = await getInvoice(ctx.orgId, id.data).catch((e) => {
    if (e instanceof ApiError && e.code === "NOT_FOUND") return null;
    throw e;
  });
  if (!inv) notFound();
  const tone = inv.displayStatus === "paid" ? "success" : inv.displayStatus === "void" ? "neutral" : inv.displayStatus === "open" ? "warning" : "danger";
  return (
    <>
      <PageHeader title={`Invoice ${inv.number}`} breadcrumb={[{ label: "Billing", href: "/billing?tab=invoices" }, { label: inv.number }]} actions={<PrintButton />} />
      <Card className="mx-auto max-w-3xl p-6 sm:p-8 print:border-0 print:p-0 print:shadow-none" >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-h3 font-semibold text-app-text">{inv.issuer.name || "MECGURA"}</p>
            <p className="whitespace-pre-line text-small text-app-muted">{inv.issuer.address}</p>
            {inv.issuer.taxId ? <p className="text-small text-app-muted">Tax ID: {inv.issuer.taxId}</p> : null}
            {inv.issuer.email ? <p className="text-small text-app-muted">{inv.issuer.email}</p> : null}
          </div>
          <div className="text-right">
            <p className="text-h4 font-semibold text-app-text">{inv.number}</p>
            <Badge tone={tone} dot>{inv.displayStatus === "payment_failed" ? "Payment failed" : inv.displayStatus === "open" ? "Due" : inv.displayStatus[0].toUpperCase() + inv.displayStatus.slice(1)}</Badge>
          </div>
        </div>
        <dl className="mt-6 grid gap-4 text-small sm:grid-cols-3">
          <div>
            <dt className="text-app-subtle">Billed to</dt>
            <dd className="text-app-text">{inv.billTo.name}{inv.billTo.email ? <span className="block text-app-muted">{inv.billTo.email}</span> : null}</dd>
          </div>
          <div>
            <dt className="text-app-subtle">Issued</dt>
            <dd className="text-app-text">{fmt.format(inv.issuedAt)}</dd>
          </div>
          <div>
            <dt className="text-app-subtle">{inv.paidAt ? "Paid" : "Due"}</dt>
            <dd className="text-app-text">{fmt.format(inv.paidAt ?? inv.dueAt)}{inv.paidAt ? <span className="block text-app-muted">{inv.paidVia === "manual" ? `Recorded by MECGURA · ${inv.paymentNote}` : inv.paidVia}</span> : null}</dd>
          </div>
        </dl>
        <table className="mt-6 w-full text-small">
          <thead>
            <tr className="border-b border-app-border text-left text-app-subtle">
              <th className="py-2 font-medium">Description</th>
              <th className="py-2 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            {inv.lines.map((l, i) => (
              <tr key={i} className="border-b border-app-border/60">
                <td className="py-2 text-app-text">{l.description}</td>
                <td className="py-2 text-right tabular-nums text-app-text">{formatINR(l.amount)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="tabular-nums">
            <tr><td className="pt-3 text-right text-app-muted">Subtotal</td><td className="pt-3 text-right text-app-text">{formatINR(inv.subtotal)}</td></tr>
            {inv.taxBps ? <tr><td className="text-right text-app-muted">Tax ({inv.taxBps / 100}%)</td><td className="text-right text-app-text">{formatINR(inv.taxAmount)}</td></tr> : null}
            <tr><td className="pt-1 text-right font-semibold text-app-text">Total</td><td className="pt-1 text-right text-h4 font-semibold text-app-text">{formatINR(inv.total)}</td></tr>
          </tfoot>
        </table>
        {inv.periodStart && inv.periodEnd ? <p className="mt-4 text-caption text-app-subtle">Service period: {fmt.format(inv.periodStart)} – {fmt.format(inv.periodEnd)}</p> : null}
        {inv.status === "open" && inv.issuer.paymentInstructions ? (
          <div className="mt-6 rounded-xl border border-app-border p-4 text-small">
            <p className="font-medium text-app-text">How to pay</p>
            <p className="mt-1 whitespace-pre-line text-app-muted">{inv.issuer.paymentInstructions}</p>
            <p className="mt-2 text-caption text-app-subtle">Quote {inv.number} as the reference. Your plan updates after MECGURA records the payment.</p>
          </div>
        ) : null}
        {inv.issuer.footer ? <p className="mt-6 text-center text-caption text-app-subtle">{inv.issuer.footer}</p> : null}
      </Card>
    </>
  );
}
