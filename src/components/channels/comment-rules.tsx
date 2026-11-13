"use client";

import * as React from "react";
import { Trash2 } from "lucide-react";
import { Alert, Badge, Button, Card, CardBody, CardHeader, Field, Input, Modal, Select, useToast } from "@/components/ds";
import { apiFetch } from "@/lib/client-api";

type Rule = { id: string; channelAccountId: string; name: string; keywords: string[]; dmText: string; publicReply: string; status: "active" | "paused"; repliesCount: number; lastReplyAt: string | null };
type Data = { rules: Rule[]; accounts: { id: string; name: string; status: string }[]; recent: { id: string; fromUsername: string; text: string; status: string; error: string; createdAt: string }[] };
const blank = { channelAccountId: "", name: "", keywords: "", dmText: "", publicReply: "" };

/** Instagram "comment a word, get a DM" rules. */
export function CommentRules({ orgId, canManage }: { orgId: string; canManage: boolean }) {
  const base = `/api/organizations/${orgId}/comment-rules`;
  const toast = useToast();
  const [data, setData] = React.useState<Data | null>(null);
  const [edit, setEdit] = React.useState<(typeof blank & { id?: string }) | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [err, setErr] = React.useState("");

  const load = React.useCallback(async () => {
    const r = await apiFetch<Data>(base);
    if (r.ok) setData(r.data);
  }, [base]);
  React.useEffect(() => {
    const id = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(id);
  }, [load]);

  if (!data) return null;
  const body = (f: typeof blank, status: Rule["status"] = "active") => ({ channelAccountId: f.channelAccountId, name: f.name, keywords: f.keywords.split(",").map((k) => k.trim()).filter(Boolean), dmText: f.dmText, publicReply: f.publicReply, status });

  async function save() {
    if (!edit) return;
    setSaving(true);
    setErr("");
    const current = data?.rules.find((r) => r.id === edit.id);
    const r = edit.id ? await apiFetch(`${base}/${edit.id}`, { method: "PUT", body: body(edit, current?.status) }) : await apiFetch(base, { method: "POST", body: body(edit) });
    setSaving(false);
    if (!r.ok) return setErr(r.details ? Object.values(r.details).flat().join(" ") || r.error : r.error);
    setEdit(null);
    toast("Rule saved");
    void load();
  }
  async function toggle(rule: Rule) {
    const r = await apiFetch(`${base}/${rule.id}`, { method: "PUT", body: { ...rule, status: rule.status === "active" ? "paused" : "active" } });
    if (!r.ok) return toast(r.error, "error");
    void load();
  }
  async function remove(rule: Rule) {
    if (!window.confirm(`Delete “${rule.name}”?`)) return;
    const r = await apiFetch(`${base}/${rule.id}`, { method: "DELETE" });
    if (!r.ok) return toast(r.error, "error");
    void load();
  }

  return (
    <Card className="mt-4">
      <CardHeader
        title="Instagram comment replies"
        description="When someone comments a word like PRICE on your post or reel, they get a private message straight away."
        action={canManage && data.accounts.length ? <Button size="sm" onClick={() => setEdit({ ...blank, channelAccountId: data.accounts[0].id })}>Add a rule</Button> : null}
      />
      <CardBody>
        {!data.accounts.length ? (
          <Alert tone="info">Add an Instagram inbox above first. Then you can set up comment replies here.</Alert>
        ) : !data.rules.length ? (
          <p className="text-small text-app-muted">No rules yet. Example: comment “price” → “Hi {"{{name}}"}, here is our price list: https://… Reply here if you want to book.”</p>
        ) : (
          <ul className="divide-y divide-app-border">
            {data.rules.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-app-text">
                    {r.name} <Badge tone={r.status === "active" ? "success" : "neutral"}>{r.status === "active" ? "On" : "Paused"}</Badge>
                  </p>
                  <p className="truncate text-small text-app-muted">{r.keywords.length ? `Words: ${r.keywords.join(", ")}` : "Every comment"} · {r.repliesCount} sent</p>
                </div>
                {canManage ? (
                  <>
                    <Button size="sm" variant="secondary" onClick={() => toggle(r)}>{r.status === "active" ? "Pause" : "Turn on"}</Button>
                    <Button size="sm" variant="secondary" onClick={() => setEdit({ id: r.id, channelAccountId: r.channelAccountId, name: r.name, keywords: r.keywords.join(", "), dmText: r.dmText, publicReply: r.publicReply })}>Edit</Button>
                    <button type="button" aria-label={`Delete ${r.name}`} onClick={() => remove(r)} className="rounded p-2 text-app-muted hover:bg-app-hover hover:text-red-300">
                      <Trash2 className="size-4" aria-hidden="true" />
                    </button>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {data.recent.some((x) => x.status === "failed") ? <Alert tone="warning" className="mt-3">Some replies could not be sent. Latest reason: {data.recent.find((x) => x.status === "failed")?.error}</Alert> : null}
        <p className="mt-3 text-caption text-app-subtle">
          Needs the Instagram webhook field <strong>comments</strong> in your Meta app, and Meta&apos;s approval for comment access on accounts outside your own app. Instagram allows one private message per comment.
        </p>
      </CardBody>
      <Modal open={Boolean(edit)} onClose={() => setEdit(null)} title={edit?.id ? "Edit rule" : "New comment rule"}>
        {edit ? (
          <div className="space-y-3">
            <Field id="cr-account" label="Instagram account">
              <Select value={edit.channelAccountId} onChange={(e) => setEdit({ ...edit, channelAccountId: e.target.value })}>
                {data.accounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </Select>
            </Field>
            <Field id="cr-name" label="Rule name">
              <Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="Price list" />
            </Field>
            <Field id="cr-words" label="Words to look for" hint="Separate with commas. Leave empty to answer every comment.">
              <Input value={edit.keywords} onChange={(e) => setEdit({ ...edit, keywords: e.target.value })} placeholder="price, rate, kitna" />
            </Field>
            <Field id="cr-dm" label="Private message" hint="{{name}} becomes their @username.">
              <textarea value={edit.dmText} onChange={(e) => setEdit({ ...edit, dmText: e.target.value })} rows={4} maxLength={900} className="w-full rounded-md border border-app-border bg-app-surface p-2 text-small text-app-text" placeholder="Hi {{name}}, thanks for asking! Our price list: https://… Reply here to book." />
            </Field>
            <Field id="cr-public" label="Public reply under the comment (optional)">
              <Input value={edit.publicReply} onChange={(e) => setEdit({ ...edit, publicReply: e.target.value })} placeholder="Sent you a DM!" maxLength={280} />
            </Field>
            {err ? <Alert tone="danger">{err}</Alert> : null}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setEdit(null)}>Cancel</Button>
              <Button onClick={save} loading={saving} disabled={!edit.name || !edit.dmText}>Save rule</Button>
            </div>
          </div>
        ) : null}
      </Modal>
    </Card>
  );
}
