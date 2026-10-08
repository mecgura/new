import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AppointmentActions } from "@/components/portal/appointment-actions";
import { PageTitle, Pill, Section } from "@/components/portal/portal-server";
import { APPT_STATUS, APPT_TYPE, dayLabel } from "@/components/portal/portal-labels";
import { AppError } from "@/lib/errors";
import { requirePatientContext } from "@/lib/portal/ctx";
import { getAppointment } from "@/lib/services/portal-records";

export const metadata: Metadata = { title: "Appointment" };
export const dynamic = "force-dynamic";
export default async function AppointmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; const ctx = await requirePatientContext();
  let a; try { a = await getAppointment(ctx, id); } catch (e) { if (e instanceof AppError) notFound(); throw e; }
  const rows: [string, React.ReactNode][] = [["Doctor", `${a.doctorName}${a.doctorSpecialization ? ` · ${a.doctorSpecialization}` : ""}`], ["Date", dayLabel(a.date)], ["Time", a.time], ["Type", APPT_TYPE[a.type] ?? "Visit"], ["Booked", a.bookedOnline ? "Online" : "By the clinic"], ...(a.serviceName ? [["Service", a.serviceName] as [string, string]] : []), ...(a.reason ? [["Reason you gave", a.reason] as [string, string]] : [])];
  return (
    <div className="space-y-4">
      <PageTitle title="Appointment" back={{ href: "/portal/appointments", label: "Appointments" }} action={<Pill status={a.status} map={APPT_STATUS} />} />
      <Section title={`${dayLabel(a.date)} · ${a.time}`}>
        <dl className="divide-y divide-line">{rows.map(([k, v]) => <div key={k} className="flex flex-wrap justify-between gap-2 px-4 py-3"><dt className="type-secondary">{k}</dt><dd className="type-label break-words text-right">{v}</dd></div>)}</dl>
      </Section>
      <Section title="Clinic">
        <div className="space-y-1 p-4"><p className="type-label">{a.clinic.name}</p>{a.clinic.address && <p className="type-secondary">{a.clinic.address}</p>}{a.clinic.phone && <p className="type-secondary"><a href={`tel:${a.clinic.phone}`}>{a.clinic.phone}</a></p>}</div>
      </Section>
      <Section title="Change or cancel"><div className="space-y-3 p-4"><p className="type-secondary">{a.policy.text}</p><AppointmentActions id={a.id} canCancel={a.canCancel} canReschedule={a.canReschedule} status={a.status} doctorHandle={a.doctorHandle} /></div></Section>
    </div>
  );
}
