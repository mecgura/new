import type { Metadata } from "next";
import { AppointmentsCalendar } from "@/components/scheduling/appointments-calendar";
import { requireTenantPagePermission } from "@/lib/auth/context";
import { todayIn } from "@/lib/scheduling/time";
import { tenantDb } from "@/lib/tenant/db";

export const metadata: Metadata = { title: "Appointments" };
export const dynamic = "force-dynamic";

export default async function AppointmentsPage() {
  const ctx = await requireTenantPagePermission("appointments.view");
  const tdb = tenantDb(ctx);
  const isDoctor = ctx.user.role === "DOCTOR" && !ctx.permissions.has("appointments.create");
  const [doctors, services] = await Promise.all([
    tdb.user.findMany({ where: { role: { key: "DOCTOR" }, status: "ACTIVE", deletedAt: null, ...(isDoctor ? { id: ctx.user.id } : {}) }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    tdb.websiteService.findMany({ where: { deletedAt: null }, select: { id: true, title: true }, orderBy: { title: "asc" }, take: 100 }),
  ]);
  return (
    <AppointmentsCalendar
      today={todayIn(ctx.tenant.timezone)} doctors={doctors} services={services} defaultDoctor={isDoctor ? ctx.user.id : undefined} doctorLocked={isDoctor}
      perms={{ canCreate: ctx.permissions.has("appointments.create"), canEdit: ctx.permissions.has("appointments.edit"), canCheckIn: ctx.permissions.has("opd.manage"), canPriority: ctx.permissions.has("opd.priority"), canViewPatients: ctx.permissions.has("patients.view") }}
    />
  );
}
