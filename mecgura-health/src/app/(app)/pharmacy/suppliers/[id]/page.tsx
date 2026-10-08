import type { Metadata } from "next";
import { SupplierDetail } from "@/components/pharmacy/supplier-views";

export const metadata: Metadata = { title: "Supplier" };
export default async function Page({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <SupplierDetail id={id} />; }
