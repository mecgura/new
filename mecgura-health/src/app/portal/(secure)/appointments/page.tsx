import type { Metadata } from "next";
import Link from "next/link";
import { CalendarPlus } from "lucide-react";
import { ButtonLink } from "@/components/ui";
import { Empty, FilterTabs, PageTitle, Pager, Pill, RowLink, Section } from "@/components/portal/portal-server";
import { APPT_STATUS, APPT_TYPE, dayLabel } from "@/components/portal/portal-labels";
import { requirePatientContext } from "@/lib/portal/ctx";
import { listAppointments } from "@/lib/services/portal-records";

export const metadata: Metadata = { title: "Appointments" };
export const dynamic = "force-dynamic";
export default async function AppointmentsPage({ searchParams }: { searchParams: Promise<{ filter?: string; page?: string }> }) {
  const sp = await searchParams; const ctx = await requirePatientContext(); const r = await listAppointments(ctx, { group: sp.filter, page: Number(sp.page) });
  return (
    <div>
      <PageTitle title="Appointments" action={<ButtonLink href="/portal/appointments/book"><CalendarPlus aria-hidden className="size-4" />Book</ButtonLink>} />
      <FilterTabs base="/portal/appointments" current={sp.filter && ["completed", "cancelled"].includes(sp.filter) ? sp.filter : ""} items={[["", "Upcoming"], ["completed", "Completed"], ["cancelled", "Cancelled"]]} />
      <Section>
        {!r.rows.length ? <Empty title={r.group === "upcoming" ? "No upcoming appointments" : r.group === "completed" ? "No completed appointments" : "No cancelled appointments"} /> : (
          <ul className="divide-y divide-line">{r.rows.map((a) => <RowLink key={a.id} href={`/portal/appointments/${a.id}`} title={`${dayLabel(a.date)} · ${a.time}`} meta={`${a.doctorName} · ${APPT_TYPE[a.type] ?? "Visit"}`} right={<Pill status={a.status} map={APPT_STATUS} />} />)}</ul>
        )}
      </Section>
      <Pager page={r.page} total={r.total} pageSize={r.pageSize} href={(p) => `/portal/appointments?${new URLSearchParams({ ...(sp.filter ? { filter: sp.filter } : {}), page: String(p) })}`} />
      <p className="type-caption mt-4"><Link href="/portal/opd">Check today&apos;s queue token</Link></p>
    </div>
  );
}
