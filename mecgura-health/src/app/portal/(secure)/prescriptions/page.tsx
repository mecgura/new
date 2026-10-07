import type { Metadata } from "next";
import { Empty, PageTitle, Pager, RowLink, Section } from "@/components/portal/portal-server";
import { dayLabel } from "@/components/portal/portal-labels";
import { requirePatientContext } from "@/lib/portal/ctx";
import { listPrescriptions } from "@/lib/services/portal-records";

export const metadata: Metadata = { title: "Prescriptions" };
export const dynamic = "force-dynamic";
export default async function PrescriptionsPage({ searchParams }: { searchParams: Promise<{ page?: string; from?: string; to?: string }> }) {
  const sp = await searchParams; const ctx = await requirePatientContext(); const r = await listPrescriptions(ctx, { page: Number(sp.page), from: sp.from, to: sp.to });
  return (
    <div>
      <PageTitle title="Prescriptions" subtitle="Your doctor's finalized prescriptions, newest first. They are read-only." />
      <form method="get" className="mb-4 grid grid-cols-2 gap-3 sm:max-w-md" aria-label="Filter by date">
        <label className="type-label">From<input type="date" name="from" defaultValue={sp.from ?? ""} className="type-body mt-1 min-h-12 w-full rounded-md border border-line-strong bg-surface px-3" /></label>
        <label className="type-label">To<input type="date" name="to" defaultValue={sp.to ?? ""} className="type-body mt-1 min-h-12 w-full rounded-md border border-line-strong bg-surface px-3" /></label>
        <button type="submit" className="type-button col-span-2 min-h-12 rounded-md border border-line-strong px-4 hover:bg-surface-muted">Apply dates</button>
      </form>
      <Section>
        {!r.rows.length ? <Empty title="No prescriptions yet" hint="When your doctor finalizes a prescription it appears here." /> : <ul className="divide-y divide-line">{r.rows.map((p) => <RowLink key={p.id} href={`/portal/prescriptions/${p.id}`} title={`${p.number ?? "Prescription"} · ${dayLabel(p.date)}`} meta={`${p.doctorName} · ${p.medicines.slice(0, 3).join(", ")}${p.medicines.length > 3 ? ` +${p.medicines.length - 3} more` : ""}`} />)}</ul>}
      </Section>
      <Pager page={r.page} total={r.total} pageSize={r.pageSize} href={(n) => `/portal/prescriptions?${new URLSearchParams({ ...(sp.from ? { from: sp.from } : {}), ...(sp.to ? { to: sp.to } : {}), page: String(n) })}`} />
    </div>
  );
}
