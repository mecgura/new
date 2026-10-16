import type { Metadata } from "next";
import { SupplierList } from "@/components/pharmacy/supplier-views";

export const metadata: Metadata = { title: "Suppliers" };
export default function Page() { return <SupplierList />; }
