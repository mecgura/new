import type { Metadata } from "next";
import { SchedulingSettings } from "@/components/scheduling/scheduling-settings";
import { requireTenantPagePermission } from "@/lib/auth/context";
import { getEnv } from "@/lib/env";
import { todayIn } from "@/lib/scheduling/time";
import { tenantDb } from "@/lib/tenant/db";

export const metadata: Metadata = { title: "Scheduling settings" };
export const dynamic = "force-dynamic";

export default async function SchedulingSettingsPage() {
  const ctx = await requireTenantPagePermission("settings.view");
  const manage = ctx.permissions.has("schedule.manage");
  const t = ctx.tenant;
  const root = getEnv().TENANT_ROOT_DOMAIN;
  const host = t.customDomain && t.customDomainVerified ? t.customDomain : t.subdomain && root ? `${t.subdomain}.${root}` : null;
  const doctors = await tenantDb(ctx).user.findMany({ where: { role: { key: "DOCTOR" }, status: "ACTIVE", deletedAt: null, ...(manage ? {} : { id: ctx.user.id }) }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  return <SchedulingSettings canManage={manage} doctors={doctors} today={todayIn(t.timezone)} siteOrigin={host ? `${getEnv().isProd ? "https" : "http"}://${host}` : null} />;
}
