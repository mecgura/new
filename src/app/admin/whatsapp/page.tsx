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

export default function AdminWhatsAppPage() {
  const [q, setQ] = React.useState("");
  const [status, setStatus] = React.useState("");
  const { data, error, loading, page, setPage, reload } = usePaged<Account>("/api/admin/whatsapp-accounts", { q, status });

  return (
    <>
      <PageHeader title="WhatsApp Accounts" description="Every WhatsApp Business number registered to a client." breadcrumb={[{ label: "Admin", href: "/admin" }, { label: "WhatsApp Accounts" }]} />
      <Alert tone="info" title="Management only" className="mb-4">
        Numbers are registered per client from <strong>Clients → WhatsApp</strong>. Live connection to the Meta WhatsApp Cloud API (and the Connected status) arrives in the WhatsApp phase.
      </Alert>
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
