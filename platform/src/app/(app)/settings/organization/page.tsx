import type { Metadata } from "next";
import { Building2 } from "lucide-react";
import { db } from "@/lib/db";
import { getAppContext } from "@/lib/app-context";
import { roleHasPermission } from "@/lib/authz";
import { Card, EmptyState } from "@/components/ds";
import { OrganizationForm } from "@/components/app/settings/organization-form";

export const metadata: Metadata = { title: "Organization settings" };

export default async function OrganizationSettingsPage() {
  const { active } = await getAppContext();
  if (!active) {
    return (
      <Card>
        <EmptyState icon={Building2} title="No workspace selected" description="You're not a member of any organization yet." />
      </Card>
    );
  }
  const org = await db.organization.findUnique({ where: { id: active.organizationId }, select: { id: true, name: true, slug: true } });
  if (!org) return null;
  return <OrganizationForm id={org.id} name={org.name} slug={org.slug} canEdit={roleHasPermission(active.role, "org:update")} />;
}
