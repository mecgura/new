import type { Metadata } from "next";
import { Breadcrumb } from "@/components/ui";
import { CreateClinicWizard } from "@/components/clinic/create-clinic-wizard";
import { requirePagePermission } from "@/lib/auth/context";

export const metadata: Metadata = { title: "New clinic" };

export default async function NewClinicPage() {
  await requirePagePermission("platform.manage");
  return (
    <div className="space-y-section">
      <div><Breadcrumb items={[{ label: "Clinics", href: "/platform/clinics" }, { label: "New clinic" }]} /><h1 className="type-page-title">Create clinic</h1></div>
      <CreateClinicWizard />
    </div>
  );
}
