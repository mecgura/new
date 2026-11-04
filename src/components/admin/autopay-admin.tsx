"use client";

import * as React from "react";
import { RefreshCw, Repeat } from "lucide-react";
import { Alert, Badge, Button, Card, CardHeader, EmptyState, LoadingState, Table, TBody, TD, TH, THead, TR, useToast } from "@/components/ds";
import { apiFetch } from "@/lib/client-api";
import { formatINR } from "@/lib/catalog";

type Mandate = { id: string; organization: string; organizationId: string; gatewaySubId: string; status: string; method: string; amount: number; interval: string; chargedCount: number; recordedPaid: number; countMismatch: boolean; lastFailureReason: string; endReason: string; createdAt: string; syncedAt: string | null };
type Problem = { id: string; gatewayRef: string; gatewayPaymentId: string; amount: number; failureCode: string; failureReason: string; createdAt: string };
type Data = { mandates: Mandate[]; problems: Problem[]; stale: number };

const TONE: Record<string, "success" | "warning" | "danger" | "neutral"> = { active: "success", authenticated: "success", created: "warning", pending: "warning", halted: "danger", cancelled: "neutral", completed: "neutral", expired: "neutral" };
const day = (d: string | null) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "never");

/** Admin → Billing → Auto-pay: every Razorpay mandate, with reconciliation against Razorpay. */
export function AutopayAdmin() {
  const toast = useToast();
  const [data, setData] = React.useState<Data | null>(null);
  const [busy, setBusy] = React.useState("");
  const load = React.useCallback(async () => {
    const r = await apiFetch<Data>("/api/admin/billing/autopay");
    if (!r.ok) return toast(r.error, "error");
    setData(r.data);
  }, [toast]);
  React.useEffect(() => {
    const t = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(t);
  }, [load]);

  async function sync(id: string) {
    setBusy(id);
    const r = await apiFetch<{ providerStatus: string; providerPaidCount: number; recordedPaid: number; mismatch: boolean }>(`/api/admin/billing/autopay/${id}/sync`, { method: "POST" });
    setBusy("");
    if (!r.ok) return toast(r.error, "error");
    toast(r.data.mismatch ? `Razorpay shows ${r.data.providerPaidCount} charge(s), MECGURA recorded ${r.data.recordedPaid} — check the webhook log.` : `In sync: ${r.data.providerStatus}, ${r.data.recordedPaid} charge(s).`, r.data.mismatch ? "error" : "success");
    void load();
  }

  if (!data) return <LoadingState />;
  return (
    <div className="space-y-4">
      {data.stale ? <Alert tone="info">{data.stale} live mandate(s) haven&apos;t been checked against Razorpay for over a month. Use “Sync” to reconcile.</Alert> : null}
      <Card>
        <CardHeader title="Auto-pay mandates" description="Razorpay Subscriptions (card / UPI AutoPay). Statuses come from Razorpay webhooks or a sync — never assumed." />
        {!data.mandates.length ? (
          <EmptyState icon={Repeat} title="No auto-pay mandates yet" description="Clients turn auto-pay on from their Billing page once Razorpay Subscriptions is enabled on your Razorpay account." />
        ) : (
          <Table>
            <THead><TR><TH>Client</TH><TH>Status</TH><TH>Method</TH><TH>Amount</TH><TH>Charges (Razorpay / recorded)</TH><TH>Last sync</TH><TH /></TR></THead>
            <TBody>
              {data.mandates.map((m) => (
                <TR key={m.id}>
                  <TD><span className="block text-app-text">{m.organization}</span><span className="text-caption text-app-subtle">{m.gatewaySubId}</span></TD>
                  <TD><Badge tone={TONE[m.status] ?? "neutral"} dot>{m.status}</Badge>{m.endReason ? <span className="block text-caption text-app-subtle">{m.endReason}</span> : null}{m.lastFailureReason ? <span className="block text-caption text-amber-300">{m.lastFailureReason}</span> : null}</TD>
                  <TD>{m.method || "—"}</TD>
                  <TD className="tabular-nums">{formatINR(m.amount)} / {m.interval}</TD>
                  <TD className="tabular-nums">{m.chargedCount} / {m.recordedPaid}{m.countMismatch ? <Badge tone="warning" className="ml-2">check</Badge> : null}</TD>
                  <TD>{day(m.syncedAt)}</TD>
                  <TD><Button size="sm" variant="ghost" onClick={() => void sync(m.id)} loading={busy === m.id}><RefreshCw aria-hidden="true" /> Sync</Button></TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
      {data.problems.length ? (
        <Card>
          <CardHeader title="Charges that need a look" description="Automatic charges that didn't match an invoice amount. Refund in Razorpay or record manually." />
          <Table>
            <THead><TR><TH>When</TH><TH>Payment</TH><TH>Amount</TH><TH>Problem</TH></TR></THead>
            <TBody>
              {data.problems.map((p) => (
                <TR key={p.id}><TD>{day(p.createdAt)}</TD><TD><span className="text-caption">{p.gatewayPaymentId}</span></TD><TD>{formatINR(p.amount)}</TD><TD>{p.failureReason || p.failureCode}</TD></TR>
              ))}
            </TBody>
          </Table>
        </Card>
      ) : null}
    </div>
  );
}
