import type { Metadata } from "next";
import { ResultsAdmin } from "@/components/admin/results-admin";

export const metadata: Metadata = { title: "Case studies" };

export default function AdminResultsPage() {
  return <ResultsAdmin />;
}
