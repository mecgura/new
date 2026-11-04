"use client";

import * as React from "react";
import { CheckCircle2, Pencil, Play, Plus, Trash2, XCircle } from "lucide-react";
import { Alert, Badge, Button, Card, CardBody, CardHeader, EmptyState, Field, IconButton, Input, LoadingState, Modal, Select, Textarea, useToast } from "@/components/ds";
import { apiFetch } from "@/lib/client-api";

type Case = { id: string; name: string; message: string; mustInclude: string; mustNotInclude: string; expectAction: string; lastStatus: string; lastReply: string; lastReasons: string[]; lastMode: string; lastModel: string; lastRunAt: string | null };
type Data = { cases: Case[]; summary: { total: number; passed: number; failed: number; notRun: number }; liveAvailable: boolean };
const ACTION_LABEL: Record<string, string> = { "": "Any (don't check)", none: "No action", collect: "Save contact info", qualify: "Qualify lead", book: "Book appointment", transfer: "Transfer to a human" };
const EMPTY = { name: "", message: "", mustInclude: "", mustNotInclude: "", expectAction: "" };

/** AI agent → Automated tests: customer messages with rules, run against the saved agent in one click. */
export function AiTestsTab({ url, dirty }: { url: string; dirty: boolean }) {
  const toast = useToast();
  const [data, setData] = React.useState<Data | null>(null);
  const [edit, setEdit] = React.useState<(typeof EMPTY & { id?: string }) | null>(null);
  const [busy, setBusy] = React.useState("");
  const load = React.useCallback(async () => {
    const r = await apiFetch<Data>(url);
    if (!r.ok) return toast(r.error, "error");
    setData(r.data);
  }, [url, toast]);
  React.useEffect(() => {
    const t = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(t);
  }, [load]);

  async function run(mode: "live" | "demo") {
    setBusy(mode);
    const r = await apiFetch<Data>(`${url}/run`, { method: "POST", body: { mode } });
    setBusy("");
    if (!r.ok) return toast(r.error, "error");
    setData(r.data);
    toast(`${r.data.summary.passed} of ${r.data.summary.total} passed`, r.data.summary.failed ? "error" : "success");
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!edit) return;
    setBusy("save");
    const { id, ...body } = edit;
    const r = await apiFetch(id ? `${url}/${id}` : url, { method: id ? "PUT" : "POST", body });
    setBusy("");
    if (!r.ok) return toast(r.error, "error");
    setEdit(null);
    void load();
  }
  async function remove(id: string) {
    if (!window.confirm("Delete this test?")) return;
    const r = await apiFetch(`${url}/${id}`, { method: "DELETE" });
    if (!r.ok) return toast(r.error, "error");
    void load();
  }

  if (!data) return <LoadingState />;
  return (
    <div className="space-y-4">
      {dirty ? <Alert tone="warning">You have unsaved changes. Tests run against the saved agent — save first.</Alert> : null}
      <Card>
        <CardHeader
          title="Automated tests"
          description="Write the questions customers really ask and what a good answer must (not) say or do. Run them after every change. Nothing is sent to customers."
          action={
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" onClick={() => setEdit({ ...EMPTY })}><Plus aria-hidden="true" /> Add test</Button>
              <Button variant="secondary" size="sm" disabled={!data.cases.length} onClick={() => void run("demo")} loading={busy === "demo"}>Run (demo)</Button>
              <Button size="sm" disabled={!data.cases.length || !data.liveAvailable} onClick={() => void run("live")} loading={busy === "live"}><Play aria-hidden="true" /> Run with live AI</Button>
            </div>
          }
        />
        <CardBody>
          {data.cases.length ? (
            <p className="mb-3 flex flex-wrap gap-2 text-small">
              <Badge tone="success">{data.summary.passed} passed</Badge>
              <Badge tone={data.summary.failed ? "danger" : "neutral"}>{data.summary.failed} failed</Badge>
              <Badge tone="neutral">{data.summary.notRun} not run</Badge>
              {!data.liveAvailable ? <span className="text-caption text-app-subtle">Live AI isn&apos;t configured — demo runs use keyword matching only.</span> : null}
            </p>
          ) : null}
          {!data.cases.length ? (
            <EmptyState icon={CheckCircle2} title="No tests yet" description="Example: “What are your timings?” must include “10am”. “Can I talk to the owner?” must use Transfer to a human." />
          ) : (
            <ul className="space-y-3">
              {data.cases.map((c) => (
                <li key={c.id} className="rounded-lg border border-app-border p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 text-small font-medium text-app-text">
                        {c.lastStatus === "pass" ? <CheckCircle2 className="size-4 text-emerald-400" aria-label="Passed" /> : c.lastStatus ? <XCircle className="size-4 text-red-400" aria-label="Failed" /> : null}
                        {c.name}
                      </p>
                      <p className="text-caption text-app-muted">“{c.message}”{c.expectAction ? ` · expects: ${ACTION_LABEL[c.expectAction]}` : ""}</p>
                    </div>
                    <div className="flex gap-1">
                      <IconButton label="Edit test" onClick={() => setEdit({ id: c.id, name: c.name, message: c.message, mustInclude: c.mustInclude, mustNotInclude: c.mustNotInclude, expectAction: c.expectAction })}><Pencil aria-hidden="true" /></IconButton>
                      <IconButton label="Delete test" onClick={() => void remove(c.id)}><Trash2 aria-hidden="true" /></IconButton>
                    </div>
                  </div>
                  {c.lastRunAt ? (
                    <div className="mt-2 rounded-md bg-app-hover p-2 text-caption">
                      <p className="text-app-subtle">Last run {new Date(c.lastRunAt).toLocaleString("en-IN")} · {c.lastMode === "live" ? `live (${c.lastModel})` : "demo"}</p>
                      {c.lastReply ? <p className="mt-1 whitespace-pre-wrap text-app-text">{c.lastReply}</p> : null}
                      {c.lastReasons.length ? <ul className="mt-1 list-disc pl-4 text-red-300">{c.lastReasons.map((r) => <li key={r}>{r}</li>)}</ul> : null}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
      <Modal open={Boolean(edit)} onClose={() => setEdit(null)} title={edit?.id ? "Edit test" : "Add test"}>
        {edit ? (
          <form onSubmit={save} className="space-y-3">
            <Field id="t-name" label="Name"><Input value={edit.name} maxLength={80} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="Timings question" /></Field>
            <Field id="t-msg" label="Customer message"><Textarea rows={2} value={edit.message} maxLength={1000} onChange={(e) => setEdit({ ...edit, message: e.target.value })} placeholder="What time do you open on Sunday?" /></Field>
            <Field id="t-inc" label="Answer must include" hint="One word or phrase per line (not case-sensitive)."><Textarea rows={2} value={edit.mustInclude} onChange={(e) => setEdit({ ...edit, mustInclude: e.target.value })} placeholder="10am" /></Field>
            <Field id="t-exc" label="Answer must NOT include" hint="e.g. a price you don't offer, a competitor's name."><Textarea rows={2} value={edit.mustNotInclude} onChange={(e) => setEdit({ ...edit, mustNotInclude: e.target.value })} /></Field>
            <Field id="t-act" label="Expected action">
              <Select value={edit.expectAction} onChange={(e) => setEdit({ ...edit, expectAction: e.target.value })}>
                {Object.entries(ACTION_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </Select>
            </Field>
            <div className="flex justify-end gap-2"><Button variant="ghost" type="button" onClick={() => setEdit(null)}>Cancel</Button><Button type="submit" loading={busy === "save"}>Save test</Button></div>
          </form>
        ) : null}
      </Modal>
    </div>
  );
}
