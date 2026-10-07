"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, CheckCircle2, FlaskConical, Info, MessageCirclePlus, RotateCcw, UserPlus, Wifi, WifiOff } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Drawer,
  Dropdown,
  DropdownItem,
  DropdownLabel,
  DropdownSeparator,
  EmptyState,
  ErrorState,
  Field,
  IconButton,
  Input,
  LoadingState,
  Modal,
  Select,
  buttonVariants,
  useToast,
} from "@/components/ds";
import { apiFetch } from "@/lib/client-api";
import type { InboxPerms } from "@/lib/inbox-context";
import { ConversationList, type ListFilters } from "@/components/inbox/conversation-list";
import { MessageBubble } from "@/components/inbox/message-bubble";
import { AiControl } from "@/components/inbox/ai-control";
import { Composer } from "@/components/inbox/composer";
import { CustomerPanel } from "@/components/inbox/customer-panel";
import { useRealtime, type LiveEvent } from "@/components/inbox/use-realtime";
import type { Account, Conversation, Message, TeamMember } from "@/components/inbox/types";

type Props = { orgId: string; me: { id: string; name: string; role: string; agentStatus: string }; perms: InboxPerms; accounts: Account[]; activeAccountId?: string };

const PRESENCE: Record<string, { label: string; dot: string }> = {
  online: { label: "Online", dot: "bg-app-success" },
  away: { label: "Away", dot: "bg-app-warning" },
  offline: { label: "Offline", dot: "bg-app-subtle" },
};

export function InboxApp(props: Props) {
  const { orgId, me, perms } = props;
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const selectedId = params.get("c");
  const toast = useToast();

  const [filters, setFilters] = React.useState<ListFilters>({ tab: "all", q: "", status: "open", accountId: props.activeAccountId ?? "" });
  const [list, setList] = React.useState<Conversation[] | null>(null);
  const [counts, setCounts] = React.useState<Record<string, number>>({});
  const [listError, setListError] = React.useState("");
  const [listLoading, setListLoading] = React.useState(false);
  const [team, setTeam] = React.useState<TeamMember[]>([]);
  const [myStatus, setMyStatus] = React.useState(me.agentStatus);
  const [conv, setConv] = React.useState<Conversation | null>(null);
  const [messages, setMessages] = React.useState<Message[] | null>(null);
  const [hasMore, setHasMore] = React.useState(false);
  const [threadError, setThreadError] = React.useState("");
  const [replyTo, setReplyTo] = React.useState<Message | null>(null);
  const [panelKey, setPanelKey] = React.useState(0);
  const [infoOpen, setInfoOpen] = React.useState(false);
  const [demoOpen, setDemoOpen] = React.useState(false);
  const bottomRef = React.useRef<HTMLDivElement>(null);
  const demoAccounts = props.accounts.filter((a) => a.isDemo);

  const loadList = React.useCallback(async () => {
    setListLoading(true);
    const qs = new URLSearchParams({ tab: filters.tab, q: filters.q, status: filters.status, accountId: filters.accountId, pageSize: "50" });
    const r = await apiFetch<{ items: Conversation[]; counts: Record<string, number> }>(`/api/organizations/${orgId}/inbox/conversations?${qs}`);
    setListLoading(false);
    if (!r.ok) return setListError(r.error);
    setListError("");
    setList(r.data.items);
    setCounts(r.data.counts);
  }, [orgId, filters]);

  const loadTeam = React.useCallback(async () => {
    const r = await apiFetch<{ members: TeamMember[] }>(`/api/organizations/${orgId}/team`);
    if (r.ok) setTeam(r.data.members);
  }, [orgId]);

  const loadThread = React.useCallback(
    async (id: string) => {
      const [c, m] = await Promise.all([
        apiFetch<{ conversation: Conversation }>(`/api/organizations/${orgId}/inbox/conversations/${id}`),
        apiFetch<{ items: Message[]; hasMore: boolean }>(`/api/organizations/${orgId}/inbox/conversations/${id}/messages?limit=50`),
      ]);
      if (!c.ok) {
        setThreadError(c.status === 404 ? "This conversation isn't available to you (it may have been reassigned)." : c.error);
        setConv(null);
        setMessages(null);
        return;
      }
      setThreadError("");
      setConv(c.data.conversation);
      if (m.ok) {
        setMessages(m.data.items);
        setHasMore(m.data.hasMore);
      }
      if (c.data.conversation.unreadCount > 0) {
        void apiFetch(`/api/organizations/${orgId}/inbox/conversations/${id}/read`, { method: "POST" });
      }
    },
    [orgId]
  );

  // Debounced list refresh (search typing + bursts of realtime events).
  React.useEffect(() => {
    const t = window.setTimeout(() => void loadList(), 250);
    return () => window.clearTimeout(t);
  }, [loadList]);
  React.useEffect(() => {
    // One-time team load (external data sync).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadTeam();
  }, [loadTeam]);
  React.useEffect(() => {
    if (!selectedId) return;
    // Thread load when the selection changes (external data sync).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMessages(null);
    setReplyTo(null);
    void loadThread(selectedId);
  }, [selectedId, loadThread]);
  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages?.length, selectedId]);

  const refreshTimer = React.useRef<number | null>(null);
  const scheduleListRefresh = React.useCallback(() => {
    if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
    refreshTimer.current = window.setTimeout(() => void loadList(), 300);
  }, [loadList]);

  const onEvent = React.useCallback(
    (e: LiveEvent) => {
      if (e.type === "team.presence") return void loadTeam();
      if (e.type === "contact.updated") return setPanelKey((k) => k + 1);
      scheduleListRefresh();
      if (selectedId && "conversationId" in e && e.conversationId === selectedId) void loadThread(selectedId);
    },
    [selectedId, loadThread, loadTeam, scheduleListRefresh]
  );
  const connected = useRealtime(orgId, onEvent, () => {
    void loadList();
    if (selectedId) void loadThread(selectedId);
  });

  const select = (id: string | null) => {
    const sp = new URLSearchParams(params.toString());
    if (id) sp.set("c", id);
    else sp.delete("c");
    router.replace(`${pathname}${sp.toString() ? `?${sp}` : ""}`, { scroll: false });
  };

  async function loadOlder() {
    if (!selectedId || !messages?.length) return;
    const r = await apiFetch<{ items: Message[]; hasMore: boolean }>(`/api/organizations/${orgId}/inbox/conversations/${selectedId}/messages?limit=50&before=${messages[0].id}`);
    if (r.ok) {
      setMessages((m) => [...r.data.items, ...(m ?? [])]);
      setHasMore(r.data.hasMore);
    }
  }

  async function assign(toUserId: string | null) {
    if (!conv) return;
    const r = await apiFetch<{ conversation: Conversation }>(`/api/organizations/${orgId}/inbox/conversations/${conv.id}/assign`, { method: "POST", body: { toUserId } });
    if (!r.ok) return toast(r.error, "error");
    toast(toUserId === me.id ? "Chat assigned to you" : toUserId ? "Chat assigned" : "Chat unassigned");
    void loadList();
    void loadThread(conv.id);
  }
  async function setStatus(status: "open" | "closed") {
    if (!conv) return;
    const r = await apiFetch(`/api/organizations/${orgId}/inbox/conversations/${conv.id}`, { method: "PATCH", body: { status } });
    if (!r.ok) return toast(r.error, "error");
    toast(status === "closed" ? "Chat closed" : "Chat reopened");
    void loadList();
    void loadThread(conv.id);
  }
  async function changeMyStatus(status: string) {
    const r = await apiFetch(`/api/organizations/${orgId}/team/status`, { method: "PUT", body: { status } });
    if (!r.ok) return toast(r.error, "error");
    setMyStatus(status);
  }
  async function demoStatus(messageId: string, status: "delivered" | "read") {
    const r = await apiFetch(`/api/organizations/${orgId}/inbox/demo/status`, { method: "POST", body: { messageId, status } });
    if (!r.ok) toast(r.error, "error");
  }
  async function demoReply(text: string) {
    if (!conv) return;
    const r = await apiFetch(`/api/organizations/${orgId}/inbox/demo/inbound`, { method: "POST", body: { whatsappAccountId: conv.account.id, phone: conv.contact.phone, name: conv.contact.name, body: text } });
    if (!r.ok) toast(r.error, "error");
  }

  const holdsChat = conv?.assignedTo?.id === me.id;
  const mustClaim = Boolean(conv && !perms["inbox:view_all"] && !holdsChat);
  const assignOptions = team.filter((m) => m.userId !== conv?.assignedTo?.id);

  const showList = !selectedId;
  return (
    <div className="-mx-4 -my-6 flex h-[calc(100dvh-4rem)] min-h-[480px] overflow-hidden border-app-border sm:-mx-6 lg:-mx-8">
      {/* LEFT — conversations */}
      <aside className={cn("w-full shrink-0 border-r border-app-border bg-app-surface md:w-80 lg:w-[22rem]", showList ? "flex flex-col" : "hidden md:flex md:flex-col")} aria-label="Conversation list">
        <div className="flex items-center justify-between gap-2 border-b border-app-border px-3 py-2.5">
          <h1 className="text-h3 text-app-text">Inbox</h1>
          <div className="flex items-center gap-1">
            <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-caption", connected ? "text-green-300" : "text-amber-300")} title={connected ? "Live updates on" : "Reconnecting…"}>
              {connected ? <Wifi className="size-3.5" aria-hidden="true" /> : <WifiOff className="size-3.5" aria-hidden="true" />}
              <span className="sr-only sm:not-sr-only">{connected ? "Live" : "Offline"}</span>
            </span>
            <Dropdown
              label={`Your availability: ${PRESENCE[myStatus]?.label ?? myStatus}`}
              trigger={
                <span className="flex h-8 items-center gap-1.5 px-2 text-caption text-app-text">
                  <span className={cn("size-2 rounded-full", PRESENCE[myStatus]?.dot)} aria-hidden="true" />
                  {PRESENCE[myStatus]?.label}
                </span>
              }
            >
              {(close) => (
                <>
                  <DropdownLabel>Your availability</DropdownLabel>
                  {Object.entries(PRESENCE).map(([k, v]) => (
                    <DropdownItem key={k} onClick={() => { close(); void changeMyStatus(k); }} icon={<span className={cn("size-2 rounded-full", v.dot)} aria-hidden="true" />}>
                      {v.label}
                    </DropdownItem>
                  ))}
                </>
              )}
            </Dropdown>
          </div>
        </div>
        <ConversationList
          items={list}
          counts={counts}
          loading={listLoading}
          error={listError}
          onRetry={loadList}
          filters={filters}
          onFilters={setFilters}
          selectedId={selectedId}
          onSelect={select}
          accounts={props.accounts}
          footer={
            demoAccounts.length ? (
              <div className="border-t border-app-border p-3">
                <Button variant="secondary" size="sm" className="w-full" onClick={() => setDemoOpen(true)}>
                  <FlaskConical aria-hidden="true" /> Simulate a customer message (demo)
                </Button>
              </div>
            ) : null
          }
        />
      </aside>

      {/* CENTER — conversation */}
      <section className={cn("min-w-0 flex-1 flex-col bg-app-bg", showList ? "hidden md:flex" : "flex")} aria-label="Conversation">
        {!selectedId ? (
          <div className="flex flex-1 items-center justify-center p-6">
            {props.accounts.length === 0 ? (
              <EmptyState
                icon={MessageCirclePlus}
                title="Connect a WhatsApp number to start"
                description="Your inbox fills up as soon as a number is connected."
                action={<Link href="/dashboard/whatsapp" className={buttonVariants({ variant: "primary" })}>Open Connection Center</Link>}
              />
            ) : (
              <EmptyState icon={MessageCirclePlus} title="Select a conversation" description="Choose a chat from the list to read and reply." />
            )}
          </div>
        ) : threadError ? (
          <div className="flex flex-1 flex-col">
            <div className="border-b border-app-border p-2 md:hidden">
              <Button variant="ghost" size="sm" onClick={() => select(null)}><ArrowLeft aria-hidden="true" /> Back</Button>
            </div>
            <ErrorState title="Conversation unavailable" description={threadError} onRetry={() => select(null)} />
          </div>
        ) : !conv || !messages ? (
          <LoadingState label="Loading conversation…" className="flex-1" />
        ) : (
          <>
            <header className="flex items-center gap-2 border-b border-app-border bg-app-surface px-3 py-2.5">
              <IconButton label="Back to conversations" className="md:hidden" onClick={() => select(null)}>
                <ArrowLeft aria-hidden="true" />
              </IconButton>
              <Avatar name={conv.contact.name || conv.contact.phone} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-body font-semibold text-app-text">{conv.contact.name || conv.contact.phone}</p>
                <p className="truncate text-caption text-app-muted">
                  {conv.contact.phone} · via {conv.account.displayName}
                  {conv.isDemo ? " · Demo" : ""}
                </p>
              </div>
              <Dropdown
                label="Assign conversation"
                trigger={
                  <span className="flex h-9 items-center gap-1.5 rounded-[var(--radius-control)] border border-app-border px-2.5 text-small text-app-text">
                    <UserPlus className="size-4" aria-hidden="true" />
                    <span className="hidden max-w-[8rem] truncate sm:inline">{conv.assignedTo?.name ?? "Unassigned"}</span>
                  </span>
                }
              >
                {(close) => (
                  <>
                    <DropdownLabel>Assigned to {conv.assignedTo?.name ?? "nobody"}</DropdownLabel>
                    {!holdsChat && (perms["inbox:assign"] || (!conv.assignedTo && perms["inbox:claim"])) ? (
                      <DropdownItem onClick={() => { close(); void assign(me.id); }}>Assign to me</DropdownItem>
                    ) : null}
                    {(perms["inbox:assign"] || (holdsChat && perms["inbox:transfer"])) && assignOptions.length ? (
                      <>
                        <DropdownSeparator />
                        <DropdownLabel>{perms["inbox:assign"] ? "Assign to" : "Transfer to"}</DropdownLabel>
                        {assignOptions.map((m) => (
                          <DropdownItem key={m.userId} onClick={() => { close(); void assign(m.userId); }} icon={<span className={cn("size-2 rounded-full", PRESENCE[m.agentStatus]?.dot)} aria-hidden="true" />}>
                            <span className="flex-1 truncate">{m.name}</span>
                            <span className="text-caption text-app-subtle">{PRESENCE[m.agentStatus]?.label} · {m.openChats} open</span>
                          </DropdownItem>
                        ))}
                      </>
                    ) : null}
                    {conv.assignedTo && (perms["inbox:assign"] || holdsChat) ? (
                      <>
                        <DropdownSeparator />
                        <DropdownItem tone="danger" onClick={() => { close(); void assign(null); }}>Unassign</DropdownItem>
                      </>
                    ) : null}
                  </>
                )}
              </Dropdown>
              <AiControl orgId={orgId} conversationId={conv.id} refreshKey={messages.length} canReply={perms["inbox:reply"]} onChanged={() => { void loadList(); void loadThread(conv.id); }} />
              {conv.status === "open" ? (
                <IconButton label="Close chat" onClick={() => setStatus("closed")} disabled={mustClaim}>
                  <CheckCircle2 aria-hidden="true" />
                </IconButton>
              ) : (
                <IconButton label="Reopen chat" onClick={() => setStatus("open")} disabled={mustClaim}>
                  <RotateCcw aria-hidden="true" />
                </IconButton>
              )}
              <IconButton label="Customer information" className="xl:hidden" onClick={() => setInfoOpen(true)}>
                <Info aria-hidden="true" />
              </IconButton>
            </header>
            {conv.status === "closed" ? <Alert tone="info" className="m-3 mb-0">This chat is closed. A new customer message reopens it.</Alert> : null}
            <div className="app-scroll min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-6" aria-live="polite" aria-relevant="additions">
              {hasMore ? (
                <div className="mb-3 flex justify-center">
                  <Button size="sm" variant="ghost" onClick={loadOlder}>Load earlier messages</Button>
                </div>
              ) : null}
              {messages.length === 0 ? <p className="py-10 text-center text-small text-app-muted">No messages yet.</p> : null}
              <ul className="space-y-2" aria-label="Messages">
                {messages.map((m) => (
                  <MessageBubble
                    key={m.id}
                    m={m}
                    orgId={orgId}
                    onReply={m.direction !== "internal" ? setReplyTo : undefined}
                    demoTools={
                      m.isDemo && m.direction === "outbound" && m.status !== "read" && m.status !== "failed" ? (
                        <span className="mt-1 flex justify-end gap-1">
                          {m.status === "sent" ? (
                            <button type="button" className="rounded border border-app-border px-1.5 text-[10px] text-app-muted hover:text-app-text" onClick={() => demoStatus(m.id, "delivered")}>
                              Demo: mark delivered
                            </button>
                          ) : null}
                          <button type="button" className="rounded border border-app-border px-1.5 text-[10px] text-app-muted hover:text-app-text" onClick={() => demoStatus(m.id, "read")}>
                            Demo: mark read
                          </button>
                        </span>
                      ) : null
                    }
                  />
                ))}
              </ul>
              <div ref={bottomRef} />
            </div>
            {conv.isDemo ? <DemoReplyBar onSend={demoReply} /> : null}
            <Composer
              orgId={orgId}
              conversation={conv}
              canReply={perms["inbox:reply"]}
              canNote={perms["inbox:note"]}
              mustClaim={mustClaim}
              replyTo={replyTo}
              onClearReply={() => setReplyTo(null)}
              onSent={(m) => setMessages((xs) => (xs?.some((x) => x.id === m.id) ? xs : [...(xs ?? []), m]))}
            />
          </>
        )}
      </section>

      {/* RIGHT — customer */}
      {conv && selectedId && !threadError ? (
        <>
          <aside className="hidden w-80 shrink-0 border-l border-app-border bg-app-surface xl:block" aria-label="Customer information">
            <CustomerPanel orgId={orgId} contactId={conv.contact.id} currentConversationId={conv.id} team={team} canWrite={perms["contacts:write"]} refreshKey={panelKey} />
          </aside>
          <Drawer open={infoOpen} onClose={() => setInfoOpen(false)} title="Customer information" side="right">
            <div className="flex items-center justify-between border-b border-app-border px-4 py-3">
              <p className="text-h3 text-app-text">Customer</p>
              <Button size="sm" variant="ghost" onClick={() => setInfoOpen(false)}>Close</Button>
            </div>
            <div className="h-[calc(100%-3.25rem)]">
              <CustomerPanel orgId={orgId} contactId={conv.contact.id} currentConversationId={conv.id} team={team} canWrite={perms["contacts:write"]} refreshKey={panelKey} />
            </div>
          </Drawer>
        </>
      ) : null}

      <DemoCustomerModal open={demoOpen} onClose={() => setDemoOpen(false)} orgId={orgId} accounts={demoAccounts} onCreated={(id) => { setDemoOpen(false); select(id); void loadList(); }} />
    </div>
  );
}

function DemoReplyBar({ onSend }: { onSend: (text: string) => Promise<void> }) {
  const [text, setText] = React.useState("");
  return (
    <form
      className="flex items-center gap-2 border-t border-dashed border-app-info/40 bg-app-info/5 px-3 py-2"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!text.trim()) return;
        await onSend(text.trim());
        setText("");
      }}
    >
      <Badge tone="info"><FlaskConical className="size-3" aria-hidden="true" /> Demo</Badge>
      <Input aria-label="Simulated customer reply" value={text} onChange={(e) => setText(e.target.value)} placeholder="Type what the customer replies…" className="h-8 text-small" />
      <Button type="submit" size="sm" variant="secondary" disabled={!text.trim()}>Simulate reply</Button>
    </form>
  );
}

function DemoCustomerModal({ open, onClose, orgId, accounts, onCreated }: { open: boolean; onClose: () => void; orgId: string; accounts: Account[]; onCreated: (conversationId: string) => void }) {
  const [form, setForm] = React.useState({ accountId: "", name: "", phone: "", body: "" });
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [saving, setSaving] = React.useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const r = await apiFetch<{ conversationId: string }>(`/api/organizations/${orgId}/inbox/demo/inbound`, {
      method: "POST",
      body: { whatsappAccountId: form.accountId || accounts[0]?.id, phone: form.phone, name: form.name, body: form.body },
    });
    setSaving(false);
    if (!r.ok) return setErrors({ ...Object.fromEntries(Object.entries(r.details ?? {}).map(([k, v]) => [k, v?.[0] ?? ""])), form: r.details ? "" : r.error });
    setErrors({});
    setForm({ accountId: "", name: "", phone: "", body: "" });
    onCreated(r.data.conversationId);
  }
  return (
    <Modal open={open} onClose={onClose} title="Simulate a customer message" description="Demo numbers only. Creates the contact and conversation exactly like a real incoming WhatsApp message would.">
      <form onSubmit={submit} noValidate className="space-y-4">
        {errors.form ? <Alert tone="danger">{errors.form}</Alert> : null}
        {accounts.length > 1 ? (
          <Field id="demo-acc" label="Demo number">
            <Select value={form.accountId} onChange={(e) => setForm((f) => ({ ...f, accountId: e.target.value }))}>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.displayName} · {a.phoneNumber}</option>
              ))}
            </Select>
          </Field>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="demo-name" label="Customer name">
            <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Rahul Sharma" />
          </Field>
          <Field id="demo-phone" label="Customer phone" error={errors.phone}>
            <Input type="tel" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} placeholder="+91 98765 43210" />
          </Field>
        </div>
        <Field id="demo-body" label="Message">
          <Input value={form.body} onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))} placeholder="Hi, I need pricing for your services." />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={saving} disabled={!form.phone || !form.body}>Simulate message</Button>
        </div>
      </form>
    </Modal>
  );
}
