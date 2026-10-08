"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, Button, Field, Select, TextInput, Textarea, useToast } from "@/components/ui";
import { apiFetch } from "@/lib/api/client";
import { FEATURES } from "@/lib/platform/features";
import { LIMITS } from "@/lib/subscriptions/catalog";
import type { PlanView } from "@/lib/services/sub-plans";

const toMinor = (v: string) => Math.round((parseFloat(v || "0") || 0) * 100);
const toRupees = (m: number) => (m / 100).toFixed(m % 100 ? 2 : 0);

/** Create / edit a plan. Prices are typed in rupees and sent as whole paise. Editing never changes what existing subscribers have already been sold. */
export function PlanForm({ plan }: { plan: PlanView | null }) {
  const router = useRouter(); const toast = useToast(); const [busy, setBusy] = useState(false); const [err, setErr] = useState<{ message: string; fields: Record<string, string> } | null>(null);
  const archived = plan?.status === "ARCHIVED";
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); const f = new FormData(e.currentTarget);
    const features: Record<string, boolean> = {}; for (const x of FEATURES) features[x.key] = f.get(`f_${x.key}`) === "on";
    const limits: Record<string, unknown> = {};
    for (const l of LIMITS) { const mode = String(f.get(`m_${l.key}`)); limits[l.key] = mode === "LIMITED" ? { mode, value: Math.max(0, Math.floor(Number(f.get(`v_${l.key}`)) || 0)) } : { mode }; }
    const body = { name: f.get("name"), slug: f.get("slug"), description: f.get("description"), status: plan?.status ?? "DRAFT", currency: "INR", monthlyPriceMinor: toMinor(String(f.get("monthly"))), annualPriceMinor: toMinor(String(f.get("annual"))), setupFeeMinor: toMinor(String(f.get("setup"))), trialDays: Number(f.get("trialDays")) || 0, isPublic: f.get("isPublic") === "on", sortOrder: Number(f.get("sortOrder")) || 0, supportLevel: f.get("supportLevel"), features, limits };
    setBusy(true); setErr(null);
    const r = await apiFetch<{ id: string }>(plan ? `/api/platform/plans/${plan.id}` : "/api/platform/plans", { method: plan ? "PUT" : "POST", body: JSON.stringify(body) }); setBusy(false);
    if (!r.ok) { setErr({ message: r.error.message, fields: r.error.fieldErrors ?? {} }); return; }
    toast({ tone: "success", title: plan ? "Plan saved" : "Plan created" }); router.push(plan ? "/platform/plans" : `/platform/plans/${r.data.id}`); router.refresh();
  }
  const fe = (k: string) => err?.fields[k];
  return (
    <form onSubmit={submit} className="space-y-6" aria-label={plan ? "Edit plan" : "New plan"}>
      {err && <Alert tone="danger" title="Check the plan">{err.message}</Alert>}
      {archived && <Alert tone="warning" title="Archived">Restore this plan before editing it.</Alert>}
      <fieldset disabled={archived || busy} className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" required error={fe("name")}><TextInput name="name" defaultValue={plan?.name} /></Field>
        <Field label="Slug" required error={fe("slug")} hint="Lowercase letters, numbers and hyphens."><TextInput name="slug" defaultValue={plan?.slug} /></Field>
        <Field label="Description" className="sm:col-span-2" error={fe("description")}><Textarea name="description" rows={2} defaultValue={plan?.description} maxLength={400} /></Field>
        <Field label="Monthly price (₹)" error={fe("monthlyPriceMinor")}><TextInput name="monthly" inputMode="decimal" defaultValue={toRupees(plan?.monthlyPriceMinor ?? 0)} /></Field>
        <Field label="Yearly price (₹)" error={fe("annualPriceMinor")}><TextInput name="annual" inputMode="decimal" defaultValue={toRupees(plan?.annualPriceMinor ?? 0)} /></Field>
        <Field label="Setup fee (₹, one time)" error={fe("setupFeeMinor")}><TextInput name="setup" inputMode="decimal" defaultValue={toRupees(plan?.setupFeeMinor ?? 0)} /></Field>
        <Field label="Free trial (days)" error={fe("trialDays")} hint="0 = no trial. A trial never charges automatically."><TextInput name="trialDays" inputMode="numeric" defaultValue={String(plan?.trialDays ?? 0)} /></Field>
        <Field label="Sort order" error={fe("sortOrder")}><TextInput name="sortOrder" inputMode="numeric" defaultValue={String(plan?.sortOrder ?? 0)} /></Field>
        <Field label="Support level" error={fe("supportLevel")}><TextInput name="supportLevel" defaultValue={plan?.supportLevel} /></Field>
        <label className="type-label flex min-h-control items-center gap-2"><input type="checkbox" name="isPublic" defaultChecked={plan?.isPublic} /> Show on the public pricing page and let clinics pick it</label>
      </fieldset>
      <fieldset disabled={archived || busy} className="rounded-lg border border-line p-card"><legend className="type-label px-2">Features included</legend>
        <ul className="grid gap-2 sm:grid-cols-2">{FEATURES.map((x) => <li key={x.key}><label className="flex items-start gap-2"><input type="checkbox" name={`f_${x.key}`} defaultChecked={plan ? plan.features[x.key] === true : false} className="mt-1" /><span><span className="type-label">{x.label}</span><span className="type-caption block">{x.description}</span></span></label></li>)}</ul></fieldset>
      <fieldset disabled={archived || busy} className="rounded-lg border border-line p-card"><legend className="type-label px-2">Limits</legend>
        <ul className="space-y-3">{LIMITS.map((l) => { const cur = plan?.limits[l.key]; return (
          <li key={l.key} className="grid items-end gap-3 sm:grid-cols-[1fr_11rem_9rem]">
            <div><span className="type-label">{l.label}</span><span className="type-caption block">{l.description}</span></div>
            <Field label="Mode"><Select name={`m_${l.key}`} defaultValue={cur?.mode ?? "UNLIMITED"} options={[{ value: "LIMITED", label: "Limited" }, { value: "UNLIMITED", label: "Unlimited" }, { value: "DISABLED", label: "Not included" }]} /></Field>
            <Field label={`Value (${l.unit})`}><TextInput name={`v_${l.key}`} inputMode="numeric" defaultValue={String(cur?.value ?? "")} /></Field>
          </li>); })}</ul></fieldset>
      {!archived && <div className="flex gap-3"><Button type="submit" loading={busy}>{plan ? "Save plan" : "Create plan"}</Button><Button type="button" variant="outline" onClick={() => router.push("/platform/plans")}>Back</Button></div>}
    </form>
  );
}

export function PlanStatusButtons({ id, status }: { id: string; status: string }) {
  const router = useRouter(); const toast = useToast(); const [busy, setBusy] = useState<string | null>(null); const [err, setErr] = useState<string | null>(null);
  const moves: Record<string, [string, string][]> = { DRAFT: [["ACTIVE", "Activate"], ["ARCHIVED", "Archive"]], ACTIVE: [["INACTIVE", "Deactivate"], ["ARCHIVED", "Archive"]], INACTIVE: [["ACTIVE", "Activate"], ["ARCHIVED", "Archive"]], ARCHIVED: [["INACTIVE", "Restore"]] };
  async function go(to: string) { setBusy(to); setErr(null); const r = await apiFetch(`/api/platform/plans/${id}/status`, { method: "POST", body: JSON.stringify({ status: to }) }); setBusy(null); if (!r.ok) { setErr(r.error.message); return; } toast({ tone: "success", title: "Plan updated" }); router.refresh(); }
  return <div><div className="flex flex-wrap gap-2">{(moves[status] ?? []).map(([to, text]) => <Button key={to} size="sm" variant={to === "ARCHIVED" ? "outline" : "primary"} loading={busy === to} onClick={() => go(to)}>{text}</Button>)}</div>{err && <p role="alert" className="type-caption mt-1 !text-danger">{err}</p>}</div>;
}
