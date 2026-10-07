"use client";

import * as React from "react";
import Link from "next/link";
import { Plus, Workflow, X } from "lucide-react";
import { Alert, Avatar, Badge, Button, EmptyState, ErrorState, Input, LoadingState, Select, Textarea, useToast } from "@/components/ds";
import { apiFetch } from "@/lib/client-api";
import { dayFmt, type TeamMember } from "@/components/inbox/types";

type Detail = {
  contact: {
    id: string;
    name: string;
    phone: string;
    email: string;
    lifecycle: string;
    leadStatus: string;
    source: string;
    owner: { id: string; name: string } | null;
    optInStatus: string;
    suppressed: boolean;
    customFields: Record<string, string>;
    tags: { id: string; name: string }[];
  };
  notes: { id: string; body: string; createdAt: string; author: string }[];
  consents: { id: string; status: string; source: string; createdAt: string }[];
  conversations: { id: string; status: string; lastMessageAt: string; lastMessagePreview: string; account: string }[];
};

export const LEAD_STATUSES = ["new", "contacted", "qualified", "proposal", "won", "lost"];
const CONSENT_LABEL: Record<string, { label: string; tone: "success" | "danger" | "neutral" }> = {
  opted_in: { label: "Opted in", tone: "success" },
  opted_out: { label: "Opted out", tone: "danger" },
  unknown: { label: "No consent recorded", tone: "neutral" },
};

function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="border-b border-app-border px-4 py-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-caption font-semibold uppercase tracking-wider text-app-subtle">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

export function CustomerPanel({
  orgId,
  contactId,
  currentConversationId,
  team,
  canWrite,
  refreshKey,
}: {
  orgId: string;
  contactId: string;
  currentConversationId?: string;
  team: TeamMember[];
  canWrite: boolean;
  refreshKey: number;
}) {
  const toast = useToast();
  const [d, setD] = React.useState<Detail | null>(null);
  const [error, setError] = React.useState("");
  const [tagInput, setTagInput] = React.useState("");
  const [note, setNote] = React.useState("");
  const [field, setField] = React.useState({ key: "", value: "" });
  const [busy, setBusy] = React.useState(false);
  const base = `/api/organizations/${orgId}/contacts/${contactId}`;

  const load = React.useCallback(async () => {
    const r = await apiFetch<Detail>(base);
    if (!r.ok) return setError(r.error);
    setError("");
    setD(r.data);
  }, [base]);

  React.useEffect(() => {
    // Initial load + reload when realtime reports a change (external data sync).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load, refreshKey]);

  async function patch(body: Record<string, unknown>, ok = "Saved") {
    setBusy(true);
    const r = await apiFetch(base, { method: "PATCH", body });
    setBusy(false);
    if (!r.ok) return toast(Object.values(r.details ?? {})[0]?.[0] ?? r.error, "error");
    toast(ok);
    void load();
  }
  async function saveTags(tags: string[]) {
    const r = await apiFetch(`${base}/tags`, { method: "PUT", body: { tags } });
    if (!r.ok) return toast(r.error, "error");
    void load();
  }
  async function addNote() {
    if (!note.trim()) return;
    const r = await apiFetch(`${base}/notes`, { method: "POST", body: { body: note } });
    if (!r.ok) return toast(r.error, "error");
    setNote("");
    void load();
  }

  if (error) return <ErrorState description={error} onRetry={load} />;
  if (!d) return <LoadingState />;
  const c = d.contact;
  const consent = CONSENT_LABEL[c.optInStatus] ?? CONSENT_LABEL.unknown;

  return (
    <div className="app-scroll h-full overflow-y-auto">
      <div className="flex flex-col items-center gap-2 border-b border-app-border px-4 py-5 text-center">
        <Avatar name={c.name || c.phone} size="lg" />
        <div className="min-w-0">
          <p className="truncate text-h3 text-app-text">{c.name || "Unknown"}</p>
          <p className="font-mono text-small text-app-muted">{c.phone}</p>
          {c.email ? <p className="truncate text-small text-app-muted">{c.email}</p> : null}
        </div>
        <div className="flex flex-wrap justify-center gap-1">
          <Badge tone={consent.tone} dot>{consent.label}</Badge>
          {c.suppressed ? <Badge tone="danger">Suppressed</Badge> : null}
        </div>
        <Link href={`/contacts/${c.id}`} className="text-small text-app-primary hover:text-app-primary-hover">
          Open full profile
        </Link>
      </div>

      <Section title="Tags">
        <div className="flex flex-wrap gap-1.5">
          {c.tags.map((t) => (
            <Badge key={t.id} tone="primary" className="pr-1">
              {t.name}
              {canWrite ? (
                <button type="button" aria-label={`Remove tag ${t.name}`} onClick={() => saveTags(c.tags.filter((x) => x.id !== t.id).map((x) => x.name))} className="rounded-full p-0.5 hover:bg-app-primary/20">
                  <X className="size-3" aria-hidden="true" />
                </button>
              ) : null}
            </Badge>
          ))}
          {!c.tags.length ? <span className="text-small text-app-subtle">No tags</span> : null}
        </div>
        {canWrite ? (
          <form
            className="mt-2 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (tagInput.trim()) void saveTags([...c.tags.map((t) => t.name), tagInput.trim()]);
              setTagInput("");
            }}
          >
            <Input aria-label="Add tag" value={tagInput} onChange={(e) => setTagInput(e.target.value)} placeholder="Add tag…" className="h-8 text-small" maxLength={40} />
            <Button type="submit" size="sm" variant="secondary" aria-label="Add tag">
              <Plus aria-hidden="true" />
            </Button>
          </form>
        ) : null}
      </Section>

      <Section title="Lead">
        <div className="grid gap-2">
          <label className="text-caption text-app-muted" htmlFor="cp-status">Lead status</label>
          <Select id="cp-status" value={c.leadStatus} disabled={!canWrite || busy} onChange={(e) => patch({ leadStatus: e.target.value }, "Lead status updated")} className="h-9 text-small capitalize">
            {LEAD_STATUSES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </Select>
          <label className="text-caption text-app-muted" htmlFor="cp-life">Type</label>
          <Select id="cp-life" value={c.lifecycle} disabled={!canWrite || busy} onChange={(e) => patch({ lifecycle: e.target.value }, "Updated")} className="h-9 text-small">
            <option value="lead">Lead</option>
            <option value="customer">Customer</option>
          </Select>
          <label className="text-caption text-app-muted" htmlFor="cp-owner">Assigned agent (contact owner)</label>
          <Select id="cp-owner" value={c.owner?.id ?? ""} disabled={!canWrite || busy} onChange={(e) => patch({ ownerUserId: e.target.value || null }, "Agent updated")} className="h-9 text-small">
            <option value="">Unassigned</option>
            {team.map((m) => (
              <option key={m.userId} value={m.userId}>{m.name}</option>
            ))}
          </Select>
          <p className="text-caption text-app-muted">Source: <span className="capitalize text-app-text">{c.source}</span></p>
        </div>
      </Section>

      <Section title="Custom fields">
        <dl className="space-y-1.5">
          {Object.entries(c.customFields).map(([k, v]) => (
            <div key={k} className="flex items-start justify-between gap-2 text-small">
              <dt className="text-app-muted">{k}</dt>
              <dd className="flex min-w-0 items-center gap-1 text-right text-app-text">
                <span className="truncate">{v}</span>
                {canWrite ? (
                  <button
                    type="button"
                    aria-label={`Remove field ${k}`}
                    onClick={() => {
                      const next = { ...c.customFields };
                      delete next[k];
                      void patch({ customFields: next }, "Field removed");
                    }}
                    className="text-app-subtle hover:text-app-text"
                  >
                    <X className="size-3" aria-hidden="true" />
                  </button>
                ) : null}
              </dd>
            </div>
          ))}
          {!Object.keys(c.customFields).length ? <p className="text-small text-app-subtle">None</p> : null}
        </dl>
        {canWrite ? (
          <form
            className="mt-2 grid grid-cols-[1fr_1fr_auto] gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!field.key.trim()) return;
              void patch({ customFields: { ...c.customFields, [field.key.trim()]: field.value } }, "Field saved");
              setField({ key: "", value: "" });
            }}
          >
            <Input aria-label="Field name" placeholder="Field" value={field.key} onChange={(e) => setField((f) => ({ ...f, key: e.target.value }))} className="h-8 text-small" maxLength={40} />
            <Input aria-label="Field value" placeholder="Value" value={field.value} onChange={(e) => setField((f) => ({ ...f, value: e.target.value }))} className="h-8 text-small" maxLength={500} />
            <Button type="submit" size="sm" variant="secondary" aria-label="Save field">
              <Plus aria-hidden="true" />
            </Button>
          </form>
        ) : null}
      </Section>

      <Section title="Notes">
        {canWrite ? (
          <div className="mb-3 space-y-2">
            <Textarea aria-label="New contact note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note about this customer…" className="min-h-16 text-small" />
            <Button size="sm" variant="secondary" onClick={addNote} disabled={!note.trim()}>Save note</Button>
          </div>
        ) : null}
        <ul className="space-y-2">
          {d.notes.map((n) => (
            <li key={n.id} className="rounded-lg bg-app-bg px-3 py-2 text-small">
              <p className="whitespace-pre-wrap text-app-text">{n.body}</p>
              <p className="mt-1 text-caption text-app-subtle">{n.author} · {dayFmt.format(new Date(n.createdAt))}</p>
            </li>
          ))}
          {!d.notes.length ? <li className="text-small text-app-subtle">No notes yet</li> : null}
        </ul>
      </Section>

      <Section title="Conversation history">
        <ul className="space-y-1.5">
          {d.conversations.map((cv) => (
            <li key={cv.id}>
              <Link href={`/inbox?c=${cv.id}`} className={`block rounded-lg px-2 py-1.5 text-small hover:bg-app-hover ${cv.id === currentConversationId ? "bg-app-hover" : ""}`}>
                <span className="flex justify-between gap-2">
                  <span className="truncate text-app-text">{cv.account}</span>
                  <span className="shrink-0 text-caption text-app-subtle">{dayFmt.format(new Date(cv.lastMessageAt))}</span>
                </span>
                <span className="block truncate text-caption text-app-muted">{cv.lastMessagePreview || "—"} · {cv.status}</span>
              </Link>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Automation history">
        <EmptyState icon={Workflow} title="No automations yet" description="Automation runs will be listed here once Automations launch." className="py-4" />
      </Section>

      {d.consents.length ? (
        <Section title="Consent log">
          <ul className="space-y-1 text-caption text-app-muted">
            {d.consents.slice(0, 5).map((r) => (
              <li key={r.id}>
                {r.status === "opted_in" ? "Opted in" : "Opted out"} · {r.source.replace("_", " ")} · {dayFmt.format(new Date(r.createdAt))}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
      {!canWrite ? <Alert tone="info" className="m-4">View only</Alert> : null}
    </div>
  );
}
