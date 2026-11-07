import type { Metadata } from "next";
import { SponsoredAdmin } from "@/components/admin/sponsored-admin";

export const metadata: Metadata = { title: "Sponsored" };

export default function AdminSponsoredPage() {
  return <SponsoredAdmin />;
}
