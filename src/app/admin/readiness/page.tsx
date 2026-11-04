import type { Metadata } from "next";
import { ReadinessAdmin } from "@/components/admin/readiness-admin";

export const metadata: Metadata = { title: "Integrations readiness" };

export default function AdminReadinessPage() {
  return <ReadinessAdmin />;
}
