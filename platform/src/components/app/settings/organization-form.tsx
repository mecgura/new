"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button, Card, CardBody, CardHeader, Field, Input, useToast } from "@/components/ds";
import { apiFetch } from "@/lib/client-api";

export function OrganizationForm({ id, name, slug, canEdit }: { id: string; name: string; slug: string; canEdit: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [value, setValue] = React.useState(name);
  const [error, setError] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    const r = await apiFetch(`/api/organizations/${id}`, { method: "PATCH", body: { name: value } });
    setSaving(false);
    if (!r.ok) {
      setError(r.details?.name?.[0] ?? r.error);
      return;
    }
    toast("Organization updated");
    router.refresh();
  }

  return (
    <Card>
      <CardHeader title="Organization" description={canEdit ? "Details shown across your workspace." : "Only owners can edit organization details."} />
      <CardBody>
        <form onSubmit={onSubmit} noValidate className="space-y-5">
          <Field id="org-name" label="Organization name" error={error}>
            <Input value={value} onChange={(e) => setValue(e.target.value)} maxLength={120} disabled={!canEdit} required />
          </Field>
          <Field id="org-slug" label="Workspace ID" hint="Used internally; cannot be changed.">
            <Input value={slug} readOnly disabled />
          </Field>
          {canEdit ? (
            <div className="flex justify-end">
              <Button type="submit" loading={saving} disabled={value.trim() === name}>
                Save changes
              </Button>
            </div>
          ) : null}
        </form>
      </CardBody>
    </Card>
  );
}
