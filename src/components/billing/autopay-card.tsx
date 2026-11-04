"use client";

import * as React from "react";
import { RefreshCw, Repeat } from "lucide-react";
import { Alert, Badge, Button, Card, CardBody, CardHeader, type BadgeTone, useToast } from "@/components/ds";
import { apiFetch } from "@/lib/client-api";
import { formatINR } from "@/lib/catalog";

export type AutopayView = {
  available: boolean;
  reason: string;
  nextChargeAmount: number | null;
  mandate: { id: string; status: string; method: string; amount: number; interval: string; authorizeUrl: string; startAt: string | null; chargedCount: number; lastChargedAt: string | null; lastFailureReason: string; needsApprovalEachDebit: boolean; syncedAt: string | null } | null;
};

const STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  created: { label: "Waiting for your authorisation", tone: "warning" },
  authenticated: { label: "Set up — first charge on the billing date", tone: "success" },
  active: { label: "On", tone: "success" },
  pending: { label: "Last charge failed — retrying", tone: "warning" },
  halted: { label: "Stopped after failed charges", tone: "danger" },
  cancelled: { label: "Off", tone: "neutral" },
  completed: { label: "Completed", tone: "neutral" },
  expired: { label: "Link expired", tone: "neutral" },
};
const METHOD: Record<string, string> = { card: "Card", upi: "UPI AutoPay", emandate: "Bank eMandate", nach: "NACH" };
const when = (d: string | null) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—");

/** Card / UPI AutoPay (Razorpay Subscriptions). Status is only ever what Razorpay reported. */
export function AutopayCard({ base, autopay, canManage, reload }: { base: string; autopay: AutopayView; canManage: boolean; reload: () => Promise<void> }) {
  const toast = useToast();
  const [busy, setBusy] = React.useState<"" | "start" | "stop" | "sync">("");
  const m = autopay.mandate;
  const live = m && ["created", "authenticated", "active", "pending"].includes(m.status);

  async function call(kind: "start" | "stop" | "sync") {
    setBusy(kind);
    const r = await apiFetch<{ mandate?: AutopayView["mandate"] }>(kind === "sync" ? `${base}/autopay/sync` : `${base}/autopay`, { method: kind === "stop" ? "DELETE" : "POST" });
    setBusy("");
    if (!r.ok) return toast(r.error, "error");
    if (kind === "start" && r.data.mandate?.authorizeUrl) {
      window.open(r.data.mandate.authorizeUrl, "_blank", "noopener");
      toast("Authorise the mandate on Razorpay's page, then tap “Check status”.");
    } else toast(kind === "stop" ? "Auto-pay turned off" : kind === "sync" ? "Status updated from Razorpay" : "Auto-pay started");
    void reload();
  }

  if (!autopay.available && !live) {
    return (
      <Card>
        <CardHeader title="Auto-pay (card / UPI)" description="Pay your plan automatically every billing period." />
        <CardBody><p className="text-small text-app-muted">{autopay.reason || "Not available for this plan."}</p></CardBody>
      </Card>
    );
  }
  const status = m ? STATUS[m.status] ?? { label: m.status, tone: "neutral" as BadgeTone } : null;
  return (
    <Card>
      <CardHeader
        title="Auto-pay (card / UPI)"
        description="Your plan is charged automatically on each billing date — no reminders to chase."
        action={
          canManage ? (
            <div className="flex flex-wrap gap-2">
              {m ? <Button variant="ghost" size="sm" onClick={() => void call("sync")} loading={busy === "sync"}><RefreshCw aria-hidden="true" /> Check status</Button> : null}
              {live && m.status !== "created" ? (
                <Button variant="secondary" size="sm" onClick={() => { if (window.confirm("Turn off auto-pay? You'll pay each invoice yourself.")) void call("stop"); }} loading={busy === "stop"}>Turn off</Button>
              ) : m?.status === "created" && m.authorizeUrl ? (
                <a href={m.authorizeUrl} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 items-center rounded-lg bg-app-primary px-3 text-small font-medium text-app-on-primary">Authorise on Razorpay</a>
              ) : (
                <Button size="sm" onClick={() => void call("start")} loading={busy === "start"}><Repeat aria-hidden="true" /> Turn on auto-pay</Button>
              )}
            </div>
          ) : null
        }
      />
      <CardBody className="space-y-3">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-small sm:grid-cols-4">
          <div><dt className="text-app-subtle">Status</dt><dd>{status ? <Badge tone={status.tone} dot>{status.label}</Badge> : <Badge tone="neutral">Off</Badge>}</dd></div>
          <div><dt className="text-app-subtle">Method</dt><dd className="text-app-text">{m?.method ? METHOD[m.method] ?? m.method : "Chosen on Razorpay"}</dd></div>
          <div><dt className="text-app-subtle">Amount per {(m?.interval ?? "month") === "year" ? "year" : "month"}</dt><dd className="text-app-text">{formatINR(m && live ? m.amount : autopay.nextChargeAmount ?? 0)} incl. tax</dd></div>
          <div><dt className="text-app-subtle">Charges so far</dt><dd className="text-app-text">{m ? `${m.chargedCount}${m.lastChargedAt ? ` · last ${when(m.lastChargedAt)}` : ""}` : "—"}</dd></div>
        </dl>
        {m && (m.status === "pending" || m.status === "halted") && m.lastFailureReason ? <Alert tone="warning">{m.lastFailureReason}</Alert> : null}
        <p className="text-caption text-app-subtle">
          You choose card, UPI AutoPay or bank mandate on Razorpay&apos;s secure page; the options shown depend on what&apos;s enabled for MECGURA.
          {(m?.needsApprovalEachDebit || (autopay.nextChargeAmount ?? 0) > 1_500_000) ? " Charges above ₹15,000 need your approval in your bank / UPI app each time (RBI rule)." : ""} You can turn it off any time.
        </p>
      </CardBody>
    </Card>
  );
}
