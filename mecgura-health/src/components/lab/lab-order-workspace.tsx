"use client";
import Link from "next/link";
import { useCallback, useState } from "react";
import { FileText, Printer, Tag } from "lucide-react";
import { Alert, Badge, Button, Card, CardBody, CardHeader, EmptyState, Field, Modal, Select, StatusBadge, TextInput, Textarea, useToast } from "@/components/ui";
import { apiFetch } from "@/lib/api/client";
import { pickRange, rangeText, NO_RANGE, type ParamSnap } from "@/lib/lab/core";
import type { LabItemView, LabOrderDetail, LabSampleView } from "@/lib/services/lab-orders";
import { EVENT_LABEL, FLAG_LABEL, FLAG_TONE, ITEM_STATUS_LABEL, ORDER_STATUS_LABEL, ORDER_STATUS_TONE, PRIORITY_LABEL, PRIORITY_TONE, REPORT_STATUS_LABEL, SAMPLE_STATUS_LABEL, SAMPLE_STATUS_TONE, fmt } from "./lab-ui";

type Reload = () => Promise<void>;
const ageOf = (p: LabOrderDetail["patient"]) => { if (!p) return null; if (p.dateOfBirth) { const d = new Date(p.dateOfBirth); const n = new Date(); let a = n.getUTCFullYear() - d.getUTCFullYear(); if (n.getUTCMonth() < d.getUTCMonth() || (n.getUTCMonth() === d.getUTCMonth() && n.getUTCDate() < d.getUTCDate())) a--; return a; } return p.ageYears; };

export function LabOrderWorkspace({ initial, rejectionReasons }: { initial: LabOrderDetail; rejectionReasons: string[] }) {
  const toast = useToast();
  const [o, setO] = useState(initial);
  const [error, setError] = useState<string>();
  const reload = useCallback(async () => {
    const r = await apiFetch<LabOrderDetail>(`/api/lab/orders/${initial.id}`);
    if (r.ok) { setO(r.data); setError(undefined); } else setError(r.error.message);
  }, [initial.id]);
  async function post(body: Record<string, unknown>, ok?: string): Promise<boolean> {
    const r = await apiFetch(`/api/lab/orders/${o.id}/action`, { method: "POST", body: JSON.stringify(body) });
    if (!r.ok) { toast({ tone: "danger", title: r.error.message }); await reload(); return false; }
    if (ok) toast({ tone: "success", title: ok });
    await reload(); return true;
  }
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState("");
  const cancelled = o.status === "CANCELLED";
  const sampleTypes = [...new Set(o.items.map((i) => i.sampleType?.trim() || "Not specified"))];
  const pendingTypes = sampleTypes.filter((t) => o.items.some((i) => (i.sampleType?.trim() || "Not specified") === t && ["ORDERED", "RECOLLECTION_REQUIRED"].includes(i.status)));
  const received = o.items.filter((i) => i.status === "SAMPLE_RECEIVED");
  const correcting = !!o.report && ["DRAFT", "AMENDED"].includes(o.report.status);
  const editable = o.items.filter((i) => ["PROCESSING", "RESULT_READY"].includes(i.status) && (["NONE", "DRAFT"].includes(i.resultStatus) || (correcting && i.resultStatus === "SUBMITTED")));

  return (
    <div className="space-y-section">
      {error && <Alert tone="danger">{error}</Alert>}
      <Card>
        <CardBody className="space-y-2">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="type-page-title tabular-nums">{o.orderNumber}</h1>
              <p className="type-secondary mt-1">{o.patient ? <>{o.patient.name} · <span className="tabular-nums">{o.patient.code}</span>{[ageOf(o.patient) != null && `${ageOf(o.patient)} y`, o.patient.gender && o.patient.gender.toLowerCase()].filter(Boolean).length ? ` · ${[ageOf(o.patient) != null && `${ageOf(o.patient)} y`, o.patient.gender && o.patient.gender.toLowerCase()].filter(Boolean).join(" / ")}` : ""}</> : "Patient details hidden for your role"}</p>
              <p className="type-caption">Ordered by {o.doctorName ?? "—"} · {fmt(o.orderedAt)}{o.source === "EXTERNAL" ? ` · external laboratory${o.labPartner ? `: ${o.labPartner.name}` : ""}` : ""}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={PRIORITY_TONE[o.priority]}>{PRIORITY_LABEL[o.priority]}</Badge>
              <StatusBadge tone={ORDER_STATUS_TONE[o.status]}>{ORDER_STATUS_LABEL[o.status]}</StatusBadge>
            </div>
          </div>
          {o.clinicalNotes && <p className="type-secondary"><strong>Clinical note:</strong> {o.clinicalNotes}</p>}
          {cancelled && <Alert tone="warning" title="This order was cancelled">{o.cancelReason}</Alert>}
          <div className="flex flex-wrap gap-2 print:hidden">
            {o.can.confirm && <Button size="sm" onClick={() => post({ action: "confirm" }, "Order confirmed")}>Confirm order</Button>}
            {o.can.print && <Link href={`/lab/orders/${o.id}/slip`}><Button size="sm" variant="outline"><Printer aria-hidden className="size-4" />Test slip</Button></Link>}
            {o.can.cancel && <Button size="sm" variant="ghost" onClick={() => setCancelOpen(true)}>Cancel order</Button>}
            {o.consultationId && o.patient && <Link href={`/consultations/${o.consultationId}`}><Button size="sm" variant="ghost">Open consultation</Button></Link>}
          </div>
          {o.source === "EXTERNAL" && (o.can.process || o.can.cancel) && <ExternalRef o={o} post={post} />}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Tests" description="Each test keeps the definition and reference ranges it had when it was ordered." />
        <ul className="divide-y divide-line">
          {o.items.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 p-card">
              <div className="min-w-0"><p className="type-label">{i.testName}</p><p className="type-caption">{i.sampleType ?? "Sample type not set"}{i.snapshot?.preparation ? ` · ${i.snapshot.preparation}` : ""}</p></div>
              <StatusBadge tone={i.status === "RECOLLECTION_REQUIRED" ? "danger" : i.status === "RESULT_READY" ? "success" : i.status === "CANCELLED" ? "neutral" : "info"}>{ITEM_STATUS_LABEL[i.status] ?? i.status}</StatusBadge>
            </li>
          ))}
        </ul>
      </Card>

      {!cancelled && (
        <Card>
          <CardHeader title="Samples & chain of custody" description="Every handover is recorded and can't be deleted. A rejected sample stays on record; a recollection is a new sample." />
          <CardBody className="space-y-3">
            {o.can.collect && pendingTypes.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-surface-muted p-3">
                <span className="type-label">Waiting for collection:</span>
                {pendingTypes.map((t) => <CollectButton key={t} type={t} post={post} />)}
              </div>
            )}
            {!o.samples.length ? <EmptyState title="No sample collected yet" description={o.can.collect ? "Collect a sample once the patient is ready." : undefined} /> : (
              <ul className="space-y-3">{o.samples.map((s) => <SampleRow key={s.id} s={s} items={o.items} o={o} post={post} reasons={rejectionReasons} />)}</ul>
            )}
            {o.can.enterResults && received.length > 0 && <Button onClick={() => post({ action: "startProcessing" }, "Processing started")}>Start processing ({received.length} test{received.length === 1 ? "" : "s"})</Button>}
          </CardBody>
        </Card>
      )}

      {o.seeResults && o.items.some((i) => i.results.length) && editable.length === 0 && (
        <Card><CardHeader title="Results" description="Flags use only the reference ranges configured for each test." /><CardBody className="space-y-4">{o.items.filter((i) => i.results.length).map((i) => <ResultTable key={i.id} item={i} />)}</CardBody></Card>
      )}
      {o.can.enterResults && editable.length > 0 && (
        <Card><CardHeader title={correcting ? "Correct results" : "Result entry"} description="Type values exactly as measured. Flags are added only from the configured reference ranges." /><CardBody className="space-y-4">{editable.map((i) => <ResultForm key={i.id} orderId={o.id} item={i} patient={o.patient} reload={reload} correcting={correcting && i.resultStatus === "SUBMITTED"} />)}</CardBody></Card>
      )}

      {!cancelled && <ReportPanel o={o} post={post} />}

      {o.samples.length > 0 && (
        <Card><CardHeader title="Timeline" /><CardBody>
          <ol className="space-y-1.5">{o.samples.flatMap((s) => s.events.map((e) => ({ ...e, s }))).sort((a, b) => String(a.at).localeCompare(String(b.at))).map((e) => <li key={e.id} className="type-secondary"><span className="tabular-nums">{fmt(e.at)}</span> · <strong>{EVENT_LABEL[e.action] ?? e.action}</strong> · {e.s.sampleNumber} · {e.by ?? "—"}{e.department ? ` · ${e.department}` : ""}{e.notes ? ` · ${e.notes}` : ""}</li>)}</ol>
        </CardBody></Card>
      )}

      <Modal open={cancelOpen} onClose={() => setCancelOpen(false)} title="Cancel this order?" description="Only possible before a sample is collected. The related doctor order is cancelled too."
        footer={<><Button variant="outline" onClick={() => setCancelOpen(false)}>Keep order</Button><Button variant="danger" onClick={async () => { if (!reason.trim()) { toast({ tone: "danger", title: "Enter a reason" }); return; } if (await post({ action: "cancel", reason }, "Order cancelled")) { setCancelOpen(false); setReason(""); } }}>Cancel order</Button></>}>
        <Field label="Reason" required><Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} /></Field>
      </Modal>
    </div>
  );
}

function ExternalRef({ o, post }: { o: LabOrderDetail; post: (b: Record<string, unknown>, ok?: string) => Promise<boolean> }) {
  const [v, setV] = useState(o.externalRef ?? "");
  return (
    <div className="flex flex-wrap items-end gap-2">
      <Field label="External lab reference" hint="Manual tracking. No laboratory system is connected."><TextInput value={v} onChange={(e) => setV(e.target.value)} maxLength={60} /></Field>
      <Button size="sm" variant="outline" onClick={() => post({ action: "setExternalRef", externalRef: v }, "Reference saved")}>Save reference</Button>
    </div>
  );
}

function CollectButton({ type, post }: { type: string; post: (b: Record<string, unknown>, ok?: string) => Promise<boolean> }) {
  const [busy, setBusy] = useState(false);
  return <Button size="sm" loading={busy} onClick={async () => { setBusy(true); await post({ action: "collect", sampleType: type }, `${type} sample collected`); setBusy(false); }}><Tag aria-hidden className="size-4" />Collect {type}</Button>;
}

function SampleRow({ s, items, o, post, reasons }: { s: LabSampleView; items: LabItemView[]; o: LabOrderDetail; post: (b: Record<string, unknown>, ok?: string) => Promise<boolean>; reasons: string[] }) {
  const [rej, setRej] = useState(false);
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const tests = items.filter((i) => i.sampleId === s.id).map((i) => i.testName);
  const canReject = o.can.process && ["COLLECTED", "RECEIVED", "PROCESSING"].includes(s.status) && !items.some((i) => i.sampleId === s.id && !["NONE", "DRAFT"].includes(i.resultStatus));
  return (
    <li className="rounded-md border border-line p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="type-label"><span className="tabular-nums">{s.sampleNumber}</span> · {s.sampleType}{s.attempt > 1 ? ` · recollection ${s.attempt}` : ""}</p>
          <p className="type-caption">Collected {fmt(s.collectedAt)} by {s.collectedBy ?? "—"}{s.receivedAt ? ` · received ${fmt(s.receivedAt)} by ${s.receivedBy ?? "—"}` : ""}{tests.length ? ` · ${tests.join(", ")}` : ""}</p>
          {s.status === "REJECTED" && <p className="type-caption text-danger">Rejected: {s.rejectionReason} ({s.rejectedBy ?? "—"}, {fmt(s.rejectedAt)})</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          <StatusBadge tone={SAMPLE_STATUS_TONE[s.status]}>{SAMPLE_STATUS_LABEL[s.status] ?? s.status}</StatusBadge>
          {o.can.process && s.status === "COLLECTED" && <Button size="sm" loading={busy} onClick={async () => { setBusy(true); await post({ action: "receive", sampleId: s.id }, "Sample received"); setBusy(false); }}>Receive</Button>}
          {canReject && <Button size="sm" variant="outline" onClick={() => setRej(true)}>Reject</Button>}
          {o.can.print && <Link href={`/lab/samples/${s.id}/label`}><Button size="sm" variant="ghost"><Printer aria-hidden className="size-4" />Label</Button></Link>}
        </div>
      </div>
      <details className="mt-2"><summary className="type-caption cursor-pointer">Chain of custody ({s.events.length})</summary>
        <ol className="mt-1 space-y-0.5">{s.events.map((e) => <li key={e.id} className="type-caption"><span className="tabular-nums">{fmt(e.at)}</span> · {EVENT_LABEL[e.action] ?? e.action} · {e.by ?? "—"}{e.department ? ` · ${e.department}` : ""}{e.notes ? ` · ${e.notes}` : ""}</li>)}</ol>
      </details>
      <Modal open={rej} onClose={() => setRej(false)} title="Reject sample" description="The sample stays on record. A new sample must be collected for these tests."
        footer={<><Button variant="outline" onClick={() => setRej(false)}>Cancel</Button><Button variant="danger" loading={busy} onClick={async () => { setBusy(true); const ok = await post({ action: "reject", sampleId: s.id, reason, notes: notes || undefined }, "Sample rejected — recollection requested"); setBusy(false); if (ok) { setRej(false); setReason(""); setNotes(""); } }}>Reject sample</Button></>}>
        <div className="space-y-3">
          <Field label="Rejection reason" required>{reasons.length ? <Select value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Choose a reason" options={reasons.map((r) => ({ value: r, label: r }))} /> : <TextInput value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
          <Field label="Notes"><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={300} /></Field>
        </div>
      </Modal>
    </li>
  );
}

export function ResultTable({ item }: { item: LabItemView }) {
  return (
    <div>
      <p className="type-label mb-1">{item.testName}</p>
      <div className="overflow-x-auto"><table className="w-full text-left"><caption className="sr-only">{item.testName} results</caption>
        <thead><tr className="type-caption"><th className="py-1 pr-3">Parameter</th><th className="py-1 pr-3">Result</th><th className="py-1 pr-3">Unit</th><th className="py-1 pr-3">Reference range</th><th className="py-1">Flag</th></tr></thead>
        <tbody>{item.results.map((r) => (
          <tr key={r.position} className="border-t border-line type-secondary"><td className="py-1.5 pr-3">{r.parameterName}{r.remarks && <span className="block type-caption">{r.remarks}</span>}</td><td className="py-1.5 pr-3 font-semibold tabular-nums !text-ink">{r.value}</td><td className="py-1.5 pr-3">{r.unit ?? ""}</td><td className="py-1.5 pr-3">{r.refText ?? <span className="type-caption">{NO_RANGE}</span>}</td><td className="py-1.5">{r.flag ? <StatusBadge tone={FLAG_TONE[r.flag] ?? "neutral"}>{FLAG_LABEL[r.flag] ?? r.flag}</StatusBadge> : "—"}</td></tr>
        ))}</tbody></table></div>
    </div>
  );
}

function ResultForm({ orderId, item, patient, reload, correcting }: { orderId: string; item: LabItemView; patient: LabOrderDetail["patient"]; reload: Reload; correcting: boolean }) {
  const toast = useToast();
  const params = item.snapshot?.parameters ?? [];
  const [vals, setVals] = useState<Record<number, { value: string; remarks: string }>>(() => Object.fromEntries(params.map((_, n) => { const r = item.results.find((x) => x.position === n); return [n, { value: r?.value ?? "", remarks: r?.remarks ?? "" }]; })));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<"save" | "submit" | null>(null);
  const age = ageOf(patient);
  async function send(submit: boolean) {
    setBusy(submit ? "submit" : "save"); setErrors({});
    const r = await apiFetch(`/api/lab/orders/${orderId}/items/${item.id}/results`, { method: "PUT", body: JSON.stringify({ submit, entries: params.map((_, n) => ({ position: n, value: vals[n]?.value ?? "", remarks: vals[n]?.remarks || undefined })) }) });
    setBusy(null);
    if (!r.ok) { setErrors(r.error.fieldErrors ?? {}); toast({ tone: "danger", title: r.error.message }); if (!r.error.fieldErrors) await reload(); return; }
    toast({ tone: "success", title: correcting ? "Correction saved" : submit ? "Results submitted" : "Draft saved" }); await reload();
  }
  return (
    <section aria-label={`Enter results for ${item.testName}`} className="rounded-md border border-line p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2"><p className="type-card-title">{item.testName}</p><StatusBadge tone={item.resultStatus === "DRAFT" || correcting ? "warning" : "neutral"}>{correcting ? "Open for correction" : item.resultStatus === "DRAFT" ? "Draft saved" : "No results yet"}</StatusBadge></div>
      <div className="space-y-3">
        {params.map((p: ParamSnap, n) => {
          const range = p.resultType === "NUMERIC" ? pickRange(p.ranges, patient?.gender, age) : null;
          const saved = item.results.find((r) => r.position === n);
          return (
            <div key={n} className="grid gap-2 sm:grid-cols-[1fr_1fr]">
              <Field label={`${p.name}${p.unit ? ` (${p.unit})` : ""}`} error={errors[`entries.${n}`]} hint={p.resultType === "NUMERIC" ? (range ? `Reference: ${rangeText(range, p.unit)}` : NO_RANGE) : undefined}>
                {p.resultType === "QUALITATIVE" && p.options?.length
                  ? <Select value={vals[n]?.value ?? ""} onChange={(e) => setVals({ ...vals, [n]: { ...vals[n], value: e.target.value } })} placeholder="Choose" options={p.options.map((x) => ({ value: x.value, label: x.value }))} />
                  : <TextInput value={vals[n]?.value ?? ""} inputMode={p.resultType === "NUMERIC" ? "decimal" : undefined} onChange={(e) => setVals({ ...vals, [n]: { ...vals[n], value: e.target.value } })} maxLength={500} />}
              </Field>
              <Field label="Remarks" hint={saved?.flag ? `Saved flag: ${FLAG_LABEL[saved.flag] ?? saved.flag}` : undefined}><TextInput value={vals[n]?.remarks ?? ""} onChange={(e) => setVals({ ...vals, [n]: { ...vals[n], remarks: e.target.value } })} maxLength={300} /></Field>
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">{!correcting && <Button variant="outline" loading={busy === "save"} onClick={() => send(false)}>Save draft</Button>}<Button loading={busy === "submit"} onClick={() => send(true)}>{correcting ? "Save correction" : "Submit results"}</Button></div>
    </section>
  );
}

function ReportPanel({ o, post }: { o: LabOrderDetail; post: (b: Record<string, unknown>, ok?: string) => Promise<boolean> }) {
  const [dlg, setDlg] = useState<null | "requestCorrection" | "amend">(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const r = o.report;
  const allSubmitted = o.items.filter((i) => i.status !== "CANCELLED").length > 0 && o.items.filter((i) => i.status !== "CANCELLED").every((i) => i.status === "RESULT_READY" && i.resultStatus === "SUBMITTED");
  const canGenerate = o.can.enterResults && allSubmitted && (!r || r.status === "DRAFT");
  if (!r && !canGenerate) return null;
  async function go(action: string, ok: string) { setBusy(true); await post({ action }, ok); setBusy(false); }
  return (
    <Card>
      <CardHeader title="Report" description={r ? `${r.reportNumber}${r.currentVersion ? ` · version ${r.currentVersion}` : ""}` : "All results are submitted."} action={r ? <StatusBadge tone={r.status === "RELEASED" ? "success" : r.status === "DRAFT" || r.status === "AMENDED" ? "warning" : "info"}>{REPORT_STATUS_LABEL[r.status]}</StatusBadge> : undefined} />
      <CardBody className="space-y-3">
        {r?.amendReason && <Alert tone="warning" title="Amendment in progress">{r.amendReason}</Alert>}
        {o.can.enterResults && o.items.some((i) => i.results.length) && o.seeResults && allSubmitted && <div className="space-y-4">{o.items.filter((i) => i.results.length).map((i) => <ResultTable key={i.id} item={i} />)}</div>}
        <div className="flex flex-wrap gap-2 print:hidden">
          {canGenerate && <Button loading={busy} onClick={() => go("generateReport", "Report generated")}><FileText aria-hidden className="size-4" />Generate report</Button>}
          {o.can.review && r && ["UNDER_REVIEW", "AMENDED"].includes(r.status) && allSubmitted && <Button loading={busy} onClick={() => go("verify", "Report verified")}>Verify results</Button>}
          {o.can.review && r?.status === "VERIFIED" && <Button loading={busy} onClick={() => go("release", "Report released to the doctor")}>Release report</Button>}
          {o.can.review && r && ["UNDER_REVIEW", "VERIFIED"].includes(r.status) && <Button variant="outline" onClick={() => { setReason(""); setDlg("requestCorrection"); }}>Send back for correction</Button>}
          {o.can.review && r && r.status === "RELEASED" && <Button variant="outline" onClick={() => { setReason(""); setDlg("amend"); }}>Amend report</Button>}
          {r && r.currentVersion > 0 && <Link href={`/lab/reports/${r.id}`}><Button variant="outline">Open released report</Button></Link>}
        </div>
        {o.can.enterResults && !o.can.review && r && ["UNDER_REVIEW", "VERIFIED"].includes(r.status) && <p className="type-caption">A lab reviewer must verify and release this report.</p>}
      </CardBody>
      <Modal open={!!dlg} onClose={() => setDlg(null)} title={dlg === "amend" ? "Amend released report" : "Send back for correction"} description={dlg === "amend" ? "The released version stays on record unchanged. A new version is released after the correction." : "Results return to the lab for correction."}
        footer={<><Button variant="outline" onClick={() => setDlg(null)}>Cancel</Button><Button loading={busy} onClick={async () => { if (!reason.trim()) return; setBusy(true); const ok = await post({ action: dlg, reason }, dlg === "amend" ? "Amendment started" : "Sent back for correction"); setBusy(false); if (ok) setDlg(null); }}>Confirm</Button></>}>
        <Field label="Reason" required><Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} /></Field>
      </Modal>
    </Card>
  );
}
