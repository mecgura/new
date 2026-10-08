"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, Button, ButtonLink, Card, CardBody, CardHeader, Checkbox, EmailInput, Field, NumberInput, PhoneInput, Select, TextInput, Textarea, useToast } from "@/components/ui";
import { EMPTY_USER, type UserFormValues } from "./user-values";
import { InviteLinkCard } from "@/components/clinic/invite-link-card";
import { apiFetch } from "@/lib/api/client";
import { GENDERS } from "@/lib/domain/constants";
import { GRANTABLE_PERMISSIONS, PERMISSIONS, ROLE_LABELS } from "@/lib/permissions/constants";
import { TENANT_ASSIGNABLE_ROLES } from "@/lib/permissions/roles";

const blankToUndef = (v: string) => (v.trim() === "" ? undefined : v);
const modules = Array.from(new Set(GRANTABLE_PERMISSIONS.map((p) => PERMISSIONS[p].module)));

export function UserForm({ mode, userId, initial, isSelf }: { mode: "create" | "edit"; userId?: string; initial: UserFormValues; isSelf?: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [v, setV] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [invite, setInvite] = useState<{ token: string; expiresAt: string } | null>(null);
  const set = (k: keyof UserFormValues) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setV({ ...v, [k]: e.target.value });
  const isDoctor = v.role === "DOCTOR";
  const grantsApply = !isDoctor && v.role !== "CLINIC_ADMIN";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const common = {
      name: v.name, phone: blankToUndef(v.phone), role: v.role, grants: grantsApply ? v.grants : [],
      qualification: blankToUndef(v.qualification), specialization: blankToUndef(v.specialization), registrationNumber: blankToUndef(v.registrationNumber),
      experienceYears: blankToUndef(v.experienceYears), gender: blankToUndef(v.gender), bio: blankToUndef(v.bio), consultationFee: blankToUndef(v.consultationFee),
      employeeRef: blankToUndef(v.employeeRef), designation: blankToUndef(v.designation),
    };
    const res = mode === "create"
      ? await apiFetch<{ id: string; inviteToken: string; inviteExpiresAt: string }>("/api/users", { method: "POST", body: JSON.stringify({ ...common, email: v.email }) })
      : await apiFetch(`/api/users/${userId}`, { method: "PATCH", body: JSON.stringify({ ...common, ...(isSelf ? { role: undefined } : {}) }) });
    setBusy(false);
    if (!res.ok) { setErrors(res.error.fieldErrors ?? {}); return toast({ tone: "danger", title: "Couldn't save", description: res.error.message }); }
    setErrors({});
    if (mode === "create") { const d = res.data as { inviteToken: string; inviteExpiresAt: string }; setInvite({ token: d.inviteToken, expiresAt: d.inviteExpiresAt }); }
    else { toast({ tone: "success", title: "Saved" }); router.refresh(); }
  }

  if (invite) {
    return (
      <Card>
        <CardHeader title="User added" description={`${v.name} has been added as ${ROLE_LABELS[v.role as keyof typeof ROLE_LABELS]}.`} />
        <CardBody className="space-y-4">
          <InviteLinkCard token={invite.token} expiresAt={invite.expiresAt} name={v.name} />
          <div className="flex flex-wrap gap-2"><ButtonLink href="/team">Back to team</ButtonLink><ButtonLink variant="outline" href="/team/new" onClick={() => { setInvite(null); setV(EMPTY_USER); }}>Add another</ButtonLink></div>
        </CardBody>
      </Card>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-section">
      {Object.keys(errors).length > 0 && <Alert tone="danger" title="Please fix the highlighted fields">{Object.values(errors).slice(0, 3).join(" ")}</Alert>}
      <Card>
        <CardHeader title="Account" />
        <CardBody className="grid gap-form md:grid-cols-2">
          <Field label="Full name" required error={errors.name}><TextInput value={v.name} onChange={set("name")} autoComplete="off" /></Field>
          <Field label="Role" required error={errors.role} hint={isSelf ? "You can't change your own role." : undefined}>
            <Select value={v.role} onChange={set("role")} disabled={isSelf} options={TENANT_ASSIGNABLE_ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }))} />
          </Field>
          {mode === "create" ? <Field label="Email" required error={errors.email}><EmailInput value={v.email} onChange={set("email")} /></Field> : <Field label="Email" hint="Email can't be changed."><EmailInput value={v.email} disabled readOnly /></Field>}
          <Field label="Phone" error={errors.phone} hint="Can be used to sign in"><PhoneInput value={v.phone} onChange={set("phone")} /></Field>
        </CardBody>
      </Card>

      {isDoctor ? (
        <Card>
          <CardHeader title="Doctor profile" description="Used later for appointments and the public website." />
          <CardBody className="grid gap-form md:grid-cols-2">
            <Field label="Qualification" error={errors.qualification}><TextInput value={v.qualification} onChange={set("qualification")} /></Field>
            <Field label="Specialization" error={errors.specialization}><TextInput value={v.specialization} onChange={set("specialization")} /></Field>
            <Field label="Registration number" error={errors.registrationNumber}><TextInput value={v.registrationNumber} onChange={set("registrationNumber")} /></Field>
            <Field label="Experience (years)" error={errors.experienceYears}><NumberInput value={v.experienceYears} onChange={set("experienceYears")} min={0} max={70} step={1} /></Field>
            <Field label="Gender" error={errors.gender}><Select value={v.gender} onChange={set("gender")} placeholder="Not set" options={Object.entries(GENDERS).map(([k, l]) => ({ value: k, label: l }))} /></Field>
            <Field label="Consultation fee (₹)" error={errors.consultationFee} hint="Foundation only — billing comes later"><NumberInput value={v.consultationFee} onChange={set("consultationFee")} min={0} step={1} /></Field>
            <Field label="Bio" error={errors.bio} className="md:col-span-2"><Textarea value={v.bio} onChange={set("bio")} maxLength={1500} /></Field>
          </CardBody>
        </Card>
      ) : (
        <Card>
          <CardHeader title="Staff details" />
          <CardBody className="grid gap-form md:grid-cols-2">
            <Field label="Employee ID" error={errors.employeeRef}><TextInput value={v.employeeRef} onChange={set("employeeRef")} /></Field>
            <Field label="Designation" error={errors.designation}><TextInput value={v.designation} onChange={set("designation")} /></Field>
          </CardBody>
        </Card>
      )}

      {grantsApply && (
        <Card>
          <CardHeader title="Extra permissions" description={v.role === "STAFF" ? "Staff only get the basics. Tick anything this person should additionally be allowed to do." : "Optional: grant this person more than their role normally allows."} />
          <CardBody className="space-y-4">
            {modules.map((m) => (
              <fieldset key={m} className="min-w-0"><legend className="type-label mb-2 capitalize">{m}</legend>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {GRANTABLE_PERMISSIONS.filter((p) => PERMISSIONS[p].module === m).map((p) => (
                    <Checkbox key={p} label={PERMISSIONS[p].description} checked={v.grants.includes(p)} onChange={(e) => setV({ ...v, grants: e.target.checked ? [...v.grants, p] : v.grants.filter((g) => g !== p) })} />
                  ))}
                </div></fieldset>
            ))}
            <p className="type-caption">Administration permissions (users, clinic settings, branding) can only come from the Clinic Admin role.</p>
          </CardBody>
        </Card>
      )}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={busy}>{mode === "create" ? "Create & invite" : "Save changes"}</Button>
        <ButtonLink variant="outline" href="/team">Cancel</ButtonLink>
      </div>
    </form>
  );
}
