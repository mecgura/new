import type { Metadata } from "next";
import Link from "next/link";
import { CalendarDays, CalendarPlus, ClipboardList, FileText, FlaskConical, Receipt, UserRound } from "lucide-react";
import { ButtonLink } from "@/components/ui";
import { Empty, Pill, Section } from "@/components/portal/portal-server";
import { APPT_STATUS, APPT_TYPE, OPD_STATUS, dayLabel, money, shortDay } from "@/components/portal/portal-labels";
import { requirePatientContext } from "@/lib/portal/ctx";
import { dashboard } from "@/lib/services/portal-records";

export const metadata: Metadata = { title: "Home" };
export const dynamic = "force-dynamic";

export default async function PortalDashboard() {
  const ctx = await requirePatientContext(); const d = await dashboard(ctx);
  const a = d.nextAppointment;
  const quick = [["/portal/appointments/book", "Book appointment", CalendarPlus, d.canBook], ["/portal/appointments", "My appointments", CalendarDays, true], ["/portal/prescriptions", "Prescriptions", FileText, true], ["/portal/reports", "Lab reports", FlaskConical, true], ["/portal/billing", "Bills", Receipt, true], ["/portal/follow-ups", "Follow-ups", ClipboardList, true], ["/portal/profile", "My profile", UserRound, true]] as const;
  return (
    <div className="space-y-5">
      <div>
        <h1 className="type-page-title">Hello, {d.greetingName}</h1>
        <p className="type-secondary mt-1">{d.clinicName} · Patient ID <span className="tabular-nums">{d.patient.code}</span></p>
        {d.profileCompletion < 100 && <p className="type-caption mt-1">Your profile is {d.profileCompletion}% complete. <Link href="/portal/profile" className="inline-flex min-h-11 items-center">Add the missing details</Link></p>}
      </div>

      {d.opdToken && (
        <Link href="/portal/opd" className="block rounded-2xl border border-primary bg-primary-soft p-4 no-underline">
          <p className="type-caption !text-primary">Your token today</p>
          <div className="mt-1 flex flex-wrap items-center justify-between gap-2"><p className="text-3xl font-bold tabular-nums !text-ink">{d.opdToken.token}</p><Pill status={d.opdToken.status} map={OPD_STATUS} /></div>
          <p className="type-secondary mt-1">{d.opdToken.message}</p>
          {d.opdToken.patientsAhead != null && <p className="type-label mt-1">{d.opdToken.patientsAhead === 0 ? "You are next" : `${d.opdToken.patientsAhead} patient${d.opdToken.patientsAhead === 1 ? "" : "s"} ahead of you`}</p>}
        </Link>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Section title="Next appointment" action={<Link href="/portal/appointments" className="type-label inline-flex min-h-11 min-w-11 items-center justify-end">All</Link>}>
          {a ? (
            <Link href={`/portal/appointments/${a.id}`} className="block p-4 no-underline hover:bg-surface-muted">
              <p className="type-card-title !text-ink">{dayLabel(a.date)} · {a.time}</p>
              <p className="type-secondary">{a.doctorName} · {APPT_TYPE[a.type] ?? "Visit"}</p><div className="mt-2"><Pill status={a.status} map={APPT_STATUS} /></div>
            </Link>
          ) : <Empty title="No upcoming appointments" action={d.canBook ? <ButtonLink href="/portal/appointments/book" size="sm">Book an appointment</ButtonLink> : undefined} />}
        </Section>
        <Section title="Today">
          {d.todaysAppointments.length ? <ul className="divide-y divide-line">{d.todaysAppointments.map((t) => <li key={t.id}><Link href={`/portal/appointments/${t.id}`} className="flex items-center justify-between gap-3 p-4 no-underline hover:bg-surface-muted"><span className="type-label !text-ink">{t.time} · {t.doctorName}</span><Pill status={t.status} map={APPT_STATUS} /></Link></li>)}</ul> : <Empty title="No appointment today" />}
        </Section>
        <Section title="Latest prescription" action={<Link href="/portal/prescriptions" className="type-label inline-flex min-h-11 min-w-11 items-center justify-end">All</Link>}>
          {d.latestPrescription ? <Link href={`/portal/prescriptions/${d.latestPrescription.id}`} className="block p-4 no-underline hover:bg-surface-muted"><p className="type-label !text-ink">{d.latestPrescription.number ?? "Prescription"} · {dayLabel(d.latestPrescription.date)}</p><p className="type-secondary">{d.latestPrescription.doctorName} · {d.latestPrescription.medicineCount} medicine{d.latestPrescription.medicineCount === 1 ? "" : "s"}</p></Link> : <Empty title="No prescriptions yet" />}
        </Section>
        <Section title="Latest lab report" action={<Link href="/portal/reports" className="type-label inline-flex min-h-11 min-w-11 items-center justify-end">All</Link>}>
          {d.latestReport ? <Link href={`/portal/reports/${d.latestReport.id}`} className="block p-4 no-underline hover:bg-surface-muted"><p className="type-label !text-ink">{d.latestReport.reportNumber} · {dayLabel(d.latestReport.date)}</p><p className="type-secondary">{d.latestReport.tests.slice(0, 3).join(", ")}</p></Link> : <Empty title="No reports available" />}
        </Section>
        <Section title="Bills" action={<Link href="/portal/billing" className="type-label inline-flex min-h-11 min-w-11 items-center justify-end">All</Link>}>
          {d.outstanding.totalMinor > 0 ? <Link href="/portal/billing?filter=unpaid" className="block p-4 no-underline hover:bg-surface-muted"><p className="type-caption">Outstanding</p><p className="type-page-title tabular-nums !text-ink">{money(d.outstanding.totalMinor, d.outstanding.currency)}</p><p className={`type-secondary ${d.outstanding.overdue ? "!text-danger" : ""}`}>{d.outstanding.count} unpaid bill{d.outstanding.count === 1 ? "" : "s"}{d.outstanding.overdue ? " · some are overdue" : ""}</p></Link> : <Empty title="No outstanding balance" />}
        </Section>
        <Section title="Follow-up" action={<Link href="/portal/follow-ups" className="type-label inline-flex min-h-11 min-w-11 items-center justify-end">All</Link>}>
          {d.upcomingFollowUp ? <Link href="/portal/follow-ups" className="block p-4 no-underline hover:bg-surface-muted"><p className="type-label !text-ink">{d.upcomingFollowUp.title}</p><p className="type-secondary">{d.upcomingFollowUp.due ? "Due now" : `Due ${shortDay(d.upcomingFollowUp.dueDate)}`}</p></Link> : <Empty title="No upcoming follow-up" />}
        </Section>
      </div>

      <Section title="Quick actions">
        <ul className="grid grid-cols-2 gap-px bg-line sm:grid-cols-4">{quick.filter((q) => q[3]).map(([href, label, Icon]) => <li key={href} className="bg-surface"><Link href={href} className="flex min-h-24 flex-col items-center justify-center gap-2 p-3 text-center no-underline hover:bg-surface-muted"><Icon aria-hidden className="size-6 !text-primary" /><span className="type-label !text-ink">{label}</span></Link></li>)}</ul>
      </Section>
    </div>
  );
}
