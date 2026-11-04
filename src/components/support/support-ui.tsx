"use client";

import * as React from "react";
import { AlertTriangle, CheckCircle2, Clock, LifeBuoy, Paperclip, Plus, Timer, X } from "lucide-react";
import { Alert, Badge, Button, Card, CardBody, CardHeader, Checkbox, EmptyState, Field, FilterBar, Input, LoadingState, Modal, PageHeader, SearchBar, Select, StatCard, Textarea, useToast } from "@/components/ds";
import { apiFetch } from "@/lib/client-api";
import { cn } from "@/lib/utils";

const CATEGORY_LABELS: Record<string, string> = { whatsapp: "WhatsApp number / messages", billing: "Billing & wallet", campaigns: "Campaigns & templates", automations: "Automations & flows", ai: "AI agent", landing: "Landing pages & website", other: "Something else" };
const PRIORITY: Record<string, { label: string; tone: "neutral" | "info" | "warning" | "danger"; sla: string }> = { low: { label: "Low", tone: "neutral", sla: "3 days" }, normal: { label: "Normal", tone: "info", sla: "24 hours" }, high: { label: "High", tone: "warning", sla: "8 hours" }, urgent: { label: "Urgent", tone: "danger", sla: "2 hours" } };
const STATUS: Record<string, { label: string; tone: "neutral" | "info" | "warning" | "success" }> = { open: { label: "Open", tone: "info" }, waiting: { label: "Waiting for you", tone: "warning" }, resolved: { label: "Resolved", tone: "success" }, closed: { label: "Closed", tone: "neutral" } };
const ADMIN_STATUS: Record<string, string> = { open: "Open", waiting: "Waiting on client", resolved: "Resolved", closed: "Closed" };
const fmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

type Msg = { id: string; body: string; fromSupport: boolean; internal: boolean; createdAt: string; author: { id: string; name: string } | null; attachments: { id: string; filename: string; mimeType: string; size: number }[] };
type Ticket = { id: string; number: number; subject: string; category: string; priority: string; status: string; slaDueAt: string; firstResponseAt: string | null; breached: boolean; lastActivityAt: string; createdAt: string; createdBy?: { name: string; email?: string } | null; organization?: { id: string; name: string }; assignee?: { id: string; name: string } | null; messages?: Msg[]; _count?: { messages: number } };
type File_ = { filename: string; data: string };

async function readFiles(list: FileList | null): Promise<File_[]> {
  const files = Array.from(list ?? []).slice(0, 3);
  return Promise.all(files.map((f) => new Promise<File_>((res, rej) => { const r = new FileReader(); r.onload = () => res({ filename: f.name.slice(0, 120), data: String(r.result) }); r.onerror = rej; r.readAsDataURL(f); })));
}

function Composer({ placeholder, onSend, extra, sendLabel = "Send" }: { placeholder: string; onSend: (body: string, files: File_[]) => Promise<boolean>; extra?: React.ReactNode; sendLabel?: string }) {
  const [body, setBody] = React.useState("");
  const [files, setFiles] = React.useState<File_[]>([]);
  const [busy, setBusy] = React.useState(false);
  const ref = React.useRef<HTMLInputElement>(null);
  return (
    <div className="space-y-2">
      <Textarea aria-label="Message" value={body} onChange={(e) => setBody(e.target.value)} rows={3} maxLength={5000} placeholder={placeholder} />
      {files.length ? <ul className="flex flex-wrap gap-2">{files.map((f, i) => <li key={i}><Badge>{f.filename}<button type="button" aria-label={`Remove ${f.filename}`} onClick={() => setFiles(files.filter((_, j) => j !== i))}><X className="size-3" /></button></Badge></li>)}</ul> : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="ghost" onClick={() => ref.current?.click()}><Paperclip className="size-4" aria-hidden="true" /> Attach</Button>
        <input ref={ref} type="file" multiple accept="image/png,image/jpeg,image/webp,application/pdf" className="hidden" onChange={async (e) => { setFiles((await readFiles(e.target.files)).slice(0, 3)); e.target.value = ""; }} />
        {extra}
        <Button size="sm" className="ml-auto" disabled={!body.trim()} loading={busy} onClick={async () => { setBusy(true); const okd = await onSend(body.trim(), files); setBusy(false); if (okd) { setBody(""); setFiles([]); } }}>{sendLabel}</Button>
      </div>
      <p className="text-caption text-app-subtle">Up to 3 files: PNG, JPG, WebP or PDF, 5 MB each.</p>
    </div>
  );
}

function Thread({ t, fileUrl }: { t: Ticket; fileUrl: (id: string) => string }) {
  return (
    <ol className="space-y-3">
      {(t.messages ?? []).map((m) => (
        <li key={m.id} className={cn("rounded-[var(--radius-control)] border p-3", m.internal ? "border-amber-400/40 bg-amber-400/5" : m.fromSupport ? "border-app-primary/30 bg-app-primary-soft" : "border-app-border")}>
          <p className="text-caption text-app-muted"><span className="font-semibold text-app-text">{m.fromSupport ? `MECGURA${m.author ? ` · ${m.author.name}` : ""}` : m.author?.name ?? "Client"}</span> · {fmt.format(new Date(m.createdAt))}{m.internal ? " · internal note" : ""}</p>
          <p className="mt-1 whitespace-pre-wrap text-small text-app-text">{m.body}</p>
          {m.attachments.length ? <ul className="mt-2 flex flex-wrap gap-2">{m.attachments.map((a) => <li key={a.id}><a href={fileUrl(a.id)} className="inline-flex items-center gap-1 rounded border border-app-border px-2 py-1 text-caption text-app-text hover:bg-app-hover"><Paperclip className="size-3" aria-hidden="true" />{a.filename} ({Math.ceil(a.size / 1024)} KB)</a></li>)}</ul> : null}
        </li>
      ))}
    </ol>
  );
}

// ---------------------------------------------------------------------------
// Client side
// ---------------------------------------------------------------------------
export function ClientSupport({ orgId, initialTicket }: { orgId: string; initialTicket: string | null }) {
  const base = `/api/organizations/${orgId}/support`;
  const toast = useToast();
  const [rows, setRows] = React.useState<Ticket[] | null>(null);
  const [open, setOpen] = React.useState<string | null>(initialTicket);
  const [creating, setCreating] = React.useState(false);
  const [n, setN] = React.useState(0);
  React.useEffect(() => {
    const t = window.setTimeout(async () => {
      const r = await apiFetch<{ tickets: Ticket[] }>(base);
      if (r.ok) setRows(r.data.tickets);
      else toast(r.error, "error");
    }, 0);
    return () => clearTimeout(t);
  }, [base, n, toast]);
  return (
    <>
      <PageHeader title="Help & support" description="Ask MECGURA for help. We reply here and you get a notification." actions={<Button onClick={() => setCreating(true)}><Plus className="size-4" aria-hidden="true" /> New ticket</Button>} />
      {!rows ? <LoadingState /> : !rows.length ? (
        <Card><EmptyState icon={LifeBuoy} title="No tickets yet" description="Stuck with WhatsApp, billing, a campaign or anything else? Open a ticket and our team will help." action={<Button onClick={() => setCreating(true)}><Plus className="size-4" aria-hidden="true" /> New ticket</Button>} /></Card>
      ) : (
        <Card>
          <ul className="divide-y divide-app-border">
            {rows.map((t) => (
              <li key={t.id}>
                <button type="button" onClick={() => setOpen(t.id)} className="flex w-full flex-col gap-1 px-4 py-3 text-left hover:bg-app-hover sm:flex-row sm:items-center sm:justify-between">
                  <span className="min-w-0">
                    <span className="block truncate text-small font-semibold text-app-text">#{t.number} {t.subject}</span>
                    <span className="text-caption text-app-subtle">{CATEGORY_LABELS[t.category]} · {t.createdBy?.name ?? ""} · updated {fmt.format(new Date(t.lastActivityAt))}</span>
                  </span>
                  <span className="flex shrink-0 gap-2"><Badge tone={PRIORITY[t.priority].tone}>{PRIORITY[t.priority].label}</Badge><Badge tone={STATUS[t.status].tone}>{STATUS[t.status].label}</Badge></span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {creating ? <NewTicket base={base} onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); setN((x) => x + 1); setOpen(id); }} /> : null}
      {open ? <ClientTicket base={base} id={open} onClose={() => setOpen(null)} onChanged={() => setN((x) => x + 1)} /> : null}
    </>
  );
}

function NewTicket({ base, onClose, onCreated }: { base: string; onClose: () => void; onCreated: (id: string) => void }) {
  const toast = useToast();
  const [f, setF] = React.useState({ subject: "", category: "whatsapp", priority: "normal", body: "" });
  const [files, setFiles] = React.useState<File_[]>([]);
  const [errors, setErrors] = React.useState<Record<string, string[]>>({});
  const [busy, setBusy] = React.useState(false);
  async function send() {
    setBusy(true);
    const r = await apiFetch<{ ticket: { id: string; number: number } }>(base, { method: "POST", body: { ...f, attachments: files } });
    setBusy(false);
    if (!r.ok) {
      setErrors(r.details ?? {});
      return toast(r.error, "error");
    }
    toast(`Ticket #${r.data.ticket.number} opened. We'll reply here.`);
    onCreated(r.data.ticket.id);
  }
  return (
    <Modal open onClose={onClose} size="lg" title="New support ticket" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={() => void send()} loading={busy}>Open ticket</Button></>}>
      <div className="space-y-4">
        <Field id="nt-subject" label="What's the problem?" error={errors.subject?.[0]}><Input value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} maxLength={150} placeholder="e.g. Campaign stuck on sending" /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="nt-cat" label="About"><Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{Object.entries(CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
          <Field id="nt-pri" label="How urgent?" hint={`We aim to reply within ${PRIORITY[f.priority].sla}.`}><Select value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}><option value="low">Low: a question</option><option value="normal">Normal</option><option value="high">High: something important isn&apos;t working</option><option value="urgent">Urgent: customers can&apos;t reach us</option></Select></Field>
        </div>
        <Field id="nt-body" label="Details" hint="What did you do, what happened, and what did you expect? Screenshots help." error={errors.body?.[0]}><Textarea value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} rows={6} maxLength={5000} /></Field>
        <div>
          <input id="nt-files" type="file" multiple accept="image/png,image/jpeg,image/webp,application/pdf" onChange={async (e) => setFiles(await readFiles(e.target.files))} className="text-small text-app-muted" />
          {errors.attachments ? <p className="mt-1 text-caption text-red-300">{errors.attachments[0]}</p> : null}
        </div>
      </div>
    </Modal>
  );
}

function ClientTicket({ base, id, onClose, onChanged }: { base: string; id: string; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const [t, setT] = React.useState<Ticket | null>(null);
  const load = React.useCallback(async () => {
    const r = await apiFetch<{ ticket: Ticket }>(`${base}/${id}`);
    if (r.ok) setT(r.data.ticket);
    else toast(r.error, "error");
  }, [base, id, toast]);
  React.useEffect(() => {
    const x = window.setTimeout(() => void load(), 0);
    return () => clearTimeout(x);
  }, [load]);
  return (
    <Modal open onClose={onClose} size="lg" title={t ? `#${t.number} ${t.subject}` : "Ticket"} description={t ? <>{CATEGORY_LABELS[t.category]} · <Badge tone={STATUS[t.status].tone}>{STATUS[t.status].label}</Badge></> : undefined}>
      {!t ? <LoadingState /> : (
        <div className="space-y-4">
          <Thread t={t} fileUrl={(aid) => `${base}/attachments/${aid}`} />
          {t.status !== "closed" ? (
            <Composer placeholder="Write a reply…" onSend={async (body, attachments) => {
              const r = await apiFetch<{ ticket: Ticket }>(`${base}/${id}`, { method: "POST", body: { body, attachments } });
              if (!r.ok) { toast(r.error, "error"); return false; }
              setT(r.data.ticket);
              onChanged();
              return true;
            }} extra={t.status !== "resolved" ? <Button size="sm" variant="secondary" onClick={async () => { const r = await apiFetch<{ ticket: Ticket }>(`${base}/${id}/resolve`, { method: "POST" }); if (r.ok) { setT(r.data.ticket); onChanged(); toast("Marked resolved. Thanks!"); } else toast(r.error, "error"); }}><CheckCircle2 className="size-4" aria-hidden="true" /> It&apos;s sorted</Button> : undefined} />
          ) : <Alert tone="info">This ticket is closed. Open a new one if you need more help.</Alert>}
        </div>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// MECGURA side
// ---------------------------------------------------------------------------
type Report = { created: number; resolved: number; open: number; breachedNow: number; avgFirstResponseHours: number | null; avgResolutionHours: number | null; slaMetPct: number | null; byCategory: { category: string; count: number }[]; byPriority: { priority: string; count: number }[] };

export function AdminSupport({ admins, initialTicket }: { admins: { id: string; name: string }[]; initialTicket: string | null }) {
  const toast = useToast();
  const [status, setStatus] = React.useState("active");
  const [priority, setPriority] = React.useState("");
  const [q, setQ] = React.useState("");
  const [breached, setBreached] = React.useState(false);
  const [rows, setRows] = React.useState<Ticket[] | null>(null);
  const [report, setReport] = React.useState<Report | null>(null);
  const [open, setOpen] = React.useState<string | null>(initialTicket);
  const [n, setN] = React.useState(0);
  React.useEffect(() => {
    const t = window.setTimeout(async () => {
      const qs = new URLSearchParams({ status, ...(priority ? { priority } : {}), ...(q.trim() ? { q: q.trim() } : {}), ...(breached ? { breached: "true" } : {}) });
      const r = await apiFetch<{ tickets: Ticket[]; report: Report }>(`/api/admin/support?${qs}`);
      if (r.ok) {
        setRows(r.data.tickets);
        setReport(r.data.report);
      } else toast(r.error, "error");
    }, q ? 300 : 0);
    return () => clearTimeout(t);
  }, [status, priority, q, breached, n, toast]);
  return (
    <>
      <PageHeader title="Support desk" description="Client tickets with response deadlines. Missed deadlines are escalated to every admin." breadcrumb={[{ label: "Admin", href: "/admin" }, { label: "Support" }]} />
      {report ? (
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Open now" value={String(report.open)} icon={LifeBuoy} hint={`${report.breachedNow} past their deadline`} />
          <StatCard label="First reply (avg)" value={report.avgFirstResponseHours === null ? null : `${report.avgFirstResponseHours} h`} icon={Timer} hint="Last 30 days" />
          <StatCard label="Resolved in (avg)" value={report.avgResolutionHours === null ? null : `${report.avgResolutionHours} h`} icon={Clock} hint={`${report.resolved} of ${report.created} resolved`} />
          <StatCard label="Deadline met" value={report.slaMetPct === null ? null : `${report.slaMetPct}%`} icon={CheckCircle2} hint={report.byCategory.length ? `Most: ${CATEGORY_LABELS[report.byCategory.sort((a, b) => b.count - a.count)[0].category]}` : "No tickets yet"} />
        </div>
      ) : null}
      <FilterBar className="mb-3">
        <SearchBar label="Search tickets" placeholder="#1042, subject or client" value={q} onChange={(e) => setQ(e.target.value)} className="w-full sm:w-64" />
        <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className="w-full sm:w-44"><option value="active">Open + waiting</option><option value="open">Open</option><option value="waiting">Waiting on client</option><option value="resolved">Resolved</option><option value="closed">Closed</option><option value="all">All</option></Select>
        <Select aria-label="Priority" value={priority} onChange={(e) => setPriority(e.target.value)} className="w-full sm:w-36"><option value="">Any priority</option>{Object.entries(PRIORITY).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</Select>
        <Checkbox checked={breached} onChange={(e) => setBreached(e.target.checked)} label="Past deadline only" />
      </FilterBar>
      {!rows ? <LoadingState /> : !rows.length ? <Card><EmptyState icon={CheckCircle2} title="Nothing here" description="No tickets match these filters." /></Card> : (
        <Card>
          <ul className="divide-y divide-app-border">
            {rows.map((t) => (
              <li key={t.id}>
                <button type="button" onClick={() => setOpen(t.id)} className="flex w-full flex-col gap-1 px-4 py-3 text-left hover:bg-app-hover sm:flex-row sm:items-center sm:justify-between">
                  <span className="min-w-0">
                    <span className="flex items-center gap-2 text-small font-semibold text-app-text">{t.breached ? <AlertTriangle className="size-4 text-red-300" aria-label="Past deadline" /> : null}#{t.number} {t.subject}</span>
                    <span className="text-caption text-app-subtle">{t.organization?.name} · {CATEGORY_LABELS[t.category]} · {t.assignee ? `with ${t.assignee.name}` : "unassigned"} · {t.firstResponseAt ? "answered" : `reply by ${fmt.format(new Date(t.slaDueAt))}`}</span>
                  </span>
                  <span className="flex shrink-0 gap-2"><Badge tone={PRIORITY[t.priority].tone}>{PRIORITY[t.priority].label}</Badge><Badge tone={STATUS[t.status].tone}>{ADMIN_STATUS[t.status]}</Badge></span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {open ? <AdminTicket id={open} admins={admins} onClose={() => setOpen(null)} onChanged={() => setN((x) => x + 1)} /> : null}
    </>
  );
}

function AdminTicket({ id, admins, onClose, onChanged }: { id: string; admins: { id: string; name: string }[]; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const [t, setT] = React.useState<Ticket | null>(null);
  const [internal, setInternal] = React.useState(false);
  const [after, setAfter] = React.useState("waiting");
  const load = React.useCallback(async () => {
    const r = await apiFetch<{ ticket: Ticket }>(`/api/admin/support/${id}`);
    if (r.ok) setT(r.data.ticket);
    else toast(r.error, "error");
  }, [id, toast]);
  React.useEffect(() => {
    const x = window.setTimeout(() => void load(), 0);
    return () => clearTimeout(x);
  }, [load]);
  async function update(body: Record<string, unknown>) {
    const r = await apiFetch<{ ticket: Ticket }>(`/api/admin/support/${id}`, { method: "PATCH", body });
    if (!r.ok) return toast(r.error, "error");
    setT(r.data.ticket);
    onChanged();
  }
  return (
    <Modal open onClose={onClose} size="lg" title={t ? `#${t.number} ${t.subject}` : "Ticket"} description={t ? `${t.organization?.name} · ${t.createdBy?.name ?? ""} ${t.createdBy?.email ? `(${t.createdBy.email})` : ""}` : undefined}>
      {!t ? <LoadingState /> : (
        <div className="space-y-4">
          {t.breached ? <Alert tone="danger" title="Past the response deadline">This {t.priority} ticket should have had a reply by {fmt.format(new Date(t.slaDueAt))}.</Alert> : null}
          <div className="grid gap-2 sm:grid-cols-3">
            <Select aria-label="Status" value={t.status} onChange={(e) => void update({ status: e.target.value })}>{Object.entries(ADMIN_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
            <Select aria-label="Priority" value={t.priority} onChange={(e) => void update({ priority: e.target.value })}>{Object.entries(PRIORITY).map(([k, v]) => <option key={k} value={k}>{v.label} (reply in {v.sla})</option>)}</Select>
            <Select aria-label="Assignee" value={t.assignee?.id ?? ""} onChange={(e) => void update({ assigneeId: e.target.value || null })}><option value="">Unassigned</option>{admins.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select>
          </div>
          <Thread t={t} fileUrl={(aid) => `/api/admin/support/attachments/${aid}`} />
          <Composer
            placeholder={internal ? "Internal note (the client never sees this)…" : "Reply to the client…"}
            sendLabel={internal ? "Add note" : "Send reply"}
            extra={
              <>
                <Checkbox checked={internal} onChange={(e) => setInternal(e.target.checked)} label="Internal note" />
                {!internal ? <Select aria-label="After sending" value={after} onChange={(e) => setAfter(e.target.value)} className="h-9 w-auto"><option value="waiting">Then: waiting on client</option><option value="open">Then: keep open</option><option value="resolved">Then: resolved</option></Select> : null}
              </>
            }
            onSend={async (body, attachments) => {
              const r = await apiFetch<{ ticket: Ticket }>(`/api/admin/support/${id}`, { method: "POST", body: { body, attachments, internal, ...(internal ? {} : { status: after }) } });
              if (!r.ok) { toast(r.error, "error"); return false; }
              setT(r.data.ticket);
              onChanged();
              toast(internal ? "Note added." : "Reply sent. The client was notified.");
              return true;
            }}
          />
        </div>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// System health
// ---------------------------------------------------------------------------
type Check = { key: string; group: string; label: string; status: "ok" | "warn" | "down" | "config"; detail: string };
type Failure = { id: string; kind: string; what: string; client: string; error: string; at: string };
const HEALTH: Record<Check["status"], { label: string; tone: "success" | "warning" | "danger" | "neutral" }> = { ok: { label: "OK", tone: "success" }, warn: { label: "Check", tone: "warning" }, down: { label: "Down", tone: "danger" }, config: { label: "Set up needed", tone: "neutral" } };

export function SystemHealth() {
  const [data, setData] = React.useState<{ checkedAt: string; checks: Check[]; summary: Record<string, number>; failures: Failure[] } | null>(null);
  const [n, setN] = React.useState(0);
  React.useEffect(() => {
    const t = window.setTimeout(async () => {
      const r = await apiFetch<{ checkedAt: string; checks: Check[]; summary: Record<string, number>; failures: Failure[] }>("/api/admin/health");
      if (r.ok) setData(r.data);
    }, 0);
    const i = window.setInterval(() => setN((x) => x + 1), 60_000);
    return () => { clearTimeout(t); clearInterval(i); };
  }, [n]);
  if (!data) return <LoadingState label="Checking services…" />;
  const groups = [...new Set(data.checks.map((c) => c.group))];
  return (
    <>
      <PageHeader title="System health" description={`Checked ${fmt.format(new Date(data.checkedAt))} · refreshes every minute. “Down” checks alert every admin (at most hourly).`} breadcrumb={[{ label: "Admin", href: "/admin" }, { label: "System health" }]} actions={<Button variant="secondary" onClick={() => setN((x) => x + 1)}>Check now</Button>} />
      <div className="mb-4 flex flex-wrap gap-2">{(["down", "warn", "config", "ok"] as const).map((s) => <Badge key={s} tone={HEALTH[s].tone}>{data.summary[s] ?? 0} {HEALTH[s].label}</Badge>)}</div>
      <div className="grid gap-4 lg:grid-cols-2">
        {groups.map((g) => (
          <Card key={g}>
            <CardHeader title={g} />
            <CardBody className="p-0">
              <ul className="divide-y divide-app-border">
                {data.checks.filter((c) => c.group === g).map((c) => (
                  <li key={c.key} className="flex items-start justify-between gap-3 px-4 py-3">
                    <span className="min-w-0"><span className="block text-small font-medium text-app-text">{c.label}</span><span className="block text-caption text-app-muted">{c.detail}</span></span>
                    <Badge tone={HEALTH[c.status].tone}>{HEALTH[c.status].label}</Badge>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        ))}
      </div>
      <Card className="mt-4">
        <CardHeader title="Latest failures" description="Automations, client webhooks, campaign messages and Meta webhook events that failed." />
        <CardBody className="overflow-x-auto p-0">
          {!data.failures.length ? <p className="px-4 py-4 text-small text-app-muted">No failures. 🎉</p> : (
            <table className="w-full text-small">
              <thead className="text-left text-caption text-app-muted"><tr className="border-b border-app-border"><th className="px-4 py-2 font-medium">When</th><th className="px-4 py-2 font-medium">Type</th><th className="px-4 py-2 font-medium">Client</th><th className="px-4 py-2 font-medium">What</th><th className="px-4 py-2 font-medium">Error</th></tr></thead>
              <tbody>{data.failures.map((f) => <tr key={`${f.kind}-${f.id}`} className="border-b border-app-border align-top last:border-0"><td className="whitespace-nowrap px-4 py-2 text-app-muted">{fmt.format(new Date(f.at))}</td><td className="px-4 py-2">{f.kind}</td><td className="px-4 py-2">{f.client}</td><td className="px-4 py-2">{f.what}</td><td className="max-w-md px-4 py-2 text-app-muted">{f.error || "—"}</td></tr>)}</tbody>
            </table>
          )}
        </CardBody>
      </Card>
    </>
  );
}
