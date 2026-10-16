"use client";
import { BillingStatus } from "@/components/billing/billing-status";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Check, CheckCircle2, Loader2, Lock, MoreHorizontal, Printer, TriangleAlert } from "lucide-react";
import { Alert, Badge, Button, ConfirmDialog, Dropdown, Field, Modal, StatusBadge, TextInput, useToast } from "@/components/ui";
import { apiFetch } from "@/lib/api/client";
import { cn } from "@/lib/cn";
import { ContextSidebar } from "./context-sidebar";
import { PrescriptionBuilder } from "./prescription-builder";
import { FollowUpsSection } from "./followups-section";
import { InvestigationsSection } from "./investigations-section";
import { AdviceSection, AssessmentSection, NotesSection, OrdersSection, VitalsSection } from "./sections";
import { toForm, toPatch, type CView, type Form, type Staff } from "./types";

type Save = "saved" | "saving" | "dirty" | "error" | "conflict";
const TABS = [["vitals", "Vitals"], ["notes", "Complaint & history"], ["assessment", "Assessment & diagnosis"], ["prescription", "Prescription"], ["advice", "Advice & follow-up"], ["orders", "Doctor orders"], ["investigations", "Investigations"], ["followups", "Follow-ups"]] as const;
type Tab = (typeof TABS)[number][0];
const STATUS_TONE: Record<string, "info" | "warning" | "success" | "neutral" | "danger"> = { DRAFT: "neutral", IN_PROGRESS: "info", READY_FOR_REVIEW: "warning", FINALIZED: "success", CANCELLED: "danger" };
const STATUS_LABEL: Record<string, string> = { DRAFT: "Draft", IN_PROGRESS: "In progress", READY_FOR_REVIEW: "Ready for review", FINALIZED: "Finalized", CANCELLED: "Cancelled" };
const cap = (s: string | null) => (s ? s[0] + s.slice(1).toLowerCase() : "");

export function ConsultationWorkspace({ initial, staff, canViewPatient }: { initial: CView; staff: Staff[]; canViewPatient: boolean }) {
  const toast = useToast();
  const [c, setC] = useState<CView>(initial);
  const [form, setForm] = useState<Form>(() => toForm(initial));
  const [save, setSave] = useState<Save>("saved");
  const [saveMsg, setSaveMsg] = useState<string>();
  const [tab, setTab] = useState<Tab>("vitals");
  const [review, setReview] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [amend, setAmend] = useState(false);
  const [cancel, setCancel] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const [loadErr, setLoadErr] = useState<string>();
  const rev = useRef(initial.rev);
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflight = useRef<Promise<boolean> | null>(null);

  const ro = !c.can.edit;
  const reload = useCallback(async () => {
    const r = await apiFetch<CView>(`/api/consultations/${initial.id}`);
    if (!r.ok) { setLoadErr(r.error.message); return; }
    setLoadErr(undefined); setC(r.data);
    if (!dirty.current) { rev.current = r.data.rev; }
  }, [initial.id]);

  const flush = useCallback(async (): Promise<boolean> => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (inflight.current) await inflight.current;
    if (!dirty.current) return true;
    setSave("saving");
    const p = (async () => {
      const snapshot = form;
      const r = await apiFetch<{ rev: number }>(`/api/consultations/${initial.id}`, { method: "PATCH", body: JSON.stringify(toPatch(snapshot, rev.current)) });
      if (!r.ok) {
        if (r.error.code === "CONFLICT") { setSave("conflict"); setSaveMsg(r.error.message); } else { setSave("error"); setSaveMsg(r.error.fieldErrors ? "Some fields are invalid — check the highlighted sections." : r.error.message); }
        return false;
      }
      rev.current = r.data.rev; dirty.current = false; setSave("saved"); setSaveMsg(undefined); return true;
    })();
    inflight.current = p; const ok = await p; inflight.current = null; return ok;
  }, [form, initial.id]);

  const flushRef = useRef(flush);
  useEffect(() => { flushRef.current = flush; }, [flush]);
  const set = useCallback(<K extends keyof Form>(k: K, v: Form[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    dirty.current = true; setSave("dirty");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void flushRef.current(); }, 1200);
  }, []);
  useEffect(() => { const h = (e: BeforeUnloadEvent) => { if (dirty.current) { e.preventDefault(); } }; window.addEventListener("beforeunload", h); return () => window.removeEventListener("beforeunload", h); }, []);

  async function act(action: "review" | "edit" | "finalize" | "cancel" | "amend", extra: Record<string, unknown> = {}) {
    setBusy(true); setErr(undefined);
    if (action !== "amend" && !(await flush())) { setBusy(false); setErr("Fix the save problem first."); return false; }
    const r = await apiFetch<Record<string, unknown>>(`/api/consultations/${initial.id}/action`, { method: "POST", body: JSON.stringify({ action, ...extra }) });
    setBusy(false);
    if (!r.ok) { setErr(r.error.fieldErrors ? Object.values(r.error.fieldErrors).join(" ") : r.error.message); return false; }
    await reload();
    return r.data;
  }
  async function startReview() { const r = await act("review"); if (r) { setReview(true); setConfirm(false); } }
  async function finalize() {
    const r = await act("finalize", { confirm: true });
    if (r) { setReview(false); toast({ tone: "success", title: "Consultation finalized", description: (r as { prescriptionNumber?: string }).prescriptionNumber ? `Prescription ${(r as { prescriptionNumber: string }).prescriptionNumber} is ready to print.` : undefined }); }
  }

  const rx = c.prescription;
  const finalized = c.status === "FINALIZED";
  const rxItems = (rx?.items ?? []) as { name: string; strength?: string; dose?: string; frequency?: string; durationDays?: number }[];
  const saveBadge = { saved: <><Check aria-hidden className="size-3.5" />Saved</>, saving: <><Loader2 aria-hidden className="size-3.5 animate-spin" />Saving…</>, dirty: <>Unsaved changes</>, error: <><TriangleAlert aria-hidden className="size-3.5" />Not saved</>, conflict: <><TriangleAlert aria-hidden className="size-3.5" />Not saved</> }[save];
  const p = c.patient;

  return (
    <div className="space-y-section pb-24 lg:pb-0">
      <header className="rounded-card border border-line bg-surface p-card shadow-card lg:sticky lg:top-0 lg:z-20">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="type-caption uppercase tracking-wide">Patient</p>
            <h1 className="type-page-title break-words">{canViewPatient ? <Link href={`/patients/${p.id}`} className="!text-ink hover:underline">{p.name}</Link> : p.name}</h1>
            <p className="type-secondary mt-0.5"><span className="tabular-nums">{p.code}</span> · {[p.age, p.gender && cap(p.gender)].filter(Boolean).join(" • ") || "Age not recorded"}{p.phone ? <> · <span className="tabular-nums">{p.phone}</span></> : null}</p>
            <p className="type-secondary">Token <strong className="tabular-nums">{c.visit.token}</strong> · {c.visit.type.replace(/_/g, " ").toLowerCase()}{c.visit.priority === "EMERGENCY" && <> · <Badge tone="emergency">Emergency</Badge></>} · {c.doctor.name} · {c.startedLabel}</p>
            <div className="mt-1"><BillingStatus kind="consultation" id={c.id} /></div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={STATUS_TONE[c.status]}>{STATUS_LABEL[c.status]}{finalized && c.version > 1 ? ` · v${c.version}` : ""}</StatusBadge>
            <span role="status" aria-live="polite" className={cn("type-caption inline-flex items-center gap-1 rounded-pill px-2 py-0.5", save === "error" || save === "conflict" ? "bg-danger-soft !text-danger" : "bg-surface-muted")}>{saveBadge}</span>
            <Dropdown triggerLabel="More actions" trigger={<><MoreHorizontal aria-hidden className="size-4" /><span>More</span></>} triggerClassName="type-button inline-flex min-h-control items-center gap-2 rounded-md border border-line-strong bg-surface px-3 hover:bg-surface-muted"
              items={[...(canViewPatient ? [{ label: "View Patient 360", href: `/patients/${p.id}` }] : []), { label: "Previous consultations", href: `/consultations?patientId=${p.id}` }, { label: "Live OPD queue", href: "/opd" }, ...(c.can.owner && (c.status === "IN_PROGRESS" || c.status === "READY_FOR_REVIEW") ? [{ type: "separator" as const }, { label: "Cancel this consultation", tone: "danger" as const, onSelect: () => setCancel(true) }] : [])]} />
          </div>
        </div>
      </header>

      {loadErr && <Alert tone="warning">Couldn&apos;t refresh the consultation: {loadErr}</Alert>}
      {save === "conflict" && <Alert tone="danger" title="Changes not saved">{saveMsg} <button type="button" className="underline" onClick={() => window.location.reload()}>Reload the page</button></Alert>}
      {save === "error" && <Alert tone="danger" title="Couldn't save">{saveMsg} <button type="button" className="underline" onClick={() => void flush()}>Try again</button></Alert>}
      {err && <Alert tone="danger">{err}</Alert>}
      {finalized && (
        <Alert tone="success" title="This consultation is finalized"><span className="flex flex-wrap items-center gap-3"><Lock aria-hidden className="size-4" />It is locked. {c.can.amend ? "To correct it, use Amend — the original version stays on record." : "Only the treating doctor can amend it."}
          {c.can.amend && <Button size="sm" variant="outline" onClick={() => { setReason(""); setAmend(true); }}>Amend consultation</Button>}
          {rx && rx.currentVersion > 0 && c.can.print && <Link href={`/consultations/${c.id}/prescription`} target="_blank" rel="noopener" className="inline-flex items-center gap-1"><Printer aria-hidden className="size-4" />Open prescription</Link>}</span></Alert>
      )}
      {c.status === "CANCELLED" && <Alert tone="danger" title="This consultation was cancelled">It is kept for the record and can&apos;t be changed.</Alert>}
      {!finalized && c.status !== "CANCELLED" && !c.can.owner && <Alert tone="info" title="Read-only">Only the treating doctor ({c.doctor.name}) edits this consultation.{c.can.vitals ? " You can record vitals." : ""}</Alert>}
      {c.status === "IN_PROGRESS" && c.amendReason && <Alert tone="warning" title="Amending a finalized consultation">Reason: {c.amendReason}. Finalizing again saves a new version; the earlier one stays on record.</Alert>}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-section lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-section">
          <div role="tablist" aria-label="Consultation sections" className="-mx-page flex gap-1 overflow-x-auto px-page"
            onKeyDown={(e) => { const i = TABS.findIndex((t) => t[0] === tab); const n = e.key === "ArrowRight" ? (i + 1) % TABS.length : e.key === "ArrowLeft" ? (i - 1 + TABS.length) % TABS.length : e.key === "Home" ? 0 : e.key === "End" ? TABS.length - 1 : -1; if (n >= 0) { e.preventDefault(); setTab(TABS[n][0]); document.getElementById(`ctab-${TABS[n][0]}`)?.focus(); } }}>
            {TABS.map(([k, label]) => (
              <button key={k} id={`ctab-${k}`} role="tab" type="button" aria-selected={tab === k} aria-controls="cpanel" tabIndex={tab === k ? 0 : -1} onClick={() => setTab(k)}
                className={cn("type-label min-h-control shrink-0 whitespace-nowrap rounded-md border px-3", tab === k ? "border-primary bg-primary-soft !text-primary" : "border-transparent hover:bg-surface-muted")}>{label}
                {k === "prescription" && rxItems.length > 0 && <span className="type-caption ml-1">({rxItems.length})</span>}{k === "orders" && c.orders.length > 0 && <span className="type-caption ml-1">({c.orders.length})</span>}</button>
            ))}
          </div>
          <div id="cpanel" role="tabpanel" aria-labelledby={`ctab-${tab}`} tabIndex={0} className="space-y-section focus:outline-none">
            {tab === "vitals" && <VitalsSection c={c} reload={reload} />}
            {tab === "notes" && <NotesSection c={c} form={form} set={set} ro={ro} />}
            {tab === "assessment" && <AssessmentSection c={c} form={form} set={set} ro={ro} reload={reload} />}
            {tab === "prescription" && <PrescriptionBuilder c={c} readOnly={!c.can.owner || c.status === "CANCELLED" || (finalized && rx?.status === "FINALIZED")} reload={reload} onSaving={(s) => { if (s === "saving") setSave("saving"); else if (s === "saved" && !dirty.current) setSave("saved"); else if (s === "error") { setSave("error"); setSaveMsg("The prescription couldn't be saved."); } }} />}
            {tab === "advice" && <AdviceSection form={form} set={set} ro={ro} />}
            {tab === "orders" && <OrdersSection c={c} staff={staff} reload={reload} />}
            {tab === "investigations" && <InvestigationsSection c={c} reload={reload} />}
            {tab === "followups" && <FollowUpsSection c={c} />}
          </div>
        </div>
        <ContextSidebar c={c} />
      </div>

      {c.can.owner && !finalized && c.status !== "CANCELLED" && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface p-3 shadow-pop lg:static lg:rounded-card lg:border lg:shadow-card">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-end gap-2">
            <Button variant="outline" onClick={() => void flush()} disabled={save === "saving" || save === "saved"}>Save draft</Button>
            {c.status === "READY_FOR_REVIEW" ? <><Button variant="outline" onClick={() => act("edit")} loading={busy}>Back to editing</Button><Button onClick={() => { setConfirm(false); setReview(true); }}><CheckCircle2 aria-hidden className="size-4" />Finalize…</Button></> : <Button onClick={startReview} loading={busy}>Review & finalize</Button>}
          </div>
        </div>
      )}

      <Modal open={review} onClose={() => setReview(false)} title="Review before finalizing" description="Once finalized the consultation and prescription are locked. Corrections create a new version."
        footer={<><Button variant="outline" onClick={() => setReview(false)}>Keep editing</Button><Button onClick={finalize} loading={busy} disabled={!confirm}>Finalize consultation{rxItems.length ? " & prescription" : ""}</Button></>}>
        <div className="space-y-3 text-sm">
          <p><strong>{p.name}</strong> · {p.code} · {[p.age, p.gender && cap(p.gender)].filter(Boolean).join(" • ")}</p><p className="text-muted">Doctor: {c.doctor.name}</p>
          <section><h3 className="type-label">Diagnosis</h3>{c.diagnoses.length ? <ul className="list-disc pl-5">{(c.diagnoses as { id: string; name: string; type: string }[]).map((d) => <li key={d.id}>{d.name}{d.type === "PRIMARY" ? " (primary)" : ""}</li>)}</ul> : <p className="text-muted">None recorded.</p>}</section>
          <section><h3 className="type-label">Medicines</h3>{rxItems.length ? <ol className="list-decimal pl-5">{rxItems.map((i, n) => <li key={n}>{[i.name, i.strength, i.dose, i.frequency, i.durationDays ? `${i.durationDays} days` : null].filter(Boolean).join(" · ")}</li>)}</ol> : <p className="text-muted">No prescription.</p>}</section>
          <section><h3 className="type-label">Advice</h3><p className="whitespace-pre-wrap">{c.content.advice || <span className="text-muted">None.</span>}</p></section>
          <section><h3 className="type-label">Follow-up</h3><p>{c.content.followUp.required ? `${c.content.followUp.afterDays ? `After ${c.content.followUp.afterDays} days` : c.content.followUp.date ?? "Required"}${c.content.followUp.notes ? ` — ${c.content.followUp.notes}` : ""}` : <span className="text-muted">Not required.</span>}</p></section>
          <label className="flex items-start gap-3 rounded-md border border-line p-3"><input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} className="mt-0.5 size-5 accent-[var(--brand-primary)]" /><span>I have reviewed this and take responsibility for the diagnosis and prescription.</span></label>
          {err && <Alert tone="danger">{err}</Alert>}
        </div>
      </Modal>
      <Modal open={amend} onClose={() => setAmend(false)} title="Amend this consultation?" description="It reopens for editing. The finalized version stays on record and your changes are saved as a new version."
        footer={<><Button variant="outline" onClick={() => setAmend(false)} autoFocus>Cancel</Button><Button loading={busy} disabled={reason.trim().length < 3} onClick={async () => { if (await act("amend", { reason })) setAmend(false); }}>Start amendment</Button></>}>
        <Field label="Reason for the amendment" required><TextInput value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} /></Field>
      </Modal>
      <ConfirmDialog open={cancel} onCancel={() => setCancel(false)} title="Cancel this consultation?" description="Use this only if it was opened by mistake. The record is kept but can't be used." confirmLabel="Cancel consultation" loading={busy} onConfirm={async () => { if (await act("cancel", { reason: "Cancelled by doctor" })) setCancel(false); }} />
    </div>
  );
}
