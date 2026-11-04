import type { Metadata } from "next";
import { SystemHealth } from "@/components/support/support-ui";

export const metadata: Metadata = { title: "System health" };

export default function AdminHealthPage() {
  return <SystemHealth />;
}
