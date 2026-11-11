import type { Metadata } from "next";
import { LedgerView } from "@/components/pharmacy/stock-views";

export const metadata: Metadata = { title: "Stock ledger" };
export default function Page() { return <LedgerView />; }
