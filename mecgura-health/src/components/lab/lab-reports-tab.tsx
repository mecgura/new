"use client";
import Link from "next/link";
import { Badge, Button, Card, CardHeader, EmptyState, ErrorState, LoadingState, StatusBadge } from "@/components/ui";
import { useApi } from "@/components/patients/use-api";
import { ORDER_STATUS_LABEL, ORDER_STATUS_TONE, PRIORITY_LABEL, PRIORITY_TONE, fmt } from "./lab-ui";

interface Row { id: string; orderNumber: string; status: string; priority: string; orderedAt: string | null; tests: string[]; report: { id: string; reportNumber: string; status: string; version: number; releasedAt: string | null } | null }

/** Patient 360 "Reports" tab: the patient's laboratory orders; results open only through a released report. */
export function LabReportsTab({ patientId }: { patientId: string }) {
  const { data, error, loading, reload } = useApi<{ orders: Row[] }>(`/api/patients/${patientId}/lab-reports`);
  return (
    <Card>
      <CardHeader title="Reports" description="Laboratory orders and released reports. Results are shown only in a released report." />
      {loading && !data ? <LoadingState /> : error ? (error.code === "FORBIDDEN" ? <EmptyState title="Reports aren't available to your role" description="Laboratory reports are visible to doctors and laboratory staff." /> : <ErrorState code={error.code} description={error.message} action={<Button onClick={reload}>Try again</Button>} />)
        : !data?.orders.length ? <EmptyState title="No laboratory orders yet" description="Investigations ordered in a consultation will appear here." /> : (
          <ul className="divide-y divide-line">{data.orders.map((o) => (
            <li key={o.id} className="flex flex-wrap items-center justify-between gap-3 p-card">
              <div className="min-w-0"><p className="type-label"><Link href={`/lab/orders/${o.id}`} className="tabular-nums">{o.orderNumber}</Link> · {o.tests.slice(0, 3).join(", ")}{o.tests.length > 3 ? ` +${o.tests.length - 3}` : ""}</p><p className="type-caption">Ordered {fmt(o.orderedAt)}{o.report ? ` · ${o.report.reportNumber} v${o.report.version}` : ""}</p></div>
              <div className="flex flex-wrap items-center gap-2">
                {o.priority !== "NORMAL" && <Badge tone={PRIORITY_TONE[o.priority]}>{PRIORITY_LABEL[o.priority]}</Badge>}
                <StatusBadge tone={ORDER_STATUS_TONE[o.status]}>{ORDER_STATUS_LABEL[o.status]}</StatusBadge>
                {o.report && <Link href={`/lab/reports/${o.report.id}`}><Button size="sm" variant="outline" aria-label={`Open report ${o.report.reportNumber}`}>Open report</Button></Link>}
              </div>
            </li>))}</ul>
        )}
    </Card>
  );
}
