"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, Button, Card, CardBody, CardHeader, useToast } from "@/components/ui";
import { apiFetch } from "@/lib/api/client";
import { ClinicProfileFields } from "./profile-fields";
import { profilePayload, type ClinicProfileValues } from "./profile-values";

/** Edits a clinic profile. `endpoint` decides who is calling: /api/clinic (own clinic) or /api/platform/clinics/:id (Super Admin). */
export function ClinicProfileForm({ initial, endpoint, readOnly }: { initial: ClinicProfileValues; endpoint: string; readOnly?: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [value, setValue] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await apiFetch(endpoint, { method: "PATCH", body: JSON.stringify(profilePayload(value)) });
    setBusy(false);
    if (!res.ok) { setErrors(res.error.fieldErrors ?? {}); return toast({ tone: "danger", title: "Couldn't save", description: res.error.message }); }
    setErrors({});
    toast({ tone: "success", title: "Clinic profile saved" });
    router.refresh();
  }

  return (
    <Card>
      <CardHeader title="Clinic profile" description={readOnly ? "You can view but not edit the clinic profile." : undefined} />
      <form onSubmit={save} noValidate>
        <CardBody className="space-y-section">
          {Object.keys(errors).length > 0 && <Alert tone="danger" title="Please fix the highlighted fields" />}
          <fieldset disabled={readOnly || busy} className="min-w-0"><ClinicProfileFields value={value} onChange={setValue} errors={errors} /></fieldset>
          {!readOnly && <div className="flex flex-wrap gap-2"><Button type="submit" loading={busy}>Save changes</Button><Button type="button" variant="outline" disabled={busy} onClick={() => { setValue(initial); setErrors({}); }}>Cancel</Button></div>}
        </CardBody>
      </form>
    </Card>
  );
}
