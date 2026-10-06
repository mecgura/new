import type { Metadata } from "next";
import { Alert } from "@/components/ui";
import { ClinicProfileForm } from "@/components/clinic/profile-form";
import { profileFromTenant } from "@/components/clinic/profile-values";
import { requirePagePermission } from "@/lib/auth/context";

export const metadata: Metadata = { title: "Clinic profile" };

export default async function ClinicSettingsPage() {
  const ctx = await requirePagePermission("clinic.view");
  if (!ctx.tenant) return <Alert tone="info" title="No clinic selected">Open a clinic from Clinics first.</Alert>;
  return <ClinicProfileForm initial={profileFromTenant(ctx.tenant as unknown as Record<string, unknown>)} endpoint="/api/clinic" readOnly={!ctx.permissions.has("clinic.edit")} />;
}
