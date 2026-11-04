"use client";

import * as React from "react";
import { KeyRound, ShieldAlert, ShieldCheck, UserX } from "lucide-react";
import { Alert, Badge, Button, Card, CardHeader, EmptyState, LoadingState, PageHeader, StatCard, Table, TBody, TD, TH, THead, TR, useToast } from "@/components/ds";
import { apiFetch } from "@/lib/client-api";

type Data = {
  totals: { failedLogins24h: number; failedLogins7d: number; logins24h: number; permissionDenied7d: number; suspiciousIps: number; newAdminIps: number; pendingDeletionRequests: number };
  failedSeries: { day: string; failed: number }[];
  topIps: { ip: string; failed24h: number; failed14d: number; accounts: number; lastAt: string; flagged: boolean }[];
  topAccounts: { email: string; failed7d: number; reasons: string[]; lastAt: string }[];
  permissionDenied: { email: string; count: number }[];
  sensitive: { id: string; action: string; at: string; ip: string; actor: string; organization: string; target: string }[];
  adminLogins: { email: string; ip: string; userAgent: string; at: string; newIp: boolean }[];
  dataRequests: { id: string; organizationName: string; requestedByEmail: string; reason: string; status: string; earliestAt: string; createdAt: string; note: string; canExecute: boolean }[];
};
const when = (d: string) => new Date(d).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** Admin → Security: sign-in attacks, risky actions, admin sign-ins and workspace deletion requests (from the audit log). */
export function SecurityAdmin() {
  const toast = useToast();
  const [data, setData] = React.useState<Data | null>(null);
  const [busy, setBusy] = React.useState("");
  const load = React.useCallback(async () => {
    const r = await apiFetch<Data>("/api/admin/security");
    if (!r.ok) return toast(r.error, "error");
    setData(r.data);
  }, [toast]);
  React.useEffect(() => {
    const t = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(t);
  }, [load]);

  async function decide(id: string, decision: "execute" | "reject", org: string) {
    if (decision === "execute" && !window.confirm(`Permanently delete the workspace “${org}” and all its data? This can't be undone.`)) return;
    const note = decision === "reject" ? window.prompt("Reason for rejecting (shown in the record):") ?? "" : "";
    setBusy(id);
    const r = await apiFetch(`/api/admin/data-requests/${id}`, { method: "POST", body: { decision, note } });
    setBusy("");
    if (!r.ok) return toast(r.error, "error");
    toast(decision === "execute" ? "Workspace deleted" : "Request rejected");
    void load();
  }

  if (!data) return <LoadingState />;
  const t = data.totals;
  const max = Math.max(1, ...data.failedSeries.map((s) => s.failed));
  return (
    <>
      <PageHeader title="Security" description="Sign-in attacks, permission denials, risky actions and admin sign-ins — counted from the audit log." />
      {t.suspiciousIps || t.newAdminIps ? (
        <Alert tone="warning" className="mb-4" title="Needs a look">
          {[t.suspiciousIps ? `${t.suspiciousIps} IP(s) with 10+ failed sign-ins in 24 h` : "", t.newAdminIps ? `${t.newAdminIps} Super Admin sign-in(s) from a new IP this week` : ""].filter(Boolean).join(" · ")}
        </Alert>
      ) : null}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Failed sign-ins (24 h)" value={String(t.failedLogins24h)} icon={UserX} hint={`${t.failedLogins7d} in 7 days · ${t.logins24h} successful today`} />
        <StatCard label="Suspicious IPs" value={String(t.suspiciousIps)} icon={ShieldAlert} hint="10+ failures in 24 h" />
        <StatCard label="Permission denied (7 d)" value={String(t.permissionDenied7d)} icon={KeyRound} hint="Users trying things their role can't do" />
        <StatCard label="Deletion requests" value={String(t.pendingDeletionRequests)} icon={ShieldCheck} hint="Pending workspace deletions" />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Failed sign-ins — last 14 days" />
          <div className="flex h-32 items-end gap-1 px-5 pb-4" role="img" aria-label={data.failedSeries.map((s) => `${s.day}: ${s.failed}`).join(", ")}>
            {data.failedSeries.map((s) => (
              <div key={s.day} className="flex flex-1 flex-col items-center gap-1" title={`${s.day}: ${s.failed}`}>
                <div className="w-full rounded-t bg-red-400/70" style={{ height: `${Math.max(2, (s.failed / max) * 96)}px` }} />
                <span className="text-[10px] text-app-subtle">{s.day.slice(8)}</span>
              </div>
            ))}
          </div>
        </Card>
        <Card>
          <CardHeader title="IPs with failed sign-ins" />
          {!data.topIps.length ? <EmptyState icon={ShieldCheck} title="No failed sign-ins" className="py-6" /> : (
            <Table><THead><TR><TH>IP</TH><TH className="text-right">24 h</TH><TH className="text-right">14 d</TH><TH className="text-right">Accounts</TH><TH>Last</TH></TR></THead>
              <TBody>{data.topIps.map((i) => <TR key={i.ip}><TD className="font-mono text-caption">{i.ip}{i.flagged ? <Badge tone="danger" className="ml-2">flagged</Badge> : null}</TD><TD className="text-right tabular-nums">{i.failed24h}</TD><TD className="text-right tabular-nums">{i.failed14d}</TD><TD className="text-right tabular-nums">{i.accounts}</TD><TD className="text-caption">{when(i.lastAt)}</TD></TR>)}</TBody>
            </Table>
          )}
        </Card>
        <Card>
          <CardHeader title="Accounts with failed sign-ins (7 d)" />
          {!data.topAccounts.length ? <EmptyState icon={ShieldCheck} title="None" className="py-6" /> : (
            <Table><THead><TR><TH>Account</TH><TH className="text-right">Failures</TH><TH>Reason</TH></TR></THead>
              <TBody>{data.topAccounts.map((a) => <TR key={a.email}><TD>{a.email}</TD><TD className="text-right tabular-nums">{a.failed7d}</TD><TD className="text-caption">{a.reasons.join(", ").replace(/_/g, " ")}</TD></TR>)}</TBody>
            </Table>
          )}
        </Card>
        <Card>
          <CardHeader title="Super Admin sign-ins (7 d)" description="“New IP” = not used by that admin in the 30 days before." />
          {!data.adminLogins.length ? <EmptyState icon={ShieldCheck} title="No admin sign-ins this week" className="py-6" /> : (
            <Table><THead><TR><TH>Admin</TH><TH>IP</TH><TH>When</TH></TR></THead>
              <TBody>{data.adminLogins.map((l, i) => <TR key={i}><TD>{l.email}</TD><TD className="font-mono text-caption">{l.ip || "—"}{l.newIp ? <Badge tone="warning" className="ml-2">new IP</Badge> : null}</TD><TD className="text-caption">{when(l.at)}</TD></TR>)}</TBody>
            </Table>
          )}
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader title="Sensitive actions (7 d)" description="Role changes, deletions, exports, key changes and settings changes." />
        {!data.sensitive.length ? <EmptyState icon={ShieldCheck} title="Nothing sensitive this week" className="py-6" /> : (
          <Table><THead><TR><TH>When</TH><TH>Action</TH><TH>By</TH><TH>Workspace</TH><TH>IP</TH></TR></THead>
            <TBody>{data.sensitive.map((s) => <TR key={s.id}><TD className="text-caption">{when(s.at)}</TD><TD><code className="text-caption">{s.action}</code></TD><TD>{s.actor}</TD><TD>{s.organization || "—"}</TD><TD className="font-mono text-caption">{s.ip || "—"}</TD></TR>)}</TBody>
          </Table>
        )}
      </Card>
      {data.permissionDenied.length ? (
        <Card className="mt-4">
          <CardHeader title="Permission denied by user (7 d)" />
          <Table><THead><TR><TH>User</TH><TH className="text-right">Denied</TH></TR></THead><TBody>{data.permissionDenied.map((p) => <TR key={p.email}><TD>{p.email}</TD><TD className="text-right tabular-nums">{p.count}</TD></TR>)}</TBody></Table>
        </Card>
      ) : null}

      <Card className="mt-4">
        <CardHeader title="Workspace deletion requests" description="Owners request deletion in Settings → Organization. Carry it out after the cooling-off period." />
        {!data.dataRequests.length ? <EmptyState icon={ShieldCheck} title="No requests" className="py-6" /> : (
          <Table><THead><TR><TH>Workspace</TH><TH>Requested by</TH><TH>Status</TH><TH>Can delete from</TH><TH /></TR></THead>
            <TBody>{data.dataRequests.map((r) => (
              <TR key={r.id}>
                <TD><span className="block">{r.organizationName}</span>{r.reason ? <span className="text-caption text-app-subtle">“{r.reason}”</span> : null}</TD>
                <TD className="text-caption">{r.requestedByEmail}<br />{when(r.createdAt)}</TD>
                <TD><Badge tone={r.status === "pending" ? "warning" : r.status === "completed" ? "danger" : "neutral"}>{r.status}</Badge>{r.note ? <span className="block text-caption text-app-subtle">{r.note}</span> : null}</TD>
                <TD className="text-caption">{when(r.earliestAt)}</TD>
                <TD>{r.status === "pending" ? <div className="flex gap-2"><Button size="sm" variant="danger" disabled={!r.canExecute} loading={busy === r.id} onClick={() => void decide(r.id, "execute", r.organizationName)}>Delete now</Button><Button size="sm" variant="ghost" onClick={() => void decide(r.id, "reject", r.organizationName)}>Reject</Button></div> : null}</TD>
              </TR>
            ))}</TBody>
          </Table>
        )}
      </Card>
    </>
  );
}
