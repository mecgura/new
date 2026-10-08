import type { Metadata } from "next";
import { PatientForm } from "@/components/patients/patient-form";
import { requireTenantPagePermission } from "@/lib/auth/context";

export const metadata: Metadata = { title: "Register patient" };

export default async function NewPatientPage() {
  await requireTenantPagePermission("patients.create");
  return (
    <div className="mx-auto max-w-3xl space-y-section">
      <div><h1 className="type-page-title">Register patient</h1><p className="type-secondary mt-1">Collect only what the clinic needs. Name and mobile number are required.</p></div>
      <PatientForm mode="new" />
    </div>
  );
}
