"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BarChart3, Copy, ListChecks, MoreHorizontal, Pause, Pencil, Play, Plus, Trash2, Workflow } from "lucide-react";
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
  Radio,
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
  const base = `/api/organizations/${orgId}/automations`;
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
          canManage ? (
            <Button onClick={() => setNewOpen(true)}>
              <Plus aria-hidden="true" /> Create automation
            </Button>
          ) : null
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
            action={canManage ? <Button onClick={() => setNewOpen(true)}>Create automation</Button> : undefined}
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

function NewAutomationModal({ open, onClose, base, accounts, activeAccountId }: { open: boolean; onClose: () => void; base: string; accounts: Account[]; activeAccountId: string }) {
  const router = useRouter();
  const [f, setF] = React.useState({ name: "", description: "", whatsappAccountId: (accounts.find((a) => a.id === activeAccountId) ?? accounts[0])?.id ?? "", start: "demo_welcome" as "demo_welcome" | "blank" });
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
        <fieldset className="grid gap-2 sm:grid-cols-2">
          <legend className="mb-1.5 text-small font-medium text-app-text">Start from</legend>
          <Radio name="na-start" label="Welcome & route to sales" description="New contact → welcome → pause → ask requirement → condition → assign sales" checked={f.start === "demo_welcome"} onChange={() => setF((x) => ({ ...x, start: "demo_welcome" }))} />
          <Radio name="na-start" label="Blank canvas" description="Just a trigger — build your own" checked={f.start === "blank"} onChange={() => setF((x) => ({ ...x, start: "blank" }))} />
        </fieldset>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={busy} disabled={!f.name.trim()}>Open builder</Button>
        </div>
      </form>
    </Modal>
  );
}
