import type { Metadata } from "next";
import { Suspense } from "react";
import { LoadingState } from "@/components/ui";
import { PurchaseEditor } from "@/components/pharmacy/purchase-views";
import { requireTenantPagePermission } from "@/lib/auth/context";

export const metadata: Metadata = { title: "Edit purchase" };
export default async function Page({ params }: { params: Promise<{ id: string }> }) { await requireTenantPagePermission("pharmacy.purchase"); const { id } = await params; return <Suspense fallback={<LoadingState />}><PurchaseEditor id={id} /></Suspense>; }
