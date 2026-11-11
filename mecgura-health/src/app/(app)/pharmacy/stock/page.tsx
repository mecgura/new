import type { Metadata } from "next";
import { StockView } from "@/components/pharmacy/stock-views";

export const metadata: Metadata = { title: "Stock" };
export default function Page() { return <StockView />; }
