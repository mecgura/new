import type { Metadata } from "next";
import { Suspense } from "react";
import { LoadingState } from "@/components/ui";
import { ExpiryView } from "@/components/pharmacy/stock-views";

export const metadata: Metadata = { title: "Expired stock" };
export default function Page() { return <Suspense fallback={<LoadingState />}><ExpiryView /></Suspense>; }
