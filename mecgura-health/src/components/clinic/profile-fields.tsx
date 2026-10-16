"use client";
import { EmailInput, Field, PhoneInput, Select, TextInput, Textarea } from "@/components/ui";
import { CLINIC_TYPES, TIMEZONES } from "@/lib/domain/constants";
import type { ClinicProfileValues } from "./profile-values";

/** Clinic profile inputs shared by the create wizard, the platform edit page and clinic settings. */
export function ClinicProfileFields({ value, onChange, errors = {}, prefix = "" }: { value: ClinicProfileValues; onChange: (v: ClinicProfileValues) => void; errors?: Record<string, string>; prefix?: string }) {
  const set = (k: keyof ClinicProfileValues) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => onChange({ ...value, [k]: e.target.value });
  const err = (k: string) => errors[`${prefix}${k}`];
  return (
    <div className="grid gap-form md:grid-cols-2">
      <Field label="Clinic name" required error={err("name")}><TextInput value={value.name} onChange={set("name")} maxLength={120} autoComplete="organization" /></Field>
      <Field label="Legal name" error={err("legalName")} hint="As on registration documents (optional)"><TextInput value={value.legalName} onChange={set("legalName")} maxLength={160} /></Field>
      <Field label="Clinic type" required error={err("clinicType")}>
        <Select value={value.clinicType} onChange={set("clinicType")} options={Object.entries(CLINIC_TYPES).map(([v, label]) => ({ value: v, label }))} />
      </Field>
      <Field label="Timezone" required error={err("timezone")}><Select value={value.timezone} onChange={set("timezone")} options={TIMEZONES.map((t) => ({ value: t, label: t }))} /></Field>
      <Field label="Clinic email" error={err("contactEmail")}><EmailInput value={value.contactEmail} onChange={set("contactEmail")} /></Field>
      <Field label="Phone" error={err("contactPhone")}><PhoneInput value={value.contactPhone} onChange={set("contactPhone")} /></Field>
      <Field label="Alternate phone" error={err("alternatePhone")}><PhoneInput value={value.alternatePhone} onChange={set("alternatePhone")} /></Field>
      <Field label="Postal code" error={err("pincode")}><TextInput value={value.pincode} onChange={set("pincode")} inputMode="numeric" autoComplete="postal-code" maxLength={10} /></Field>
      <Field label="Address" error={err("address")} className="md:col-span-2"><Textarea rows={2} value={value.address} onChange={set("address")} maxLength={300} autoComplete="street-address" /></Field>
      <Field label="City" error={err("city")}><TextInput value={value.city} onChange={set("city")} autoComplete="address-level2" /></Field>
      <Field label="State" error={err("state")}><TextInput value={value.state} onChange={set("state")} autoComplete="address-level1" /></Field>
      <Field label="Country" required error={err("country")}><TextInput value={value.country} onChange={set("country")} autoComplete="country-name" /></Field>
    </div>
  );
}
