import type { Metadata } from "next";
import { Suspense } from "react";
import { LoadingState } from "@/components/ui";
import { MedicineList } from "@/components/pharmacy/medicine-list";

export const metadata: Metadata = { title: "Medicines" };
export default function Page() { return <Suspense fallback={<LoadingState />}><MedicineList /></Suspense>; }
