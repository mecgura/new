import type { Metadata } from "next";
import { OpdBoard } from "@/components/scheduling/opd-board";
import { requireTenantPagePermission } from "@/lib/auth/context";
import { tenantDb } from "@/lib/tenant/db";

export const metadata: Metadata = { title: "Live OPD" };
export const dynamic = "force-dynamic";

export default async function OpdPage() {
  const ctx = await requireTenantPagePermission("opd.view");
  const manage = ctx.permissions.has("opd.manage");
  const doctorOnly = ctx.user.role === "DOCTOR" && !manage;
  const doctors = await tenantDb(ctx).user.findMany({ where: { role: { key: "DOCTOR" }, status: "ACTIVE", deletedAt: null, ...(doctorOnly ? { id: ctx.user.id } : {}) }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  return <OpdBoard mode={doctorOnly ? "doctor" : "reception"} doctors={doctors} perms={{ manage, call: ctx.permissions.has("opd.call"), priority: ctx.permissions.has("opd.priority"), patients: ctx.permissions.has("patients.view") }} />;
}
