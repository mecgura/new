import type { Metadata } from "next";
import { RevenueDashboard } from "@/components/admin/revenue-dashboard";

export const metadata: Metadata = { title: "Revenue" };

export default function AdminRevenuePage() {
  return <RevenueDashboard />;
}
