import type { Metadata } from "next";
import { Suspense } from "react";
import { LoadingState } from "@/components/ui";
import { PurchaseEditor } from "@/components/pharmacy/purchase-views";
import { requireTenantPagePermission } from "@/lib/auth/context";

export const metadata: Metadata = { title: "New purchase" };
export default async function Page() { await requireTenantPagePermission("pharmacy.purchase"); return <Suspense fallback={<LoadingState />}><PurchaseEditor /></Suspense>; }
