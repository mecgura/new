"use client";
import { StatusBadge } from "@/components/ui";
import { useApi } from "@/components/patients/use-api";
import { STATUS, CHANNEL, when } from "./comms-labels";

interface Data { rows: { id: string; at: string; channel: string; eventLabel: string; status: string; failureReason: string | null }[] }
/** Real delivery status of the messages about one appointment (or one patient), straight from the communication log. Renders nothing if you may not see it. */
export function CommunicationStatus({ appointmentId, patientId, title = "Patient messages" }: { appointmentId?: string; patientId?: string; title?: string }) {
  const qs = appointmentId ? `entityType=appointment&entityId=${encodeURIComponent(appointmentId)}` : `patientId=${encodeURIComponent(patientId ?? "")}`;
  const { data, error } = useApi<Data>(`/api/communications/entity?${qs}`);
  if (error?.code === "FORBIDDEN" || error?.code === "UNAUTHENTICATED") return null;
  return (
    <section aria-label={title} className="rounded-xl border border-line p-4">
      <h3 className="type-card-title">{title}</h3>
      {error ? <p className="type-caption mt-1">Couldn&apos;t load message status.</p> : !data ? <p className="type-caption mt-1">Loading…</p> : !data.rows.length ? <p className="type-caption mt-1">Nothing has been sent to the patient for this yet.</p> : (
        <ul className="mt-2 space-y-1.5">{data.rows.slice(0, 6).map((r) => <li key={r.id} className="flex flex-wrap items-center justify-between gap-2"><span className="type-secondary">{r.eventLabel} · {CHANNEL[r.channel] ?? r.channel} <span className="type-caption">· {when(r.at)}</span></span><StatusBadge tone={STATUS[r.status]?.[1]}>{STATUS[r.status]?.[0] ?? r.status}</StatusBadge></li>)}</ul>
      )}
    </section>
  );
}
