"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, Button, ButtonLink, Card, CardBody, CardHeader, EmailInput, Field, PhoneInput, Select, StatusBadge, TextInput, useToast } from "@/components/ui";
import { apiFetch } from "@/lib/api/client";
import { clinicTypeLabel } from "@/components/domain/badges";
import { brandContrastIssues } from "@/theme/contrast";
import { DEFAULT_BRAND, type BrandColors } from "@/theme/tokens";
import { BrandPreview, ContrastList } from "./brand-preview";
import { ColorFields } from "./color-fields";
import { InviteLinkCard } from "./invite-link-card";
import { ClinicProfileFields } from "./profile-fields";
import { EMPTY_PROFILE, profilePayload, type ClinicProfileValues } from "./profile-values";

const STEPS = ["Clinic details", "Branding", "Clinic admin", "Review & activate"] as const;
const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

/** Which step owns which server field error, so we can jump back to it. */
const stepOf = (key: string) => (key.startsWith("branding") ? 1 : key.startsWith("admin") ? 2 : key === "slug" || key.startsWith("profile") ? 0 : 3);

export function CreateClinicWizard() {
  const router = useRouter();
  const toast = useToast();
  const [step, setStep] = useState(0);
  const [profile, setProfile] = useState<ClinicProfileValues>(EMPTY_PROFILE);
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [brand, setBrand] = useState<BrandColors>({ ...DEFAULT_BRAND });
  const [admin, setAdmin] = useState({ name: "", email: "", phone: "", role: "CLINIC_ADMIN" });
  const [status, setStatus] = useState("PENDING");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ id: string; token: string; expiresAt: string } | null>(null);

  const effSlug = slugTouched ? slug : slugify(profile.name);
  const brandIssues = brandContrastIssues(brand);

  function next() {
    const e: Record<string, string> = {};
    if (step === 0) {
      if (!profile.name.trim()) e["profile.name"] = "Clinic name is required.";
      if (effSlug.length < 3) e.slug = "Use at least 3 letters or numbers.";
    }
    if (step === 1 && Object.keys(brandIssues).length) { for (const k of Object.keys(brandIssues)) e[`branding.${k}Color`] = brandIssues[k as keyof typeof brandIssues]!; }
    if (step === 2) {
      if (!admin.name.trim()) e["admin.name"] = "Name is required.";
      if (!admin.email.trim()) e["admin.email"] = "Email is required.";
    }
    setErrors(e);
    if (!Object.keys(e).length) setStep((s) => s + 1);
  }

  async function submit() {
    setBusy(true);
    const res = await apiFetch<{ tenant: { id: string }; inviteToken: string; inviteExpiresAt: string }>("/api/platform/clinics", {
      method: "POST",
      body: JSON.stringify({
        profile: profilePayload(profile), slug: effSlug, status,
        branding: { primaryColor: brand.primary, secondaryColor: brand.secondary, accentColor: brand.accent },
        admin: { ...admin, phone: admin.phone.trim() || undefined },
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const fe = res.error.fieldErrors ?? {};
      setErrors(fe);
      const keys = Object.keys(fe);
      if (keys.length) setStep(Math.min(...keys.map(stepOf)));
      toast({ tone: "danger", title: "Couldn't create the clinic", description: res.error.message });
      return;
    }
    setDone({ id: res.data.tenant.id, token: res.data.inviteToken, expiresAt: res.data.inviteExpiresAt });
    router.refresh();
  }

  if (done) {
    return (
      <Card>
        <CardHeader title="Clinic created" description={`${profile.name} is set up as ${status.toLowerCase()}.`} />
        <CardBody className="space-y-4">
          <InviteLinkCard token={done.token} expiresAt={done.expiresAt} name={admin.name} />
          <Alert tone="info" title="Next: logo">The logo and favicon can be uploaded once inside the clinic — open the clinic and go to Settings → Branding.</Alert>
          <div className="flex flex-wrap gap-2"><ButtonLink href={`/platform/clinics/${done.id}`}>Open clinic</ButtonLink><ButtonLink variant="outline" href="/platform/clinics">All clinics</ButtonLink></div>
        </CardBody>
      </Card>
    );
  }

  const errorList = Object.entries(errors);
  return (
    <div className="space-y-section">
      <ol className="flex flex-wrap gap-2" aria-label="Progress">
        {STEPS.map((label, i) => (
          <li key={label} aria-current={i === step ? "step" : undefined} className={`type-caption flex items-center gap-2 rounded-pill border px-3 py-1.5 ${i === step ? "border-primary bg-primary-soft font-semibold !text-primary" : i < step ? "border-line !text-ink" : "border-line"}`}>
            <span aria-hidden className="font-bold">{i < step ? "✓" : i + 1}</span>{label}
          </li>
        ))}
      </ol>

      {errorList.length > 0 && <Alert tone="danger" title="Please fix the highlighted fields">{errorList.map(([, m]) => m).slice(0, 4).join(" ")}</Alert>}

      <Card>
        <CardHeader title={STEPS[step]} />
        <CardBody className="space-y-section">
          {step === 0 && (<>
            <ClinicProfileFields value={profile} onChange={setProfile} errors={errors} prefix="profile." />
            <Field label="Clinic address (workspace name)" required error={errors.slug} hint={`Used as the subdomain: ${effSlug || "your-clinic"}.<your-domain>. Cannot be changed casually later.`}>
              <TextInput value={effSlug} onChange={(e) => { setSlugTouched(true); setSlug(slugify(e.target.value)); }} autoCapitalize="none" />
            </Field>
          </>)}

          {step === 1 && (<>
            <ColorFields value={brand} onChange={setBrand} errors={errors} />
            <ContrastList brand={brand} />
            <BrandPreview brand={brand} name={profile.name} />
            <p className="type-caption">Logo and favicon are uploaded after the clinic exists.</p>
          </>)}

          {step === 2 && (
            <div className="grid gap-form md:grid-cols-2">
              <Field label="Full name" required error={errors["admin.name"]}><TextInput value={admin.name} onChange={(e) => setAdmin({ ...admin, name: e.target.value })} autoComplete="off" /></Field>
              <Field label="Role" required error={errors["admin.role"]}><Select value={admin.role} onChange={(e) => setAdmin({ ...admin, role: e.target.value })} options={[{ value: "CLINIC_ADMIN", label: "Clinic Admin" }, { value: "DOCTOR", label: "Doctor" }]} /></Field>
              <Field label="Email" required error={errors["admin.email"]}><EmailInput value={admin.email} onChange={(e) => setAdmin({ ...admin, email: e.target.value })} /></Field>
              <Field label="Phone" error={errors["admin.phone"]}><PhoneInput value={admin.phone} onChange={(e) => setAdmin({ ...admin, phone: e.target.value })} /></Field>
              <p className="type-caption md:col-span-2">This person receives an invitation link to set their own password. Passwords are never created or shared by MECGURA staff.</p>
            </div>
          )}

          {step === 3 && (<>
            <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
              {[["Clinic", profile.name], ["Type", clinicTypeLabel(profile.clinicType)], ["Workspace address", effSlug], ["Admin", `${admin.name} (${admin.role === "DOCTOR" ? "Doctor" : "Clinic Admin"})`], ["Admin email", admin.email]].map(([k, v]) => (
                <div key={k}><dt className="type-caption">{k}</dt><dd className="type-body break-words">{v}</dd></div>
              ))}
            </dl>
            <BrandPreview brand={brand} name={profile.name} />
            <Field label="Initial status" hint="Pending setup keeps the clinic closed until you finish setup and activate it. Trial and Active allow normal access."><Select value={status} onChange={(e) => setStatus(e.target.value)} options={[{ value: "PENDING", label: "Pending setup (recommended)" }, { value: "TRIAL", label: "Trial" }, { value: "ACTIVE", label: "Active" }, { value: "SUSPENDED", label: "Suspended" }, { value: "INACTIVE", label: "Inactive" }]} /></Field>
            <div className="flex items-center gap-2"><StatusBadge tone={status === "ACTIVE" ? "success" : status === "TRIAL" ? "info" : "warning"}>{status.charAt(0) + status.slice(1).toLowerCase()}</StatusBadge></div>
          </>)}
        </CardBody>
      </Card>

      <div className="flex flex-wrap justify-between gap-2">
        {step === 0 ? <Link href="/platform/clinics" className="type-button inline-flex min-h-control items-center rounded-md border border-line-strong px-btn no-underline !text-ink">Cancel</Link> : <Button variant="outline" onClick={() => { setErrors({}); setStep((s) => s - 1); }}>Back</Button>}
        {step < 3 ? <Button onClick={next}>Continue</Button> : <Button onClick={submit} loading={busy}>Create clinic</Button>}
      </div>
    </div>
  );
}
