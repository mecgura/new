import type { Metadata } from "next";
import { FeatureSwitch } from "@/components/platform/feature-switch";
import { Section } from "@/components/analytics/widgets";
import { requirePagePermission } from "@/lib/auth/context";
import { getClinic } from "@/lib/services/clinics";
import { clinicFeatures } from "@/lib/services/platform-clinics";

export const metadata: Metadata = { title: "Clinic · Features" };
export const dynamic = "force-dynamic";
export default async function ClinicFeaturesPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePagePermission("platform.manage"); const { id } = await params;
  const [t, features] = await Promise.all([getClinic(ctx, id), clinicFeatures(ctx, id)]); const groups = [...new Set(features.map((f) => f.group))];
  return (
    <div className="space-y-section">
      <p className="type-secondary">Switching a feature off blocks it on the server for this clinic — not just in the menu. <strong>No data is deleted</strong>; everything returns when it is switched back on.</p>
      {groups.map((g) => <Section key={g} title={g}><ul className="divide-y divide-line">{features.filter((f) => f.group === g).map((f) => <FeatureSwitch key={f.key} clinicId={id} clinicName={t.name} feature={f} />)}</ul></Section>)}
    </div>
  );
}
