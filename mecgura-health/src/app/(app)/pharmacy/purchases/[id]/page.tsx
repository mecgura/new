import type { Metadata } from "next";
import { PurchaseView } from "@/components/pharmacy/purchase-views";

export const metadata: Metadata = { title: "Purchase" };
export default async function Page({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <PurchaseView id={id} />; }
