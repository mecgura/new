import type { Metadata } from "next";
import { DomainRequestForm } from "@/components/website/domain-form";
import { Alert, Card, CardBody, CardHeader, StatusBadge } from "@/components/ui";
import { requireTenantPagePermission } from "@/lib/auth/context";
import { getEnv } from "@/lib/env";
import { domainStatus, ensureWebsite } from "@/lib/services/website-content";

export const metadata: Metadata = { title: "Website domain" };
const LABEL = { NOT_CONNECTED: "Not connected", PENDING_VERIFICATION: "Pending verification", VERIFIED: "Verified", ACTIVE: "Active", ERROR: "Error" } as const;

export default async function DomainPage() {
  const ctx = await requireTenantPagePermission("clinic.settings");
  const w = await ensureWebsite(ctx);
  const t = ctx.tenant;
  const root = getEnv().TENANT_ROOT_DOMAIN;
  const status = domainStatus({ customDomain: t.customDomain, verified: t.customDomainVerified, requested: w.requestedDomain, published: w.status === "PUBLISHED" });
  return (
    <div className="space-y-section">
      <Card>
        <CardHeader title="Your website address" action={<StatusBadge tone={status === "ACTIVE" ? "success" : status === "NOT_CONNECTED" ? "neutral" : status === "ERROR" ? "danger" : "warning"}>{LABEL[status]}</StatusBadge>} />
        <CardBody className="space-y-3">
          <p className="type-body"><span className="text-muted">Subdomain: </span>{t.subdomain ? (root ? <strong>{t.subdomain}.{root}</strong> : <><strong>{t.subdomain}</strong> <span className="type-caption">(the platform has no root domain configured yet, so subdomains do not resolve)</span></>) : "—"}</p>
          <p className="type-body"><span className="text-muted">Custom domain: </span>{t.customDomain ? <><strong>{t.customDomain}</strong> {t.customDomainVerified ? "· verified by MECGURA" : "· waiting for verification"}</> : w.requestedDomain ? <><strong>{w.requestedDomain}</strong> · requested, waiting for a MECGURA administrator</> : "none"}</p>
          {status === "ACTIVE" ? <Alert tone="success">Your custom domain is verified and your website is published.</Alert> : <Alert tone="info">Saving a domain does not make it live by itself — see the steps below.</Alert>}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Connect your own domain" description="For example www.drsharma.com" />
        <CardBody className="space-y-4">
          <DomainRequestForm current={w.requestedDomain ?? t.customDomain} />
          <ol className="type-body list-decimal space-y-1.5 pl-5">
            <li>Send your request above. A MECGURA administrator attaches the domain to your clinic.</li>
            <li>At your domain registrar, add the DNS record the administrator gives you (typically a CNAME for <code>www</code> pointing to the platform host).</li>
            <li>The hosting platform issues an SSL certificate for the domain.</li>
            <li>The administrator confirms DNS and SSL, then marks the domain <strong>verified</strong>. Only then does it start serving your website.</li>
          </ol>
          <p className="type-caption">Nothing here checks DNS automatically yet, so the “Error” state is not reported by this version.</p>
        </CardBody>
      </Card>
    </div>
  );
}
