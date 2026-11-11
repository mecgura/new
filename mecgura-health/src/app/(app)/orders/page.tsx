import type { Metadata } from "next";
import { OrdersBoard } from "@/components/consultation/orders-board";
import { requireTenantPagePermission } from "@/lib/auth/context";

export const metadata: Metadata = { title: "Orders" };
export const dynamic = "force-dynamic";

export default async function OrdersPage() {
  const ctx = await requireTenantPagePermission("orders.view");
  return <OrdersBoard canUpdate={ctx.permissions.has("orders.update") || ctx.permissions.has("orders.create")} canCancel={ctx.user.role === "DOCTOR"} />;
}
