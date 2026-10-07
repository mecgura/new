import type { Metadata } from "next";
import Link from "next/link";
import { Alert, Card, DataTable, StatusBadge, type Column } from "@/components/ui";
import { requireTenantPagePermission } from "@/lib/auth/context";
import { listDoctors } from "@/lib/services/website-doctors";

export const metadata: Metadata = { title: "Website doctors" };
type Row = Awaited<ReturnType<typeof listDoctors>>[number];

export default async function DoctorsCms() {
  const ctx = await requireTenantPagePermission("website.view");
  const rows = await listDoctors(ctx);
  const cols: Column<Row>[] = [
    { key: "name", header: "Doctor", cell: (r) => <Link href={`/website/doctors/${r.id}`} className="font-semibold">{r.name}<span className="type-caption block font-normal">{[r.doctorProfile?.specialization, r.doctorProfile?.qualification].filter(Boolean).join(" · ") || "No specialization set"}</span></Link> },
    { key: "status", header: "Public profile", cell: (r) => r.doctorPublicProfile ? <StatusBadge tone={r.doctorPublicProfile.status === "PUBLISHED" ? "success" : "warning"}>{r.doctorPublicProfile.status[0] + r.doctorPublicProfile.status.slice(1).toLowerCase()}</StatusBadge> : <StatusBadge tone="neutral">Not created</StatusBadge> },
    { key: "act", header: "Actions", align: "right", cell: (r) => <Link href={`/website/doctors/${r.id}`} className="type-label">{r.doctorPublicProfile ? "Edit" : "Create profile"}</Link> },
  ];
  return (
    <div className="space-y-4">
      <Alert tone="info">Doctors come from the Team. Qualification, specialization, experience, registration and fee are kept on each doctor&apos;s record (Team → edit); this tab controls how they appear publicly.</Alert>
      <Card className="overflow-hidden"><DataTable caption="Doctors" columns={cols} rows={rows} rowKey={(r) => r.id} empty={{ title: "No doctors yet", description: "Add a user with the Doctor role in Team." }} /></Card>
    </div>
  );
}
