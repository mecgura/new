import type { Metadata } from "next";
import { DispensedView } from "@/components/pharmacy/dispensing-views";
import { requireTenantPagePermission } from "@/lib/auth/context";

export const metadata: Metadata = { title: "Dispensing record" };
export default async function Page({ params }: { params: Promise<{ id: string }> }) { await requireTenantPagePermission("pharmacy.dispense"); const { id } = await params; return <DispensedView id={id} />; }
