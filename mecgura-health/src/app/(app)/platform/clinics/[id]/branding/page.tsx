import type { Metadata } from "next";
import { BrandingManager } from "@/components/platform/branding-manager";
import { Section } from "@/components/analytics/widgets";
import { StatusBadge } from "@/components/ui";
import { requirePagePermission } from "@/lib/auth/context";
import { getClinic } from "@/lib/services/clinics";
import { whiteLabelCheck } from "@/lib/services/platform-clinics";

export const metadata: Metadata = { title: "Clinic · Branding" };
export const dynamic = "force-dynamic";
export default async function ClinicBrandingPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePagePermission("platform.manage"); const { id } = await params;
  const [t, w] = await Promise.all([getClinic(ctx, id), whiteLabelCheck(ctx, id)]);
  return (
    <div className="space-y-section">
      <Section title="White-label health" description={`${w.ok} of ${w.total} items are configured for this clinic.`}>
        <ul className="divide-y divide-line">{w.items.map((i) => <li key={i.key} className="flex flex-wrap items-center justify-between gap-2 py-2"><span className="type-body">{i.label}<span className="type-caption block">{i.detail}</span></span><StatusBadge tone={i.ok ? "success" : "warning"}>{i.ok ? "Configured" : "Not set"}</StatusBadge></li>)}</ul>
      </Section>
      <BrandingManager clinicId={id} name={t.name} initial={w.brand} logoUrl={t.branding?.logoUrl ?? null} />
    </div>
  );
}
