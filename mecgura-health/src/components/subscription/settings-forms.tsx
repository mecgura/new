"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, Button, Field, PasswordInput, Select, TextInput, useToast } from "@/components/ui";
import { apiFetch } from "@/lib/api/client";
import type { VendorProfile } from "@/lib/services/sub-config";
import type { SubscriptionPolicy } from "@/lib/subscriptions/state";
import type { TaxConfig } from "@/lib/subscriptions/tax";

function useSave(section: string) {
  const router = useRouter(); const toast = useToast(); const [busy, setBusy] = useState(false); const [err, setErr] = useState<{ message: string; fields: Record<string, string> } | null>(null);
  async function save(values: unknown, password: string) {
    setBusy(true); setErr(null); const r = await apiFetch("/api/platform/subscriptions/settings", { method: "PUT", body: JSON.stringify({ section, values, password }) }); setBusy(false);
    if (!r.ok) { setErr({ message: r.error.message, fields: r.error.fieldErrors ?? {} }); return; } toast({ tone: "success", title: "Saved" }); router.refresh();
  }
  return { busy, err, save };
}
const ACCESS = [{ value: "FULL", label: "Full access" }, { value: "READ_ONLY", label: "Read-only" }, { value: "BLOCK", label: "Blocked (admin can still pay)" }];
const Pw = ({ e }: { e?: string }) => <Field label="Your password" required error={e} hint="Re-enter your own password to confirm."><PasswordInput name="confirmPassword" autoComplete="current-password" /></Field>;

export function PolicyForm({ policy }: { policy: SubscriptionPolicy }) {
  const { busy, err, save } = useSave("policy"); const n = (f: FormData, k: string) => Number(f.get(k));
  return (
    <form aria-label="Billing policy" className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); void save({ graceDays: n(f, "graceDays"), dunningDays: n(f, "dunningDays"), renewalInvoiceLeadDays: n(f, "lead"), invoiceDueDays: n(f, "dueDays"), trial: { maxDays: n(f, "trialMax"), allowExtension: f.get("allowExt") === "on", maxExtensionDays: n(f, "extMax"), requireBillingProfile: f.get("reqProfile") === "on" }, access: { grace: f.get("aGrace"), paused: f.get("aPaused"), suspended: f.get("aSusp"), ended: f.get("aEnded"), pending: f.get("aPending") }, portalDuringSuspension: f.get("portal") }, String(f.get("confirmPassword"))); }}>
      {err && <Alert tone="danger" title="Not saved">{err.message}</Alert>}
      <Field label="Grace period (days)" hint="Between 'past due' and suspension."><TextInput name="graceDays" defaultValue={policy.graceDays} inputMode="numeric" /></Field>
      <Field label="Days overdue before grace starts"><TextInput name="dunningDays" defaultValue={policy.dunningDays} inputMode="numeric" /></Field>
      <Field label="Renewal invoice lead time (days)"><TextInput name="lead" defaultValue={policy.renewalInvoiceLeadDays} inputMode="numeric" /></Field>
      <Field label="Invoice payment terms (days)"><TextInput name="dueDays" defaultValue={policy.invoiceDueDays} inputMode="numeric" /></Field>
      <Field label="Longest trial (days)"><TextInput name="trialMax" defaultValue={policy.trial.maxDays} inputMode="numeric" /></Field>
      <Field label="Longest trial extension (days)"><TextInput name="extMax" defaultValue={policy.trial.maxExtensionDays} inputMode="numeric" /></Field>
      <label className="type-label flex items-center gap-2"><input type="checkbox" name="allowExt" defaultChecked={policy.trial.allowExtension} /> Allow trial extensions</label>
      <label className="type-label flex items-center gap-2"><input type="checkbox" name="reqProfile" defaultChecked={policy.trial.requireBillingProfile} /> Ask for billing details before a trial</label>
      <Field label="During grace period"><Select name="aGrace" defaultValue={policy.access.grace} options={ACCESS} /></Field>
      <Field label="While paused"><Select name="aPaused" defaultValue={policy.access.paused} options={ACCESS} /></Field>
      <Field label="While suspended"><Select name="aSusp" defaultValue={policy.access.suspended} options={ACCESS} /></Field>
      <Field label="After cancellation / expiry"><Select name="aEnded" defaultValue={policy.access.ended} options={ACCESS} /></Field>
      <Field label="Before the first payment"><Select name="aPending" defaultValue={policy.access.pending} options={ACCESS} /></Field>
      <Field label="Patient portal during suspension"><Select name="portal" defaultValue={policy.portalDuringSuspension} options={[{ value: "ALLOW", label: "Keep working" }, { value: "READ_ONLY", label: "Read-only" }, { value: "BLOCK", label: "Blocked" }]} /></Field>
      <div className="sm:col-span-2"><Pw e={err?.fields.confirmPassword} /></div>
      <div className="sm:col-span-2"><Button type="submit" loading={busy}>Save policy</Button></div>
    </form>
  );
}
export function TaxForm({ tax }: { tax: TaxConfig }) {
  const { busy, err, save } = useSave("tax");
  return (
    <form aria-label="Tax" className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); void save({ enabled: f.get("enabled") === "on", mode: f.get("mode"), name: f.get("name"), rateBp: Math.round((parseFloat(String(f.get("rate"))) || 0) * 100), vendorStateCode: String(f.get("vsc") ?? "") }, String(f.get("confirmPassword"))); }}>
      {err && <Alert tone="danger" title="Not saved">{err.message}</Alert>}
      <label className="type-label flex items-center gap-2 sm:col-span-2"><input type="checkbox" name="enabled" defaultChecked={tax.enabled} /> Charge tax on subscription invoices</label>
      <Field label="Tax name"><TextInput name="name" defaultValue={tax.name} /></Field>
      <Field label="Rate (%)" hint="Set by your accountant. Nothing is assumed."><TextInput name="rate" inputMode="decimal" defaultValue={String(tax.rateBp / 100)} /></Field>
      <Field label="Tax is"><Select name="mode" defaultValue={tax.mode} options={[{ value: "EXCLUSIVE", label: "Added on top of the price" }, { value: "INCLUSIVE", label: "Already included in the price" }]} /></Field>
      <Field label="MECGURA's GST state code" hint="Same as the clinic's state → CGST + SGST; otherwise IGST."><TextInput name="vsc" defaultValue={tax.vendorStateCode ?? ""} maxLength={2} /></Field>
      <div className="sm:col-span-2"><Pw e={err?.fields.confirmPassword} /></div>
      <div className="sm:col-span-2"><Button type="submit" loading={busy}>Save tax settings</Button></div>
    </form>
  );
}
const VF: [keyof VendorProfile, string][] = [["brandName", "Brand name"], ["legalName", "Legal entity name"], ["gstin", "GSTIN"], ["pan", "PAN"], ["address", "Address"], ["city", "City"], ["state", "State"], ["stateCode", "GST state code"], ["pincode", "PIN code"], ["email", "Billing email"], ["phone", "Phone"], ["website", "Website"], ["supportEmail", "Support email"], ["supportPhone", "Support phone"], ["supportHours", "Support hours"], ["invoiceFooter", "Invoice footer note"], ["bankDetails", "Bank details for offline payment"]];
export function VendorForm({ vendor }: { vendor: VendorProfile }) {
  const { busy, err, save } = useSave("vendor");
  return (
    <form aria-label="MECGURA details" className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); const v: Record<string, string> = {}; for (const [k] of VF) v[k] = String(f.get(k) ?? ""); void save(v, String(f.get("confirmPassword"))); }}>
      {err && <Alert tone="danger" title="Not saved">{err.message}</Alert>}
      {VF.map(([k, l]) => <Field key={k} label={l} error={err?.fields[k]}><TextInput name={k} defaultValue={vendor[k]} /></Field>)}
      <div className="sm:col-span-2"><Pw e={err?.fields.confirmPassword} /></div>
      <div className="sm:col-span-2"><Button type="submit" loading={busy}>Save MECGURA details</Button></div>
    </form>
  );
}
