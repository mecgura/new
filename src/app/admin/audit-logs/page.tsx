"use client";

import * as React from "react";
import { ScrollText } from "lucide-react";
import {
  Badge,
  Card,
  EmptyState,
  ErrorState,
  FilterBar,
  LoadingState,
  PageHeader,
  Pagination,
  Select,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from "@/components/ds";
import { AUDIT_ACTIONS, describeAction } from "@/lib/audit-actions";
import { usePaged } from "@/components/admin/use-paged";

type Log = {
  id: string;
  action: string;
  targetType: string;
  targetId: string;
  metadata: string;
  ip: string;
  createdAt: string;
  actor: { name: string | null; email: string } | null;
  organization: { id: string; name: string } | null;
};

const fmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", second: "2-digit" });

function tone(action: string) {
  if (action === "permission.denied" || action === "auth.login_failed") return "danger" as const;
  if (action.startsWith("auth.")) return "info" as const;
  return "neutral" as const;
}

export default function AdminAuditLogsPage() {
  const [action, setAction] = React.useState("");
  const { data, error, loading, page, setPage, reload } = usePaged<Log>("/api/admin/audit-logs", { action }, 25);

  return (
    <>
      <PageHeader title="Audit logs" description="Security and administrative events across the platform. Secrets are never recorded." breadcrumb={[{ label: "Admin", href: "/admin" }, { label: "Audit logs" }]} />
      <Card>
        <FilterBar>
          <label htmlFor="action-filter" className="text-small text-app-muted">
            Event
          </label>
          <Select id="action-filter" value={action} onChange={(e) => setAction(e.target.value)} className="sm:w-64">
            <option value="">All events</option>
            {AUDIT_ACTIONS.map((a) => (
              <option key={a} value={a}>
                {describeAction(a)}
              </option>
            ))}
          </Select>
        </FilterBar>
        {error ? (
          <ErrorState description={error} onRetry={reload} />
        ) : !data && loading ? (
          <LoadingState />
        ) : data && data.items.length === 0 ? (
          <EmptyState icon={ScrollText} title="No events recorded" />
        ) : data ? (
          <>
            <Table caption="Audit log" aria-busy={loading}>
              <THead>
                <tr>
                  <TH>Time</TH>
                  <TH>Event</TH>
                  <TH>Actor</TH>
                  <TH>Organization</TH>
                  <TH>Details</TH>
                </tr>
              </THead>
              <TBody>
                {data.items.map((l) => (
                  <TR key={l.id}>
                    <TD className="whitespace-nowrap text-app-muted">{fmt.format(new Date(l.createdAt))}</TD>
                    <TD>
                      <Badge tone={tone(l.action)}>{describeAction(l.action)}</Badge>
                    </TD>
                    <TD>{l.actor ? (l.actor.name ?? l.actor.email) : <span className="text-app-subtle">Anonymous</span>}</TD>
                    <TD>{l.organization?.name ?? <span className="text-app-subtle">—</span>}</TD>
                    <TD className="max-w-xs">
                      <code className="block truncate text-caption text-app-muted" title={l.metadata}>
                        {l.metadata === "{}" ? "—" : l.metadata}
                      </code>
                    </TD>
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
