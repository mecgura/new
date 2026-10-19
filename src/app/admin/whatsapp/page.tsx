"use client";

import * as React from "react";
import Link from "next/link";
import { Phone } from "lucide-react";
import {
  Alert,
  Badge,
  Card,
  EmptyState,
  ErrorState,
  FilterBar,
  LoadingState,
  PageHeader,
  Pagination,
  SearchBar,
  Select,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from "@/components/ds";
import { WHATSAPP_STATUS_LABELS } from "@/lib/catalog";
import { usePaged } from "@/components/admin/use-paged";
import { apiFetch } from "@/lib/client-api";

type Account = {
  id: string;
  displayName: string;
  phoneNumber: string;
  status: string;
  provider: string;
  createdAt: string;
  organization: { id: string; name: string; status: string };
};

const dateFmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" });

type Readiness = { embeddedSignupReady: boolean; missing: string[]; encryptionReady: boolean; graphVersion: string; callbackUrl: string };

/** Whether "Connect with Meta" (Embedded Signup) can work for clients, and what to do when it can't. */
function MetaReadiness() {
  const [r, setR] = React.useState<Readiness | null>(null);
  React.useEffect(() => {
    let off = false;
    void apiFetch<Readiness>("/api/admin/meta-readiness").then((x) => {
      if (!off && x.ok) setR(x.data);
    });
    return () => {
      off = true;
    };
  }, []);
  if (!r) return null;
  return (
    <Card className="mb-4">
      <div className="space-y-3 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-semibold text-app-text">Connect with Meta (Embedded Signup)</h2>
          <Badge tone={r.embeddedSignupReady ? "success" : "warning"}>{r.embeddedSignupReady ? "Ready" : "Not set up"}</Badge>
        </div>
        {r.embeddedSignupReady ? (
          <p className="text-small text-app-muted">Clients can connect a WhatsApp number with their Facebook login. Graph API {r.graphVersion}.</p>
        ) : (
          <>
            <p className="text-small text-app-muted">
              Clients can still connect with <strong>API / Developer setup</strong>. To enable the one-click flow, MECGURA&apos;s Meta app must become a Tech Provider and these settings must be added in Vercel:
            </p>
            <ul className="flex flex-wrap gap-2">
              {r.missing.map((m) => (
                <li key={m} className="rounded bg-app-hover px-2 py-1 font-mono text-caption">
                  {m}
                </li>
              ))}
            </ul>
            <ol className="list-decimal space-y-1 pl-5 text-small text-app-muted">
              <li>Complete Business Verification for MECGURA in Meta Business Settings.</li>
              <li>In your Meta app, add WhatsApp and Facebook Login for Business, then apply to become a Tech Provider.</li>
              <li>Create an Embedded Signup configuration (version 4) and copy its configuration ID.</li>
              <li>Set the webhook callback to <code className="rounded bg-app-hover px-1">{r.callbackUrl}</code> with your verify token, and subscribe to messages and account_update.</li>
            </ol>
          </>
        )}
        {!r.encryptionReady ? <Alert tone="danger">WHATSAPP_ENCRYPTION_KEY is missing. Client credentials can&apos;t be stored securely until it is set.</Alert> : null}
      </div>
    </Card>
  );
}

export default function AdminWhatsAppPage() {
  const [q, setQ] = React.useState("");
  const [status, setStatus] = React.useState("");
  const { data, error, loading, page, setPage, reload } = usePaged<Account>("/api/admin/whatsapp-accounts", { q, status });

  return (
    <>
      <PageHeader title="WhatsApp Accounts" description="Every WhatsApp Business number registered to a client." breadcrumb={[{ label: "Admin", href: "/admin" }, { label: "WhatsApp Accounts" }]} />
      <MetaReadiness />
      <Card>
        <FilterBar>
          <SearchBar label="Search numbers" placeholder="Number, name or client…" value={q} onChange={(e) => setQ(e.target.value)} className="sm:w-72" />
          <Select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)} className="sm:w-48">
            <option value="">All statuses</option>
            {Object.entries(WHATSAPP_STATUS_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </FilterBar>
        {error ? (
          <ErrorState description={error} onRetry={reload} />
        ) : !data && loading ? (
          <LoadingState />
        ) : data && data.items.length === 0 ? (
          <EmptyState icon={Phone} title="No numbers registered" description="Open a client and use the WhatsApp tab to register their number." />
        ) : data ? (
          <>
            <Table caption="WhatsApp numbers" aria-busy={loading}>
              <THead>
                <tr>
                  <TH>Number</TH>
                  <TH>Display name</TH>
                  <TH>Client</TH>
                  <TH>Provider</TH>
                  <TH>Status</TH>
                  <TH>Added</TH>
                </tr>
              </THead>
              <TBody>
                {data.items.map((a) => (
                  <TR key={a.id}>
                    <TD className="font-mono text-small">{a.phoneNumber}</TD>
                    <TD>{a.displayName}</TD>
                    <TD>
                      <Link href={`/admin/clients/${a.organization.id}?tab=whatsapp`} className="hover:text-app-primary-hover">
                        {a.organization.name}
                      </Link>
                      {a.organization.status !== "active" ? <Badge tone="danger" className="ml-2">Suspended</Badge> : null}
                    </TD>
                    <TD className="text-app-muted">{a.provider === "meta_cloud_api" ? "Meta Cloud API" : a.provider}</TD>
                    <TD>
                      <Badge tone={a.status === "connected" ? "success" : a.status === "disabled" ? "neutral" : "warning"} dot>
                        {WHATSAPP_STATUS_LABELS[a.status] ?? a.status}
                      </Badge>
                    </TD>
                    <TD className="text-app-muted">{dateFmt.format(new Date(a.createdAt))}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <Pagination page={page} pageSize={data.pageSize} total={data.total} onPageChange={setPage} />
          </>
        ) : null}
      </Card>
    </>
  );
}
