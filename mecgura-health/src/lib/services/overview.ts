import "server-only";
import { db } from "@/lib/db";
import type { TenantRequestContext } from "@/lib/auth/context";
import { tenantDb } from "@/lib/tenant/db";

/** Real, tenant-scoped numbers for the clinic dashboard. No medical data, no placeholders. */
export async function clinicOverview(ctx: TenantRequestContext) {
  const tdb = tenantDb(ctx);
  const [doctors, staff, invited, branding, tenant] = await Promise.all([
    tdb.user.count({ where: { role: { key: "DOCTOR" }, status: { not: "DISABLED" } } }),
    tdb.user.count({ where: { role: { key: { notIn: ["DOCTOR", "CLINIC_ADMIN"] } }, status: { not: "DISABLED" } } }),
    tdb.user.count({ where: { status: "INVITED" } }),
    db.tenantBranding.findUnique({ where: { tenantId: ctx.tenantId } }),
    db.tenant.findUnique({ where: { id: ctx.tenantId }, select: { contactPhone: true, address: true, city: true } }),
  ]);
  const checklist = [
    { key: "profile", label: "Clinic profile", done: !!(tenant?.contactPhone && tenant.address && tenant.city), href: "/settings/clinic", hint: "Add phone, address and city" },
    { key: "logo", label: "Logo uploaded", done: !!branding?.logoUrl, href: "/settings/branding", hint: "Upload your clinic logo" },
    { key: "branding", label: "Branding configured", done: !!(branding?.primaryColor || branding?.secondaryColor || branding?.accentColor), href: "/settings/branding", hint: "Choose your colours" },
    { key: "doctor", label: "Doctor added", done: doctors > 0, href: "/team/new", hint: "Add at least one doctor" },
    { key: "staff", label: "Staff added", done: staff > 0, href: "/team/new", hint: "Add reception or other staff" },
  ];
  const later = ["Website setup", "Appointment setup", "OPD setup"];
  return { doctors, staff, invited, checklist, later };
}
