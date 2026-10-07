import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PatientForm, type PatientFormValues } from "@/components/patients/patient-form";
import { requireTenantPagePermission } from "@/lib/auth/context";
import { AppError } from "@/lib/errors";
import { getPatientProfile } from "@/lib/services/patient-crm";

export const metadata: Metadata = { title: "Edit patient" };

export default async function EditPatientPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireTenantPagePermission("patients.edit");
  const { id } = await params;
  const prof = await getPatientProfile(ctx, id).catch((e) => { if (e instanceof AppError && e.code === "NOT_FOUND") notFound(); throw e; });
  if (prof.tier !== "full") notFound();
  const p = prof.patient;
  const s = (x: string | number | null | undefined) => (x == null ? "" : String(x));
  const values: PatientFormValues = {
    name: p.name, preferredName: s(p.preferredName), gender: s(p.gender), dateOfBirth: s(p.dateOfBirth), ageYears: s(p.ageYears), phone: s(p.phone), alternatePhone: s(p.alternatePhone), email: s(p.email),
    addressLine: s(p.addressLine), city: s(p.city), state: s(p.state), country: s(p.country), pincode: s(p.pincode), bloodGroup: s(p.bloodGroup), maritalStatus: s(p.maritalStatus), occupation: s(p.occupation),
    emergencyContactName: s(p.emergencyContact?.name), emergencyContactRelation: s(p.emergencyContact?.relation), emergencyContactPhone: s(p.emergencyContact?.phone),
    prefPhone: p.prefs.phone, prefWhatsapp: p.prefs.whatsapp, prefSms: p.prefs.sms, prefEmail: p.prefs.email,
  };
  return (
    <div className="mx-auto max-w-3xl space-y-section">
      <div><h1 className="type-page-title">Edit {p.name}</h1><p className="type-secondary mt-1">{p.code}</p></div>
      <PatientForm mode="edit" patientId={id} initial={values} />
    </div>
  );
}
