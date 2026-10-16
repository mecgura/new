import type { Metadata } from "next";
import { ReportsView } from "@/components/pharmacy/reports-view";
import { requireTenantPagePermission } from "@/lib/auth/context";

export const metadata: Metadata = { title: "Pharmacy reports" };
export default async function Page() { await requireTenantPagePermission("pharmacy.reports"); return <ReportsView />; }
