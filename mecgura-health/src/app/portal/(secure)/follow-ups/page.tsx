import type { Metadata } from "next";
import Link from "next/link";
import { ButtonLink } from "@/components/ui";
import { Empty, FilterTabs, PageTitle, Pill, RowLink, Section } from "@/components/portal/portal-server";
import { FOLLOWUP_STATUS, dayLabel } from "@/components/portal/portal-labels";
import { requirePatientContext } from "@/lib/portal/ctx";
import { listFollowUps } from "@/lib/services/portal-records";

export const metadata: Metadata = { title: "Follow-ups" };
export const dynamic = "force-dynamic";
export default async function FollowUpsPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const sp = await searchParams; const ctx = await requirePatientContext(); const r = await listFollowUps(ctx, { group: sp.filter });
  return (
    <div>
      <PageTitle title="Follow-ups" subtitle="Visits and check-ups your clinic has planned for you." action={<ButtonLink href="/portal/appointments/book" variant="outline">Book a visit</ButtonLink>} />
      <FilterTabs base="/portal/follow-ups" current={r.group === "completed" ? "completed" : ""} items={[["", "Upcoming"], ["completed", "Completed"]]} />
      <Section>
        {!r.rows.length ? <Empty title={r.group === "completed" ? "No completed follow-ups" : "No upcoming follow-ups"} /> : (
          <ul className="divide-y divide-line">{r.rows.map((f) => <RowLink key={f.id} title={f.title} meta={`${f.status === "COMPLETED" ? "Was due" : "Due"} ${dayLabel(f.dueDate)}${f.doctorName ? ` · ${f.doctorName}` : ""}`} right={<Pill status={f.status} map={FOLLOWUP_STATUS} />}>{f.appointment && <p className="type-caption mt-1"><Link href={`/portal/appointments/${f.appointment.id}`}>Appointment on {dayLabel(f.appointment.date)}</Link></p>}</RowLink>)}</ul>
        )}
      </Section>
    </div>
  );
}
