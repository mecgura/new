import type { Metadata } from "next";
import Link from "next/link";
import { Button, Card, DataTable, EmptyState, Pagination, StatusBadge, type Column } from "@/components/ui";
import { requireTenantPagePermission } from "@/lib/auth/context";
import { AppError } from "@/lib/errors";
import { listConsultations } from "@/lib/services/consultation";

export const metadata: Metadata = { title: "Consultations" };
export const dynamic = "force-dynamic";
type Row = Awaited<ReturnType<typeof listConsultations>>["rows"][number];
const TONE = { FINALIZED: "success", IN_PROGRESS: "info", READY_FOR_REVIEW: "warning", DRAFT: "neutral", CANCELLED: "danger" } as const;

export default async function ConsultationsPage({ searchParams }: { searchParams: Promise<{ patientId?: string; page?: string }> }) {
  const ctx = await requireTenantPagePermission("consultation.view");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  let data;
  try { data = await listConsultations(ctx, { patientId: sp.patientId, page }); } catch (e) {
    if (e instanceof AppError) return <Card className="mx-auto max-w-xl"><EmptyState title="Consultations aren't available to your role" description={e.message} /></Card>;
    throw e;
  }
  const href = (p: number) => `/consultations?${new URLSearchParams({ ...(sp.patientId ? { patientId: sp.patientId } : {}), page: String(p) })}`;
  const columns: Column<Row>[] = [
    { key: "date", header: "Date", cell: (r) => <Link href={`/consultations/${r.id}`} className="font-semibold tabular-nums">{r.date}</Link> },
    { key: "patient", header: "Patient", cell: (r) => `${r.patient.name} · ${r.patient.code}` },
    { key: "complaint", header: "Chief complaint", cell: (r) => r.complaint ?? "—", hideOnMobile: true },
    { key: "dx", header: "Diagnosis", cell: (r) => (r.diagnoses.length ? r.diagnoses.join(", ") : "—"), hideOnMobile: true },
    { key: "rx", header: "Prescription", cell: (r) => r.prescription ?? "—", hideOnMobile: true },
    { key: "status", header: "Status", cell: (r) => <StatusBadge tone={TONE[r.status as keyof typeof TONE] ?? "neutral"}>{r.status.replace(/_/g, " ").toLowerCase()}</StatusBadge> },
    { key: "open", header: "Open", align: "right", cell: (r) => <Link href={`/consultations/${r.id}`} aria-label={`Open consultation ${r.date}`}><Button size="sm" variant="outline">Open</Button></Link> },
  ];
  return (
    <div className="space-y-section">
      <div><h1 className="type-page-title">Consultations</h1><p className="type-secondary mt-1">{sp.patientId ? "This patient's consultations." : ctx.user.role === "DOCTOR" ? "Your consultations. Start a new one from the Live OPD queue." : "Consultations in this clinic."}</p></div>
      <Card className="overflow-hidden"><DataTable caption="Consultations" columns={columns} rows={data.rows} rowKey={(r) => r.id} empty={{ title: "No consultations yet", description: "Consultations start from the Live OPD queue.", action: ctx.permissions.has("opd.view") ? <Link href="/opd"><Button>Open Live OPD</Button></Link> : undefined }} /></Card>
      <Pagination page={data.page} pageCount={Math.ceil(data.total / data.pageSize)} hrefFor={href} />
    </div>
  );
}
