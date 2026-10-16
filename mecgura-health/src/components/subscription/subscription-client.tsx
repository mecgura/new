"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Field, Modal, Select, TextInput, Textarea, Alert, StatusBadge, useToast } from "@/components/ui";
import { apiFetch } from "@/lib/api/client";
import type { PlanView } from "@/lib/services/sub-plans";
import type { ChangePreview } from "@/lib/services/sub-core";
import { rupees, when } from "./format";

type Plan = PlanView;
interface Props { plans: Plan[]; currentPlanId: string | null; currentInterval: string | null; status: string | null; canManage: boolean; tz: string }

/** Plan comparison + choose / change. The server decides what is allowed and what is charged; this only shows its preview. */
export function PlanPicker({ plans, currentPlanId, currentInterval, status, canManage, tz }: Props) {
  const router = useRouter(); const toast = useToast();
  const [interval, setInterval] = useState<"MONTHLY" | "YEARLY">((currentInterval as "MONTHLY" | "YEARLY") || "MONTHLY");
  const [busy, setBusy] = useState<string | null>(null); const [err, setErr] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ plan: Plan; p: ChangePreview } | null>(null);
  const managed = status && !["PENDING_PAYMENT", "CANCELLED", "EXPIRED"].includes(status) && status !== "TRIAL" ? true : status === "TRIAL";
  async function choose(plan: Plan, trial: boolean) {
    setBusy(plan.id + (trial ? "t" : "")); setErr(null);
    const r = await apiFetch<{ invoiceId: string | null; status: string }>("/api/subscription/choose", { method: "POST", body: JSON.stringify({ planId: plan.id, interval, trial }) });
    setBusy(null); if (!r.ok) { setErr(r.error.message); return; }
    toast({ tone: "success", title: trial ? "Trial started" : "Invoice created" }); router.refresh();
  }
  async function openPreview(plan: Plan) {
    setBusy(plan.id); setErr(null);
    const r = await apiFetch<{ preview: ChangePreview }>("/api/subscription/change", { method: "POST", body: JSON.stringify({ planId: plan.id, interval }) });
    setBusy(null); if (!r.ok) { setErr(r.error.message); return; } setPreview({ plan, p: r.data.preview });
  }
  async function confirm() {
    if (!preview) return; setBusy("confirm");
    const r = await apiFetch<{ invoiceId: string | null }>("/api/subscription/change", { method: "POST", body: JSON.stringify({ planId: preview.plan.id, interval, confirm: true }) });
    setBusy(null); if (!r.ok) { setErr(r.error.message); setPreview(null); return; }
    setPreview(null); toast({ tone: "success", title: r.data.invoiceId ? "Upgrade invoice created — pay it to switch" : "Plan change saved" }); router.refresh();
  }
  return (
    <section aria-labelledby="plans-h" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="plans-h" className="type-section-title">{managed ? "Change plan" : "Choose a plan"}</h2>
        <div role="group" aria-label="Billing period" className="inline-flex rounded-md border border-line-strong p-0.5">
          {(["MONTHLY", "YEARLY"] as const).map((v) => <button key={v} type="button" aria-pressed={interval === v} onClick={() => setInterval(v)} className={`type-label min-h-control rounded px-4 ${interval === v ? "bg-primary text-white" : ""}`}>{v === "MONTHLY" ? "Monthly" : "Yearly"}</button>)}
        </div>
      </div>
      {err && <Alert tone="danger" title="Couldn't do that">{err}</Alert>}
      {!plans.length && <p className="type-secondary">No plans are available right now. Please contact support.</p>}
      <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {plans.map((p) => {
          const price = interval === "YEARLY" ? p.annualPriceMinor : p.monthlyPriceMinor; const current = p.id === currentPlanId && interval === currentInterval;
          return (
            <li key={p.id} className="flex flex-col rounded-lg border border-line bg-surface p-card">
              <div className="flex items-center justify-between gap-2"><h3 className="type-card-title">{p.name}</h3>{p.id === currentPlanId && <StatusBadge tone="primary">Current</StatusBadge>}</div>
              {p.description && <p className="type-secondary mt-1">{p.description}</p>}
              <p className="mt-3"><span className="text-2xl font-semibold">{price === 0 ? "Free" : rupees(price, p.currency)}</span>{price > 0 && <span className="type-caption"> / {interval === "YEARLY" ? "year" : "month"}</span>}</p>
              {interval === "YEARLY" && p.annualSavingMinor > 0 && <p className="type-caption !text-success">Save {rupees(p.annualSavingMinor)} a year</p>}
              {p.setupFeeMinor > 0 && <p className="type-caption">One-time setup fee {rupees(p.setupFeeMinor)}</p>}
              <ul className="type-secondary mt-3 space-y-1" aria-label={`${p.name} limits`}>{p.limitList.filter((l) => l.mode !== "UNLIMITED" || ["maxDoctors", "maxPatients"].includes(l.key)).map((l) => <li key={l.key}>{l.label}: {l.text}</li>)}</ul>
              <ul className="type-secondary mt-3 space-y-1" aria-label={`${p.name} features`}>{p.featureList.map((f) => <li key={f.key}><span aria-hidden>{f.included ? "✓" : "–"}</span> <span className={f.included ? "" : "text-muted line-through"}>{f.label}</span><span className="sr-only">{f.included ? " included" : " not included"}</span></li>)}</ul>
              <div className="mt-auto flex flex-col gap-2 pt-4">
                {!canManage ? <p className="type-caption">Only a clinic admin can change the plan.</p>
                  : current ? <Button disabled variant="outline">Your current plan</Button>
                  : managed ? <Button loading={busy === p.id} onClick={() => openPreview(p)} variant="outline">Review change</Button>
                  : <>
                    {p.trialDays > 0 && status !== "EXPIRED" && status !== "CANCELLED" && <Button loading={busy === p.id + "t"} onClick={() => choose(p, true)} variant="outline">Start {p.trialDays}-day free trial</Button>}
                    <Button loading={busy === p.id} onClick={() => choose(p, false)}>{price === 0 ? "Start free plan" : "Subscribe"}</Button>
                  </>}
              </div>
            </li>
          );
        })}
      </ul>
      <Modal open={!!preview} onClose={() => setPreview(null)} title={preview ? `Switch to ${preview.plan.name}` : ""} description="Review exactly what changes before you confirm.">
        {preview && (
          <div className="space-y-3">
            {preview.p.blockedReason && <Alert tone="warning" title="Not possible yet">{preview.p.blockedReason}{preview.p.violations.length > 0 && <ul className="mt-2 list-disc pl-5">{preview.p.violations.map((v) => <li key={v.key}>{v.label}: you use {v.used}, the plan allows {v.limit}</li>)}</ul>}</Alert>}
            {preview.p.allowed && (
              <dl className="grid gap-1 sm:grid-cols-[10rem_1fr]">
                <dt className="type-caption">Type</dt><dd>{preview.p.kind === "UPGRADE" ? "Upgrade — takes effect once the invoice is paid" : preview.p.kind === "DOWNGRADE" ? "Downgrade — at the end of your paid period" : preview.p.kind === "INTERVAL" ? "Billing period change — at renewal" : "Plan switch during trial"}</dd>
                <dt className="type-caption">Effective</dt><dd>{preview.p.immediate ? "Now" : when(preview.p.effectiveAt, tz)}</dd>
                {preview.p.proration && <><dt className="type-caption">Unused credit / new price</dt><dd>{preview.p.proration.remainingDays} of {preview.p.proration.totalDays} days left · charge {rupees(preview.p.proration.netMinor)} (before tax)</dd></>}
                {preview.p.invoice && <><dt className="type-caption">Invoice total</dt><dd className="font-semibold">{rupees(preview.p.invoice.totalMinor)} (tax {rupees(preview.p.invoice.taxMinor)})</dd></>}
                {preview.p.featuresLost.length > 0 && <><dt className="type-caption">Features lost</dt><dd>{preview.p.featuresLost.join(", ")} (data is kept)</dd></>}
              </dl>
            )}
            <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setPreview(null)}>Close</Button>{preview.p.allowed && <Button loading={busy === "confirm"} onClick={confirm}>Confirm change</Button>}</div>
          </div>
        )}
      </Modal>
    </section>
  );
}

export function PayButton({ invoiceId, label = "Pay now", disabledReason }: { invoiceId: string; label?: string; disabledReason?: string | null }) {
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  async function pay() {
    setBusy(true); setErr(null); const r = await apiFetch<{ checkoutUrl: string }>(`/api/subscription/invoices/${invoiceId}/checkout`, { method: "POST" });
    if (!r.ok) { setBusy(false); setErr(r.error.message); return; } window.location.assign(r.data.checkoutUrl);
  }
  return <div><Button onClick={pay} loading={busy} disabled={!!disabledReason}>{label}</Button>{disabledReason && <p className="type-caption mt-1">{disabledReason}</p>}{err && <p role="alert" className="type-caption mt-1 !text-danger">{err}</p>}</div>;
}
export function CheckStatusButton({ invoiceId }: { invoiceId: string }) {
  const router = useRouter(); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<string | null>(null);
  async function go() { setBusy(true); const r = await apiFetch<{ status: string }>(`/api/subscription/invoices/${invoiceId}/sync`, { method: "POST" }); setBusy(false); setMsg(r.ok ? (r.data.status === "PAID" ? "Payment confirmed." : "Not confirmed yet.") : r.error.message); router.refresh(); }
  return <div><Button variant="outline" onClick={go} loading={busy}>Check payment status</Button><p role="status" className="type-caption mt-1">{msg}</p></div>;
}

export function CancelBox({ reasons, scheduled, accessUntil, tz }: { reasons: Record<string, string>; scheduled: boolean; accessUntil: string | null; tz: string }) {
  const router = useRouter(); const toast = useToast(); const [open, setOpen] = useState(false); const [busy, setBusy] = useState(false); const [err, setErr] = useState<{ message: string; reason?: string } | null>(null);
  async function resume() { setBusy(true); const r = await apiFetch("/api/subscription/resume", { method: "POST" }); setBusy(false); if (!r.ok) { setErr({ message: r.error.message }); return; } toast({ tone: "success", title: "Subscription will continue" }); router.refresh(); }
  async function cancel(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); const f = new FormData(e.currentTarget); setBusy(true); setErr(null);
    const r = await apiFetch("/api/subscription/cancel", { method: "POST", body: JSON.stringify({ reason: f.get("reason"), notes: f.get("notes") }) }); setBusy(false);
    if (!r.ok) { setErr({ message: r.error.message, reason: r.error.fieldErrors?.reason }); return; } setOpen(false); toast({ tone: "success", title: "Cancellation saved" }); router.refresh();
  }
  return (
    <div className="space-y-3">
      {scheduled ? <><Alert tone="warning" title="Cancellation scheduled">Your plan stays fully active until {when(accessUntil, tz)}. After that the workspace becomes read-only; your data is kept.</Alert><Button onClick={resume} loading={busy}>Keep my subscription</Button></>
        : <Button variant="danger" onClick={() => setOpen(true)}>Cancel subscription</Button>}
      {err && !open && <p role="alert" className="type-caption !text-danger">{err.message}</p>}
      <Modal open={open} onClose={() => setOpen(false)} title="Cancel subscription" description="You keep full access until the end of the period you already paid for. Nothing is deleted.">
        <form onSubmit={cancel} className="space-y-3" aria-label="Cancel subscription">
          <Field label="Why are you cancelling?" required error={err?.reason}><Select name="reason" placeholder="Choose a reason" options={Object.entries(reasons).map(([value, label]) => ({ value, label }))} required /></Field>
          <Field label="Anything we should know? (optional)"><Textarea name="notes" maxLength={500} rows={3} /></Field>
          {err && !err.reason && <p role="alert" className="type-caption !text-danger">{err.message}</p>}
          <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setOpen(false)}>Keep subscription</Button><Button type="submit" variant="danger" loading={busy}>Cancel at period end</Button></div>
        </form>
      </Modal>
    </div>
  );
}

interface Profile { legalName?: string; billingName?: string | null; billingEmail?: string; billingPhone?: string | null; contactName?: string | null; addressLine?: string | null; city?: string | null; state?: string | null; stateCode?: string | null; pincode?: string | null; gstin?: string | null; taxId?: string | null }
export function BillingProfileForm({ profile, canManage, defaults }: { profile: Profile | null; canManage: boolean; defaults: { name: string; email: string } }) {
  const router = useRouter(); const toast = useToast(); const [busy, setBusy] = useState(false); const [errs, setErrs] = useState<Record<string, string>>({}); const [top, setTop] = useState<string | null>(null);
  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); const f = new FormData(e.currentTarget); const body: Record<string, string> = {}; f.forEach((v, k) => { body[k] = String(v); });
    setBusy(true); setErrs({}); setTop(null); const r = await apiFetch("/api/subscription/billing-profile", { method: "PUT", body: JSON.stringify(body) }); setBusy(false);
    if (!r.ok) { setErrs(r.error.fieldErrors ?? {}); setTop(r.error.message); return; } toast({ tone: "success", title: "Billing details saved" }); router.refresh();
  }
  const v = (k: keyof Profile, d = "") => (profile?.[k] as string | null | undefined) ?? d;
  return (
    <form onSubmit={save} className="grid gap-4 sm:grid-cols-2" aria-label="Billing details">
      <Field label="Legal / billing name" required error={errs.legalName}><TextInput name="legalName" defaultValue={v("legalName", defaults.name)} disabled={!canManage} /></Field>
      <Field label="Billing email" required error={errs.billingEmail} hint="Invoices and payment notices go here."><TextInput name="billingEmail" type="email" defaultValue={v("billingEmail", defaults.email)} disabled={!canManage} /></Field>
      <Field label="Contact person" error={errs.contactName}><TextInput name="contactName" defaultValue={v("contactName")} disabled={!canManage} /></Field>
      <Field label="Billing phone" error={errs.billingPhone}><TextInput name="billingPhone" defaultValue={v("billingPhone")} disabled={!canManage} /></Field>
      <Field label="Address" className="sm:col-span-2" error={errs.addressLine}><TextInput name="addressLine" defaultValue={v("addressLine")} disabled={!canManage} /></Field>
      <Field label="City" error={errs.city}><TextInput name="city" defaultValue={v("city")} disabled={!canManage} /></Field>
      <Field label="State" error={errs.state}><TextInput name="state" defaultValue={v("state")} disabled={!canManage} /></Field>
      <Field label="GST state code" hint="Two digits, e.g. 03. Decides CGST+SGST or IGST." error={errs.stateCode}><TextInput name="stateCode" defaultValue={v("stateCode")} maxLength={2} disabled={!canManage} /></Field>
      <Field label="PIN code" error={errs.pincode}><TextInput name="pincode" defaultValue={v("pincode")} disabled={!canManage} /></Field>
      <Field label="GSTIN (optional)" error={errs.gstin} hint="Leave empty if the clinic is not GST-registered."><TextInput name="gstin" defaultValue={v("gstin")} maxLength={15} disabled={!canManage} /></Field>
      <Field label="Other tax ID (optional)" error={errs.taxId}><TextInput name="taxId" defaultValue={v("taxId")} disabled={!canManage} /></Field>
      {top && !Object.keys(errs).length && <p role="alert" className="type-caption !text-danger sm:col-span-2">{top}</p>}
      {canManage && <div className="sm:col-span-2"><Button type="submit" loading={busy}>Save billing details</Button></div>}
    </form>
  );
}
export function PrintBar({ downloadHref }: { downloadHref: string }) {
  return <div className="flex flex-wrap gap-2 print:hidden"><Button onClick={() => window.print()}>Print / Save as PDF</Button><a className="type-label inline-flex min-h-control items-center rounded-md border border-line-strong px-4 no-underline" href={downloadHref}>Download HTML</a></div>;
}
