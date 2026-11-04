"use client";

import * as React from "react";
import { Download, Trash2 } from "lucide-react";
import { Alert, Button, Card, CardBody, CardHeader, Field, Input, Modal, Textarea, useToast } from "@/components/ds";
import { apiFetch } from "@/lib/client-api";

type Req = { id: string; earliestAt: string; createdAt: string; reason: string } | null;

/** Settings → Organization → Your data: download everything, or ask for the workspace to be deleted. */
export function DataRightsCard({ orgId, name }: { orgId: string; name: string }) {
  const toast = useToast();
  const base = `/api/organizations/${orgId}/data`;
  const [req, setReq] = React.useState<Req | undefined>(undefined);
  const [days, setDays] = React.useState(7);
  const [open, setOpen] = React.useState(false);
  const [confirm, setConfirm] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const load = React.useCallback(async () => {
    const r = await apiFetch<{ request: Req; coolingOffDays: number }>(`${base}/deletion`);
    if (r.ok) {
      setReq(r.data.request);
      setDays(r.data.coolingOffDays);
    }
  }, [base]);
  React.useEffect(() => {
    const t = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(t);
  }, [load]);

  async function request() {
    setBusy(true);
    const r = await apiFetch(`${base}/deletion`, { method: "POST", body: { confirmName: confirm, reason } });
    setBusy(false);
    if (!r.ok) return toast(r.error, "error");
    setOpen(false);
    toast("Deletion requested");
    void load();
  }
  async function cancel() {
    const r = await apiFetch(`${base}/deletion`, { method: "DELETE" });
    if (!r.ok) return toast(r.error, "error");
    toast("Deletion cancelled — your workspace stays");
    void load();
  }

  return (
    <Card className="mt-4">
      <CardHeader title="Your data" description="Download everything in your workspace, or ask us to delete it." />
      <CardBody className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-small text-app-muted">JSON file with contacts, conversations, messages, deals, appointments, purchases, loyalty, reviews, templates, campaigns, automations, landing pages and invoices. Passwords, tokens and keys are never included.</p>
          <a href={`${base}/export`} className="inline-flex h-9 shrink-0 items-center gap-2 rounded-lg border border-app-border px-3 text-small font-medium text-app-text hover:bg-app-hover"><Download className="size-4" aria-hidden="true" /> Download export</a>
        </div>
        {req ? (
          <Alert tone="warning" title="Workspace deletion requested">
            Requested on {new Date(req.createdAt).toLocaleDateString("en-IN")}. MECGURA can delete it from {new Date(req.earliestAt).toLocaleDateString("en-IN")}; until then you can cancel.
            <div className="mt-2"><Button size="sm" variant="secondary" onClick={() => void cancel()}>Cancel deletion</Button></div>
          </Alert>
        ) : req === null ? (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-app-border pt-4">
            <p className="text-small text-app-muted">Delete the whole workspace and everything in it. There&apos;s a {days}-day period to change your mind. Download an export first.</p>
            <Button variant="danger" onClick={() => setOpen(true)}><Trash2 aria-hidden="true" /> Request deletion</Button>
          </div>
        ) : null}
      </CardBody>
      <Modal open={open} onClose={() => setOpen(false)} title="Delete this workspace?">
        <div className="space-y-3">
          <Alert tone="danger">All contacts, conversations, campaigns, automations and files will be permanently deleted after {days} days. Users who belong only to this workspace are removed too.</Alert>
          <Field id="del-confirm" label={`Type “${name}” to confirm`}><Input value={confirm} onChange={(e) => setConfirm(e.target.value)} /></Field>
          <Field id="del-reason" label="Why are you leaving? (optional)"><Textarea rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setOpen(false)}>Keep workspace</Button><Button variant="danger" disabled={confirm.trim() !== name} loading={busy} onClick={() => void request()}>Request deletion</Button></div>
        </div>
      </Modal>
    </Card>
  );
}
