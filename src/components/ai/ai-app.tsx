"use client";

import * as React from "react";
import { Bot, CalendarCheck, FileText, FlaskConical, History, ListChecks, Pause, Play, Plus, RotateCcw, Save, Send, Settings2, Trash2, Upload, UserRound, X } from "lucide-react";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  ConfirmationDialog,
  EmptyState,
  ErrorState,
  Field,
  IconButton,
  Input,
  LoadingState,
  Modal,
  PageHeader,
  Pagination,
  Select,
  Switch,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Textarea,
  useToast,
  type BadgeTone,
} from "@/components/ds";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/client-api";
import { COLLECTABLE_FIELDS, DEMO_LABEL, RESUME_LABELS, type AiAction, type AiActionsConfig, type AiHandoffConfig, type AiKnowledge, type KbItem } from "@/lib/ai";
import { istFmt } from "@/components/campaigns/types";

type Doc = { id: string; name: string; mimeType: string; sizeBytes: number; createdAt: string };
type Agent = {
  id: string;
  name: string;
  status: string;
  instructions: string;
  accountIds: string[];
  knowledge: AiKnowledge;
  actions: AiActionsConfig;
  handoff: AiHandoffConfig;
  documents: Doc[];
  interactions: number;
  updatedAt: string;
};
type Account = { id: string; displayName: string; phoneNumber: string; isDemo: boolean };
type Member = { id: string; name: string; role: string };
type Overview = { agents: Agent[]; accounts: Account[]; members: Member[]; liveConfigured: boolean };
type Editable = Pick<Agent, "name" | "instructions" | "accountIds" | "knowledge" | "actions" | "handoff">;

const STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  draft: { label: "Draft", tone: "neutral" },
  active: { label: "Active", tone: "success" },
  paused: { label: "Paused", tone: "warning" },
};
const TABS = [
  { id: "settings", label: "Settings", icon: Settings2 },
  { id: "knowledge", label: "Knowledge", icon: FileText },
  { id: "actions", label: "Actions & handoff", icon: ListChecks },
  { id: "test", label: "Test chat", icon: FlaskConical },
  { id: "activity", label: "Activity", icon: History },
  { id: "appointments", label: "Appointments", icon: CalendarCheck },
] as const;

const editable = (a: Agent): Editable => ({ name: a.name, instructions: a.instructions, accountIds: a.accountIds, knowledge: a.knowledge, actions: a.actions, handoff: a.handoff });

export function AiApp({ orgId, canManage, initialTab }: { orgId: string; canManage: boolean; initialTab: string }) {
  const toast = useToast();
  const base = `/api/organizations/${orgId}/ai`;
  const [data, setData] = React.useState<Overview | null>(null);
  const [error, setError] = React.useState("");
  const [selected, setSelected] = React.useState("");
  const [tab, setTab] = React.useState<string>(TABS.some((t) => t.id === initialTab) ? initialTab : "settings");
  const [draft, setDraft] = React.useState<Editable | null>(null);
  const [saved, setSaved] = React.useState("");
  const [busy, setBusy] = React.useState("");
  const [creating, setCreating] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);

  const load = React.useCallback(async (select?: string) => {
    const r = await apiFetch<Overview>(`${base}/agents`);
    if (!r.ok) return setError(r.error);
    setError("");
    setData(r.data);
    const pick = r.data.agents.find((a) => a.id === select) ?? r.data.agents[0];
    setSelected(pick?.id ?? "");
    setDraft(pick ? editable(pick) : null);
    setSaved(pick ? JSON.stringify(editable(pick)) : "");
  }, [base]);
  React.useEffect(() => {
    const t = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(t);
  }, [load]);

  const agent = data?.agents.find((a) => a.id === selected) ?? null;
  const dirty = draft !== null && JSON.stringify(draft) !== saved;

  function pick(id: string) {
    const a = data?.agents.find((x) => x.id === id);
    if (!a) return;
    if (dirty && !window.confirm("Discard unsaved changes?")) return;
    setSelected(id);
    setDraft(editable(a));
    setSaved(JSON.stringify(editable(a)));
  }
  function replace(a: Agent) {
    setData((d) => (d ? { ...d, agents: d.agents.map((x) => (x.id === a.id ? a : x)) } : d));
  }
  async function save(): Promise<boolean> {
    if (!agent || !draft) return false;
    setBusy("save");
    // Half-filled rows are dropped rather than rejected.
    const k = draft.knowledge;
    const body: Editable = {
      ...draft,
      knowledge: {
        ...k,
        faqs: k.faqs.filter((f) => f.q.trim() && f.a.trim()),
        products: k.products.filter((p) => p.name.trim()),
        services: k.services.filter((p) => p.name.trim()),
      },
    };
    const r = await apiFetch<{ agent: Agent }>(`${base}/agents/${agent.id}`, { method: "PATCH", body });
    setBusy("");
    if (!r.ok) {
      toast(Object.values(r.details ?? {})[0]?.[0] ?? r.error, "error");
      return false;
    }
    replace(r.data.agent);
    setDraft(editable(r.data.agent));
    setSaved(JSON.stringify(editable(r.data.agent)));
    toast("Saved");
    return true;
  }
  async function setStatus(status: "active" | "paused") {
    if (!agent) return;
    if (dirty && !(await save())) return;
    setBusy("status");
    const r = await apiFetch<{ agent: Agent }>(`${base}/agents/${agent.id}/status`, { method: "POST", body: { status } });
    setBusy("");
    if (!r.ok) return toast(r.error, "error");
    replace(r.data.agent);
    toast(status === "active" ? "AI agent is now answering" : "AI agent paused");
  }
  async function remove() {
    if (!agent) return;
    setBusy("delete");
    const r = await apiFetch(`${base}/agents/${agent.id}`, { method: "DELETE" });
    setBusy("");
    setConfirmDelete(false);
    if (!r.ok) return toast(r.error, "error");
    toast("AI agent deleted");
    void load();
  }

  if (error) return <ErrorState description={error} onRetry={() => load()} />;
  if (!data) return <LoadingState />;
  const status = agent ? (STATUS[agent.status] ?? { label: agent.status, tone: "neutral" as const }) : null;

  return (
    <>
      <PageHeader
        title="AI Agent"
        description="Answers customers on WhatsApp from your knowledge base, collects details, books appointments and hands over to your team."
        actions={
          canManage ? (
            <Button variant="secondary" onClick={() => setCreating(true)}>
              <Plus aria-hidden="true" /> New agent
            </Button>
          ) : null
        }
      />
      <ModeBanner live={data.liveConfigured} accounts={data.accounts} />

      {!agent || !draft ? (
        <Card>
          <EmptyState icon={Bot} title="No AI agent yet" description={canManage ? "Create one, add your FAQs, products and pricing, test it, then activate it." : "Ask an owner or manager to set one up."} action={canManage ? <Button onClick={() => setCreating(true)}><Plus aria-hidden="true" /> Create AI agent</Button> : undefined} />
        </Card>
      ) : (
        <>
          <Card className="mb-4">
            <div className="flex flex-wrap items-center gap-3 p-4">
              <span className="flex size-10 items-center justify-center rounded-xl bg-app-primary-soft text-app-primary">
                <Bot className="size-5" aria-hidden="true" />
              </span>
              <div className="min-w-[12rem] flex-1">
                {data.agents.length > 1 ? (
                  <Select aria-label="AI agent" value={agent.id} onChange={(e) => pick(e.target.value)} className="max-w-xs">
                    {data.agents.map((a) => (
                      <option key={a.id} value={a.id}>{a.name} · {STATUS[a.status]?.label ?? a.status}</option>
                    ))}
                  </Select>
                ) : (
                  <p className="text-h4 font-semibold text-app-text">{agent.name}</p>
                )}
                <p className="mt-1 flex flex-wrap items-center gap-2 text-caption text-app-muted">
                  {status ? <Badge tone={status.tone} dot>{status.label}</Badge> : null}
                  <span>{agent.accountIds.length ? `${agent.accountIds.length} number(s)` : "All numbers"}</span>
                  <span>· {agent.interactions} interaction(s)</span>
                  {dirty ? <span className="text-amber-300">· Unsaved changes</span> : null}
                </p>
              </div>
              {canManage ? (
                <div className="flex w-full flex-wrap gap-2 sm:w-auto">
                  <Button variant="secondary" onClick={save} loading={busy === "save"} disabled={!dirty}>
                    <Save aria-hidden="true" /> Save
                  </Button>
                  {agent.status === "active" ? (
                    <Button variant="secondary" onClick={() => setStatus("paused")} loading={busy === "status"}>
                      <Pause aria-hidden="true" /> Pause
                    </Button>
                  ) : (
                    <Button onClick={() => setStatus("active")} loading={busy === "status"}>
                      <Play aria-hidden="true" /> Activate
                    </Button>
                  )}
                  <IconButton label="Delete agent" onClick={() => setConfirmDelete(true)}>
                    <Trash2 aria-hidden="true" />
                  </IconButton>
                </div>
              ) : null}
            </div>
          </Card>

          <nav aria-label="AI agent sections" className="mb-4 flex gap-1 overflow-x-auto border-b border-app-border">
            {TABS.map((t) => (
              <button key={t.id} type="button" onClick={() => setTab(t.id)} aria-current={tab === t.id ? "page" : undefined} className={cn("flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-small", tab === t.id ? "border-app-primary text-app-text" : "border-transparent text-app-muted hover:text-app-text")}>
                <t.icon className="size-4" aria-hidden="true" /> {t.label}
              </button>
            ))}
          </nav>

          {tab === "settings" ? <SettingsTab key={agent.id} draft={draft} setDraft={setDraft} accounts={data.accounts} disabled={!canManage} /> : null}
          {tab === "knowledge" ? <KnowledgeTab key={agent.id} draft={draft} setDraft={setDraft} agent={agent} base={`${base}/agents/${agent.id}`} disabled={!canManage} onDocs={(documents) => replace({ ...agent, documents })} /> : null}
          {tab === "actions" ? <ActionsTab key={agent.id} draft={draft} setDraft={setDraft} members={data.members} disabled={!canManage} /> : null}
          {tab === "test" ? <TestTab key={agent.id} url={`${base}/agents/${agent.id}/test`} live={data.liveConfigured} dirty={dirty} canManage={canManage} /> : null}
          {tab === "activity" ? <ActivityTab key={agent.id} url={`${base}/agents/${agent.id}/interactions`} /> : null}
        </>
      )}
      {tab === "appointments" || (!agent && initialTab === "appointments") ? <AppointmentsTab base={`${base}/appointments`} /> : null}

      {creating ? <CreateModal url={`${base}/agents`} onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); setTab("settings"); void load(id); }} /> : null}
      <ConfirmationDialog open={confirmDelete} onClose={() => setConfirmDelete(false)} onConfirm={remove} loading={busy === "delete"} title="Delete this AI agent?" description="Its settings, documents and activity log are removed. Conversations and contacts stay." confirmLabel="Delete agent" />
    </>
  );
}

function ModeBanner({ live, accounts }: { live: boolean; accounts: Account[] }) {
  const liveNumbers = accounts.filter((a) => !a.isDemo).length;
  if (live) {
    return (
      <Alert tone="success" className="mb-4" title="Live AI is configured">
        Replies are written by Claude using only your instructions and knowledge base. Every reply is logged under Activity, and live replies count towards your AI usage.
      </Alert>
    );
  }
  return (
    <Alert tone="warning" className="mb-4" title={`Demo mode — ${DEMO_LABEL}`}>
      ANTHROPIC_API_KEY isn&apos;t set on this installation, so there is no real AI. The demo engine only matches keywords against your FAQs, products, services and pricing. It answers on demo numbers and in the test chat only{liveNumbers ? ` — your ${liveNumbers} live number(s) will not get automatic replies` : ""}. Messages it sends are labelled “Demo AI”.
    </Alert>
  );
}

function CreateModal({ url, onClose, onCreated }: { url: string; onClose: () => void; onCreated: (id: string) => void }) {
  const [name, setName] = React.useState("Sales assistant");
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const r = await apiFetch<{ agent: Agent }>(url, { method: "POST", body: { name } });
    setBusy(false);
    if (!r.ok) return setError(r.details?.name?.[0] ?? r.error);
    onCreated(r.data.agent.id);
  }
  return (
    <Modal open onClose={onClose} title="Create an AI agent" description="It starts as a draft — nothing is answered until you activate it.">
      <form onSubmit={submit} className="space-y-4">
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <Field id="ai-new-name" label="Agent name">
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={busy} disabled={!name.trim()}>Create</Button>
        </div>
      </form>
    </Modal>
  );
}

type SetDraft = React.Dispatch<React.SetStateAction<Editable | null>>;

function SettingsTab({ draft, setDraft, accounts, disabled }: { draft: Editable; setDraft: SetDraft; accounts: Account[]; disabled: boolean }) {
  const set = (p: Partial<Editable>) => setDraft((d) => (d ? { ...d, ...p } : d));
  return (
    <Card>
      <CardHeader title="Settings" description="Who the agent is and how it should talk." />
      <CardBody className="space-y-4">
        <Field id="ai-name" label="Name">
          <Input value={draft.name} onChange={(e) => set({ name: e.target.value })} maxLength={80} disabled={disabled} />
        </Field>
        <Field id="ai-instr" label="Instructions" hint="Tone, what to focus on, what never to say. The agent only states facts from these instructions and the Knowledge tab.">
          <Textarea value={draft.instructions} onChange={(e) => set({ instructions: e.target.value })} rows={8} maxLength={8000} disabled={disabled} placeholder="You are the assistant for Sharma Dental Clinic in Ludhiana. Be warm and brief. Reply in Hindi or Punjabi if the customer does. Clinic hours are 10am–7pm, Monday to Saturday…" />
        </Field>
        <fieldset>
          <legend className="mb-2 text-small font-medium text-app-text">WhatsApp numbers</legend>
          <p className="mb-2 text-caption text-app-muted">Leave all unticked to answer on every number. Only one active agent can answer a number.</p>
          {accounts.length ? (
            <div className="grid gap-2 sm:grid-cols-2">
              {accounts.map((a) => (
                <Checkbox
                  key={a.id}
                  label={`${a.displayName} · ${a.phoneNumber}`}
                  description={a.isDemo ? "Demo number" : "Live number"}
                  checked={draft.accountIds.includes(a.id)}
                  disabled={disabled}
                  onChange={(e) => set({ accountIds: e.target.checked ? [...draft.accountIds, a.id] : draft.accountIds.filter((x) => x !== a.id) })}
                />
              ))}
            </div>
          ) : (
            <p className="text-small text-app-muted">No connected numbers yet.</p>
          )}
        </fieldset>
      </CardBody>
    </Card>
  );
}

/** Comma-separated list input that only splits when the field loses focus. */
function ListInput({ id, value, onChange, disabled, placeholder }: { id: string; value: string[]; onChange: (v: string[]) => void; disabled?: boolean; placeholder?: string }) {
  const [text, setText] = React.useState(value.join(", "));
  return (
    <Input
      id={id}
      value={text}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        const list = [...new Set(text.split(",").map((s) => s.trim()).filter(Boolean))];
        onChange(list);
        setText(list.join(", "));
      }}
    />
  );
}

function ItemsEditor({ title, items, onChange, disabled, kind }: { title: string; items: KbItem[]; onChange: (v: KbItem[]) => void; disabled: boolean; kind: string }) {
  return (
    <Card>
      <CardHeader title={title} description={`${items.length} ${kind}${items.length === 1 ? "" : "s"}`} action={!disabled ? <Button size="sm" variant="secondary" onClick={() => onChange([...items, { name: "", description: "", price: "" }])} disabled={items.length >= 100}><Plus aria-hidden="true" /> Add {kind}</Button> : null} />
      <CardBody className="space-y-3">
        {!items.length ? <p className="text-small text-app-muted">None yet.</p> : null}
        {items.map((it, i) => (
          <div key={i} className="grid gap-2 rounded-xl border border-app-border p-3 sm:grid-cols-[1fr_10rem_auto]">
            <Input aria-label={`${kind} ${i + 1} name`} placeholder="Name" value={it.name} maxLength={120} disabled={disabled} onChange={(e) => onChange(items.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
            <Input aria-label={`${kind} ${i + 1} price`} placeholder="Price (e.g. ₹1,499)" value={it.price} maxLength={60} disabled={disabled} onChange={(e) => onChange(items.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)))} />
            {!disabled ? (
              <IconButton label={`Remove ${kind} ${i + 1}`} onClick={() => onChange(items.filter((_, j) => j !== i))}>
                <X aria-hidden="true" />
              </IconButton>
            ) : <span />}
            <Textarea aria-label={`${kind} ${i + 1} description`} placeholder="Short description" value={it.description} rows={2} maxLength={1000} disabled={disabled} onChange={(e) => onChange(items.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} className="sm:col-span-3" />
          </div>
        ))}
      </CardBody>
    </Card>
  );
}

function KnowledgeTab({ draft, setDraft, agent, base, disabled, onDocs }: { draft: Editable; setDraft: SetDraft; agent: Agent; base: string; disabled: boolean; onDocs: (d: Doc[]) => void }) {
  const toast = useToast();
  const k = draft.knowledge;
  const setK = (p: Partial<AiKnowledge>) => setDraft((d) => (d ? { ...d, knowledge: { ...d.knowledge, ...p } } : d));
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = React.useState(false);
  const [paste, setPaste] = React.useState(false);

  async function upload(file: File) {
    setUploading(true);
    const form = new FormData();
    form.set("file", file);
    const res = await fetch(`${base}/documents`, { method: "POST", body: form });
    const body = (await res.json().catch(() => ({}))) as { document?: Doc; error?: string };
    setUploading(false);
    if (fileRef.current) fileRef.current.value = "";
    if (!res.ok || !body.document) return toast(body.error ?? "Upload failed", "error");
    onDocs([...agent.documents, body.document]);
    toast("Document added");
  }
  async function removeDoc(id: string) {
    const r = await apiFetch(`${base}/documents/${id}`, { method: "DELETE" });
    if (!r.ok) return toast(r.error, "error");
    onDocs(agent.documents.filter((d) => d.id !== id));
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="FAQs" description={`${k.faqs.length} question(s) — the agent answers these word for word when they match.`} action={!disabled ? <Button size="sm" variant="secondary" onClick={() => setK({ faqs: [...k.faqs, { q: "", a: "" }] })} disabled={k.faqs.length >= 100}><Plus aria-hidden="true" /> Add FAQ</Button> : null} />
        <CardBody className="space-y-3">
          {!k.faqs.length ? <p className="text-small text-app-muted">No FAQs yet. Add your most common questions — timings, location, delivery, refunds…</p> : null}
          {k.faqs.map((f, i) => (
            <div key={i} className="grid gap-2 rounded-xl border border-app-border p-3 sm:grid-cols-[1fr_auto]">
              <Input aria-label={`Question ${i + 1}`} placeholder="Question" value={f.q} maxLength={300} disabled={disabled} onChange={(e) => setK({ faqs: k.faqs.map((x, j) => (j === i ? { ...x, q: e.target.value } : x)) })} />
              {!disabled ? (
                <IconButton label={`Remove FAQ ${i + 1}`} onClick={() => setK({ faqs: k.faqs.filter((_, j) => j !== i) })}>
                  <X aria-hidden="true" />
                </IconButton>
              ) : <span />}
              <Textarea aria-label={`Answer ${i + 1}`} placeholder="Answer" value={f.a} rows={2} maxLength={2000} disabled={disabled} onChange={(e) => setK({ faqs: k.faqs.map((x, j) => (j === i ? { ...x, a: e.target.value } : x)) })} className="sm:col-span-2" />
            </div>
          ))}
        </CardBody>
      </Card>
      <div className="grid gap-4 xl:grid-cols-2">
        <ItemsEditor title="Products" kind="product" items={k.products} onChange={(products) => setK({ products })} disabled={disabled} />
        <ItemsEditor title="Services" kind="service" items={k.services} onChange={(services) => setK({ services })} disabled={disabled} />
      </div>
      <Card>
        <CardHeader title="Pricing" description="Packages, offers, delivery charges — anything about price the agent may quote." />
        <CardBody>
          <Textarea aria-label="Pricing" value={k.pricing} onChange={(e) => setK({ pricing: e.target.value })} rows={5} maxLength={5000} disabled={disabled} placeholder={"Basic cleaning: ₹800\nWhitening: ₹6,000 (festive offer ₹4,999 till 31 Oct)\nConsultation: free"} />
        </CardBody>
      </Card>
      <Card>
        <CardHeader
          title="Documents"
          description="Plain text only: .txt, .md or .csv up to 200 KB, or paste text. PDFs and Word files aren't read — paste their text instead. Documents save immediately."
          action={
            !disabled ? (
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => setPaste(true)}>Paste text</Button>
                <Button size="sm" variant="secondary" onClick={() => fileRef.current?.click()} loading={uploading}>
                  <Upload aria-hidden="true" /> Upload
                </Button>
                <input ref={fileRef} type="file" accept=".txt,.md,.csv,text/plain,text/markdown,text/csv" className="hidden" aria-hidden="true" tabIndex={-1} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
              </div>
            ) : null
          }
        />
        <CardBody>
          {!agent.documents.length ? (
            <p className="text-small text-app-muted">No documents yet.</p>
          ) : (
            <ul className="divide-y divide-app-border">
              {agent.documents.map((d) => (
                <li key={d.id} className="flex items-center gap-3 py-2">
                  <FileText className="size-4 shrink-0 text-app-subtle" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-small text-app-text">{d.name}</span>
                    <span className="block text-caption text-app-subtle">{(d.sizeBytes / 1000).toFixed(1)} KB · {d.mimeType}</span>
                  </span>
                  {!disabled ? (
                    <IconButton label={`Remove ${d.name}`} onClick={() => removeDoc(d.id)}>
                      <Trash2 aria-hidden="true" />
                    </IconButton>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
      {paste ? <PasteModal url={`${base}/documents`} onClose={() => setPaste(false)} onAdded={(d) => { setPaste(false); onDocs([...agent.documents, d]); toast("Document added"); }} /> : null}
    </div>
  );
}

function PasteModal({ url, onClose, onAdded }: { url: string; onClose: () => void; onAdded: (d: Doc) => void }) {
  const [name, setName] = React.useState("");
  const [content, setContent] = React.useState("");
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const r = await apiFetch<{ document: Doc }>(url, { method: "POST", body: { name, content } });
    setBusy(false);
    if (!r.ok) return setError(Object.values(r.details ?? {})[0]?.[0] ?? r.error);
    onAdded(r.data.document);
  }
  return (
    <Modal open onClose={onClose} title="Paste a document" size="lg">
      <form onSubmit={submit} className="space-y-4">
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <Field id="doc-name" label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="Return policy" />
        </Field>
        <Field id="doc-text" label="Text">
          <Textarea value={content} onChange={(e) => setContent(e.target.value)} rows={10} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={busy} disabled={!name.trim() || !content.trim()}>Add document</Button>
        </div>
      </form>
    </Modal>
  );
}

function ToggleRow({ title, description, checked, onChange, disabled, children }: { title: string; description: string; checked: boolean; onChange: (v: boolean) => void; disabled: boolean; children?: React.ReactNode }) {
  return (
    <div className="border-b border-app-border py-3 last:border-0">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-small font-medium text-app-text">{title}</p>
          <p className="text-caption text-app-muted">{description}</p>
        </div>
        <Switch checked={checked} onCheckedChange={onChange} label={title} disabled={disabled} />
      </div>
      {checked && children ? <div className="mt-3">{children}</div> : null}
    </div>
  );
}

function ActionsTab({ draft, setDraft, members, disabled }: { draft: Editable; setDraft: SetDraft; members: Member[]; disabled: boolean }) {
  const a = draft.actions;
  const h = draft.handoff;
  const setA = (p: Partial<AiActionsConfig>) => setDraft((d) => (d ? { ...d, actions: { ...d.actions, ...p } } : d));
  const setH = (p: Partial<AiHandoffConfig>) => setDraft((d) => (d ? { ...d, handoff: { ...d.handoff, ...p } } : d));
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card>
        <CardHeader title="AI actions" description="What the agent is allowed to do." />
        <CardBody>
          <ToggleRow title="Answer questions" description="From your FAQs, products, services, pricing and documents." checked={a.answer} onChange={(v) => setA({ answer: v })} disabled={disabled} />
          <ToggleRow title="Qualify leads" description="Marks the contact as a lead: qualified, contacted or lost." checked={a.qualify} onChange={(v) => setA({ qualify: v })} disabled={disabled} />
          <ToggleRow title="Collect information" description="Saves details the customer shares to their contact." checked={a.collect} onChange={(v) => setA({ collect: v })} disabled={disabled}>
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {COLLECTABLE_FIELDS.map((f) => (
                <Checkbox key={f} label={f} checked={a.collectFields.includes(f)} disabled={disabled} onChange={(e) => setA({ collectFields: e.target.checked ? [...a.collectFields, f] : a.collectFields.filter((x) => x !== f) })} />
              ))}
            </div>
          </ToggleRow>
          <ToggleRow title="Book appointments" description="Creates an appointment request; your team confirms the exact slot." checked={a.book} onChange={(v) => setA({ book: v })} disabled={disabled}>
            <Field id="ai-book-services" label="Bookable services" hint="Comma separated. Empty = the services in Knowledge.">
              <ListInput id="ai-book-services" value={a.bookingServices} onChange={(v) => setA({ bookingServices: v })} disabled={disabled} placeholder="Consultation, Cleaning, Whitening" />
            </Field>
          </ToggleRow>
          <ToggleRow title="Transfer to a human" description="When asked, or when the agent can't help." checked={a.transfer} onChange={(v) => setA({ transfer: v })} disabled={disabled} />
          <ToggleRow title="Summarize conversations" description="Leaves a summary note for the team on handoff (and on request in the inbox)." checked={a.summarize} onChange={(v) => setA({ summarize: v })} disabled={disabled} />
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Human handoff" description="When the AI hands over, it stops replying in that chat." />
        <CardBody className="space-y-4">
          <Field id="ai-kw" label="Handoff keywords" hint="Comma separated. A customer message containing one hands the chat over immediately.">
            <ListInput id="ai-kw" value={h.keywords} onChange={(v) => setH({ keywords: v })} disabled={disabled || !a.transfer} />
          </Field>
          <Field id="ai-assign" label="Assign the chat to">
            <Select value={h.assign} onChange={(e) => setH({ assign: e.target.value as AiHandoffConfig["assign"] })} disabled={disabled}>
              <option value="auto">Least busy teammate (auto)</option>
              <option value="user">A specific teammate</option>
              <option value="queue">Unassigned queue (owners & managers notified)</option>
            </Select>
          </Field>
          {h.assign === "user" ? (
            <Field id="ai-user" label="Teammate">
              <Select value={h.userId} onChange={(e) => setH({ userId: e.target.value })} disabled={disabled}>
                <option value="">Choose…</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>{m.name} · {m.role.replace("CLIENT_", "").toLowerCase()}</option>
                ))}
              </Select>
            </Field>
          ) : null}
          <Field id="ai-hmsg" label="Message to the customer">
            <Textarea value={h.message} onChange={(e) => setH({ message: e.target.value })} rows={2} maxLength={500} disabled={disabled} />
          </Field>
          <Field id="ai-resume" label="AI resumes">
            <Select value={h.resume} onChange={(e) => setH({ resume: e.target.value as AiHandoffConfig["resume"] })} disabled={disabled}>
              {(Object.keys(RESUME_LABELS) as AiHandoffConfig["resume"][]).map((r) => (
                <option key={r} value={r}>{RESUME_LABELS[r]}</option>
              ))}
            </Select>
          </Field>
          {h.resume === "after_hours" ? (
            <Field id="ai-hours" label="Hours without a teammate reply">
              <Input type="number" min={1} max={720} value={h.resumeAfterHours} onChange={(e) => setH({ resumeAfterHours: Math.min(720, Math.max(1, Number(e.target.value) || 1)) })} disabled={disabled} />
            </Field>
          ) : null}
          <p className="text-caption text-app-muted">The AI also steps back whenever a teammate replies in a chat or someone takes it.</p>
        </CardBody>
      </Card>
    </div>
  );
}

type TestTurn = { role: "customer" | "business"; text: string; label?: string; actions?: AiAction[]; handoff?: boolean };

function actionLabel(a: AiAction) {
  if (a.type === "answer") return `Answered · ${a.source}`;
  if (a.type === "collect") return `Collected · ${Object.entries(a.fields).map(([k, v]) => `${k}: ${v}`).join(", ")}`;
  if (a.type === "qualify") return `Lead → ${a.status}`;
  if (a.type === "book") return `Appointment · ${a.service} · ${a.requestedFor}`;
  return `Transfer · ${a.reason}`;
}

function TestTab({ url, live, dirty, canManage }: { url: string; live: boolean; dirty: boolean; canManage: boolean }) {
  const [mode, setMode] = React.useState<"live" | "demo">(live ? "live" : "demo");
  const [turns, setTurns] = React.useState<TestTurn[]>([]);
  const [text, setText] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  async function send(e: React.FormEvent) {
    e.preventDefault();
    const message = text.trim();
    if (!message) return;
    setBusy(true);
    setError("");
    const history = turns.map((t) => ({ role: t.role, text: t.text }));
    setTurns((t) => [...t, { role: "customer", text: message }]);
    setText("");
    const r = await apiFetch<{ turn: { reply: string; label: string; actions: AiAction[]; handoff: { reason: string } | null } }>(url, { method: "POST", body: { history, message, mode } });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setTurns((t) => [...t, { role: "business", text: r.data.turn.reply, label: r.data.turn.label, actions: r.data.turn.actions, handoff: !!r.data.turn.handoff }]);
  }
  if (!canManage) return <Alert tone="info">Only owners and managers can run the test chat.</Alert>;
  return (
    <Card>
      <CardHeader
        title="Test chat"
        description="Nothing is sent to WhatsApp and no contact changes. Tests use the saved settings."
        action={
          <div className="flex items-center gap-2">
            <Select aria-label="Engine" value={mode} onChange={(e) => setMode(e.target.value as "live" | "demo")} className="w-60">
              <option value="live" disabled={!live}>Live AI (Claude){live ? "" : " — not configured"}</option>
              <option value="demo">Demo AI (rule-based)</option>
            </Select>
            <IconButton label="Reset chat" onClick={() => setTurns([])}>
              <RotateCcw aria-hidden="true" />
            </IconButton>
          </div>
        }
      />
      <CardBody className="space-y-3">
        {dirty ? <Alert tone="warning">You have unsaved changes — save them to test the latest settings.</Alert> : null}
        {mode === "demo" ? <Alert tone="info" title={DEMO_LABEL}>Keyword matching only — this is not how the live AI behaves.</Alert> : null}
        <ol className="app-scroll max-h-[28rem] space-y-2 overflow-y-auto rounded-xl border border-app-border bg-app-bg/50 p-3" aria-live="polite">
          {!turns.length ? <li className="py-6 text-center text-small text-app-muted">Type a message as if you were the customer.</li> : null}
          {turns.map((t, i) => (
            <li key={i} className={cn("flex", t.role === "customer" ? "justify-start" : "justify-end")}>
              <div className={cn("max-w-[85%] rounded-2xl px-3.5 py-2 text-body", t.role === "customer" ? "rounded-bl-md bg-app-elevated" : "rounded-br-md bg-emerald-900/70")}>
                {t.label ? (
                  <p className="mb-1">
                    <Badge tone={t.label.startsWith("Live") ? "info" : "warning"}>{t.label}</Badge>
                  </p>
                ) : null}
                <p className="whitespace-pre-wrap break-words text-app-text">{t.text}</p>
                {t.actions?.length ? (
                  <ul className="mt-1.5 space-y-0.5">
                    {t.actions.map((a, j) => (
                      <li key={j} className="text-caption text-app-muted">⚙ {actionLabel(a)}</li>
                    ))}
                  </ul>
                ) : null}
                {t.handoff ? <p className="mt-1 text-caption text-amber-300">→ Chat would be handed to the team; the AI stops here.</p> : null}
              </div>
            </li>
          ))}
        </ol>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <form onSubmit={send} className="flex gap-2">
          <Input aria-label="Customer message" value={text} onChange={(e) => setText(e.target.value)} placeholder="Hi, what are your timings?" maxLength={2000} />
          <Button type="submit" loading={busy} disabled={!text.trim()}>
            <Send aria-hidden="true" /> Send
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}

type Interaction = { id: string; mode: string; kind: string; input: string; output: string; actions: AiAction[]; model: string; inputTokens: number; outputTokens: number; error: string; isTest: boolean; contact: { name: string; phone: string } | null; createdAt: string };
const KIND_TONE: Record<string, BadgeTone> = { reply: "success", handoff: "warning", summary: "info", skipped: "neutral", error: "danger" };

function ActivityTab({ url }: { url: string }) {
  const [page, setPage] = React.useState(1);
  const [data, setData] = React.useState<{ interactions: Interaction[]; total: number } | null>(null);
  const [error, setError] = React.useState("");
  const load = React.useCallback(async () => {
    const r = await apiFetch<{ interactions: Interaction[]; total: number }>(`${url}?page=${page}&pageSize=20`);
    if (!r.ok) return setError(r.error);
    setError("");
    setData(r.data);
  }, [url, page]);
  React.useEffect(() => {
    const t = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(t);
  }, [load]);
  if (error) return <ErrorState description={error} onRetry={load} />;
  if (!data) return <LoadingState />;
  return (
    <Card>
      <CardHeader title="Activity" description="Every reply, handoff, summary and skip — live and demo are labelled." />
      {!data.interactions.length ? (
        <EmptyState icon={History} title="No activity yet" description="Use the test chat or activate the agent." />
      ) : (
        <>
          <Table caption="AI activity" className="min-w-[760px]">
            <THead>
              <tr>
                <TH>When</TH>
                <TH>Engine</TH>
                <TH>Customer</TH>
                <TH>Message → reply</TH>
                <TH>Actions</TH>
              </tr>
            </THead>
            <TBody>
              {data.interactions.map((x) => (
                <TR key={x.id}>
                  <TD className="whitespace-nowrap align-top text-small text-app-muted">
                    {istFmt.format(new Date(x.createdAt))}
                    <div className="mt-1"><Badge tone={KIND_TONE[x.kind] ?? "neutral"}>{x.kind}</Badge></div>
                  </TD>
                  <TD className="align-top text-small">
                    {x.mode ? <Badge tone={x.mode === "live" ? "info" : "warning"}>{x.mode === "live" ? "Live AI" : "Demo AI"}</Badge> : <span className="text-app-subtle">—</span>}
                    <p className="mt-1 text-caption text-app-subtle">{x.model || "—"}{x.inputTokens ? ` · ${x.inputTokens}/${x.outputTokens} tok` : ""}</p>
                  </TD>
                  <TD className="align-top text-small">{x.isTest ? <span className="text-app-subtle">Test chat</span> : x.contact ? x.contact.name || x.contact.phone : "—"}</TD>
                  <TD className="max-w-md align-top text-small">
                    {x.input ? <p className="text-app-muted">“{x.input.slice(0, 160)}”</p> : null}
                    {x.output ? <p className="mt-1 whitespace-pre-wrap text-app-text">{x.output.slice(0, 300)}</p> : null}
                    {x.error ? <p className="mt-1 text-red-300">{x.error}</p> : null}
                  </TD>
                  <TD className="align-top text-caption text-app-muted">
                    {x.actions.length ? x.actions.map((a, i) => <p key={i}>{actionLabel(a)}</p>) : "—"}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
          <Pagination page={page} pageSize={20} total={data.total} onPageChange={setPage} />
        </>
      )}
    </Card>
  );
}

type Appointment = { id: string; service: string; requestedFor: string; status: string; source: string; notes: string; createdAt: string; contact: { id: string; name: string; phone: string } | null };
const APPT: Record<string, { label: string; tone: BadgeTone }> = {
  requested: { label: "Requested", tone: "warning" },
  confirmed: { label: "Confirmed", tone: "success" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  completed: { label: "Completed", tone: "info" },
};

function AppointmentsTab({ base }: { base: string }) {
  const toast = useToast();
  const [status, setStatus] = React.useState("requested");
  const [page, setPage] = React.useState(1);
  const [data, setData] = React.useState<{ appointments: Appointment[]; total: number } | null>(null);
  const [error, setError] = React.useState("");
  const load = React.useCallback(async () => {
    const r = await apiFetch<{ appointments: Appointment[]; total: number }>(`${base}?status=${status}&page=${page}&pageSize=20`);
    if (!r.ok) return setError(r.error);
    setError("");
    setData(r.data);
  }, [base, status, page]);
  React.useEffect(() => {
    const t = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(t);
  }, [load]);
  async function update(id: string, next: string) {
    const r = await apiFetch(`${base}/${id}`, { method: "PATCH", body: { status: next } });
    if (!r.ok) return toast(r.error, "error");
    toast(`Appointment ${APPT[next]?.label.toLowerCase() ?? next}`);
    void load();
  }
  return (
    <Card>
      <CardHeader
        title="Appointments"
        description="Requests from the AI agent and WhatsApp Flows. Confirm the exact time with the customer in the inbox."
        action={
          <Select aria-label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="w-40">
            <option value="">All</option>
            {Object.entries(APPT).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </Select>
        }
      />
      {error ? (
        <ErrorState description={error} onRetry={load} />
      ) : !data ? (
        <LoadingState />
      ) : !data.appointments.length ? (
        <EmptyState icon={CalendarCheck} title="No appointments" description="Turn on “Book appointments” for the agent, or use an Appointment Booking flow." />
      ) : (
        <>
          <Table caption="Appointments" className="min-w-[720px]">
            <THead>
              <tr>
                <TH>Customer</TH>
                <TH>Service</TH>
                <TH>Preferred time</TH>
                <TH>Status</TH>
                <TH className="text-right">Actions</TH>
              </tr>
            </THead>
            <TBody>
              {data.appointments.map((a) => (
                <TR key={a.id}>
                  <TD>
                    <span className="flex items-center gap-1.5 text-small"><UserRound className="size-3.5 text-app-subtle" aria-hidden="true" />{a.contact ? a.contact.name || a.contact.phone : "—"}</span>
                    <p className="text-caption text-app-subtle">{a.source === "ai" ? "AI agent" : a.source === "flow" ? "WhatsApp Flow" : "Manual"} · {istFmt.format(new Date(a.createdAt))}</p>
                  </TD>
                  <TD className="text-small">{a.service || "—"}</TD>
                  <TD className="text-small">{a.requestedFor || "—"}</TD>
                  <TD><Badge tone={APPT[a.status]?.tone ?? "neutral"} dot>{APPT[a.status]?.label ?? a.status}</Badge></TD>
                  <TD className="text-right">
                    <div className="flex justify-end gap-1">
                      {a.status === "requested" ? <Button size="sm" onClick={() => update(a.id, "confirmed")}>Confirm</Button> : null}
                      {a.status === "confirmed" ? <Button size="sm" variant="secondary" onClick={() => update(a.id, "completed")}>Complete</Button> : null}
                      {a.status === "requested" || a.status === "confirmed" ? <Button size="sm" variant="ghost" onClick={() => update(a.id, "cancelled")}>Cancel</Button> : null}
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
          <Pagination page={page} pageSize={20} total={data.total} onPageChange={setPage} />
        </>
      )}
    </Card>
  );
}
