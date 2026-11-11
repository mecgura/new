"use client";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { Alert, Badge, Skeleton } from "@/components/ui";
import { useApi } from "@/components/patients/use-api";
import type { ConsultationContext } from "@/lib/services/consultation";
import type { CView } from "./types";

type Ctx = ConsultationContext;

function Block({ title, children, open }: { title: string; children: React.ReactNode; open?: boolean }) {
  return (
    <details open={open} className="group rounded-card border border-line bg-surface shadow-card">
      <summary className="type-label flex min-h-control cursor-pointer list-none items-center justify-between px-card py-2">{title}<span aria-hidden className="text-muted group-open:rotate-90">›</span></summary>
      <div className="space-y-1.5 border-t border-line px-card py-3 text-sm">{children}</div>
    </details>
  );
}
const none = (t: string) => <p className="type-secondary">{t}</p>;

/** Read-only clinical context for the doctor. It displays what is on record; it never checks, warns about or recommends anything. */
export function ContextSidebar({ c }: { c: CView }) {
  const { data, error, loading } = useApi<Ctx>(`/api/consultations/${c.id}/context`);
  return (
    <aside aria-label="Patient summary" className="space-y-3">
      <Block title="Visit" open>
        <p><span className="text-muted">Token</span> <strong className="tabular-nums">{c.visit.token}</strong> · <span className="text-muted">{c.visit.type.replace(/_/g, " ").toLowerCase()}</span></p>
        <p><span className="text-muted">Started</span> {c.startedLabel}</p>
        <p><span className="text-muted">Consultation</span> {c.number}</p>
        {c.appointment ? <p><span className="text-muted">Appointment</span> {c.appointment.when} · {c.appointment.publicId}{c.appointment.reason ? ` · ${c.appointment.reason}` : ""}</p> : none("Walk-in — no appointment.")}
      </Block>
      {loading && !data && <div className="space-y-3" role="status" aria-label="Loading patient context"><Skeleton className="h-24" /><Skeleton className="h-24" /><Skeleton className="h-24" /></div>}
      {error && <Alert tone="warning">Couldn&apos;t load the patient context. {error.message}</Alert>}
      {data && (
        <>
          <Block title="Allergies" open>
            {data.allergies.length ? (
              <ul className="space-y-1">{data.allergies.map((a, i) => <li key={i} className="flex gap-2 rounded-md border border-danger/40 bg-danger-soft p-2"><AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-danger" /><span><strong>{a.allergen}</strong>{a.reaction ? ` — ${a.reaction}` : ""}{a.severity !== "UNKNOWN" ? ` (${a.severity.toLowerCase()})` : ""}</span></li>)}</ul>
            ) : none("No allergies recorded.")}
            <p className="type-caption">Information from the patient file only. This system does not check medicines against allergies.</p>
          </Block>
          <Block title="Current medications (on record)" open>
            {data.currentMedications.length ? <ul className="list-disc space-y-0.5 pl-4">{data.currentMedications.map((m, i) => <li key={i}>{[m.name, m.strength, m.frequency].filter(Boolean).join(" · ")}</li>)}</ul> : none("No current medications recorded.")}
            <p className="type-caption">Separate from the new prescription — nothing is carried over automatically.</p>
          </Block>
          <Block title="Previous vitals">
            {data.previousVitals.length ? data.previousVitals.map((v, i) => <p key={i} className="tabular-nums"><span className="text-muted">{v.date}</span> {[v.bp && `BP ${v.bp}`, v.pulse && `P ${v.pulse}`, v.temperature, v.spo2 && `SpO₂ ${v.spo2}%`, v.weightKg && `${v.weightKg} kg`, v.bmi && `BMI ${v.bmi}`].filter(Boolean).join(" · ")}</p>) : none("No earlier vitals.")}
          </Block>
          <Block title="Previous diagnoses">{data.previousDiagnoses.length ? <div className="flex flex-wrap gap-1.5">{data.previousDiagnoses.map((d) => <Badge key={d}>{d}</Badge>)}</div> : none("No earlier diagnoses.")}</Block>
          <Block title="Recent consultations">
            {data.previousConsultations.length ? data.previousConsultations.map((p) => (
              <div key={p.id} className="rounded-md border border-line p-2"><p className="type-label">{p.date} · {p.doctor}</p><p className="type-secondary">{p.complaint ?? "—"}{p.diagnoses.length ? ` → ${p.diagnoses.join(", ")}` : ""}</p>{p.followUp && <p className="type-caption">Follow-up {p.followUp}</p>}<Link href={`/consultations/${p.id}`} className="type-caption">View full consultation</Link></div>
            )) : none("No previous consultations.")}
          </Block>
          <Block title="Recent prescriptions">
            {data.recentPrescriptions.length ? data.recentPrescriptions.map((r, i) => <div key={i}><p className="type-label">{r.number} · {r.date}</p><p className="type-secondary">{r.medicines.join(", ")}</p></div>) : none("No earlier prescriptions.")}
          </Block>
          <Block title="Recent visits">
            {data.recentVisits.length ? data.recentVisits.map((v) => <p key={v.id}>{v.date} · {v.doctor} · token {v.token}</p>) : none("No earlier visits.")}
          </Block>
          <Block title="Reports & documents">{none("No reports or documents yet. This arrives with the tests and documents modules.")}</Block>
        </>
      )}
    </aside>
  );
}
