import type { Metadata } from "next";
import { MetaBalanceApp } from "@/components/admin/meta-balance-app";

export const metadata: Metadata = { title: "Meta balance" };

export default function MetaBalancePage() {
  return <MetaBalanceApp />;
}
