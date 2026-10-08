import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { InvoiceWorkspace } from "@/components/billing/invoice-workspace";
import { requireTenantPagePermission } from "@/lib/auth/context";
import { AppError } from "@/lib/errors";
import { getInvoice } from "@/lib/services/billing-invoices";

export const metadata: Metadata = { title: "Invoice", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function InvoicePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ do?: string }> }) {
  const ctx = await requireTenantPagePermission("billing.view");
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  let d;
  try { d = await getInvoice(ctx, id); } catch (e) { if (e instanceof AppError && (e.code === "NOT_FOUND" || e.code === "FORBIDDEN")) notFound(); throw e; }
  return <InvoiceWorkspace initial={d} initialAction={sp.do} />;
}
