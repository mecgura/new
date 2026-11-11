import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FollowUpWorkspace } from "@/components/followups/followup-workspace";
import { requireTenantPagePermission } from "@/lib/auth/context";
import { AppError } from "@/lib/errors";
import { todayIn } from "@/lib/scheduling/time";
import { assignableUsers, getFollowUp } from "@/lib/services/followups";
import { tenantDb } from "@/lib/tenant/db";

export const metadata: Metadata = { title: "Follow-up", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function FollowUpPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ do?: string }> }) {
  const ctx = await requireTenantPagePermission("followups.view");
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  let detail;
  try { detail = await getFollowUp(ctx, id); } catch (e) { if (e instanceof AppError && (e.code === "NOT_FOUND" || e.code === "FORBIDDEN")) notFound(); throw e; }
  const tdb = tenantDb(ctx);
  const [doctors, services, assignees] = await Promise.all([
    tdb.user.findMany({ where: { role: { key: "DOCTOR" }, status: "ACTIVE", deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    tdb.websiteService.findMany({ where: { deletedAt: null }, select: { id: true, title: true }, orderBy: { title: "asc" }, take: 100 }),
    assignableUsers(ctx).then((r) => r.users).catch(() => []),
  ]);
  return <FollowUpWorkspace initial={detail} doctors={doctors} services={services} assignees={assignees} today={todayIn(ctx.tenant.timezone)} initialAction={sp.do} />;
}
