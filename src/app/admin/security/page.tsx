import type { Metadata } from "next";
import { SecurityAdmin } from "@/components/admin/security-admin";

export const metadata: Metadata = { title: "Security" };

export default function AdminSecurityPage() {
  return <SecurityAdmin />;
}
