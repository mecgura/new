import type { Metadata } from "next";
import { PurchaseList } from "@/components/pharmacy/purchase-views";
import { requireTenantPagePermission } from "@/lib/auth/context";

export const metadata: Metadata = { title: "Purchases" };
export default async function Page() { const ctx = await requireTenantPagePermission("pharmacy.view"); if (!ctx.permissions.has("pharmacy.purchase") && !ctx.permissions.has("pharmacy.receive")) (await import("next/navigation")).notFound(); return <PurchaseList />; }
