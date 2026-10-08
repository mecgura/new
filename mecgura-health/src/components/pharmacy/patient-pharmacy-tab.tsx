"use client";
import Link from "next/link";
import { Button, Card, CardHeader, EmptyState, ErrorState, LoadingState, StatusBadge } from "@/components/ui";
import { useApi } from "@/components/patients/use-api";
import type { patientPharmacy } from "@/lib/services/pharmacy-dispensing";
import { DISPENSING_LABEL, DISPENSING_TONE, stamp } from "./pharmacy-ui";

type P = Awaited<ReturnType<typeof patientPharmacy>>;
/** Patient 360 "Pharmacy" tab: what was dispensed. Dispensed medicine names and quantities only — no prices unless the role may see billing. */
export function PatientPharmacyTab({ patientId }: { patientId: string }) {
  const { data, error, loading, reload } = useApi<P>(`/api/patients/${patientId}/pharmacy`);
  if (loading && !data) return <Card><LoadingState /></Card>;
  if (error) return <Card>{error.code === "FORBIDDEN" ? <EmptyState title="Pharmacy history isn't available to your role" /> : <ErrorState code={error.code} description={error.message} action={<Button onClick={reload}>Try again</Button>} />}</Card>;
  if (!data) return null;
  return (
    <Card><CardHeader title="Pharmacy" description="Medicines dispensed to this patient. Dispensing never changes the doctor's prescription." />
      {!data.rows.length ? <EmptyState title="No medicines dispensed yet." /> : (
        <ul className="divide-y divide-line">{data.rows.map((r) => (
          <li key={r.id} className="space-y-1 p-card">
            <div className="flex flex-wrap items-center justify-between gap-2"><p className="type-label"><span className="tabular-nums">{r.dispensingNumber}</span> <span className="type-caption">· {stamp(r.dispensedAt)}{r.prescriptionNumber ? ` · prescription ${r.prescriptionNumber}` : ""}</span></p><StatusBadge tone={DISPENSING_TONE[r.status]}>{DISPENSING_LABEL[r.status]}</StatusBadge></div>
            <ul className="type-secondary">{r.items.map((i, n) => <li key={n}>{i.name} × {i.quantity} <span className="type-caption">(batch {i.batch})</span></li>)}</ul>
            {r.invoiceNumber && <p className="type-caption">Bill {r.invoiceNumber} ({(r.invoiceStatus ?? "").replace(/_/g, " ").toLowerCase()})</p>}
          </li>))}</ul>
      )}
      <p className="px-card pb-card type-caption"><Link href="/pharmacy/dispensing?view=history">Open pharmacy →</Link></p>
    </Card>
  );
}
