import type { Metadata } from "next";
import { getAppContext } from "@/lib/app-context";
import { SecurityForm } from "@/components/app/settings/security-form";

export const metadata: Metadata = { title: "Security settings" };

export default async function SecuritySettingsPage() {
  await getAppContext();
  return <SecurityForm />;
}
