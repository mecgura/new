"use client";

import * as React from "react";
import { Activity, Coins, History, IndianRupee, RotateCcw, ThumbsUp } from "lucide-react";
import { Alert, Badge, Button, Card, CardBody, CardHeader, ConfirmationDialog, EmptyState, ErrorState, LoadingState, Select, StatCard, Table, TBody, TD, TH, THead, TR, useToast } from "@/components/ds";
import { apiFetch } from "@/lib/client-api";
import { istFmt } from "@/components/campaigns/types";

type Version = { id: string; version: number; note: string; instructions: string; summary: string; by: string | null; createdAt: string };

/** Earlier copies of the agent's instructions, knowledge and actions; any can be put back. */
export function VersionsTab<A>({ url, dirty, onRestored }: { url: string; dirty: boolean; onRestored: (agent: A) => void }) {
  const toast = useToast();
  const [rows, setRows] = React.useState<Version[] | null>(null);
  const [error, setError] = React.useState("");
  const [pick, setPick] = React.useState<Version | null>(null);
  const [busy, setBusy] = React.useState(false);
  const load = React.useCallback(async () => {
    const r = await apiFetch<{ versions: Version[] }>(`${url}`);
    if (!r.ok) return setError(r.error);
    setError("");
    setRows(r.data.versions);
  }, [url]);
  React.useEffect(() => {
    const t = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(t);
  }, [load]);
  async function restore() {
    if (!pick) return;
    setBusy(true);
    const r = await apiFetch<{ restored: number; agent: A }>(`${url}/${pick.id}/restore`, { method: "POST", body: {} });
    setBusy(false);
    setPick(null);
    if (!r.ok) return toast(r.error, "error");
    onRestored(r.data.agent);
    toast(`Restored version ${r.data.restored}`);
    void load();
  }
  if (error) return <ErrorState description={error} onRetry={load} />;
  if (!rows) return <LoadingState />;
  return (
    <Card>
      <CardHeader title="Versions" description="A copy is saved every time instructions, knowledge or actions change (last 30 kept). Restoring saves the current settings first, so it can be undone." />
      {dirty ? <Alert tone="warning" className="mx-5 mb-3">You have unsaved changes. Restoring a version discards them.</Alert> : null}
      {!rows.length ? (
        <EmptyState icon={History} title="No earlier versions yet" description="Versions appear after you save a change." />
      ) : (
        <ul className="divide-y divide-app-border">
          {rows.map((v) => (
            <li key={v.id} className="flex flex-wrap items-start gap-3 px-5 py-3">
              <Badge>v{v.version}</Badge>
              <div className="min-w-0 flex-1">
                <p className="text-small text-app-text">{istFmt.format(new Date(v.createdAt))}{v.by ? ` · ${v.by}` : ""}{v.note ? ` · ${v.note}` : ""}</p>
                <p className="text-caption text-app-muted">{v.summary}</p>
                <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-caption text-app-subtle">{v.instructions || "(no instructions)"}</p>
              </div>
              <Button size="sm" variant="secondary" onClick={() => setPick(v)}>
                <RotateCcw aria-hidden="true" /> Restore
              </Button>
            </li>
          ))}
        </ul>
      )}
      <ConfirmationDialog open={!!pick} onClose={() => setPick(null)} onConfirm={restore} loading={busy} title={`Restore version ${pick?.version ?? ""}?`} description="Instructions, knowledge (FAQs, products, services, pricing), actions and handoff go back to this version. Documents aren't changed." confirmLabel="Restore" />
    </Card>
  );
}

type AgentUsage = { agentId: string; name: string; calls: number; testCalls: number; inputTokens: number; outputTokens: number; costInr: number; costPerReplyInr: number | null; replies: number; handoffs: number; errors: number; good: number; bad: number; handoffRatePct: number | null };
type Usage = { days: number; usdToInr: number; totals: { calls: number; inputTokens: number; outputTokens: number; costInr: number; good: number; bad: number }; agents: AgentUsage[]; models: { model: string; inputTokens: number; outputTokens: number; costInr: number }[]; note: string };

const inr = (n: number | null) => (n === null ? "—" : `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`);
const num = (n: number) => n.toLocaleString("en-IN");

/** Token use and estimated AI cost per agent, with reply quality signals. */
export function UsageTab({ url }: { url: string }) {
  const [days, setDays] = React.useState(30);
  const [d, setD] = React.useState<Usage | null>(null);
  const [error, setError] = React.useState("");
  const load = React.useCallback(async () => {
    const r = await apiFetch<Usage>(`${url}?days=${days}`);
    if (!r.ok) return setError(r.error);
    setError("");
    setD(r.data);
  }, [url, days]);
  React.useEffect(() => {
    const t = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(t);
  }, [load]);
  if (error) return <ErrorState description={error} onRetry={load} />;
  if (!d) return <LoadingState />;
  const rated = d.totals.good + d.totals.bad;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-small text-app-muted">{d.note}</p>
        <Select aria-label="Period" value={String(days)} onChange={(e) => setDays(Number(e.target.value))} className="w-44 shrink-0">
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
          <option value="90">Last 90 days</option>
        </Select>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={IndianRupee} label="Estimated AI cost" value={inr(d.totals.costInr)} />
        <StatCard icon={Activity} label="AI calls" value={num(d.totals.calls)} />
        <StatCard icon={Coins} label="Tokens (in / out)" value={`${num(d.totals.inputTokens)} / ${num(d.totals.outputTokens)}`} />
        <StatCard icon={ThumbsUp} label="Replies rated good" value={rated ? `${Math.round((d.totals.good / rated) * 100)}% of ${rated}` : "—"} />
      </div>
      <Card>
        <CardHeader title={<span className="flex items-center gap-2"><IndianRupee className="size-4" aria-hidden="true" /> By agent</span>} description={`US$1 = ₹${d.usdToInr}. Test-chat calls are included in the cost.`} />
        {!d.agents.length ? (
          <CardBody><p className="text-small text-app-muted">No AI activity in this period.</p></CardBody>
        ) : (
          <Table caption="AI usage by agent" className="min-w-[760px]">
            <THead>
              <tr>
                <TH>Agent</TH>
                <TH>Calls</TH>
                <TH>Replies</TH>
                <TH>Handoff rate</TH>
                <TH>Errors</TH>
                <TH>👍 / 👎</TH>
                <TH>Cost</TH>
                <TH>Per reply</TH>
              </tr>
            </THead>
            <TBody>
              {d.agents.map((a) => (
                <TR key={a.agentId}>
                  <TD className="font-medium text-app-text">{a.name}</TD>
                  <TD>{num(a.calls)}{a.testCalls ? <span className="text-caption text-app-subtle"> ({a.testCalls} test)</span> : null}</TD>
                  <TD>{num(a.replies)}</TD>
                  <TD>{a.handoffRatePct === null ? "—" : `${a.handoffRatePct}%`}</TD>
                  <TD>{a.errors ? <Badge tone="danger">{a.errors}</Badge> : "0"}</TD>
                  <TD>{a.good} / {a.bad}</TD>
                  <TD className="font-semibold text-app-text">{inr(a.costInr)}</TD>
                  <TD>{inr(a.costPerReplyInr)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
      {d.models.length ? (
        <Card>
          <CardHeader title="By model" />
          <CardBody>
            <ul className="space-y-1 text-small">
              {d.models.map((m) => (
                <li key={m.model} className="flex justify-between gap-3"><span className="font-mono text-caption text-app-text">{m.model}</span><span className="text-app-muted">{num(m.inputTokens)} in · {num(m.outputTokens)} out · <span className="text-app-text">{inr(m.costInr)}</span></span></li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
