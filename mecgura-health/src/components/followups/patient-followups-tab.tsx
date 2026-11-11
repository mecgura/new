"use client";
import Link from "next/link";
import { useState } from "react";
import { Plus } from "lucide-react";
import { Badge, Button, Card, CardHeader, EmptyState, ErrorState, LoadingState, StatusBadge } from "@/components/ui";
import { useApi } from "@/components/patients/use-api";
import { NewFollowUpModal } from "./new-followup-modal";
import { RecallsPanel } from "./recalls-panel";
import { PRIORITY_LABEL, PRIORITY_TONE, STATUS_LABEL, STATUS_TONE, TYPE_LABEL, dueText } from "./followup-ui";

interface Item { id: string; followUpNumber: string; type: string; title: string; dueDate: string; priority: string; status: string; doctorName: string | null; overdueDays: number; group: string }
const GROUPS: [string, string][] = [["overdue", "Overdue"], ["active", "Due today"], ["upcoming", "Upcoming"], ["completed", "Completed"], ["cancelled", "Cancelled"]];

/** Patient 360 "Follow-up" tab. */
export function PatientFollowUpsTab({ patientId, patientLabel }: { patientId: string; patientLabel: string }) {
  const { data, error, loading, reload } = useApi<{ followUps: Item[]; recalls: unknown[]; can: { create: boolean; recall: boolean } }>(`/api/patients/${patientId}/followups`);
  const [open, setOpen] = useState(false);
  if (loading && !data) return <Card><LoadingState /></Card>;
  if (error) return <Card>{error.code === "FORBIDDEN" ? <EmptyState title="Follow-ups aren't available to your role" /> : <ErrorState code={error.code} description={error.message} action={<Button onClick={reload}>Try again</Button>} />}</Card>;
  return (
    <div className="space-y-section">
      <Card>
        <CardHeader title="Follow-ups" description="Tasks so this patient is not missed. You see the follow-ups assigned to you or your own patients." action={data?.can.create ? <Button size="sm" onClick={() => setOpen(true)}><Plus aria-hidden className="size-4" />New follow-up</Button> : undefined} />
        {!data?.followUps.length ? <EmptyState title="No follow-ups for this patient" description="Follow-ups planned in a consultation or created by staff appear here." /> : GROUPS.map(([g, label]) => {
          const list = data.followUps.filter((f) => f.group === g);
          return list.length ? (
            <section key={g} aria-label={label}><h3 className="type-label px-card pt-3">{label} ({list.length})</h3>
              <ul className="divide-y divide-line">{list.map((f) => (
                <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 p-card">
                  <div className="min-w-0"><p className="type-label"><Link href={`/followups/${f.id}`} className="tabular-nums">{f.followUpNumber}</Link> · {f.title}</p><p className="type-caption">{TYPE_LABEL[f.type]} · {f.doctorName ?? "No doctor"} · due {dueText(f.dueDate, f.overdueDays)}</p></div>
                  <div className="flex items-center gap-2">{f.priority !== "NORMAL" && <Badge tone={PRIORITY_TONE[f.priority]}>{PRIORITY_LABEL[f.priority]}</Badge>}<StatusBadge tone={STATUS_TONE[f.status]}>{STATUS_LABEL[f.status]}</StatusBadge></div>
                </li>))}</ul></section>) : null;
        })}
      </Card>
      {data?.can.recall && <RecallsPanel canCreateFollowUp={data.can.create} presetPatient={{ id: patientId, label: patientLabel }} />}
      <NewFollowUpModal open={open} onClose={() => setOpen(false)} context={{ patientId, patientLabel }} onCreated={reload} />
    </div>
  );
}
