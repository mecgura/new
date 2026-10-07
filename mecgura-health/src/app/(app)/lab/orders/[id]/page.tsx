import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LabOrderWorkspace } from "@/components/lab/lab-order-workspace";
import { requireTenantPagePermission } from "@/lib/auth/context";
import { AppError } from "@/lib/errors";
import { getLabOrder } from "@/lib/services/lab-orders";
import { listConfig } from "@/lib/services/lab-master";

export const metadata: Metadata = { title: "Lab order", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function LabOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireTenantPagePermission("tests.view");
  const { id } = await params;
  let order, cfg;
  try { [order, cfg] = await Promise.all([getLabOrder(ctx, id), listConfig(ctx).catch(() => null)]); } catch (e) {
    if (e instanceof AppError && (e.code === "NOT_FOUND" || e.code === "FORBIDDEN")) notFound();
    throw e;
  }
  return <LabOrderWorkspace initial={order} rejectionReasons={(cfg?.REJECTION_REASON ?? []).filter((r) => r.active).map((r) => r.name)} />;
}
