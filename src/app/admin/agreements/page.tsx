import type { Metadata } from "next";
import { AgreementsAdmin } from "@/components/admin/agreements-admin";

export const metadata: Metadata = { title: "Agreements" };

export default function AgreementsPage() {
  return <AgreementsAdmin />;
}
