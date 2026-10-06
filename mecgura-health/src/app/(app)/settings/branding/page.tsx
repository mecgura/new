import type { Metadata } from "next";
import { Alert } from "@/components/ui";
import { BrandingEditor } from "@/components/clinic/branding-editor";
import { requirePagePermission } from "@/lib/auth/context";

export const metadata: Metadata = { title: "Theme & branding" };

export default async function BrandingPage() {
  const ctx = await requirePagePermission("settings.view");
  if (!ctx.tenant) return <Alert tone="info" title="No clinic selected">Branding belongs to a clinic. Open a clinic from Clinics first.</Alert>;
  return (
    <BrandingEditor
      clinicName={ctx.tenant.name} initial={ctx.tenant.brand} logoUrl={ctx.tenant.logoUrl} faviconUrl={ctx.tenant.faviconUrl}
      canEdit={ctx.permissions.has("clinic.settings")}
    />
  );
}
