"use client";

import * as React from "react";
import Link from "next/link";
import { ClipboardList, FileText, LayoutList, Lock, Paperclip, SendHorizonal, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Alert, Button, Field, IconButton, Input, Modal, Select, useToast } from "@/components/ds";
import { apiFetch } from "@/lib/client-api";
import type { Conversation, Message } from "@/components/inbox/types";
import type { TemplateView } from "@/components/templates/types";
import { WaPreview } from "@/components/templates/wa-preview";

const ACCEPT = "image/jpeg,image/png,video/mp4,video/3gpp,audio/aac,audio/mp4,audio/mpeg,audio/amr,audio/ogg,application/pdf,text/plain,.doc,.docx,.xls,.xlsx,.ppt,.pptx";

export function Composer({
  orgId,
  conversation,
  canReply,
  canNote,
  mustClaim,
  replyTo,
  onClearReply,
  onSent,
}: {
  orgId: string;
  conversation: Conversation;
  canReply: boolean;
  canNote: boolean;
  /** Agent viewing an unassigned/other chat: must take it before replying. */
  mustClaim: boolean;
  replyTo: Message | null;
  onClearReply: () => void;
  onSent: (m: Message) => void;
}) {
  const toast = useToast();
  const [mode, setMode] = React.useState<"reply" | "note">("reply");
  const [text, setText] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [error, setError] = React.useState("");
  const [templateOpen, setTemplateOpen] = React.useState(false);
  const [buttonsOpen, setButtonsOpen] = React.useState(false);
  const [flowOpen, setFlowOpen] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const base = `/api/organizations/${orgId}/inbox/conversations/${conversation.id}`;
  const blocked = conversation.contact.optInStatus === "opted_out";
  const windowClosed = !conversation.windowOpen;
  const replyDisabled = !canReply || mustClaim || blocked || conversation.account.status === "disconnected";

  async function submit() {
    const body = text.trim();
    if (!body) return;
    setSending(true);
    setError("");
    const r =
      mode === "note"
        ? await apiFetch<{ message: Message }>(`${base}/notes`, { method: "POST", body: { body } })
        : await apiFetch<{ message: Message }>(`${base}/messages`, { method: "POST", body: { type: "text", body, ...(replyTo ? { replyToId: replyTo.id } : {}) } });
    setSending(false);
    if (!r.ok) return setError(r.details?.body?.[0] ?? r.error);
    setText("");
    onClearReply();
    onSent(r.data.message);
    if (r.data.message.status === "failed") toast(r.data.message.error || "Message failed to send", "error");
  }

  async function sendFile(file: File) {
    setSending(true);
    setError("");
    const fd = new FormData();
    fd.set("file", file);
    if (text.trim()) fd.set("caption", text.trim());
    if (replyTo) fd.set("replyToId", replyTo.id);
    try {
      const res = await fetch(`${base}/media`, { method: "POST", body: fd });
      const data = (await res.json()) as { message?: Message; error?: string; details?: { file?: string[] } };
      if (!res.ok || !data.message) return setError(data.details?.file?.[0] ?? data.error ?? "Upload failed");
      setText("");
      onClearReply();
      onSent(data.message);
    } catch {
      setError("Network error — the file wasn't sent.");
    } finally {
      setSending(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const reasons = !canReply
    ? "You don't have permission to reply."
    : mustClaim
      ? "Take this chat (Assign → Assign to me) before replying."
      : blocked
        ? "This contact opted out — messages are blocked."
        : conversation.account.status === "disconnected"
          ? "This number is disconnected."
          : null;

  return (
    <div className="border-t border-app-border bg-app-surface p-3">
      <div role="tablist" aria-label="Composer mode" className="mb-2 flex gap-1">
        {(["reply", "note"] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            disabled={m === "note" ? !canNote : false}
            onClick={() => setMode(m)}
            className={cn(
              "rounded-md px-3 py-1 text-small font-medium",
              mode === m ? (m === "note" ? "bg-amber-500/15 text-amber-200" : "bg-app-primary-soft text-app-primary-hover") : "text-app-muted hover:text-app-text"
            )}
          >
            {m === "note" ? (
              <span className="inline-flex items-center gap-1">
                <Lock className="size-3" aria-hidden="true" /> Internal note
              </span>
            ) : (
              "Reply"
            )}
          </button>
        ))}
      </div>

      {mode === "reply" && reasons ? <Alert tone="warning" className="mb-2">{reasons}</Alert> : null}
      {mode === "reply" && !reasons && windowClosed ? (
        <Alert tone="info" className="mb-2">
          The 24-hour customer service window is closed. Only approved templates can be sent until the customer replies.
        </Alert>
      ) : null}
      {error ? <Alert tone="danger" className="mb-2">{error}</Alert> : null}
      {replyTo && mode === "reply" ? (
        <div className="mb-2 flex items-center gap-2 rounded-lg border-l-2 border-app-primary bg-app-bg px-3 py-1.5 text-small">
          <span className="min-w-0 flex-1 truncate text-app-muted">Replying to: {replyTo.body || replyTo.type}</span>
          <IconButton label="Cancel reply" size="sm" onClick={onClearReply}>
            <X aria-hidden="true" />
          </IconButton>
        </div>
      ) : null}

      <div className="flex items-end gap-2">
        {mode === "reply" ? (
          <div className="flex shrink-0 gap-0.5">
            <IconButton label="Attach file" onClick={() => fileRef.current?.click()} disabled={replyDisabled || windowClosed || sending}>
              <Paperclip aria-hidden="true" />
            </IconButton>
            <IconButton label="Send template" onClick={() => setTemplateOpen(true)} disabled={replyDisabled || sending}>
              <FileText aria-hidden="true" />
            </IconButton>
            <IconButton label="Send buttons" onClick={() => setButtonsOpen(true)} disabled={replyDisabled || windowClosed || sending}>
              <LayoutList aria-hidden="true" />
            </IconButton>
            <IconButton label="Send WhatsApp Flow" onClick={() => setFlowOpen(true)} disabled={replyDisabled || windowClosed || sending}>
              <ClipboardList aria-hidden="true" />
            </IconButton>
            <input ref={fileRef} type="file" accept={ACCEPT} className="hidden" onChange={(e) => e.target.files?.[0] && sendFile(e.target.files[0])} aria-hidden="true" tabIndex={-1} />
          </div>
        ) : null}
        <label htmlFor="composer-text" className="sr-only">
          {mode === "note" ? "Internal note" : "Message"}
        </label>
        <textarea
          id="composer-text"
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void submit();
            }
          }}
          disabled={mode === "reply" ? replyDisabled || windowClosed : !canNote}
          placeholder={mode === "note" ? "Write a note only your team can see…" : windowClosed ? "Window closed — send a template" : "Type a message…  (Enter to send, Shift+Enter for a new line)"}
          className={cn(
            "app-scroll max-h-40 min-h-10 flex-1 resize-none rounded-[var(--radius-control)] border bg-app-bg px-3 py-2 text-body text-app-text placeholder:text-app-subtle focus:outline-none disabled:opacity-50",
            mode === "note" ? "border-amber-500/40 focus:border-amber-400" : "border-app-border focus:border-app-primary/70"
          )}
        />
        <Button onClick={submit} loading={sending} disabled={!text.trim() || (mode === "reply" ? replyDisabled || windowClosed : !canNote)} aria-label={mode === "note" ? "Add internal note" : "Send message"}>
          <SendHorizonal aria-hidden="true" />
          <span className="hidden sm:inline">{mode === "note" ? "Add note" : "Send"}</span>
        </Button>
      </div>

      <TemplateModal open={templateOpen} onClose={() => setTemplateOpen(false)} url={`${base}/messages`} orgId={orgId} accountId={conversation.account.id} onSent={(m) => { setTemplateOpen(false); onSent(m); }} />
      <FlowModal open={flowOpen} onClose={() => setFlowOpen(false)} url={`${base}/messages`} orgId={orgId} accountId={conversation.account.id} onSent={(m) => { setFlowOpen(false); onSent(m); }} />
      <ButtonsModal open={buttonsOpen} onClose={() => setButtonsOpen(false)} url={`${base}/messages`} onSent={(m) => { setButtonsOpen(false); onSent(m); }} />
    </div>
  );
}

function TemplateModal({ open, onClose, url, orgId, accountId, onSent }: { open: boolean; onClose: () => void; url: string; orgId: string; accountId: string; onSent: (m: Message) => void }) {
  const [list, setList] = React.useState<TemplateView[] | null>(null);
  const [loadError, setLoadError] = React.useState("");
  const [id, setId] = React.useState("");
  const [values, setValues] = React.useState<Record<string, string>>({});
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    let alive = true;
    void apiFetch<{ templates: TemplateView[] }>(`/api/organizations/${orgId}/templates?status=approved`).then((r) => {
      if (!alive) return;
      if (!r.ok) return setLoadError(r.error);
      // Only templates on this conversation's WhatsApp account can be sent from it.
      const usable = r.data.templates.filter((t) => t.waba.numbers.some((n) => n.id === accountId));
      setList(usable);
      setId((cur) => cur || usable[0]?.id || "");
    });
    return () => {
      alive = false;
    };
  }, [open, orgId, accountId]);

  const t = list?.find((x) => x.id === id);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!t) return;
    setSaving(true);
    const r = await apiFetch<{ message: Message }>(url, { method: "POST", body: { type: "template", templateId: t.id, values } });
    setSaving(false);
    if (!r.ok) return setErrors({ ...Object.fromEntries(Object.entries(r.details ?? {}).map(([k, v]) => [k.replace(/^values\./, ""), v?.[0] ?? ""])), form: r.details ? "" : r.error });
    setErrors({});
    setValues({});
    onSent(r.data.message);
  }
  return (
    <Modal open={open} onClose={onClose} title="Send a template" description="Approved templates can start or restart a conversation, even after the 24-hour window." size="lg">
      {loadError ? (
        <Alert tone="danger">{loadError}</Alert>
      ) : !list ? (
        <p className="text-small text-app-muted">Loading templates…</p>
      ) : !list.length ? (
        <Alert tone="info" title="No approved templates for this number">
          Create one in <Link href="/templates" className="underline">Templates</Link> and get it approved first.
        </Alert>
      ) : (
        <form onSubmit={submit} noValidate className="grid gap-4 md:grid-cols-[minmax(0,1fr)_18rem]">
          <div className="min-w-0 space-y-4">
            {errors.form ? <Alert tone="danger">{errors.form}</Alert> : null}
            <Field id="tpl-pick" label="Template">
              <Select value={id} onChange={(e) => { setId(e.target.value); setValues({}); setErrors({}); }}>
                {list.map((x) => (
                  <option key={x.id} value={x.id}>{x.name} · {x.language} · {x.category.toLowerCase()}</option>
                ))}
              </Select>
            </Field>
            {t?.slots.map((s) => (
              <Field key={s.key} id={`tpl-v-${s.key}`} label={s.label} error={errors[s.key]}>
                <Input value={values[s.key] ?? ""} onChange={(e) => setValues((v) => ({ ...v, [s.key]: e.target.value }))} placeholder={s.part === "header" && s.kind === "media" ? "https://…" : ""} />
              </Field>
            ))}
            {t && !t.slots.length ? <p className="text-small text-app-muted">This template has no variables.</p> : null}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={onClose}>Cancel</Button>
              <Button type="submit" loading={saving} disabled={!t}>Send template</Button>
            </div>
          </div>
          {t ? <WaPreview t={t} values={values} /> : null}
        </form>
      )}
    </Modal>
  );
}

function ButtonsModal({ open, onClose, url, onSent }: { open: boolean; onClose: () => void; url: string; onSent: (m: Message) => void }) {
  const [body, setBody] = React.useState("");
  const [buttons, setButtons] = React.useState(["", "", ""]);
  const [error, setError] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const list = buttons.map((t) => t.trim()).filter(Boolean).map((title, i) => ({ id: `btn_${i + 1}`, title }));
    setSaving(true);
    const r = await apiFetch<{ message: Message }>(url, { method: "POST", body: { type: "interactive", body, buttons: list } });
    setSaving(false);
    if (!r.ok) return setError(Object.values(r.details ?? {})[0]?.[0] ?? r.error);
    setError("");
    setBody("");
    setButtons(["", "", ""]);
    onSent(r.data.message);
  }
  return (
    <Modal open={open} onClose={onClose} title="Send quick-reply buttons" description="Up to 3 buttons, 20 characters each.">
      <form onSubmit={submit} noValidate className="space-y-4">
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <Field id="btn-body" label="Message">
          <Input value={body} onChange={(e) => setBody(e.target.value)} placeholder="How can we help you today?" />
        </Field>
        {buttons.map((b, i) => (
          <Field key={i} id={`btn-${i}`} label={`Button ${i + 1}${i ? " (optional)" : ""}`}>
            <Input value={b} maxLength={20} onChange={(e) => setButtons((xs) => xs.map((x, j) => (j === i ? e.target.value : x)))} placeholder={["View Pricing", "Book Demo", "Talk to Human"][i]} />
          </Field>
        ))}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={saving} disabled={!body.trim() || !buttons[0].trim()}>Send buttons</Button>
        </div>
      </form>
    </Modal>
  );
}

type FlowOption = { id: string; name: string; wabaId: string | null; definition: { start: { body: string; cta: string } } };

function FlowModal({ open, onClose, url, orgId, accountId, onSent }: { open: boolean; onClose: () => void; url: string; orgId: string; accountId: string; onSent: (m: Message) => void }) {
  const [list, setList] = React.useState<FlowOption[] | null>(null);
  const [loadError, setLoadError] = React.useState("");
  const [id, setId] = React.useState("");
  const [body, setBody] = React.useState("");
  const [error, setError] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  React.useEffect(() => {
    if (!open) return;
    let alive = true;
    void apiFetch<{ flows: FlowOption[]; accounts: { id: string; accounts: { id: string }[] }[] }>(`/api/organizations/${orgId}/flows?status=published`).then((r) => {
      if (!alive) return;
      if (!r.ok) return setLoadError(r.error);
      // A Flow can only be sent from a number on the WhatsApp account it was published to.
      const waba = r.data.accounts.find((w) => w.accounts.some((a) => a.id === accountId));
      const usable = waba ? r.data.flows.filter((f) => f.wabaId === waba.id) : [];
      setList(usable);
      setId((cur) => cur || usable[0]?.id || "");
    });
    return () => {
      alive = false;
    };
  }, [open, orgId, accountId]);
  const f = list?.find((x) => x.id === id);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!f) return;
    setSaving(true);
    const r = await apiFetch<{ message: Message }>(url, { method: "POST", body: { type: "flow", flowId: f.id, ...(body.trim() ? { body: body.trim() } : {}) } });
    setSaving(false);
    if (!r.ok) return setError(Object.values(r.details ?? {})[0]?.[0] ?? r.error);
    setError("");
    setBody("");
    onSent(r.data.message);
  }
  return (
    <Modal open={open} onClose={onClose} title="Send a WhatsApp Flow" description="The customer opens the form inside WhatsApp; their answers update this contact.">
      {loadError ? (
        <Alert tone="danger">{loadError}</Alert>
      ) : !list ? (
        <p className="text-small text-app-muted">Loading flows…</p>
      ) : !list.length ? (
        <Alert tone="info" title="No published flows for this number">
          Build and publish one in <Link href="/flows" className="underline">Flows</Link>.
        </Alert>
      ) : (
        <form onSubmit={submit} noValidate className="space-y-4">
          {error ? <Alert tone="danger">{error}</Alert> : null}
          <Field id="flow-pick" label="Flow">
            <Select value={id} onChange={(e) => setId(e.target.value)}>
              {list.map((x) => (
                <option key={x.id} value={x.id}>{x.name}</option>
              ))}
            </Select>
          </Field>
          <Field id="flow-body" label="Message (optional)" hint={f ? `Default: “${f.definition.start.body}” · Button: ${f.definition.start.cta}` : undefined}>
            <Input value={body} onChange={(e) => setBody(e.target.value)} maxLength={1024} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button type="submit" loading={saving} disabled={!f}>Send flow</Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
