import type { Metadata } from "next";
import { Suspense } from "react";
import { LoadingState } from "@/components/ui";
import { DispensingHome } from "@/components/pharmacy/dispensing-views";
import { requireTenantPagePermission } from "@/lib/auth/context";

export const metadata: Metadata = { title: "Dispensing" };
export default async function Page() { await requireTenantPagePermission("pharmacy.dispense"); return <Suspense fallback={<LoadingState />}><DispensingHome /></Suspense>; }
