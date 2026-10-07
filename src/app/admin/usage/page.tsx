"use client";

import * as React from "react";
import Link from "next/link";
import { Gauge } from "lucide-react";
import {
  Badge,
  Card,
  EmptyState,
  ErrorState,
  FilterBar,
  LoadingState,
  PageHeader,
  Pagination,
  SearchBar,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  UsageMeter,
} from "@/components/ds";
import { usePaged } from "@/components/admin/use-paged";

type Line = { used: number; limit: number | null };
type Row = { id: string; name: string; status: string; plan: { id: string; name: string } | null; seats: Line; whatsappNumbers: Line; messages: Line; contacts: Line; aiReplies: number; apiCalls: number };

export default function AdminUsagePage() {
  const [q, setQ] = React.useState("");
  const { data, error, loading, page, setPage, reload } = usePaged<Row>("/api/admin/usage", { q });
  const period = new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric", timeZone: "Asia/Kolkata" }).format(new Date());

  return (
    <>
      <PageHeader title="Usage" description={`Usage against plan limits · ${period}. Messages and contacts are metered once WhatsApp and CRM are connected.`} breadcrumb={[{ label: "Admin", href: "/admin" }, { label: "Usage" }]} />
      <Card>
        <FilterBar>
          <SearchBar label="Search clients" placeholder="Search client…" value={q} onChange={(e) => setQ(e.target.value)} className="sm:w-72" />
        </FilterBar>
        {error ? (
          <ErrorState description={error} onRetry={reload} />
        ) : !data && loading ? (
          <LoadingState />
        ) : data && data.items.length === 0 ? (
          <EmptyState icon={Gauge} title="No clients" />
        ) : data ? (
          <>
            <Table caption="Usage by client" aria-busy={loading} className="min-w-[960px]">
              <THead>
                <tr>
                  <TH>Client</TH>
                  <TH>Plan</TH>
                  <TH className="w-44">Seats</TH>
                  <TH className="w-44">WhatsApp numbers</TH>
                  <TH className="w-44">Messages</TH>
                  <TH className="w-44">New contacts</TH>
                </tr>
              </THead>
              <TBody>
                {data.items.map((r) => (
                  <TR key={r.id}>
                    <TD>
                      <Link href={`/admin/clients/${r.id}?tab=usage`} className="font-medium hover:text-app-primary-hover">
                        {r.name}
                      </Link>
                      {r.status !== "active" ? <p className="text-caption text-red-300">Suspended</p> : null}
                    </TD>
                    <TD>{r.plan ? <Badge tone="primary">{r.plan.name}</Badge> : <Badge tone="warning">No plan</Badge>}</TD>
                    <TD><UsageMeter compact label="Seats" used={r.seats.used} limit={r.seats.limit} /></TD>
                    <TD><UsageMeter compact label="Numbers" used={r.whatsappNumbers.used} limit={r.whatsappNumbers.limit} /></TD>
                    <TD><UsageMeter compact label="Messages" used={r.messages.used} limit={r.messages.limit} /></TD>
                    <TD><UsageMeter compact label="Contacts" used={r.contacts.used} limit={r.contacts.limit} /></TD>
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
