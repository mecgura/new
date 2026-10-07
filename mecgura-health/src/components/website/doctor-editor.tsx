"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, Button, Card, CardBody, CardHeader, StatusBadge, useToast } from "@/components/ui";
import { apiFetch } from "@/lib/api/client";
import { FieldsForm, type FieldDef, type Values } from "./fields";

export const DOCTOR_FIELDS: FieldDef[] = [
  { name: "photoUrl", label: "Profile photo", type: "image" },
  { name: "photoAlt", label: "Photo description (alt text)", type: "text", hint: "e.g. “Dr. Name — Specialization”. Required when a photo is set.", max: 140 },
  { name: "shortBio", label: "Short introduction", type: "textarea", rows: 3, max: 300, hint: "Shown on doctor cards." },
  { name: "bio", label: "Professional biography", type: "markdown" },
  { name: "education", label: "Education", type: "markdown", rows: 4 },
  { name: "certifications", label: "Certifications", type: "lines" },
  { name: "memberships", label: "Memberships", type: "lines" },
  { name: "languages", label: "Languages", type: "lines", hint: "Only if you want to show them." },
  { name: "philosophy", label: "Approach / philosophy", type: "markdown", rows: 4 },
  { name: "showRegistration", label: "Show registration number on the website", type: "toggle" },
  { name: "showFee", label: "Show consultation fee on the website", type: "toggle" },
  { name: "slug", label: "Page URL name", type: "text", hint: "Leave blank to generate from the name.", max: 80 },
  { name: "sortOrder", label: "Display order", type: "number" },
  { name: "seoTitle", label: "SEO title", type: "text", max: 70 },
  { name: "seoDescription", label: "SEO description", type: "textarea", rows: 2, max: 180 },
];

export function DoctorEditor({ userId, initial, status, editable, canPublish }: { userId: string; initial: Values; status: string | null; editable: boolean; canPublish: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [value, setValue] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    const res = await apiFetch<{ revertedToDraft?: boolean }>(`/api/website/doctors/${userId}`, { method: "PATCH", body: JSON.stringify(value) });
    setBusy(false);
    if (!res.ok) { setErrors(res.error.fieldErrors ?? {}); return toast({ tone: "danger", title: "Couldn't save", description: res.error.message }); }
    setErrors({});
    toast({ tone: "success", title: "Profile saved", description: res.data.revertedToDraft ? "It was taken back to draft — an admin must publish it again." : undefined });
    router.refresh();
  }
  async function setStatus(s: string) {
    const res = await apiFetch(`/api/website/doctors/${userId}/status`, { method: "POST", body: JSON.stringify({ status: s }) });
    if (!res.ok) return toast({ tone: "danger", title: "Couldn't change status", description: res.error.message });
    toast({ tone: "success", title: s === "PUBLISHED" ? "Profile published" : "Profile moved to draft" }); router.refresh();
  }
  return (
    <Card>
      <CardHeader title="Public profile" description="What visitors see on the doctor page." action={status ? <StatusBadge tone={status === "PUBLISHED" ? "success" : "warning"}>{status[0] + status.slice(1).toLowerCase()}</StatusBadge> : <StatusBadge tone="neutral">Not created</StatusBadge>} />
      <CardBody className="space-y-section">
        {!editable && <Alert tone="info">You can view this profile but not edit it.</Alert>}
        {Object.keys(errors).length > 0 && <Alert tone="danger" title="Please fix the highlighted fields">{Object.values(errors).slice(0, 3).join(" ")}</Alert>}
        <fieldset disabled={!editable || busy} className="min-w-0"><FieldsForm fields={DOCTOR_FIELDS} value={value} onChange={setValue} errors={errors} /></fieldset>
        {editable && (
          <div className="flex flex-wrap gap-2">
            <Button onClick={save} loading={busy}>Save profile</Button>
            {canPublish && status && status !== "PUBLISHED" && <Button variant="success" onClick={() => void setStatus("PUBLISHED")}>Publish profile</Button>}
            {status === "PUBLISHED" && <Button variant="outline" onClick={() => void setStatus("DRAFT")}>Unpublish</Button>}
          </div>
        )}
        {editable && !canPublish && <p className="type-caption">A Clinic Admin publishes profiles. Editing a published profile takes it back to draft until it is re-published.</p>}
      </CardBody>
    </Card>
  );
}
