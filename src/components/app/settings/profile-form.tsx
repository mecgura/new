"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button, Card, CardBody, CardHeader, Field, Input, useToast } from "@/components/ds";
import { apiFetch } from "@/lib/client-api";

export function ProfileForm({ name, email }: { name: string; email: string }) {
  const router = useRouter();
  const toast = useToast();
  const [value, setValue] = React.useState(name);
  const [error, setError] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const dirty = value.trim() !== name;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    const r = await apiFetch<{ user: { name: string } }>("/api/me/profile", { method: "PATCH", body: { name: value } });
    setSaving(false);
    if (!r.ok) {
      setError(r.details?.name?.[0] ?? r.error);
      return;
    }
    toast("Profile saved");
    router.refresh();
  }

  return (
    <Card>
      <CardHeader title="Profile" description="How you appear to your team." />
      <CardBody>
        <form onSubmit={onSubmit} noValidate className="space-y-5">
          <Field id="profile-name" label="Full name" error={error}>
            <Input value={value} onChange={(e) => setValue(e.target.value)} autoComplete="name" maxLength={100} required />
          </Field>
          <Field id="profile-email" label="Email" hint="Contact the MECGURA team to change your sign-in email.">
            <Input value={email} readOnly disabled />
          </Field>
          <div className="flex justify-end">
            <Button type="submit" loading={saving} disabled={!dirty}>
              Save changes
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
