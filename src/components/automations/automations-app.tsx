"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BarChart3, Copy, ListChecks, Lock, MoreHorizontal, Pause, Pencil, Play, Plus, ShieldCheck, Sparkles, Trash2, Workflow } from "lucide-react";
import {
  Alert,
  Badge,
  Button,
  Card,
  ConfirmationDialog,
  Dropdown,
  DropdownItem,
  DropdownSeparator,
  EmptyState,
  ErrorState,
  Field,
  FilterBar,
  Input,
  LoadingState,
  Modal,
  PageHeader,
  SearchBar,
  Select,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Tabs,
  Textarea,
  useToast,
} from "@/components/ds";
import { apiFetch } from "@/lib/client-api";
import { formatNumber } from "@/lib/catalog";
import { TRIGGER_LABELS, type TriggerType } from "@/lib/automations";
import { useRealtime } from "@/components/inbox/use-realtime";
import { istFmt } from "@/components/campaigns/types";
import { AUTO_STATUS } from "@/components/automations/meta";

type Account = { id: string; displayName: string; phoneNumber: string; isDemo: boolean };
type Item = {
  id: string;
  name: string;
  description: string;
  status: string;
  triggerType: string;
  currentVersion: number;
  published: boolean;
  steps: number;
  lastRunAt: string | null;
  updatedAt: string;
  stats: { runs30: number; completed30: number; failed30: number; active: number };
};

const TABS = ["all", "active", "inactive", "draft"];

export function AutomationsApp({ orgId, canManage, accounts, activeAccountId = "" }: { orgId: string; canManage: boolean; accounts: Account[]; activeAccountId?: string }) {
  const router = useRouter();
  const toast = useToast();
  const [tab, setTab] = React.useState("all");
  const [q, setQ] = React.useState("");
  const [data, setData] = React.useState<{ automations: Item[]; counts: Record<string, number> } | null>(null);
  const [error, setError] = React.useState("");
  const [newOpen, setNewOpen] = React.useState(false);
  const [del, setDel] = React.useState<Item | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [approvalsOpen, setApprovalsOpen] = React.useState(false);
  const [approvalCount, setApprovalCount] = React.useState(0);
  const base = `/api/organizations/${orgId}/automations`;
  const loadApprovals = React.useCallback(async () => {
    const r = await apiFetch<{ approvals: Approval[] }>(`${base}/approvals`);
    if (r.ok) setApprovalCount(r.data.approvals.filter((a) => a.canDecide).length);
  }, [base]);
  React.useEffect(() => {
    const t = window.setTimeout(() => {
      void loadApprovals();
      if (new URLSearchParams(window.location.search).get("approvals")) setApprovalsOpen(true);
    }, 0);
    return () => window.clearTimeout(t);
  }, [loadApprovals]);
  const qs = new URLSearchParams({ status: tab === "all" ? "" : tab, q }).toString();

  const load = React.useCallback(async () => {
    const r = await apiFetch<{ automations: Item[]; counts: Record<string, number> }>(`${base}?${qs}`);
    if (!r.ok) return setError(r.error);
    setError("");
    setData(r.data);
  }, [base, qs]);
  React.useEffect(() => {
    const t = window.setTimeout(() => void load(), 200);
    return () => window.clearTimeout(t);
  }, [load]);
  const pending = React.useRef<number | null>(null);
  useRealtime(
    orgId,
    (e) => {
      if (e.type !== "automation.updated" || pending.current) return;
      pending.current = window.setTimeout(() => {
        pending.current = null;
        void load();
      }, 2000);
    },
    load
  );

  async function act(a: Item, kind: "activate" | "deactivate" | "duplicate") {
    const r =
      kind === "duplicate"
        ? await apiFetch<{ automation: { id: string } }>(`${base}/${a.id}/duplicate`, { method: "POST" })
        : await apiFetch(`${base}/${a.id}/status`, { method: "POST", body: { action: kind } });
    if (!r.ok) return toast(r.error, "error");
    toast(kind === "duplicate" ? "Copy created" : kind === "activate" ? "Automation activated" : "Automation deactivated");
    if (kind === "duplicate") router.push(`/automations/${(r.data as { automation: { id: string } }).automation.id}`);
    else void load();
  }
  async function remove() {
    if (!del) return;
    setBusy(true);
    const r = await apiFetch(`${base}/${del.id}`, { method: "DELETE" });
    setBusy(false);
    setDel(null);
    if (!r.ok) return toast(r.error, "error");
    toast("Automation deleted");
    void load();
  }

  return (
    <>
      <PageHeader
        title="Automations"
        description="Visual workflows that reply, tag, route and follow up — automatically and within WhatsApp's rules."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setApprovalsOpen(true)}>
              <ShieldCheck aria-hidden="true" /> Approvals{approvalCount ? <Badge tone="warning">{approvalCount}</Badge> : null}
            </Button>
            {canManage ? (
              <>
                <Button variant="secondary" onClick={() => setNewOpen(true)}>
                  <Plus aria-hidden="true" /> Create automation
                </Button>
                <Button onClick={() => router.push("/automations/easy")}>
                  <Sparkles aria-hidden="true" /> Easy setup
                </Button>
              </>
            ) : null}
          </div>
        }
      />
      {!accounts.length ? (
        <Alert tone="info" className="mb-4" title="Connect a WhatsApp number to send messages">
          You can build automations now; message steps need a <Link href="/whatsapp/connect" className="underline">connected or demo number</Link>.
        </Alert>
      ) : null}
      <Card>
        <Tabs label="Automation status" items={TABS.map((t) => ({ id: t, label: `${t === "all" ? "All" : AUTO_STATUS[t].label} ${data?.counts[t] ?? ""}`.trim() }))} value={tab} onValueChange={setTab} className="px-2" />
        <FilterBar>
          <SearchBar label="Search automations" placeholder="Search by name…" value={q} onChange={(e) => setQ(e.target.value)} className="sm:w-72" />
        </FilterBar>
        {error ? (
          <ErrorState description={error} onRetry={load} />
        ) : !data ? (
          <LoadingState />
        ) : !data.automations.length ? (
          <EmptyState
            icon={Workflow}
            title={q || tab !== "all" ? "No automations match" : "No automations yet"}
            description="Start from the ready-made welcome flow or a blank canvas."
            action={canManage ? <Button onClick={() => router.push("/automations/easy")}><Sparkles aria-hidden="true" /> Easy setup</Button> : undefined}
          />
        ) : (
          <Table caption="Automations" className="min-w-[820px]">
            <THead>
              <tr>
                <TH>Automation</TH>
                <TH>Trigger</TH>
                <TH>Status</TH>
                <TH className="text-right">Runs (30 d)</TH>
                <TH className="text-right">Completed</TH>
                <TH className="text-right">Failed</TH>
                <TH>Last run</TH>
                <TH className="w-12"><span className="sr-only">Actions</span></TH>
              </tr>
            </THead>
            <TBody>
              {data.automations.map((a) => (
                <TR key={a.id}>
                  <TD>
                    <Link href={`/automations/${a.id}`} className="font-medium hover:text-app-primary-hover">{a.name}</Link>
                    <p className="text-caption text-app-subtle">{a.steps} steps · {a.published ? `v${a.currentVersion} live` : "not published"}</p>
                  </TD>
                  <TD className="text-small">{TRIGGER_LABELS[a.triggerType as TriggerType] ?? "—"}</TD>
                  <TD>
                    <span className="flex flex-wrap gap-1">
                      <Badge tone={AUTO_STATUS[a.status]?.tone ?? "neutral"} dot>{AUTO_STATUS[a.status]?.label ?? a.status}</Badge>
                      {a.stats.active ? <Badge tone="info">{a.stats.active} running</Badge> : null}
                    </span>
                  </TD>
                  <TD className="text-right tabular-nums">{formatNumber(a.stats.runs30)}</TD>
                  <TD className="text-right tabular-nums">{formatNumber(a.stats.completed30)}</TD>
                  <TD className="text-right tabular-nums">{a.stats.failed30 ? <span className="text-red-300">{formatNumber(a.stats.failed30)}</span> : "0"}</TD>
                  <TD className="whitespace-nowrap text-small text-app-muted">{a.lastRunAt ? istFmt.format(new Date(a.lastRunAt)) : "Never"}</TD>
                  <TD>
                    <Dropdown label={`Actions for ${a.name}`} trigger={<span className="flex size-8 items-center justify-center"><MoreHorizontal className="size-4" aria-hidden="true" /></span>}>
                      {(close) => (
                        <>
                          <DropdownItem icon={<Pencil className="size-4" aria-hidden="true" />} onClick={() => { close(); router.push(`/automations/${a.id}`); }}>
                            {canManage ? "Edit" : "Open"}
                          </DropdownItem>
                          <DropdownItem icon={<ListChecks className="size-4" aria-hidden="true" />} onClick={() => { close(); router.push(`/automations/${a.id}?tab=logs`); }}>
                            View logs
                          </DropdownItem>
                          <DropdownItem icon={<BarChart3 className="size-4" aria-hidden="true" />} onClick={() => { close(); router.push(`/automations/${a.id}?tab=analytics`); }}>
                            Analytics
                          </DropdownItem>
                          {canManage ? (
                            <>
                              <DropdownSeparator />
                              {a.status === "active" ? (
                                <DropdownItem icon={<Pause className="size-4" aria-hidden="true" />} onClick={() => { close(); void act(a, "deactivate"); }}>
                                  Deactivate
                                </DropdownItem>
                              ) : (
                                <DropdownItem icon={<Play className="size-4" aria-hidden="true" />} disabled={!a.published} onClick={() => { close(); void act(a, "activate"); }}>
                                  {a.published ? "Activate" : "Activate (publish first)"}
                                </DropdownItem>
                              )}
                              <DropdownItem icon={<Copy className="size-4" aria-hidden="true" />} onClick={() => { close(); void act(a, "duplicate"); }}>
                                Duplicate
                              </DropdownItem>
                              <DropdownItem tone="danger" icon={<Trash2 className="size-4" aria-hidden="true" />} onClick={() => { close(); setDel(a); }}>
                                Delete
                              </DropdownItem>
                            </>
                          ) : null}
                        </>
                      )}
                    </Dropdown>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
      <NewAutomationModal open={newOpen} onClose={() => setNewOpen(false)} base={base} accounts={accounts} activeAccountId={activeAccountId} />
      {approvalsOpen ? <ApprovalsModal base={base} onClose={() => setApprovalsOpen(false)} onChanged={() => void loadApprovals()} /> : null}
      <ConfirmationDialog
        open={Boolean(del)}
        onClose={() => setDel(null)}
        onConfirm={remove}
        loading={busy}
        title="Delete automation?"
        description={`“${del?.name}” and its run history will be deleted. Runs in progress stop. This can't be undone.`}
        confirmLabel="Delete"
      />
    </>
  );
}

type LibraryItem = { id: string; name: string; description: string; steps: string[]; premium: boolean; locked: boolean; nodes: number };

function NewAutomationModal({ open, onClose, base, accounts, activeAccountId }: { open: boolean; onClose: () => void; base: string; accounts: Account[]; activeAccountId: string }) {
  const router = useRouter();
  const [f, setF] = React.useState({ name: "", description: "", whatsappAccountId: (accounts.find((a) => a.id === activeAccountId) ?? accounts[0])?.id ?? "", start: "demo_welcome" });
  const [library, setLibrary] = React.useState<LibraryItem[] | null>(null);
  React.useEffect(() => {
    if (!open || library) return;
    void apiFetch<{ templates: LibraryItem[] }>(`${base}/library`).then((r) => r.ok && setLibrary(r.data.templates));
  }, [open, base, library]);
  const pickTemplate = (t: LibraryItem) => setF((x) => ({ ...x, start: t.id, name: x.name || t.name }));
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const r = await apiFetch<{ automation: { id: string } }>(base, { method: "POST", body: { ...f, whatsappAccountId: f.whatsappAccountId || null } });
    setBusy(false);
    if (!r.ok) return setError(Object.values(r.details ?? {})[0]?.[0] ?? r.error);
    router.push(`/automations/${r.data.automation.id}`);
  }
  return (
    <Modal open={open} onClose={onClose} title="Create automation" size="lg">
      <form onSubmit={submit} className="space-y-4">
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <Field id="na-name" label="Name">
          <Input value={f.name} onChange={(e) => setF((x) => ({ ...x, name: e.target.value }))} placeholder="Welcome new contacts" maxLength={120} />
        </Field>
        <Field id="na-desc" label="Description (optional)">
          <Textarea value={f.description} onChange={(e) => setF((x) => ({ ...x, description: e.target.value }))} rows={2} maxLength={500} />
        </Field>
        <Field id="na-acct" label="Send messages from" hint="Replies go out on the number the customer wrote to; this number is used otherwise.">
          <Select value={f.whatsappAccountId} onChange={(e) => setF((x) => ({ ...x, whatsappAccountId: e.target.value }))}>
            <option value="">First connected number</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.displayName} · {a.phoneNumber}{a.isDemo ? " (demo)" : ""}</option>
            ))}
          </Select>
        </Field>
        <fieldset className="space-y-2">
          <legend className="mb-1.5 text-small font-medium text-app-text">Start from a ready-made automation</legend>
          {!library ? <p className="text-small text-app-muted">Loading…</p> : null}
          <div className="grid gap-2 sm:grid-cols-2">
            {library?.map((t) => (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={f.start === t.id}
                disabled={t.locked}
                onClick={() => pickTemplate(t)}
                className={`rounded-[var(--radius-control)] border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${f.start === t.id ? "border-app-primary bg-app-primary-soft" : "border-app-border hover:bg-app-hover"}`}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="text-small font-semibold text-app-text">{t.name}</span>
                  {t.locked ? <Badge tone="warning"><Lock className="size-3" aria-hidden="true" /> Add-on</Badge> : t.premium ? <Badge tone="success">{t.nodes} steps</Badge> : <Badge>Free</Badge>}
                </span>
                <span className="mt-1 block text-caption text-app-muted">{t.description}</span>
                <span className="mt-2 block text-caption text-app-subtle">{t.steps.join(" → ")}</span>
              </button>
            ))}
            <button type="button" role="radio" aria-checked={f.start === "blank"} onClick={() => setF((x) => ({ ...x, start: "blank" }))} className={`rounded-[var(--radius-control)] border p-3 text-left transition-colors ${f.start === "blank" ? "border-app-primary bg-app-primary-soft" : "border-app-border hover:bg-app-hover"}`}>
              <span className="text-small font-semibold text-app-text">Blank canvas</span>
              <span className="mt-1 block text-caption text-app-muted">Just a trigger. Build your own.</span>
            </button>
          </div>
          {library?.some((t) => t.locked) ? <p className="text-caption text-app-subtle">Locked ones are part of the “Ready-made automations” add-on. Contact MECGURA to enable it.</p> : null}
          <p className="text-caption text-app-subtle">Everything opens in the builder: change any message, button or step before you publish.</p>
        </fieldset>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={busy} disabled={!f.name.trim()}>Open builder</Button>
        </div>
      </form>
    </Modal>
  );
}

type Approval = {
  id: string;
  automation: { id: string; name: string };
  contact: { id: string; name: string; phone: string } | null;
  question: string;
  status: string;
  note: string;
  approver: string;
  canDecide: boolean;
  decidedBy: string | null;
  decidedAt: string | null;
  expiresAt: string;
  createdAt: string;
};
const APPROVAL_STATUS: Record<string, { label: string; tone: "warning" | "success" | "danger" | "neutral" }> = {
  pending: { label: "Waiting", tone: "warning" },
  approved: { label: "Approved", tone: "success" },
  rejected: { label: "Rejected", tone: "danger" },
  expired: { label: "Timed out", tone: "neutral" },
  cancelled: { label: "Run ended", tone: "neutral" },
};

/** Requests from Approval steps: decide here and the waiting run continues on that branch. */
function ApprovalsModal({ base, onClose, onChanged }: { base: string; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const [view, setView] = React.useState<"pending" | "decided">("pending");
  const [rows, setRows] = React.useState<Approval[] | null>(null);
  const [notes, setNotes] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState("");
  const load = React.useCallback(async () => {
    const r = await apiFetch<{ approvals: Approval[] }>(`${base}/approvals?status=${view}`);
    if (!r.ok) return toast(r.error, "error");
    setRows(r.data.approvals);
  }, [base, view, toast]);
  React.useEffect(() => {
    const t = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(t);
  }, [load]);
  async function decide(a: Approval, decision: "approved" | "rejected") {
    setBusy(a.id + decision);
    const r = await apiFetch(`${base}/approvals/${a.id}`, { method: "POST", body: { decision, note: notes[a.id] ?? "" } });
    setBusy("");
    if (!r.ok) return toast(r.error, "error");
    toast(decision === "approved" ? "Approved — the automation continues." : "Rejected — the automation takes the Rejected path.");
    onChanged();
    void load();
  }
  return (
    <Modal open onClose={onClose} size="lg" title="Automation approvals" description="Automations wait here for a person's decision.">
      <Tabs label="Approvals" value={view} onValueChange={(v) => { setRows(null); setView(v as "pending" | "decided"); }} items={[{ id: "pending", label: "Waiting" }, { id: "decided", label: "History" }]} />
      <div className="mt-3">
        {!rows ? (
          <LoadingState />
        ) : !rows.length ? (
          <p className="py-8 text-center text-small text-app-muted">{view === "pending" ? "Nothing is waiting for approval." : "No decisions yet."}</p>
        ) : (
          <ul className="space-y-3">
            {rows.map((a) => (
              <li key={a.id} className="rounded-lg border border-app-border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Link href={`/automations/${a.automation.id}`} className="text-small font-semibold text-app-text hover:underline">{a.automation.name}</Link>
                  <Badge tone={APPROVAL_STATUS[a.status]?.tone ?? "neutral"}>{APPROVAL_STATUS[a.status]?.label ?? a.status}</Badge>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-small text-app-text">{a.question}</p>
                <p className="mt-1 text-caption text-app-muted">
                  {a.contact ? `${a.contact.name || a.contact.phone} · ` : ""}
                  {a.status === "pending" ? `Approver: ${a.approver} · decide by ${istFmt.format(new Date(a.expiresAt))}` : `${a.decidedBy ? `${a.decidedBy} · ` : ""}${a.decidedAt ? istFmt.format(new Date(a.decidedAt)) : ""}`}
                </p>
                {a.note ? <p className="mt-1 text-caption text-app-subtle">“{a.note}”</p> : null}
                {a.canDecide ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Input aria-label="Note (optional)" placeholder="Note (optional)" value={notes[a.id] ?? ""} maxLength={500} onChange={(e) => setNotes({ ...notes, [a.id]: e.target.value })} className="min-w-0 flex-1" />
                    <Button size="sm" variant="secondary" loading={busy === a.id + "rejected"} onClick={() => void decide(a, "rejected")}>Reject</Button>
                    <Button size="sm" loading={busy === a.id + "approved"} onClick={() => void decide(a, "approved")}>Approve</Button>
                  </div>
                ) : a.status === "pending" ? (
                  <p className="mt-2 text-caption text-app-subtle">Waiting for {a.approver}.</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
