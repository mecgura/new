"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { CheckCircle2, RefreshCw } from "lucide-react";
import { Alert, Button, Card, CardBody, CardHeader, StatusBadge, useToast } from "@/components/ui";
import { apiFetch } from "@/lib/api/client";
import { SensitiveAction } from "./sensitive-action";

interface Custom { domain: string; status: string; verifiedAt: string | null; checkedAt: string | null; failure: string | null; txtName: string; txtValue: string | null; resolving: boolean }
const TONE: Record<string, "success" | "warning" | "danger" | "info" | "neutral"> = { VERIFIED: "success", PENDING: "warning", FAILED: "danger", VERIFYING: "info", DISABLED: "neutral" };

export function DomainManager({ clinicId, clinicName, subdomainHost, subdomain, rootConfigured, custom }: { clinicId: string; clinicName: string; subdomainHost: string | null; subdomain: string | null; rootConfigured: boolean; custom: Custom | null }) {
  const router = useRouter(); const toast = useToast(); const [domain, setDomain] = useState(custom?.domain ?? ""); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  async function call(path: string, method: string, body?: unknown, ok?: string) {
    setBusy(true); setErr(null); const res = await apiFetch<{ status?: string; failure?: string | null }>(`/api/platform/clinics/${clinicId}/domain/${path}`, { method, body: body === undefined ? undefined : JSON.stringify(body) }); setBusy(false);
    if (!res.ok) { setErr(res.error.fieldErrors?.customDomain ?? res.error.message); return; }
    toast({ tone: res.data?.status === "FAILED" ? "danger" : "success", title: res.data?.status === "FAILED" ? "Not verified yet" : ok ?? "Done", description: res.data?.failure ?? undefined }); router.refresh();
  }
  return (
    <div className="space-y-section">
      <Card><CardHeader title="Platform subdomain" description="Always on the platform's own domain." /><CardBody>
        {subdomain ? <p className="type-body">{subdomainHost ?? <>{subdomain} <span className="type-caption">(set TENANT_ROOT_DOMAIN to serve subdomains)</span></>}</p> : <p className="type-secondary">No subdomain. Set one from Edit clinic.</p>}
        {!rootConfigured && <p className="type-caption mt-2">TENANT_ROOT_DOMAIN is not configured on this server, so clinic subdomains cannot be served yet.</p>}
      </CardBody></Card>
      <Card><CardHeader title="Custom domain" description="Pointing a domain at the platform does nothing until ownership is proven with a DNS record." action={custom && <StatusBadge tone={TONE[custom.status] ?? "neutral"}>{custom.status.charAt(0) + custom.status.slice(1).toLowerCase()}</StatusBadge>} />
        <CardBody className="space-y-4">
          <form onSubmit={(e) => { e.preventDefault(); void call("custom", "PUT", { customDomain: domain.trim().toLowerCase() || null }, "Domain saved"); }} className="flex flex-col gap-2 sm:flex-row" aria-label="Custom domain">
            <label className="sr-only" htmlFor="cd">Custom domain</label>
            <input id="cd" value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="portal.clinic.com" className="type-form min-h-control min-w-0 flex-1 rounded-md border border-line-strong bg-surface px-3" aria-invalid={!!err} />
            <Button type="submit" loading={busy} disabled={domain.trim().toLowerCase() === (custom?.domain ?? "")}>{custom ? "Change domain" : "Set domain"}</Button>
          </form>
          {err && <p role="alert" className="type-caption text-danger">{err}</p>}
          {custom && (
            <div className="space-y-3">
              {custom.status === "VERIFIED" ? <Alert tone="success" title="Verified">{custom.domain} now opens {clinicName}{custom.verifiedAt ? ` (verified ${new Date(custom.verifiedAt).toLocaleString("en-IN")})` : ""}. SSL and DNS pointing are handled outside the app.</Alert>
                : custom.status === "DISABLED" ? <Alert tone="info" title="Disabled">This domain no longer opens the clinic. Set it again to re-verify.</Alert>
                : <Alert tone="warning" title="Not verified — this domain does not open the clinic yet">Ask the clinic to add this DNS TXT record, then check.</Alert>}
              {custom.status !== "VERIFIED" && custom.status !== "DISABLED" && custom.txtValue && (
                <dl className="grid gap-2 rounded-md bg-surface-muted p-3 sm:grid-cols-[7rem_1fr]">
                  <dt className="type-caption">Record type</dt><dd className="type-body">TXT</dd><dt className="type-caption">Name / host</dt><dd className="type-body break-all font-mono text-sm">{custom.txtName}</dd><dt className="type-caption">Value</dt><dd className="type-body break-all font-mono text-sm">{custom.txtValue}</dd>
                </dl>
              )}
              {custom.failure && <p role="status" className="type-secondary text-danger">{custom.failure}{custom.checkedAt && <span className="type-caption"> · checked {new Date(custom.checkedAt).toLocaleString("en-IN")}</span>}</p>}
              <div className="flex flex-wrap gap-2">
                {custom.status !== "VERIFIED" && custom.status !== "DISABLED" && <Button variant="primary" onClick={() => call("verify", "POST", undefined, "Domain verified")} loading={busy}><RefreshCw aria-hidden className="size-4" />Check DNS now</Button>}
                {custom.status !== "VERIFIED" && custom.status !== "DISABLED" && <SensitiveAction label="Confirm manually" icon={<CheckCircle2 aria-hidden className="size-4" />} title="Confirm this domain manually?" target={custom.domain} impact={`${custom.domain} will start opening ${clinicName} without a DNS check. Only do this if you verified DNS and SSL yourself.`} endpoint={`/api/platform/clinics/${clinicId}/domain`} body={{ verified: true }} fields={[{ name: "notes", label: "How was it verified?", kind: "textarea", required: true }]} tone="primary" successMessage="Domain confirmed" />}
                {custom.status !== "DISABLED" && <SensitiveAction label="Disable domain" title="Disable this domain?" target={custom.domain} impact={`${custom.domain} stops opening the clinic immediately. Nothing else changes.`} endpoint={`/api/platform/clinics/${clinicId}/domain/custom`} method="DELETE" successMessage="Domain disabled" />}
              </div>
            </div>
          )}
        </CardBody></Card>
    </div>
  );
}
