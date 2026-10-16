import type { Metadata } from "next";
import { PortalDocPage } from "@/components/portal/portal-doc-page";

export const metadata: Metadata = { title: "Receipt" };
export const dynamic = "force-dynamic";
export default async function Page({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <PortalDocPage kind="receipt" id={id} back={{ href: "/portal/billing?view=payments", label: "Payments" }} />; }
