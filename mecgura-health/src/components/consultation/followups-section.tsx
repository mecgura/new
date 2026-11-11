"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { Badge, Button, Card, CardHeader, EmptyState, ErrorState, LoadingState, StatusBadge } from "@/components/ui";
import { NewFollowUpModal } from "@/components/followups/new-followup-modal";
import { PRIORITY_LABEL, PRIORITY_TONE, STATUS_LABEL, STATUS_TONE, TYPE_LABEL, dueText } from "@/components/followups/followup-ui";
import { apiFetch } from "@/lib/api/client";
import type { FollowUpRow } from "@/lib/services/followups";
import type { CView } from "./types";

/** Follow-ups created from this consultation (the doctor's plan on finalize, or ones created here). */
export function FollowUpsSection({ c }: { c: CView }) {
  const [rows, setRows] = useState<FollowUpRow[] | null>(null); const [err, setErr] = useState<string>(); const [open, setOpen] = useState(false);
  const load = useCallback(async () => { const r = await apiFetch<{ rows: FollowUpRow[] }>(`/api/followups?tab=all&consultationId=${c.id}`); if (r.ok) { setRows(r.data.rows); setErr(undefined); } else setErr(r.error.message); }, [c.id]);
  useEffect(() => { load(); }, [load]);
  const rxId = (c.prescription as { id?: string } | null)?.id;
  return (
    <Card>
      <CardHeader title="Follow-ups" description="Tasks so this patient is not missed. The follow-up plan on the Advice tab becomes a task when you finalize." action={c.can.owner && c.status !== "CANCELLED" ? <Button size="sm" onClick={() => setOpen(true)}><Plus aria-hidden className="size-4" />New follow-up</Button> : undefined} />
      {err && !rows ? <ErrorState description={err} action={<Button onClick={load}>Try again</Button>} /> : !rows ? <LoadingState /> : !rows.length ? <EmptyState title="No follow-ups yet" description="Mark “follow-up required” on the Advice tab and finalize, or create one here." /> : (
        <ul className="divide-y divide-line">{rows.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 p-card">
            <div className="min-w-0"><p className="type-label"><Link href={`/followups/${r.id}`} className="tabular-nums">{r.followUpNumber}</Link> · {r.title}</p><p className="type-caption">{TYPE_LABEL[r.type]} · due {dueText(r.dueDate, r.overdueDays)}</p></div>
            <div className="flex items-center gap-2">{r.priority !== "NORMAL" && <Badge tone={PRIORITY_TONE[r.priority]}>{PRIORITY_LABEL[r.priority]}</Badge>}<StatusBadge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</StatusBadge></div>
          </li>))}</ul>
      )}
      <NewFollowUpModal open={open} onClose={() => setOpen(false)} canClinical context={{ consultationId: c.id, prescriptionId: rxId }} defaultType="CONSULTATION_FOLLOW_UP" defaultTitle="Follow-up visit" types={["CONSULTATION_FOLLOW_UP", "MEDICATION_REVIEW", "PROCEDURE_FOLLOW_UP", "INVESTIGATION_PENDING", "OTHER"]} onCreated={load} />
    </Card>
  );
}
