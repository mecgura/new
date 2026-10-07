"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { CheckCircle2, Download } from "lucide-react";
import { Alert, Button, Card, CardBody, Field, StatusBadge, Textarea, useToast } from "@/components/ui";
import { apiFetch } from "@/lib/api/client";
import { LabPrintButton } from "./lab-print-button";
import { fmt, REPORT_STATUS_LABEL } from "./lab-ui";

interface Props { reportId: string; orderId: string; version: number; latestVersion: number; versions: { version: number; createdAt: string; reason: string | null }[]; review: { status: string; note: string | null; at: string } | null; canReview: boolean; status: string }

/** Toolbar above a released report: versions, print/download (audited) and the treating doctor's acknowledgement. */
export function ReportActions({ reportId, orderId, version, latestVersion, versions, review, canReview, status }: Props) {
  const toast = useToast();
  const router = useRouter();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  async function send(s: "ACKNOWLEDGED" | "REVIEWED") {
    setBusy(s);
    const r = await apiFetch(`/api/lab/reports/${reportId}/review`, { method: "POST", body: JSON.stringify({ status: s, note: note || undefined }) });
    setBusy(null);
    if (!r.ok) { toast({ tone: "danger", title: r.error.message }); return; }
    toast({ tone: "success", title: s === "REVIEWED" ? "Marked as reviewed" : "Report acknowledged" }); router.refresh();
  }
  return (
    <div className="space-y-3 print:hidden">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="type-secondary">Version {version}{version !== latestVersion ? ` (latest is v${latestVersion})` : ""} · {versions.length} version{versions.length === 1 ? "" : "s"} on record{status === "AMENDED" ? " · an amendment is in progress" : ""}</p>
        <div className="flex flex-wrap gap-2">
          <LabPrintButton auditUrl={`/api/lab/reports/${reportId}/print`} body={{ version }} />
          <a href={`/api/lab/reports/${reportId}/document?version=${version}`} className="type-button inline-flex min-h-control items-center gap-2 rounded-md border border-line-strong px-4 !text-ink no-underline hover:bg-surface-muted"><Download aria-hidden className="size-4" />Download</a>
          <Link href={`/lab/orders/${orderId}`} className="type-button inline-flex min-h-control items-center rounded-md border border-line-strong px-4 !text-ink no-underline hover:bg-surface-muted">Open order</Link>
        </div>
      </div>
      {versions.length > 1 && (
        <nav aria-label="Report versions" className="flex flex-wrap gap-2">{versions.map((v) => <Link key={v.version} href={`/lab/reports/${reportId}?version=${v.version}`} aria-current={v.version === version ? "page" : undefined} className={`type-label rounded-md border px-3 py-1 no-underline ${v.version === version ? "border-primary bg-primary-soft !text-primary" : "border-line"}`} title={v.reason ?? undefined}>v{v.version}{v.version === latestVersion ? " (latest)" : ""}</Link>)}</nav>
      )}
      {review && <Alert tone="success" title={review.status === "REVIEWED" ? "You reviewed this version" : "You acknowledged this version"}>{fmt(review.at)}{review.note ? ` · ${review.note}` : ""}</Alert>}
      {canReview && review?.status !== "REVIEWED" && (
        <Card><CardBody className="space-y-3">
          <div className="flex items-center gap-2"><CheckCircle2 aria-hidden className="size-5 text-primary" /><p className="type-card-title">Doctor review</p><StatusBadge tone="info">{REPORT_STATUS_LABEL[status] ?? status}</StatusBadge></div>
          <p className="type-secondary">Confirm you have seen this report. This only records your review — it does not interpret the results.</p>
          <Field label="Note (optional)"><Textarea rows={2} value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} /></Field>
          <div className="flex flex-wrap gap-2">{!review && <Button variant="outline" loading={busy === "ACKNOWLEDGED"} onClick={() => send("ACKNOWLEDGED")}>Acknowledge</Button>}<Button loading={busy === "REVIEWED"} onClick={() => send("REVIEWED")}>Mark as reviewed</Button></div>
        </CardBody></Card>
      )}
    </div>
  );
}
