import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DomainForm } from "@/components/clinic/domain-form";
import { ClinicProfileForm } from "@/components/clinic/profile-form";
import { profileFromTenant } from "@/components/clinic/profile-values";
import { Breadcrumb } from "@/components/ui";
import { requirePagePermission } from "@/lib/auth/context";
import { getEnv } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { getClinic } from "@/lib/services/clinics";

export const metadata: Metadata = { title: "Edit clinic" };

export default async function EditClinicPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePagePermission("platform.manage");
  const { id } = await params;
  const t = await getClinic(ctx, id).catch((e) => { if (e instanceof AppError && e.code === "NOT_FOUND") notFound(); throw e; });
  return (
    <div className="space-y-section">
      <div><Breadcrumb items={[{ label: "Clinics", href: "/platform/clinics" }, { label: t.name, href: `/platform/clinics/${t.id}` }, { label: "Edit" }]} /><h1 className="type-page-title">Edit clinic</h1></div>
      <ClinicProfileForm initial={profileFromTenant(t)} endpoint={`/api/platform/clinics/${t.id}`} />
      <div id="domain"><DomainForm id={t.id} subdomain={t.subdomain} customDomain={t.customDomain} verified={!!t.customDomainVerifiedAt} websiteEnabled={t.websiteEnabled} rootDomain={getEnv().TENANT_ROOT_DOMAIN ?? null} /></div>
    </div>
  );
}
