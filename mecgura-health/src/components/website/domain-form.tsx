"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Field, TextInput, useToast } from "@/components/ui";
import { apiFetch } from "@/lib/api/client";

export function DomainRequestForm({ current }: { current: string | null }) {
  const router = useRouter();
  const toast = useToast();
  const [domain, setDomain] = useState(current ?? "");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await apiFetch("/api/website/domain", { method: "POST", body: JSON.stringify({ domain }) });
    setBusy(false);
    if (!res.ok) { setError(res.error.fieldErrors?.domain ?? res.error.message); return; }
    setError(undefined); toast({ tone: "success", title: "Request saved", description: "A MECGURA administrator will connect and verify it." }); router.refresh();
  }
  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <div className="flex-1"><Field label="Domain you own" error={error} hint="e.g. www.drsharma.com — no https:// or path"><TextInput value={domain} onChange={(e) => setDomain(e.target.value.toLowerCase())} autoCapitalize="none" /></Field></div>
      <Button type="submit" loading={busy}>Request this domain</Button>
    </form>
  );
}
