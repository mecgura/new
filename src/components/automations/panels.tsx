"use client";

import * as React from "react";
import Link from "next/link";
import { History, Play, RotateCcw, Square, X } from "lucide-react";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  Drawer,
  EmptyState,
  Field,
  IconButton,
  LoadingState,
  Modal,
  Pagination,
  SearchBar,
  Select,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  useToast,
} from "@/components/ds";
import { apiFetch } from "@/lib/client-api";
import { formatNumber } from "@/lib/catalog";
import { NODE_LABELS, TRIGGER_LABELS, type NodeType, type TriggerType } from "@/lib/automations";
import { istFmt } from "@/components/campaigns/types";
import { EXEC_STATUS, STEP_STATUS } from "@/components/automations/meta";

export type ExecRow = {
  id: string;
  status: string;
  waitState: string;
  version: number;
  isTest: boolean;
  triggerType: string;
  contact: { id: string; name: string; phone: string } | null;
  error: string;
  steps: number;
  nextRunAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
};
export type ExecDetail = Omit<ExecRow, "steps"> & {
  automationId: string;
  currentNodeId: string | null;
  triggerData: Record<string, unknown>;
  steps: { id: string; nodeId: string; nodeType: string; label: string; status: string; attempt: number; output: Record<string, unknown>; error: string; startedAt: string }[];
};

const waitLabel = (e: { status: string; waitState: string; nextRunAt: string | null }) =>
  e.status !== "running" || !e.waitState
    ? null
    : e.waitState === "delay"
      ? `Waiting until ${e.nextRunAt ? istFmt.format(new Date(e.nextRunAt)) : "…"}`
      : e.waitState === "reply"
        ? "Waiting for the customer's reply"
        : `Retrying at ${e.nextRunAt ? istFmt.format(new Date(e.nextRunAt)) : "…"}`;

/** Visible title + close button for side drawers. */
export function DrawerHeader({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-app-border bg-app-surface px-4 py-3">
      <h2 className="text-body font-semibold text-app-text">{title}</h2>
      <IconButton label="Close" onClick={onClose}>
        <X aria-hidden="true" />
      </IconButton>
    </div>
  );
}

export function ExecutionStatus({ e }: { e: { status: string; waitState: string; nextRunAt: string | null } }) {
  const s = EXEC_STATUS[e.status] ?? { label: e.status, tone: "neutral" as const };
  const w = waitLabel(e);
  return (
    <span className="flex flex-col items-start gap-0.5">
      <Badge tone={s.tone} dot>{s.label}</Badge>
      {w ? <span className="text-caption text-app-subtle">{w}</span> : null}
    </span>
  );
}

/** Step-by-step timeline of one run, with Stop / Retry. */
export function ExecutionDrawer({ orgId, executionId, onClose, canManage, refreshKey, onHighlight }: { orgId: string; executionId: string | null; onClose: () => void; canManage: boolean; refreshKey: number; onHighlight?: (nodeId: string | null) => void }) {
  const toast = useToast();
  const [e, setE] = React.useState<ExecDetail | null>(null);
  const [busy, setBusy] = React.useState(false);
  const load = React.useCallback(async () => {
    if (!executionId) return;
    const r = await apiFetch<{ execution: ExecDetail }>(`/api/organizations/${orgId}/automations/executions/${executionId}`);
    if (r.ok) setE(r.data.execution);
  }, [orgId, executionId]);
  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- refetch on open / realtime refresh
    void load();
  }, [load, refreshKey]);
  React.useEffect(() => {
    onHighlight?.(e?.status === "running" ? e.currentNodeId : null);
  }, [e, onHighlight]);
  async function act(action: "stop" | "retry") {
    if (!e) return;
    setBusy(true);
    const r = await apiFetch<{ execution: ExecDetail }>(`/api/organizations/${orgId}/automations/executions/${e.id}`, { method: "POST", body: { action } });
    setBusy(false);
    if (!r.ok) return toast(r.error, "error");
    setE(r.data.execution);
    toast(action === "stop" ? "Run stopped" : "Retrying from the failed step");
  }
  return (
    <Drawer open={Boolean(executionId)} onClose={onClose} title="Run details" side="right">
      <DrawerHeader title="Run details" onClose={onClose} />
      {!e ? (
        <LoadingState />
      ) : (
        <div className="space-y-4 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <ExecutionStatus e={e} />
            {e.isTest ? <Badge tone="info">Test run</Badge> : <Badge>v{e.version}</Badge>}
          </div>
          <dl className="grid grid-cols-[6rem_minmax(0,1fr)] gap-y-1 text-small">
            <dt className="text-app-muted">Contact</dt>
            <dd>{e.contact ? <Link href={`/contacts/${e.contact.id}`} className="hover:text-app-primary-hover">{e.contact.name || e.contact.phone}</Link> : "—"}</dd>
            <dt className="text-app-muted">Trigger</dt>
            <dd>{TRIGGER_LABELS[e.triggerType as TriggerType] ?? e.triggerType}{typeof e.triggerData.text === "string" && e.triggerData.text ? ` · “${e.triggerData.text.slice(0, 60)}”` : ""}</dd>
            <dt className="text-app-muted">Started</dt>
            <dd>{e.startedAt ? `${istFmt.format(new Date(e.startedAt))} IST` : "Not yet"}</dd>
            {e.finishedAt ? (
              <>
                <dt className="text-app-muted">Finished</dt>
                <dd>{istFmt.format(new Date(e.finishedAt))} IST</dd>
              </>
            ) : null}
          </dl>
          {e.error ? <Alert tone="danger">{e.error}</Alert> : null}
          {canManage ? (
            <div className="flex gap-2">
              {e.status === "queued" || e.status === "running" ? (
                <Button size="sm" variant="danger" onClick={() => act("stop")} loading={busy}>
                  <Square aria-hidden="true" /> Stop run
                </Button>
              ) : null}
              {e.status === "failed" ? (
                <Button size="sm" variant="secondary" onClick={() => act("retry")} loading={busy}>
                  <RotateCcw aria-hidden="true" /> Retry failed step
                </Button>
              ) : null}
            </div>
          ) : null}
          <ol className="relative space-y-3 border-l border-app-border pl-4">
            {e.steps.map((s) => {
              const st = STEP_STATUS[s.status] ?? { label: s.status, tone: "neutral" as const };
              const out = Object.entries(s.output).filter(([, v]) => v !== null && v !== undefined && v !== "");
              return (
                <li key={s.id} className="relative">
                  <span className="absolute -left-[21px] top-1.5 size-2.5 rounded-full border-2 border-app-surface bg-app-border-strong" aria-hidden="true" />
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-small font-medium text-app-text">{s.label}</span>
                    <Badge tone={st.tone}>{st.label}</Badge>
                    {s.attempt > 1 ? <span className="text-caption text-app-subtle">attempt {s.attempt}</span> : null}
                  </div>
                  <p className="text-caption text-app-subtle">{NODE_LABELS[s.nodeType as NodeType] ?? s.nodeType} · {istFmt.format(new Date(s.startedAt))}</p>
                  {s.error ? <p className="mt-0.5 text-caption text-red-300">{s.error}</p> : null}
                  {out.length ? (
                    <dl className="mt-1 space-y-0.5 text-caption text-app-muted">
                      {out.slice(0, 5).map(([k, v]) => (
                        <div key={k} className="flex gap-1.5">
                          <dt className="shrink-0">{k}:</dt>
                          <dd className="min-w-0 truncate text-app-text">{typeof v === "object" ? JSON.stringify(v) : typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v) ? `${istFmt.format(new Date(v))} IST` : String(v)}</dd>
                        </div>
                      ))}
                    </dl>
                  ) : null}
                </li>
              );
            })}
            {!e.steps.length ? <li className="text-small text-app-muted">No steps yet.</li> : null}
          </ol>
        </div>
      )}
    </Drawer>
  );
}

export function LogsPanel({ orgId, automationId, canManage, refreshKey, onOpen }: { orgId: string; automationId: string; canManage: boolean; refreshKey: number; onOpen: (id: string) => void }) {
  const [status, setStatus] = React.useState("");
  const [tests, setTests] = React.useState("include");
  const [page, setPage] = React.useState(1);
  const [data, setData] = React.useState<{ executions: ExecRow[]; total: number; page: number; pageSize: number } | null>(null);
  const load = React.useCallback(async () => {
    const r = await apiFetch<{ executions: ExecRow[]; total: number; page: number; pageSize: number }>(`/api/organizations/${orgId}/automations/${automationId}/executions?${new URLSearchParams({ status, tests, page: String(page) })}`);
    if (r.ok) setData(r.data);
  }, [orgId, automationId, status, tests, page]);
  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- refetch on filters / realtime refresh
    void load();
  }, [load, refreshKey]);
  return (
    <Card>
      <CardHeader
        title="Run logs"
        description="Every run with its step-by-step history. Updates live."
        action={
          <div className="flex flex-wrap gap-2">
            <Select aria-label="Filter by status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="h-9 w-36 text-small">
              <option value="">All statuses</option>
              {Object.entries(EXEC_STATUS).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </Select>
            <Select aria-label="Test runs" value={tests} onChange={(e) => { setTests(e.target.value); setPage(1); }} className="h-9 w-36 text-small">
              <option value="include">Live + tests</option>
              <option value="exclude">Live only</option>
              <option value="only">Tests only</option>
            </Select>
          </div>
        }
      />
      {!data ? (
        <LoadingState />
      ) : !data.executions.length ? (
        <EmptyState icon={History} title="No runs yet" description={canManage ? "Publish and activate the automation, or use Test to try it on a contact." : "Runs appear here once the automation is triggered."} />
      ) : (
        <>
          <Table caption="Automation runs" className="min-w-[720px]">
            <THead>
              <tr>
                <TH>Status</TH>
                <TH>Contact</TH>
                <TH>Trigger</TH>
                <TH>Version</TH>
                <TH className="text-right">Steps</TH>
                <TH>Started</TH>
              </tr>
            </THead>
            <TBody>
              {data.executions.map((e) => (
                <TR key={e.id} className="cursor-pointer" onClick={() => onOpen(e.id)}>
                  <TD>
                    <button type="button" className="text-left" onClick={(ev) => { ev.stopPropagation(); onOpen(e.id); }} aria-label={`Open run for ${e.contact?.name || e.contact?.phone || "contact"}`}>
                      <ExecutionStatus e={e} />
                    </button>
                    {e.error ? <p className="mt-0.5 max-w-[16rem] truncate text-caption text-red-300" title={e.error}>{e.error}</p> : null}
                  </TD>
                  <TD>{e.contact ? <span>{e.contact.name || "Unnamed"}<span className="block font-mono text-caption text-app-subtle">{e.contact.phone}</span></span> : "—"}</TD>
                  <TD className="text-small">{TRIGGER_LABELS[e.triggerType as TriggerType] ?? e.triggerType}</TD>
                  <TD>{e.isTest ? <Badge tone="info">Test</Badge> : <span className="text-small">v{e.version}</span>}</TD>
                  <TD className="text-right tabular-nums">{e.steps}</TD>
                  <TD className="whitespace-nowrap text-small text-app-muted">{istFmt.format(new Date(e.createdAt))}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPageChange={setPage} />
        </>
      )}
    </Card>
  );
}

type Analytics = {
  totals: Record<string, number>;
  completionRate: number;
  avgDurationSec: number | null;
  nodes: Record<string, Record<string, number>>;
  days: { day: string; runs: number; completed: number; failed: number }[];
  errors: { error: string; count: number }[];
};

const duration = (s: number | null) => (s === null ? "—" : s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)} min` : `${Math.round(s / 360) / 10} h`);

export function AnalyticsPanel({ orgId, automationId, refreshKey, labels }: { orgId: string; automationId: string; refreshKey: number; labels: Record<string, string> }) {
  const [a, setA] = React.useState<Analytics | null>(null);
  const load = React.useCallback(async () => {
    const r = await apiFetch<Analytics>(`/api/organizations/${orgId}/automations/${automationId}/analytics`);
    if (r.ok) setA(r.data);
  }, [orgId, automationId]);
  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- refetch on realtime refresh
    void load();
  }, [load, refreshKey]);
  if (!a) return <LoadingState />;
  const cards = [
    { label: "Total runs", value: formatNumber(a.totals.total ?? 0), hint: "Live runs, all time" },
    { label: "Completed", value: formatNumber(a.totals.completed ?? 0), hint: `${a.completionRate}% of finished runs` },
    { label: "Running now", value: formatNumber((a.totals.running ?? 0) + (a.totals.queued ?? 0)), hint: "Including waits" },
    { label: "Failed", value: formatNumber(a.totals.failed ?? 0), hint: `${formatNumber(a.totals.stopped ?? 0)} stopped` },
    { label: "Avg. duration", value: duration(a.avgDurationSec), hint: "Completed runs" },
  ];
  const max = Math.max(1, ...a.days.map((d) => d.runs));
  const nodeRows = Object.entries(a.nodes).sort((x, y) => (y[1].completed ?? 0) - (x[1].completed ?? 0));
  return (
    <div className="space-y-4">
      <section aria-label="Automation totals" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {cards.map((c) => (
          <Card key={c.label} className="p-4">
            <p className="text-small text-app-muted">{c.label}</p>
            <p className="mt-1 text-h2 tabular-nums text-app-text">{c.value}</p>
            <p className="text-caption text-app-subtle">{c.hint}</p>
          </Card>
        ))}
      </section>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card className="min-w-0">
          <CardHeader title="Runs per day" description="Last 14 days (IST)." />
          <CardBody>
            <ul className="space-y-1.5">
              {a.days.map((d) => (
                <li key={d.day} className="grid grid-cols-[4.5rem_minmax(0,1fr)_5.5rem] items-center gap-2 text-caption">
                  <span className="text-app-muted">{d.day.slice(5)}</span>
                  <span className="h-2.5 rounded-full bg-app-elevated" aria-hidden="true">
                    <span className="block h-full rounded-full bg-app-primary" style={{ width: `${(d.runs / max) * 100}%` }} />
                  </span>
                  <span className="text-right tabular-nums text-app-text">
                    {d.runs} run{d.runs === 1 ? "" : "s"}
                    {d.failed ? <span className="text-red-300"> · {d.failed}✕</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
        <Card className="min-w-0">
          <CardHeader title="Steps" description="How often each step ran (live runs)." />
          {!nodeRows.length ? (
            <p className="px-5 pb-5 text-small text-app-muted">No runs yet.</p>
          ) : (
            <Table caption="Step results" className="min-w-0">
              <THead>
                <tr>
                  <TH>Step</TH>
                  <TH className="text-right">Done</TH>
                  <TH className="text-right">Failed</TH>
                  <TH className="text-right">Waiting / retry</TH>
                </tr>
              </THead>
              <TBody>
                {nodeRows.map(([id, s]) => (
                  <TR key={id}>
                    <TD>{labels[id] ?? id}</TD>
                    <TD className="text-right tabular-nums">{s.completed ?? 0}</TD>
                    <TD className="text-right tabular-nums">{s.failed ? <span className="text-red-300">{s.failed}</span> : 0}</TD>
                    <TD className="text-right tabular-nums">{(s.waiting ?? 0) + (s.retrying ?? 0)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
      </div>
      {a.errors.length ? (
        <Card>
          <CardHeader title="Most common errors" />
          <ul className="divide-y divide-app-border">
            {a.errors.map((e) => (
              <li key={e.error} className="flex justify-between gap-3 px-5 py-2.5 text-small">
                <span className="min-w-0 text-app-muted">{e.error}</span>
                <span className="tabular-nums">{e.count}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}

export type VersionRow = { id: string; version: number; note: string; createdAt: string; publishedBy: string | null; live: boolean; triggerType: string };

export function VersionsPanel({ versions, canManage, onRestore }: { versions: VersionRow[]; canManage: boolean; onRestore: (v: VersionRow) => void }) {
  return (
    <Card>
      <CardHeader title="Versions" description="Each publish creates a version. Running customers finish on the version they started with." />
      {!versions.length ? (
        <p className="px-5 pb-5 text-small text-app-muted">Not published yet. Publishing creates version 1.</p>
      ) : (
        <ul className="divide-y divide-app-border">
          {versions.map((v) => (
            <li key={v.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <span className="font-mono text-small text-app-text">v{v.version}</span>
              {v.live ? <Badge tone="success" dot>Live</Badge> : null}
              <span className="min-w-0 flex-1 text-small text-app-muted">
                {v.note || "No note"} · {v.publishedBy ?? "—"} · {istFmt.format(new Date(v.createdAt))}
              </span>
              {canManage ? (
                <Button size="sm" variant="secondary" onClick={() => onRestore(v)}>
                  <RotateCcw aria-hidden="true" /> Restore to draft
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Runs the current draft against one contact. */
export function TestModal({ open, onClose, orgId, automationId, onStarted, beforeStart }: { open: boolean; onClose: () => void; orgId: string; automationId: string; onStarted: (executionId: string) => void; beforeStart: () => Promise<boolean> }) {
  const [q, setQ] = React.useState("");
  const [results, setResults] = React.useState<{ id: string; name: string; phone: string; optInStatus: string }[]>([]);
  const [contactId, setContactId] = React.useState("");
  const [skipDelays, setSkipDelays] = React.useState(true);
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => {
      void apiFetch<{ items: { id: string; name: string; phone: string; optInStatus: string }[] }>(`/api/organizations/${orgId}/contacts?${new URLSearchParams({ q, pageSize: "10" })}`).then((r) => r.ok && setResults(r.data.items));
    }, 250);
    return () => window.clearTimeout(t);
  }, [open, q, orgId]);
  async function start() {
    setBusy(true);
    setError("");
    if (!(await beforeStart())) return setBusy(false);
    const r = await apiFetch<{ executionId: string }>(`/api/organizations/${orgId}/automations/${automationId}/test`, { method: "POST", body: { contactId, skipDelays } });
    setBusy(false);
    if (!r.ok) return setError(r.details ? Object.values(r.details).flat().slice(0, 4).join(" · ") : r.error);
    onStarted(r.data.executionId);
  }
  return (
    <Modal open={open} onClose={onClose} title="Test this automation" description="Runs the current draft (saved first) for one contact. Messages are really sent on live numbers — test with your own number. Demo numbers never deliver.">
      <div className="space-y-4">
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <SearchBar label="Search contacts" placeholder="Search name or phone…" value={q} onChange={(e) => setQ(e.target.value)} />
        <Field id="test-contact" label="Contact">
          <Select value={contactId} onChange={(e) => setContactId(e.target.value)}>
            <option value="">Choose a contact…</option>
            {results.map((c) => (
              <option key={c.id} value={c.id}>{c.name || "Unnamed"} · {c.phone}{c.optInStatus === "opted_out" ? " (opted out)" : ""}</option>
            ))}
          </Select>
        </Field>
        <Checkbox label="Skip delays" description="Delay steps finish instantly in this test." checked={skipDelays} onChange={(e) => setSkipDelays(e.target.checked)} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={start} loading={busy} disabled={!contactId}>
            <Play aria-hidden="true" /> Run test
          </Button>
        </div>
      </div>
    </Modal>
  );
}
