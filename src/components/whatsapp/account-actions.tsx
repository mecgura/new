"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plug2, Settings2, SlidersHorizontal } from "lucide-react";
import { Alert, Button, Card, CardBody, CardHeader, ConfirmationDialog, Field, Input, buttonVariants, useToast } from "@/components/ds";
import { apiFetch } from "@/lib/client-api";

export function DisconnectButton({ orgId, accountId, label, isDemo, size = "sm" }: { orgId: string; accountId: string; label: string; isDemo: boolean; size?: "sm" | "md" }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  async function confirm() {
    setBusy(true);
    const r = await apiFetch(`/api/organizations/${orgId}/whatsapp/accounts/${accountId}/disconnect`, { method: "POST" });
    setBusy(false);
    if (!r.ok) return toast(r.error, "error");
    setOpen(false);
    toast(`${label} disconnected`);
    router.refresh();
  }
  return (
    <>
      <Button size={size} variant="danger" onClick={() => setOpen(true)}>
        <Plug2 aria-hidden="true" /> Disconnect
      </Button>
      <ConfirmationDialog
        open={open}
        onClose={() => setOpen(false)}
        onConfirm={confirm}
        loading={busy}
        title="Disconnect this number?"
        description={
          isDemo
            ? `${label} is a demo number. Disconnecting removes it from your active numbers.`
            : `MECGURA stops sending and receiving messages for ${label}. Stored credentials are deleted and webhook delivery is unsubscribed at Meta. Your number stays registered with Meta, and you can reconnect later.`
        }
        confirmLabel="Disconnect"
      />
    </>
  );
}

export function CardActions({ orgId, accountId, label, isDemo, status, canManage }: { orgId: string; accountId: string; label: string; isDemo: boolean; status: string; canManage: boolean }) {
  return (
    <div className="flex flex-wrap gap-2">
      <Link href={`/whatsapp/accounts/${accountId}`} className={buttonVariants({ size: "sm", variant: "secondary" })}>
        <SlidersHorizontal aria-hidden="true" /> Manage
      </Link>
      {canManage ? (
        <Link href={`/whatsapp/accounts/${accountId}?tab=settings`} className={buttonVariants({ size: "sm", variant: "ghost" })}>
          <Settings2 aria-hidden="true" /> Settings
        </Link>
      ) : null}
      {canManage && (status === "connected" || status === "demo") ? <DisconnectButton orgId={orgId} accountId={accountId} label={label} isDemo={isDemo} /> : null}
      {canManage && (status === "pending" || status === "disconnected") ? (
        <Link href="/whatsapp/connect" className={buttonVariants({ size: "sm", variant: "primary" })}>
          {status === "pending" ? "Connect" : "Reconnect"}
        </Link>
      ) : null}
    </div>
  );
}

export function AccountSettingsForm({ orgId, accountId, displayName }: { orgId: string; accountId: string; displayName: string }) {
  const router = useRouter();
  const toast = useToast();
  const [value, setValue] = React.useState(displayName);
  const [error, setError] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    const r = await apiFetch(`/api/organizations/${orgId}/whatsapp/accounts/${accountId}`, { method: "PATCH", body: { displayName: value } });
    setSaving(false);
    if (!r.ok) return setError(r.details?.displayName?.[0] ?? r.error);
    toast("Settings saved");
    router.refresh();
  }
  return (
    <Card>
      <CardHeader title="Settings" description="How this number is labelled inside MECGURA. The WhatsApp display name is managed by Meta." />
      <CardBody>
        <form onSubmit={submit} noValidate className="space-y-4">
          {error ? <Alert tone="danger">{error}</Alert> : null}
          <Field id="wa-display-name" label="Internal name">
            <Input value={value} onChange={(e) => setValue(e.target.value)} maxLength={80} />
          </Field>
          <div className="flex justify-end">
            <Button type="submit" loading={saving} disabled={value.trim() === displayName || value.trim().length < 2}>
              Save
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
