import type { Metadata } from "next";
import { ReturnsBoard } from "@/components/pharmacy/returns-board";
import { requireTenantPagePermission } from "@/lib/auth/context";

export const metadata: Metadata = { title: "Returns" };
export default async function Page() { const ctx = await requireTenantPagePermission("pharmacy.view"); if (!ctx.permissions.has("pharmacy.return_request") && !ctx.permissions.has("pharmacy.return_approve")) (await import("next/navigation")).notFound(); return <ReturnsBoard />; }
