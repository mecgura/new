import type { Metadata } from "next";
import { PharmacySettingsForm } from "@/components/pharmacy/pharmacy-settings-form";
import { requireTenantPagePermission } from "@/lib/auth/context";

export const metadata: Metadata = { title: "Pharmacy settings" };
export default async function Page() { await requireTenantPagePermission("pharmacy.configure"); return <PharmacySettingsForm />; }
