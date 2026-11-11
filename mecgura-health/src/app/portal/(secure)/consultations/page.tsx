import type { Metadata } from "next";
import { Empty, PageTitle, Pager, RowLink, Section } from "@/components/portal/portal-server";
import { dayLabel } from "@/components/portal/portal-labels";
import { requirePatientContext } from "@/lib/portal/ctx";
import { listConsultations } from "@/lib/services/portal-records";

export const metadata: Metadata = { title: "Consultations" };
export const dynamic = "force-dynamic";
export default async function ConsultationsPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const sp = await searchParams; const ctx = await requirePatientContext(); const r = await listConsultations(ctx, { page: Number(sp.page) });
  return (
    <div>
      <PageTitle title="Consultation history" subtitle="A summary of your completed visits. Your doctor's private working notes are not shown here." />
      <Section>{!r.rows.length ? <Empty title="No completed consultations yet" /> : <ul className="divide-y divide-line">{r.rows.map((c) => <RowLink key={c.id} href={`/portal/consultations/${c.id}`} title={`${dayLabel(c.date)} · ${c.doctorName}`} meta={c.complaints.length ? c.complaints.slice(0, 2).join("; ") : c.number} />)}</ul>}</Section>
      <Pager page={r.page} total={r.total} pageSize={r.pageSize} href={(n) => `/portal/consultations?page=${n}`} />
    </div>
  );
}
