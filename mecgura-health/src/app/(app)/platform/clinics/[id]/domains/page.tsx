import type { Metadata } from "next";
import { DomainManager } from "@/components/platform/domain-manager";
import { requirePagePermission } from "@/lib/auth/context";
import { getClinic } from "@/lib/services/clinics";
import { clinicDomain } from "@/lib/services/platform-clinics";

export const metadata: Metadata = { title: "Clinic · Domains" };
export const dynamic = "force-dynamic";
export default async function ClinicDomainsPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePagePermission("platform.manage"); const { id } = await params;
  const [t, d] = await Promise.all([getClinic(ctx, id), clinicDomain(ctx, id)]);
  return <DomainManager clinicId={id} clinicName={t.name} subdomain={d.subdomain} subdomainHost={d.subdomainHost} rootConfigured={d.rootDomainConfigured} custom={d.custom && { ...d.custom, verifiedAt: d.custom.verifiedAt?.toISOString() ?? null, checkedAt: d.custom.checkedAt?.toISOString() ?? null }} />;
}
