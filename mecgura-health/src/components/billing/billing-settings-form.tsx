"use client";
import { useEffect, useState } from "react";
import { Alert, Badge, Button, Card, CardBody, CardHeader, ErrorState, Field, LoadingState, Select, TextInput, Textarea, Toggle, useToast } from "@/components/ui";
import { apiFetch } from "@/lib/api/client";
import { bpToInput, minorToInput, moneyToMinor, percentToBp } from "@/lib/billing/money";
import type { BillingSettingsView } from "@/lib/services/billing-master";
import { METHOD_LABEL, SERVICE_TYPE_LABEL } from "./billing-ui";

type S = BillingSettingsView & { canConfigure: boolean; gateway: { configured: boolean; message: string } };
const ROLES = ["CLINIC_ADMIN", "ACCOUNTANT", "RECEPTIONIST", "DOCTOR", "NURSE", "STAFF"];
interface Svc { id: string; serviceName: string; serviceCode: string; type: string }

export function BillingSettingsForm() {
  const toast = useToast();
  const [s, setS] = useState<S | null>(null); const [svcs, setSvcs] = useState<Svc[]>([]); const [err, setErr] = useState<string>();
  const [rules, setRules] = useState<Record<string, { pct: string; fixed: string }>>({}); const [busy, setBusy] = useState(false); const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    Promise.all([apiFetch<S>("/api/billing/settings"), apiFetch<{ services: Svc[] }>("/api/billing/services")]).then(([a, b]) => {
      if (!a.ok) { setErr(a.error.message); return; }
      setS(a.data); if (b.ok) setSvcs(b.data.services);
      setRules(Object.fromEntries(Object.entries(a.data.discountRules).map(([k, v]) => [k, { pct: bpToInput(v.maxPercentBp), fixed: v.maxFixedMinor != null ? minorToInput(v.maxFixedMinor) : "" }])));
    });
  }, []);
  if (err) return <ErrorState description={err} />;
  if (!s) return <LoadingState />;
  const ro = !s.canConfigure; const set = <K extends keyof S>(k: K, v: S[K]) => setS({ ...s, [k]: v });
  async function save() {
    if (!s) return; setErrors({});
    const discountRules: Record<string, { maxPercentBp: number; maxFixedMinor?: number }> = {};
    for (const [role, r] of Object.entries(rules)) { if (!r.pct.trim()) continue; const bp = percentToBp(r.pct); const fx = r.fixed.trim() ? moneyToMinor(r.fixed) : undefined; if (bp == null || fx === null) { setErrors({ discountRules: `Check the discount limit for ${role}.` }); return; } discountRules[role] = { maxPercentBp: bp, ...(fx != null ? { maxFixedMinor: fx } : {}) }; }
    setBusy(true);
    const { canConfigure, gateway, ...body } = s; void canConfigure; void gateway;
    const r = await apiFetch("/api/billing/settings", { method: "PUT", body: JSON.stringify({ ...body, discountRules, dueDays: body.dueDays ?? undefined }) });
    setBusy(false);
    if (!r.ok) { setErrors(r.error.fieldErrors ?? {}); toast({ tone: "danger", title: r.error.message }); return; }
    toast({ tone: "success", title: "Billing settings saved" });
  }
  const svcOpts = (types: string[]) => svcs.filter((x) => types.includes(x.type)).map((x) => ({ value: x.id, label: `${x.serviceName} (${x.serviceCode})` }));
  const toggleMethod = (m: string) => set("paymentMethods", s.paymentMethods.includes(m) ? s.paymentMethods.filter((x) => x !== m) : [...s.paymentMethods, m]);
  return (
    <div className="space-y-section">
      {ro && <Alert tone="info">You can view the billing settings. Only a clinic admin can change them.</Alert>}
      <Card><CardHeader title="Numbering & currency" description="Numbers keep counting up even if you change a prefix; existing numbers never change." />
        <CardBody className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Field label="Currency" error={errors.currency}><TextInput value={s.currency} disabled={ro} maxLength={3} onChange={(e) => set("currency", e.target.value.toUpperCase())} /></Field>
          {(["invoicePrefix", "receiptPrefix", "paymentPrefix", "refundPrefix"] as const).map((k) => <Field key={k} label={`${k.replace("Prefix", "")[0].toUpperCase()}${k.replace("Prefix", "").slice(1)} prefix`} error={errors[k]}><TextInput value={s[k]} disabled={ro} maxLength={8} onChange={(e) => set(k, e.target.value.toUpperCase())} /></Field>)}
        </CardBody></Card>
      <Card><CardHeader title="Tax & payment terms" /><CardBody className="space-y-3">
        <Field label="Tax mode" hint="Exclusive: tax is added on top of prices. Inclusive: prices already include tax."><Select value={s.taxMode} disabled={ro} onChange={(e) => set("taxMode", e.target.value as S["taxMode"])} options={[{ value: "EXCLUSIVE", label: "Tax exclusive" }, { value: "INCLUSIVE", label: "Tax inclusive" }]} /></Field>
        <div className="grid gap-3 sm:grid-cols-2"><Field label="Days until an invoice is due (optional)" error={errors.dueDays}><TextInput value={s.dueDays != null ? String(s.dueDays) : ""} disabled={ro} inputMode="numeric" onChange={(e) => set("dueDays", e.target.value === "" ? null : Number(e.target.value))} /></Field><Field label="Payment terms (printed)" error={errors.paymentTerms}><TextInput value={s.paymentTerms ?? ""} disabled={ro} maxLength={300} onChange={(e) => set("paymentTerms", e.target.value)} /></Field></div>
        <div className="grid gap-3 sm:grid-cols-2"><Field label="Invoice footer" error={errors.invoiceFooter}><Textarea rows={2} value={s.invoiceFooter ?? ""} disabled={ro} maxLength={300} onChange={(e) => set("invoiceFooter", e.target.value)} /></Field><Field label="Receipt footer" error={errors.receiptFooter}><Textarea rows={2} value={s.receiptFooter ?? ""} disabled={ro} maxLength={300} onChange={(e) => set("receiptFooter", e.target.value)} /></Field></div>
      </CardBody></Card>
      <Card><CardHeader title="Payment methods" description="Online payments need a payment gateway, which is not configured." /><CardBody className="space-y-2">
        <div className="flex flex-wrap gap-3">{Object.keys(METHOD_LABEL).filter((m) => m !== "ONLINE").map((m) => <label key={m} className="type-label flex min-h-control items-center gap-2"><input type="checkbox" disabled={ro} checked={s.paymentMethods.includes(m)} onChange={() => toggleMethod(m)} />{METHOD_LABEL[m]}</label>)}<span className="flex items-center gap-2"><Badge>Online</Badge><span className="type-caption">{s.gateway.message}</span></span></div>{errors.paymentMethods && <p role="alert" className="type-caption text-danger">{errors.paymentMethods}</p>}
      </CardBody></Card>
      <Card><CardHeader title="Discount limits" description="Nobody can give a discount until a limit is set for their role. Leave blank for no discounts." /><CardBody className="space-y-2">
        {errors.discountRules && <Alert tone="danger">{errors.discountRules}</Alert>}
        {ROLES.map((role) => <div key={role} className="grid items-end gap-2 sm:grid-cols-[10rem_1fr_1fr]"><p className="type-label min-h-control content-center">{role.replace("_", " ").toLowerCase()}</p><Field label="Max percentage (%)"><TextInput value={rules[role]?.pct ?? ""} disabled={ro} inputMode="decimal" onChange={(e) => setRules({ ...rules, [role]: { pct: e.target.value, fixed: rules[role]?.fixed ?? "" } })} /></Field><Field label={`Max amount (${s.currency}, optional)`}><TextInput value={rules[role]?.fixed ?? ""} disabled={ro} inputMode="decimal" onChange={(e) => setRules({ ...rules, [role]: { pct: rules[role]?.pct ?? "", fixed: e.target.value } })} /></Field></div>)}
      </CardBody></Card>
      <Card><CardHeader title="Clinical events" description="Automatic invoices are always DRAFTS. Nothing is issued or marked paid automatically, and the clinical workflow never waits for payment." /><CardBody className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2"><Field label="Default consultation service" error={errors.defaultConsultationServiceId}><Select value={s.defaultConsultationServiceId ?? ""} disabled={ro} placeholder="Not set" onChange={(e) => set("defaultConsultationServiceId", e.target.value || null)} options={svcOpts(["CONSULTATION", "FOLLOW_UP", "OTHER"])} /></Field><Field label="Default follow-up service" error={errors.defaultFollowUpServiceId}><Select value={s.defaultFollowUpServiceId ?? ""} disabled={ro} placeholder="Not set" onChange={(e) => set("defaultFollowUpServiceId", e.target.value || null)} options={svcOpts(["FOLLOW_UP", "CONSULTATION", "OTHER"])} /></Field></div>
        <Toggle label="Create a draft invoice when a consultation is finalized" checked={s.autoBillConsultation} disabled={ro} onChange={(v) => set("autoBillConsultation", v)} />
        <Toggle label="Create a draft invoice when investigations are ordered" checked={s.autoBillInvestigation} disabled={ro} onChange={(v) => set("autoBillInvestigation", v)} />
        <Toggle label="Create a draft invoice when a follow-up visit is booked" checked={s.autoBillFollowUp} disabled={ro} onChange={(v) => set("autoBillFollowUp", v)} />
      </CardBody></Card>
      <Card><CardHeader title="Controls" /><CardBody className="space-y-3">
        <Toggle label="Allow a payment above the outstanding amount (overpayment)" checked={s.allowOverpayment} disabled={ro} onChange={(v) => set("allowOverpayment", v)} />
        <Toggle label="Allow the person who requested a refund to approve it" checked={s.refundSelfApproval} disabled={ro} onChange={(v) => set("refundSelfApproval", v)} />
        <Toggle label="Require a cashier session for cash payments" checked={s.useCashierSessions} disabled={ro} onChange={(v) => set("useCashierSessions", v)} />
        <p className="type-caption">Service types: {Object.values(SERVICE_TYPE_LABEL).join(", ")}.</p>
      </CardBody></Card>
      {!ro && <div><Button onClick={save} loading={busy}>Save settings</Button></div>}
    </div>
  );
}
