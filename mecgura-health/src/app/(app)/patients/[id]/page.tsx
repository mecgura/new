import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PatientWorkspace } from "@/components/patients/patient-workspace";
import { Card, CardBody, CardHeader } from "@/components/ui";
import { requireTenantPagePermission } from "@/lib/auth/context";
import { AppError } from "@/lib/errors";
import { todayIn } from "@/lib/scheduling/time";
import { getPatientProfile } from "@/lib/services/patient-crm";
import { tenantDb } from "@/lib/tenant/db";

export const metadata: Metadata = { title: "Patient" };
export const dynamic = "force-dynamic";

export default async function PatientPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireTenantPagePermission("patients.identity");
  const { id } = await params;
  // another clinic's patient (or an unknown id) is simply "not found"
  const prof = await getPatientProfile(ctx, id).catch((e) => { if (e instanceof AppError && (e.code === "NOT_FOUND" || e.code === "FORBIDDEN")) notFound(); throw e; });
  if (prof.tier === "identity") {
    return (
      <div className="mx-auto max-w-xl space-y-section">
        <Card><CardHeader title={prof.patient.name} description={prof.patient.code} />
          <CardBody><p className="type-secondary">Your role can see the patient&apos;s name and ID only.</p></CardBody></Card>
      </div>
    );
  }
  const tdb = tenantDb(ctx);
  const [doctors, services] = await Promise.all([
    tdb.user.findMany({ where: { role: { key: "DOCTOR" }, status: "ACTIVE", deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    tdb.websiteService.findMany({ where: { deletedAt: null }, select: { id: true, title: true }, orderBy: { title: "asc" }, take: 100 }),
  ]);
  return <PatientWorkspace profile={prof} doctors={doctors} services={services} today={todayIn(ctx.tenant.timezone)} />;
}
