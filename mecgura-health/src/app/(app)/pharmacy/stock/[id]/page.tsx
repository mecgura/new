import type { Metadata } from "next";
import { BatchDetailView } from "@/components/pharmacy/stock-views";

export const metadata: Metadata = { title: "Batch" };
export default async function Page({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <BatchDetailView id={id} />; }
