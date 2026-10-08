import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageTitle, Section } from "@/components/portal/portal-server";
import { dayLabel } from "@/components/portal/portal-labels";
import { AppError } from "@/lib/errors";
import { requirePatientContext } from "@/lib/portal/ctx";
import { getConsultation } from "@/lib/services/portal-records";

export const metadata: Metadata = { title: "Consultation" };
export const dynamic = "force-dynamic";
export default async function ConsultationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; const ctx = await requirePatientContext();
  let c; try { c = await getConsultation(ctx, id); } catch (e) { if (e instanceof AppError) notFound(); throw e; }
  return (
    <div className="space-y-4">
      <PageTitle title={`Visit on ${dayLabel(c.date)}`} subtitle={`${c.doctorName} · ${c.number}`} back={{ href: "/portal/consultations", label: "Consultations" }} />
      {c.complaints.length > 0 && <Section title="What you came for"><ul className="list-disc space-y-1 p-4 pl-8">{c.complaints.map((x) => <li key={x} className="type-body">{x}</li>)}</ul></Section>}
      {c.diagnoses && c.diagnoses.length > 0 && <Section title="Diagnosis"><ul className="list-disc space-y-1 p-4 pl-8">{c.diagnoses.map((x) => <li key={x} className="type-body">{x}</li>)}</ul></Section>}
      {c.advice && <Section title="Doctor's advice"><p className="type-body whitespace-pre-line p-4">{c.advice}</p></Section>}
      {c.followUp && <Section title="Follow-up"><p className="type-body p-4">{c.followUp.date ? `Please come back on ${dayLabel(c.followUp.date)}.` : c.followUp.afterDays ? `Please come back after ${c.followUp.afterDays} days.` : "A follow-up visit is advised."}</p></Section>}
      {c.hasPrescription && <p><Link href="/portal/prescriptions" className="type-label">View your prescriptions →</Link></p>}
    </div>
  );
}
