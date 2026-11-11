import type { Metadata } from "next";
import { DispenseScreen } from "@/components/pharmacy/dispensing-views";
import { requireTenantPagePermission } from "@/lib/auth/context";

export const metadata: Metadata = { title: "Dispense prescription" };
export default async function Page({ params }: { params: Promise<{ id: string }> }) { await requireTenantPagePermission("pharmacy.dispense"); const { id } = await params; return <DispenseScreen id={id} />; }
