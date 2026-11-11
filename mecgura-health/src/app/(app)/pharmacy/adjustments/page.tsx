import type { Metadata } from "next";
import { AdjustmentsView } from "@/components/pharmacy/stock-views";
import { requireTenantPagePermission } from "@/lib/auth/context";

export const metadata: Metadata = { title: "Stock adjustments" };
export default async function Page() { await requireTenantPagePermission("pharmacy.adjust"); return <AdjustmentsView />; }
