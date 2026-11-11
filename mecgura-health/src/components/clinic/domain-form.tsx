"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, Button, Card, CardBody, CardHeader, Field, StatusBadge, TextInput, Toggle, useToast } from "@/components/ui";
import { apiFetch } from "@/lib/api/client";

interface Props { id: string; subdomain: string | null; customDomain: string | null; verified: boolean; websiteEnabled: boolean; rootDomain: string | null }

/** Super Admin only. Stores domain settings; DNS/SSL are configured outside the app (see README → Domains). */
export function DomainForm({ id, subdomain, customDomain, verified, websiteEnabled, rootDomain }: Props) {
  const router = useRouter();
  const toast = useToast();
  const [sub, setSub] = useState(subdomain ?? "");
  const [custom, setCustom] = useState(customDomain ?? "");
  const [web, setWeb] = useState(websiteEnabled);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function call(url: string, method: string, body: unknown, ok: string) {
    setBusy(true);
    const res = await apiFetch(url, { method, body: JSON.stringify(body) });
    setBusy(false);
    if (!res.ok) { setErrors(res.error.fieldErrors ?? {}); toast({ tone: "danger", title: "Couldn't save", description: res.error.message }); return; }
    setErrors({}); toast({ tone: "success", title: ok }); router.refresh();
  }

  const changed = custom.trim() !== (customDomain ?? "");
  return (
    <Card>
      <CardHeader title="Domain" description="Where this clinic's workspace and (later) website are reached." />
      <CardBody className="space-y-4">
        <Alert tone="info" title="Configuration only">
          Saving a domain does not make it live. DNS records and SSL must be set up on the hosting side first (see the README). A custom domain only starts resolving after you mark it verified below.
        </Alert>
        <div className="grid gap-form md:grid-cols-2">
          <Field label="Subdomain" error={errors.subdomain} hint={rootDomain ? `${sub || "clinic"}.${rootDomain}` : "TENANT_ROOT_DOMAIN is not configured, so subdomains do not resolve yet."}><TextInput value={sub} onChange={(e) => setSub(e.target.value.toLowerCase())} autoCapitalize="none" /></Field>
          <Field label="Custom domain" error={errors.customDomain} hint="e.g. drsharma.com — no https:// or path"><TextInput value={custom} onChange={(e) => setCustom(e.target.value.toLowerCase())} autoCapitalize="none" /></Field>
        </div>
        <Toggle label="Public website enabled (website builder arrives in Phase 2)" checked={web} onChange={setWeb} />
        <div className="flex flex-wrap items-center gap-2">
          <Button loading={busy} onClick={() => call(`/api/platform/clinics/${id}/domain`, "PATCH", { subdomain: sub.trim(), customDomain: custom.trim(), websiteEnabled: web }, "Domain settings saved")}>Save domain</Button>
          {customDomain && (verified
            ? <><StatusBadge tone="success">Verified</StatusBadge><Button variant="outline" size="sm" disabled={busy} onClick={() => call(`/api/platform/clinics/${id}/domain`, "POST", { verified: false }, "Domain marked unverified")}>Mark unverified</Button></>
            : <><StatusBadge tone="warning">Not verified</StatusBadge><Button variant="outline" size="sm" disabled={busy || changed} onClick={() => call(`/api/platform/clinics/${id}/domain`, "POST", { verified: true }, "Domain marked verified")}>I&apos;ve confirmed DNS &amp; SSL — mark verified</Button></>)}
        </div>
      </CardBody>
    </Card>
  );
}
