import type { Metadata } from "next";
import { ConfigForm } from "@/components/platform/forms";
import { SensitiveAction } from "@/components/platform/sensitive-action";
import { Section } from "@/components/analytics/widgets";
import { ButtonLink, StatusBadge } from "@/components/ui";
import { requirePagePermission } from "@/lib/auth/context";
import { getClinic } from "@/lib/services/clinics";
import { clinicConfig } from "@/lib/services/platform-clinics";

export const metadata: Metadata = { title: "Clinic · Settings" };
export const dynamic = "force-dynamic";
export default async function ClinicSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePagePermission("platform.manage"); const { id } = await params;
  const [t, c] = await Promise.all([getClinic(ctx, id), clinicConfig(ctx, id)]);
  return (
    <div className="space-y-section">
      <Section title="Profile" description="Name, contact details, address and timezone." action={<ButtonLink size="sm" variant="outline" href={`/platform/clinics/${id}/edit`}>Edit profile</ButtonLink>}><p className="type-secondary">Editing the profile never changes historical clinical data.</p></Section>
      <Section title="Maintenance mode" description="Blocks this clinic's staff and patients with a maintenance message. Super Admins are never blocked." action={<StatusBadge tone={c.maintenanceMode ? "warning" : "neutral"}>{c.maintenanceMode ? "On" : "Off"}</StatusBadge>}>
        <SensitiveAction label={c.maintenanceMode ? "Turn maintenance off" : "Turn maintenance on"} variant={c.maintenanceMode ? "primary" : "outline"} tone={c.maintenanceMode ? "primary" : "danger"} size="md" title={c.maintenanceMode ? "Turn off maintenance?" : `Put ${t.name} into maintenance?`} target={t.name} impact={c.maintenanceMode ? "The clinic's users can sign in again." : "Everyone in this clinic (staff and patients) is blocked with a maintenance message until you turn it off. Data is untouched."} endpoint={`/api/platform/clinics/${id}/config`} method="PUT" body={{ maintenanceMode: !c.maintenanceMode }} fields={c.maintenanceMode ? [] : [{ name: "maintenanceMessage", label: "Message shown to users (optional)", kind: "textarea" }]} successMessage="Maintenance mode updated" />
      </Section>
      <Section title="Plan limits & data retention (foundation)"><ConfigForm clinicId={id} limits={c.limits} retention={c.retention} /></Section>
    </div>
  );
}
