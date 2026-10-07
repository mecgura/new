"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, RefreshCw, Rocket, Save, ShieldCheck, Trash2, Users, XCircle } from "lucide-react";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  ConfirmationDialog,
  Field,
  Input,
  LoadingState,
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
  Textarea,
  useToast,
} from "@/components/ds";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/client-api";
import { formatNumber } from "@/lib/catalog";
import { CATEGORY_LABELS, type SlotValues } from "@/lib/templates";
import type { Audience, AudienceFilters, VariableMapping } from "@/lib/validations";
import type { Tag } from "@/components/inbox/types";
import { WaPreview } from "@/components/templates/wa-preview";
import type { TemplateView } from "@/components/templates/types";
import { REASON_LABELS, istFmt, type CampaignView, type ComplianceReport, type SegmentView } from "@/components/campaigns/types";

type Account = { id: string; displayName: string; phoneNumber: string; isDemo: boolean };

const STEPS = [
  { id: 1, label: "Campaign details" },
  { id: 2, label: "Audience" },
  { id: 3, label: "Template" },
  { id: 4, label: "Variables" },
  { id: 5, label: "Schedule" },
  { id: 6, label: "Compliance review" },
  { id: 7, label: "Send" },
];

const EMPTY_FILTERS: AudienceFilters = { tagIds: [], tagMode: "any", excludeTagIds: [], leadStatuses: [], lifecycles: [], consent: ["opted_in"], sources: [] };

type Api = <T>(path: string, init?: { method?: string; body?: unknown }) => ReturnType<typeof apiFetch<T>>;

export function CampaignWizard({ orgId, campaign, accounts }: { orgId: string; campaign: CampaignView; accounts: Account[] }) {
  const router = useRouter();
  const toast = useToast();
  const [c, setC] = React.useState(campaign);
  const [step, setStep] = React.useState(Math.min(Math.max(campaign.step, 1), 7));
  const [delOpen, setDelOpen] = React.useState(false);
  const base = `/api/organizations/${orgId}`;
  const api: Api = React.useCallback((path, init) => apiFetch(`${base}${path}`, init), [base]);

  /** Saves a step's fields, then moves on. Returns false (and shows the error) on failure. */
  async function save(patch: Record<string, unknown>, next?: number): Promise<boolean> {
    const r = await api<{ campaign: CampaignView }>(`/campaigns/${c.id}`, { method: "PATCH", body: { ...patch, ...(next ? { step: next } : {}) } });
    if (!r.ok) {
      toast(Object.values(r.details ?? {})[0]?.[0] ?? r.error, "error");
      return false;
    }
    setC(r.data.campaign);
    if (next) setStep(next);
    return true;
  }

  async function remove() {
    const r = await api(`/campaigns/${c.id}`, { method: "DELETE" });
    if (!r.ok) return toast(r.error, "error");
    toast("Draft deleted");
    router.push("/campaigns");
  }

  const reachable = (n: number) => n <= Math.max(c.step, step);

  return (
    <>
      <PageHeader
        title={c.name}
        breadcrumb={[{ label: "Campaigns", href: "/campaigns" }, { label: c.name }]}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge dot>Draft</Badge>
            {c.isDemo ? <Badge tone="warning">Demo number — nothing reaches real customers</Badge> : null}
            {c.account ? <span>From {c.account.displayName} · {c.account.phoneNumber}</span> : null}
          </span>
        }
        actions={
          <Button variant="ghost" onClick={() => setDelOpen(true)}>
            <Trash2 aria-hidden="true" /> Delete draft
          </Button>
        }
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[14rem_minmax(0,1fr)]">
        <nav aria-label="Campaign steps" className="min-w-0">
          <div className="mb-2 lg:hidden">
            <p className="text-small text-app-muted">Step {step} of 7 — <span className="text-app-text">{STEPS[step - 1].label}</span></p>
            <div className="mt-2 h-1.5 rounded-full bg-app-elevated"><div className="h-full rounded-full bg-app-primary transition-all" style={{ width: `${(step / 7) * 100}%` }} /></div>
          </div>
          <ol className="hidden space-y-1 lg:block">
            {STEPS.map((s) => {
              const done = s.id < Math.max(c.step, step) && s.id !== step;
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    disabled={!reachable(s.id)}
                    onClick={() => setStep(s.id)}
                    aria-current={s.id === step ? "step" : undefined}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-small transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                      s.id === step ? "bg-app-primary-soft text-app-text" : "text-app-muted hover:bg-app-hover"
                    )}
                  >
                    <span className={cn("flex size-6 shrink-0 items-center justify-center rounded-full border text-caption font-semibold", s.id === step ? "border-app-primary text-app-primary-hover" : done ? "border-app-primary bg-app-primary text-app-on-primary" : "border-app-border-strong text-app-subtle")} aria-hidden="true">
                      {done ? "✓" : s.id}
                    </span>
                    {s.label}
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>
        <div className="min-w-0">
          {step === 1 ? <DetailsStep c={c} accounts={accounts} onSave={(p) => save(p, 2)} /> : null}
          {step === 2 ? <AudienceStep c={c} api={api} onBack={() => setStep(1)} onSave={(audience) => save({ audience }, 3)} /> : null}
          {step === 3 ? <TemplateStep c={c} api={api} onBack={() => setStep(2)} onSave={(templateId) => save({ templateId }, 4)} /> : null}
          {step === 4 ? <VariablesStep c={c} api={api} onBack={() => setStep(3)} onSave={(variables) => save({ variables }, 5)} /> : null}
          {step === 5 ? <ScheduleStep c={c} onBack={() => setStep(4)} onSave={(scheduledAt) => save({ scheduledAt }, 6)} /> : null}
          {step === 6 ? <ReviewStep c={c} api={api} onBack={() => setStep(5)} onReviewed={(review) => setC((x) => ({ ...x, review, reviewedAt: review.generatedAt }))} onNext={() => setStep(7)} /> : null}
          {step === 7 ? <SendStep c={c} api={api} onBack={() => setStep(6)} onLaunched={() => router.refresh()} /> : null}
        </div>
      </div>
      <ConfirmationDialog open={delOpen} onClose={() => setDelOpen(false)} onConfirm={remove} title="Delete this draft?" description="The campaign draft will be removed. Nothing has been sent." confirmLabel="Delete draft" />
    </>
  );
}

function StepFooter({ onBack, children }: { onBack?: () => void; children: React.ReactNode }) {
  return (
    <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
      {onBack ? (
        <Button variant="ghost" onClick={onBack}>
          <ChevronLeft aria-hidden="true" /> Back
        </Button>
      ) : (
        <span />
      )}
      <div className="flex flex-col gap-2 sm:flex-row">{children}</div>
    </div>
  );
}

function useBusy() {
  const [busy, setBusy] = React.useState(false);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };
  return [busy, run] as const;
}

// ---------------------------------------------------------------------------
// 1. Details
// ---------------------------------------------------------------------------

function DetailsStep({ c, accounts, onSave }: { c: CampaignView; accounts: Account[]; onSave: (p: Record<string, unknown>) => Promise<boolean> }) {
  const [f, setF] = React.useState({ name: c.name, description: c.description, whatsappAccountId: c.account?.id ?? accounts[0]?.id ?? "" });
  const [busy, run] = useBusy();
  return (
    <Card>
      <CardHeader title="1. Campaign details" description="Name it for your team and choose the number it's sent from." />
      <CardBody className="space-y-4">
        <Field id="cw-name" label="Campaign name">
          <Input value={f.name} onChange={(e) => setF((x) => ({ ...x, name: e.target.value }))} maxLength={120} />
        </Field>
        <Field id="cw-desc" label="Internal description">
          <Textarea value={f.description} onChange={(e) => setF((x) => ({ ...x, description: e.target.value }))} rows={2} maxLength={500} />
        </Field>
        <Field id="cw-acct" label="Send from" hint="Changing the number clears the template if it belongs to another WhatsApp account.">
          <Select value={f.whatsappAccountId} onChange={(e) => setF((x) => ({ ...x, whatsappAccountId: e.target.value }))}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.displayName} · {a.phoneNumber}{a.isDemo ? " (demo)" : ""}</option>
            ))}
          </Select>
        </Field>
        <StepFooter>
          <Button onClick={() => run(() => onSave(f))} loading={busy} disabled={!f.name.trim()}>
            Save & continue <ChevronRight aria-hidden="true" />
          </Button>
        </StepFooter>
      </CardBody>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// 2. Audience
// ---------------------------------------------------------------------------

function Chips<T extends string>({ label, options, value, onChange }: { label: string; options: { value: T; label: string }[]; value: T[]; onChange: (v: T[]) => void }) {
  return (
    <fieldset>
      <legend className="mb-1.5 text-small font-medium text-app-text">{label}</legend>
      <div className="flex flex-wrap gap-1.5">
        {options.length ? (
          options.map((o) => {
            const on = value.includes(o.value);
            return (
              <button
                key={o.value}
                type="button"
                aria-pressed={on}
                onClick={() => onChange(on ? value.filter((x) => x !== o.value) : [...value, o.value])}
                className={cn("rounded-full border px-3 py-1 text-small transition-colors", on ? "border-app-primary bg-app-primary-soft text-app-text" : "border-app-border text-app-muted hover:bg-app-hover")}
              >
                {o.label}
              </button>
            );
          })
        ) : (
          <span className="text-caption text-app-subtle">None yet</span>
        )}
      </div>
    </fieldset>
  );
}

type Preview = { total: number; optedIn: number; optedOut: number; suppressed: number; noConsent: number };

function AudienceStep({ c, api, onBack, onSave }: { c: CampaignView; api: Api; onBack: () => void; onSave: (a: Audience) => Promise<boolean> }) {
  const toast = useToast();
  const [mode, setMode] = React.useState<Audience["mode"]>(c.audience.mode);
  const [filters, setFilters] = React.useState<AudienceFilters>(c.step <= 2 && c.audience.mode === "filters" && !c.audience.filters.consent.length && !c.audience.filters.tagIds.length ? EMPTY_FILTERS : c.audience.filters);
  const [segmentId, setSegmentId] = React.useState(c.audience.segmentId ?? "");
  const [contactIds, setContactIds] = React.useState<string[]>(c.audience.contactIds);
  const [picked, setPicked] = React.useState<Record<string, string>>({});
  const [tags, setTags] = React.useState<Tag[]>([]);
  const [segments, setSegments] = React.useState<SegmentView[]>([]);
  const [preview, setPreview] = React.useState<Preview | null>(null);
  const [segName, setSegName] = React.useState("");
  const [q, setQ] = React.useState("");
  const [results, setResults] = React.useState<{ id: string; name: string; phone: string; optInStatus: string }[]>([]);
  const [busy, run] = useBusy();

  const audience: Audience = React.useMemo(() => ({ mode, filters, segmentId: mode === "segment" ? segmentId || null : null, contactIds: mode === "contacts" ? contactIds : [] }), [mode, filters, segmentId, contactIds]);

  React.useEffect(() => {
    void api<{ tags: Tag[] }>("/tags").then((r) => r.ok && setTags(r.data.tags));
    void api<{ segments: SegmentView[] }>("/segments").then((r) => r.ok && setSegments(r.data.segments));
  }, [api]);

  React.useEffect(() => {
    if (mode === "segment" && !segmentId) return;
    const t = window.setTimeout(() => {
      void api<Preview>("/campaigns/audience-preview", { method: "POST", body: { audience } }).then((r) => r.ok && setPreview(r.data));
    }, 300);
    return () => window.clearTimeout(t);
  }, [api, audience, mode, segmentId]);

  React.useEffect(() => {
    if (mode !== "contacts" || !q.trim()) return;
    const t = window.setTimeout(() => {
      void api<{ items: { id: string; name: string; phone: string; optInStatus: string }[] }>(`/contacts?${new URLSearchParams({ q, pageSize: "20" })}`).then((r) => r.ok && setResults(r.data.items));
    }, 250);
    return () => window.clearTimeout(t);
  }, [api, mode, q]);

  async function saveSegment() {
    const r = await api<{ segment: { id: string; name: string } }>("/segments", { method: "POST", body: { name: segName, filters } });
    if (!r.ok) return toast(r.details?.name?.[0] ?? r.error, "error");
    toast(`Segment “${r.data.segment.name}” saved`);
    setSegName("");
    const s = await api<{ segments: SegmentView[] }>("/segments");
    if (s.ok) setSegments(s.data.segments);
  }

  const tagOpts = tags.map((t) => ({ value: t.id, label: t.name }));
  const ready = mode !== "segment" || Boolean(segmentId);

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_18rem]">
      <Card className="min-w-0">
        <CardHeader title="2. Audience" description="Choose who could receive this campaign. The compliance review later removes anyone who can't be messaged." />
        <CardBody className="space-y-5">
          <fieldset className="grid gap-2 sm:grid-cols-2">
            <legend className="sr-only">Audience type</legend>
            <Radio name="aud-mode" label="Filter contacts" description="By tags, lead status, type, consent, source" checked={mode === "filters"} onChange={() => setMode("filters")} />
            <Radio name="aud-mode" label="Saved segment" description={`${segments.length} saved`} checked={mode === "segment"} onChange={() => setMode("segment")} />
            <Radio name="aud-mode" label="All contacts" description="Everyone in your contact list" checked={mode === "all"} onChange={() => setMode("all")} />
            <Radio name="aud-mode" label="Pick contacts" description="Search and select people" checked={mode === "contacts"} onChange={() => setMode("contacts")} />
          </fieldset>

          {mode === "filters" ? (
            <div className="space-y-4">
              <Chips label="Has tags" options={tagOpts} value={filters.tagIds} onChange={(v) => setFilters((f) => ({ ...f, tagIds: v }))} />
              {filters.tagIds.length > 1 ? (
                <Select aria-label="Tag matching" value={filters.tagMode} onChange={(e) => setFilters((f) => ({ ...f, tagMode: e.target.value as "any" | "all" }))} className="sm:w-64">
                  <option value="any">Any of these tags</option>
                  <option value="all">All of these tags</option>
                </Select>
              ) : null}
              <Chips label="Exclude tags" options={tagOpts} value={filters.excludeTagIds} onChange={(v) => setFilters((f) => ({ ...f, excludeTagIds: v }))} />
              <Chips
                label="Lead status"
                options={(["new", "contacted", "qualified", "proposal", "won", "lost"] as const).map((v) => ({ value: v, label: v[0].toUpperCase() + v.slice(1) }))}
                value={filters.leadStatuses}
                onChange={(v) => setFilters((f) => ({ ...f, leadStatuses: v }))}
              />
              <Chips label="Type" options={[{ value: "lead" as const, label: "Leads" }, { value: "customer" as const, label: "Customers" }]} value={filters.lifecycles} onChange={(v) => setFilters((f) => ({ ...f, lifecycles: v }))} />
              <Chips
                label="Consent status"
                options={[{ value: "opted_in" as const, label: "Opted in" }, { value: "unknown" as const, label: "No consent recorded" }, { value: "opted_out" as const, label: "Opted out" }]}
                value={filters.consent}
                onChange={(v) => setFilters((f) => ({ ...f, consent: v }))}
              />
              <Chips
                label="Source"
                options={[{ value: "whatsapp" as const, label: "WhatsApp" }, { value: "manual" as const, label: "Added manually" }, { value: "import" as const, label: "CSV import" }, { value: "api" as const, label: "API" }]}
                value={filters.sources}
                onChange={(v) => setFilters((f) => ({ ...f, sources: v }))}
              />
              <div className="flex flex-col gap-2 rounded-xl border border-app-border p-3 sm:flex-row sm:items-end">
                <Field id="seg-name" label="Save these filters as a segment" className="flex-1">
                  <Input value={segName} onChange={(e) => setSegName(e.target.value)} placeholder="e.g. Delhi VIP customers" maxLength={80} />
                </Field>
                <Button variant="secondary" onClick={saveSegment} disabled={!segName.trim()}>
                  <Save aria-hidden="true" /> Save segment
                </Button>
              </div>
            </div>
          ) : null}

          {mode === "segment" ? (
            segments.length ? (
              <Field id="aud-seg" label="Segment">
                <Select value={segmentId} onChange={(e) => setSegmentId(e.target.value)}>
                  <option value="">Choose a segment…</option>
                  {segments.map((s) => (
                    <option key={s.id} value={s.id}>{s.name} ({formatNumber(s.contacts)} contacts)</option>
                  ))}
                </Select>
              </Field>
            ) : (
              <Alert tone="info">No saved segments yet. Use “Filter contacts” and save the filters as a segment.</Alert>
            )
          ) : null}

          {mode === "contacts" ? (
            <div className="space-y-3">
              <SearchBar label="Search contacts" placeholder="Search name or phone…" value={q} onChange={(e) => setQ(e.target.value)} />
              {q.trim() ? (
                <ul className="max-h-64 divide-y divide-app-border overflow-y-auto rounded-xl border border-app-border">
                  {results.map((r) => (
                    <li key={r.id} className="px-3 py-2">
                      <Checkbox
                        label={`${r.name || "Unnamed"} · ${r.phone}`}
                        description={r.optInStatus === "opted_in" ? "Opted in" : r.optInStatus === "opted_out" ? "Opted out — will be removed" : "No consent — will be removed"}
                        checked={contactIds.includes(r.id)}
                        onChange={(e) => {
                          setContactIds((ids) => (e.target.checked ? [...ids, r.id] : ids.filter((x) => x !== r.id)));
                          setPicked((p) => ({ ...p, [r.id]: r.name || r.phone }));
                        }}
                      />
                    </li>
                  ))}
                  {!results.length ? <li className="px-3 py-2 text-small text-app-subtle">No matches</li> : null}
                </ul>
              ) : null}
              <p className="text-small text-app-muted">{contactIds.length} selected{contactIds.length ? `: ${contactIds.slice(0, 5).map((id) => picked[id] ?? "contact").join(", ")}${contactIds.length > 5 ? "…" : ""}` : ""}</p>
            </div>
          ) : null}

          <StepFooter onBack={onBack}>
            <Button onClick={() => run(() => onSave(audience))} loading={busy} disabled={!ready}>
              Save & continue <ChevronRight aria-hidden="true" />
            </Button>
          </StepFooter>
        </CardBody>
      </Card>
      <Card className="min-w-0 self-start">
        <CardHeader title="Audience size" description="Live count from your contacts." />
        <CardBody>
          {!preview ? (
            <p className="text-small text-app-muted">{mode === "segment" && !segmentId ? "Choose a segment." : "Counting…"}</p>
          ) : (
            <dl className="space-y-2 text-small">
              <div className="flex justify-between"><dt className="text-app-muted">Matching contacts</dt><dd className="text-h3 tabular-nums text-app-text">{formatNumber(preview.total)}</dd></div>
              <div className="flex justify-between"><dt className="text-emerald-300">Opted in</dt><dd className="tabular-nums">{formatNumber(preview.optedIn)}</dd></div>
              <div className="flex justify-between"><dt className="text-app-muted">No consent recorded</dt><dd className="tabular-nums">{formatNumber(preview.noConsent)}</dd></div>
              <div className="flex justify-between"><dt className="text-app-muted">Opted out</dt><dd className="tabular-nums">{formatNumber(preview.optedOut)}</dd></div>
              <div className="flex justify-between"><dt className="text-app-muted">Suppressed</dt><dd className="tabular-nums">{formatNumber(preview.suppressed)}</dd></div>
              <p className="pt-2 text-caption text-app-subtle">Only opted-in, non-suppressed contacts can receive campaigns.</p>
            </dl>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 3. Template
// ---------------------------------------------------------------------------

function TemplateStep({ c, api, onBack, onSave }: { c: CampaignView; api: Api; onBack: () => void; onSave: (id: string) => Promise<boolean> }) {
  const [list, setList] = React.useState<TemplateView[] | null>(null);
  const [error, setError] = React.useState("");
  const [id, setId] = React.useState(c.template?.id ?? "");
  const [busy, run] = useBusy();
  React.useEffect(() => {
    void api<{ templates: TemplateView[] }>("/templates?status=approved").then((r) => {
      if (!r.ok) return setError(r.error);
      setList(r.data.templates.filter((t) => t.category !== "AUTHENTICATION" && t.waba.numbers.some((n) => n.id === c.account?.id)));
    });
  }, [api, c.account?.id]);
  const t = list?.find((x) => x.id === id);
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
      <Card className="min-w-0">
        <CardHeader title="3. Template" description="Only Meta-approved Marketing or Utility templates on this number's WhatsApp account can be broadcast." />
        <CardBody>
          {error ? (
            <Alert tone="danger">{error}</Alert>
          ) : !list ? (
            <LoadingState />
          ) : !list.length ? (
            <Alert tone="info" title="No approved templates for this number">
              <Link href="/templates/new" className="underline">Create a template</Link> and get it approved, then come back.
            </Alert>
          ) : (
            <fieldset className="space-y-2">
              <legend className="sr-only">Approved templates</legend>
              {list.map((x) => (
                <label key={x.id} className={cn("flex cursor-pointer items-start gap-3 rounded-xl border p-3", id === x.id ? "border-app-primary bg-app-primary-soft" : "border-app-border hover:bg-app-hover")}>
                  <input type="radio" name="cw-template" checked={id === x.id} onChange={() => setId(x.id)} className="mt-1 accent-[var(--color-app-primary)]" />
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-small font-medium text-app-text">{x.name}</span>
                      <Badge>{CATEGORY_LABELS[x.category]}</Badge>
                      <Badge>{x.language}</Badge>
                      {x.qualityScore === "RED" ? <Badge tone="danger">Low quality</Badge> : null}
                    </span>
                    <span className="mt-1 line-clamp-2 block text-caption text-app-muted">{x.body}</span>
                  </span>
                </label>
              ))}
            </fieldset>
          )}
          <StepFooter onBack={onBack}>
            <Button onClick={() => run(() => onSave(id))} loading={busy} disabled={!id}>
              Save & continue <ChevronRight aria-hidden="true" />
            </Button>
          </StepFooter>
        </CardBody>
      </Card>
      <div className="min-w-0">{t ? <WaPreview t={t} /> : null}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 4. Variables
// ---------------------------------------------------------------------------

const SAMPLE = { name: "Priya Sharma", first_name: "Priya", phone: "+919876543210", email: "priya@example.com" };

function sampleValue(m: VariableMapping | undefined): string {
  if (!m) return "";
  if (m.source === "static") return m.value;
  if (m.field === "custom") return m.fallback || `‹${m.key || "custom field"}›`;
  return SAMPLE[m.field];
}

function VariablesStep({ c, api, onBack, onSave }: { c: CampaignView; api: Api; onBack: () => void; onSave: (v: Record<string, VariableMapping>) => Promise<boolean> }) {
  const [t, setT] = React.useState<TemplateView | null>(null);
  const [map, setMap] = React.useState<Record<string, VariableMapping>>(c.variables);
  const [busy, run] = useBusy();
  React.useEffect(() => {
    if (c.template) void api<{ template: TemplateView }>(`/templates/${c.template.id}`).then((r) => r.ok && setT(r.data.template));
  }, [api, c.template]);
  if (!c.template) return <Alert tone="warning">Choose a template first.</Alert>;
  if (!t) return <LoadingState />;
  const values: SlotValues = Object.fromEntries(t.slots.map((s) => [s.key, sampleValue(map[s.key])]));
  const complete = t.slots.every((s) => {
    const m = map[s.key];
    return m && (m.source === "static" ? m.value.trim() : m.field !== "custom" || m.key.trim());
  });
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
      <Card className="min-w-0">
        <CardHeader title="4. Variables" description="Fill each {{variable}} from the contact's details or with the same text for everyone. Contacts missing a value (and no fallback) are removed in review." />
        <CardBody className="space-y-4">
          {!t.slots.length ? <p className="text-small text-app-muted">“{t.name}” has no variables — nothing to fill.</p> : null}
          {t.slots.map((s) => {
            const m = map[s.key];
            const media = s.part === "header" && s.kind === "media";
            const sourceValue = !m ? "" : m.source === "static" ? "static" : m.field;
            return (
              <div key={s.key} className="rounded-xl border border-app-border p-3">
                <p className="mb-2 text-small font-medium text-app-text">{s.label}</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field id={`v-src-${s.key}`} label="Value from">
                    <Select
                      value={sourceValue}
                      onChange={(e) => {
                        const v = e.target.value;
                        setMap((x) => ({ ...x, [s.key]: v === "static" ? { source: "static", value: "" } : { source: "field", field: v as "name", key: "", fallback: "" } }));
                      }}
                    >
                      <option value="" disabled>Choose…</option>
                      {media ? null : (
                        <>
                          <option value="first_name">Contact first name</option>
                          <option value="name">Contact full name</option>
                          <option value="phone">Contact phone</option>
                          <option value="email">Contact email</option>
                          <option value="custom">Contact custom field</option>
                        </>
                      )}
                      <option value="static">{media ? "Media link (same for everyone)" : "Same text for everyone"}</option>
                    </Select>
                  </Field>
                  {m?.source === "static" ? (
                    <Field id={`v-val-${s.key}`} label={media ? "https:// link" : "Text"}>
                      <Input value={m.value} onChange={(e) => setMap((x) => ({ ...x, [s.key]: { source: "static", value: e.target.value } }))} placeholder={media ? "https://cdn.example.com/offer.jpg" : "e.g. DIWALI20"} />
                    </Field>
                  ) : m?.source === "field" ? (
                    <>
                      {m.field === "custom" ? (
                        <Field id={`v-key-${s.key}`} label="Custom field name">
                          <Input value={m.key} onChange={(e) => setMap((x) => ({ ...x, [s.key]: { ...m, key: e.target.value } }))} placeholder="city" />
                        </Field>
                      ) : null}
                      <Field id={`v-fb-${s.key}`} label="Fallback if empty" hint="Used when the contact has no value">
                        <Input value={m.fallback} onChange={(e) => setMap((x) => ({ ...x, [s.key]: { ...m, fallback: e.target.value } }))} placeholder={m.field === "first_name" || m.field === "name" ? "there" : ""} />
                      </Field>
                    </>
                  ) : null}
                </div>
              </div>
            );
          })}
          <StepFooter onBack={onBack}>
            <Button onClick={() => run(() => onSave(map))} loading={busy} disabled={!complete}>
              Save & continue <ChevronRight aria-hidden="true" />
            </Button>
          </StepFooter>
        </CardBody>
      </Card>
      <div className="min-w-0">
        <WaPreview t={t} values={values} />
        <p className="mt-2 text-center text-caption text-app-subtle">Shown with a sample contact (Priya Sharma).</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 5. Schedule
// ---------------------------------------------------------------------------

const istInput = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
function toIstInput(d: Date) {
  const p = Object.fromEntries(istInput.formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

function ScheduleStep({ c, onBack, onSave }: { c: CampaignView; onBack: () => void; onSave: (at: string | null) => Promise<boolean> }) {
  const [mode, setMode] = React.useState<"now" | "later">(c.scheduledAt ? "later" : "now");
  // Lazy initialiser: "an hour from now" is computed once, on mount.
  const [at, setAt] = React.useState(() => toIstInput(c.scheduledAt ? new Date(c.scheduledAt) : new Date(Date.now() + 60 * 60 * 1000)));
  const [busy, run] = useBusy();
  const iso = at ? new Date(`${at}:00+05:30`).toISOString() : null;
  return (
    <Card>
      <CardHeader title="5. Schedule" description="Send right after the review, or pick a time. Tip: daytime sends (10 am – 8 pm) get more reads and fewer blocks." />
      <CardBody className="space-y-4">
        <fieldset className="grid gap-2 sm:grid-cols-2">
          <legend className="sr-only">When to send</legend>
          <Radio name="cw-when" label="Send now" description="Starts immediately after you confirm in step 7" checked={mode === "now"} onChange={() => setMode("now")} />
          <Radio name="cw-when" label="Schedule" description="Sends automatically at the chosen time" checked={mode === "later"} onChange={() => setMode("later")} />
        </fieldset>
        {mode === "later" ? (
          <Field id="cw-at" label="Date & time (India Standard Time, IST)" hint="At least 2 minutes from now, up to 60 days ahead. Consent is re-checked for every contact at send time.">
            <Input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
          </Field>
        ) : null}
        <StepFooter onBack={onBack}>
          <Button onClick={() => run(() => onSave(mode === "later" ? iso : null))} loading={busy} disabled={mode === "later" && !iso}>
            Save & continue <ChevronRight aria-hidden="true" />
          </Button>
        </StepFooter>
      </CardBody>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// 6. Compliance review
// ---------------------------------------------------------------------------

const CHECK_ICON = {
  pass: <CheckCircle2 className="size-5 text-emerald-400" aria-hidden="true" />,
  warn: <AlertTriangle className="size-5 text-amber-400" aria-hidden="true" />,
  fail: <XCircle className="size-5 text-red-400" aria-hidden="true" />,
};
const CHECK_LABEL = { pass: "Passed", warn: "Warning", fail: "Blocking" };

export function ComplianceView({ review }: { review: ComplianceReport }) {
  const reasons = Object.entries(review.reasons).filter(([, n]) => n);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        {[
          { label: "Total", value: review.total, cls: "text-app-text" },
          { label: "Eligible", value: review.eligible, cls: "text-emerald-300" },
          { label: "Removed", value: review.removed, cls: review.removed ? "text-amber-300" : "text-app-text" },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-app-border bg-app-bg/40 p-3 text-center">
            <p className="text-caption text-app-muted">{s.label}</p>
            <p className={cn("text-h2 tabular-nums", s.cls)}>{formatNumber(s.value)}</p>
          </div>
        ))}
      </div>
      <ul className="divide-y divide-app-border rounded-xl border border-app-border">
        {review.checks.map((x) => (
          <li key={x.key} className="flex items-start gap-3 px-3 py-2.5">
            {CHECK_ICON[x.status]}
            <div className="min-w-0">
              <p className="text-small font-medium text-app-text">
                {x.label} <span className="sr-only">— {CHECK_LABEL[x.status]}</span>
              </p>
              <p className="text-caption text-app-muted">{x.detail}</p>
            </div>
          </li>
        ))}
      </ul>
      {reasons.length ? (
        <div>
          <p className="mb-2 text-small font-medium text-app-text">Removed — by reason</p>
          <Table caption="Removal reasons" className="min-w-0">
            <THead>
              <tr>
                <TH>Reason</TH>
                <TH className="text-right">Contacts</TH>
              </tr>
            </THead>
            <TBody>
              {reasons.map(([k, n]) => (
                <TR key={k}>
                  <TD>{REASON_LABELS[k] ?? k}</TD>
                  <TD className="text-right tabular-nums">{formatNumber(n ?? 0)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </div>
      ) : null}
      {review.removedSample.length ? (
        <details className="rounded-xl border border-app-border">
          <summary className="cursor-pointer px-3 py-2 text-small text-app-muted">Show removed contacts ({review.removedSample.length < review.removed ? `first ${review.removedSample.length}` : review.removedSample.length})</summary>
          <Table caption="Removed contacts" className="min-w-[480px]">
            <THead>
              <tr>
                <TH>Name</TH>
                <TH>Phone</TH>
                <TH>Reason</TH>
              </tr>
            </THead>
            <TBody>
              {review.removedSample.map((r, i) => (
                <TR key={`${r.phone}-${i}`}>
                  <TD>{r.name || "—"}</TD>
                  <TD className="font-mono text-small">{r.phone}</TD>
                  <TD className="text-small">{REASON_LABELS[r.reason] ?? r.reason}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </details>
      ) : null}
      <p className="text-caption text-app-subtle">Checked {istFmt.format(new Date(review.generatedAt))} IST</p>
    </div>
  );
}

function ReviewStep({ c, api, onBack, onReviewed, onNext }: { c: CampaignView; api: Api; onBack: () => void; onReviewed: (r: ComplianceReport) => void; onNext: () => void }) {
  const [busy, run] = useBusy();
  const [error, setError] = React.useState("");
  const review = c.review;
  const runReview = React.useCallback(
    () =>
      run(async () => {
        const r = await api<{ review: ComplianceReport }>(`/campaigns/${c.id}/review`, { method: "POST" });
        if (!r.ok) return setError(r.error);
        setError("");
        onReviewed(r.data.review);
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [api, c.id]
  );
  React.useEffect(() => {
    // Run automatically the first time this step opens.
    if (!review) void runReview();
  }, [review, runReview]);
  return (
    <Card>
      <CardHeader
        title="6. Compliance review"
        description="Every contact is checked against WhatsApp's rules before anything is sent."
        action={
          <Button variant="secondary" size="sm" onClick={runReview} loading={busy}>
            <RefreshCw aria-hidden="true" /> Re-run
          </Button>
        }
      />
      <CardBody>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {!review ? <LoadingState label="Checking contacts…" /> : <ComplianceView review={review} />}
        {review && !review.canSend ? (
          <Alert tone="danger" className="mt-4" title="Fix the blocking items before sending">
            Go back to the step that needs changes, then re-run the review.
          </Alert>
        ) : null}
        <StepFooter onBack={onBack}>
          <Button onClick={onNext} disabled={!review?.canSend || busy}>
            <ShieldCheck aria-hidden="true" /> Continue to send
          </Button>
        </StepFooter>
      </CardBody>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// 7. Send
// ---------------------------------------------------------------------------

function SendStep({ c, api, onBack, onLaunched }: { c: CampaignView; api: Api; onBack: () => void; onLaunched: () => void }) {
  const toast = useToast();
  const [confirm, setConfirm] = React.useState(false);
  const [busy, run] = useBusy();
  const [errors, setErrors] = React.useState<string[]>([]);
  const later = Boolean(c.scheduledAt);
  async function launch() {
    const r = await api<{ campaign: CampaignView }>(`/campaigns/${c.id}/launch`, { method: "POST", body: { confirmConsent: true } });
    if (!r.ok) return setErrors([r.error, ...((r.details?.review as string[] | undefined) ?? [])]);
    toast(later ? "Campaign scheduled" : "Campaign is sending");
    onLaunched();
  }
  const rows: [string, React.ReactNode][] = [
    ["Campaign", c.name],
    ["Send from", c.account ? `${c.account.displayName} · ${c.account.phoneNumber}${c.account.isDemo ? " (demo)" : ""}` : "—"],
    ["Template", c.template ? <span className="font-mono">{c.template.name} ({c.template.language})</span> : "—"],
    ["Recipients", c.review ? `${formatNumber(c.review.eligible)} eligible of ${formatNumber(c.review.total)} (${formatNumber(c.review.removed)} removed)` : "Run the review first"],
    ["When", c.scheduledAt ? `${istFmt.format(new Date(c.scheduledAt))} IST` : "Immediately"],
  ];
  return (
    <Card>
      <CardHeader title="7. Send" description="Final check. The audience is re-verified at launch, and consent again for each contact at send time." />
      <CardBody className="space-y-4">
        <dl className="divide-y divide-app-border rounded-xl border border-app-border">
          {rows.map(([k, v]) => (
            <div key={k} className="grid gap-1 px-3 py-2.5 sm:grid-cols-[9rem_minmax(0,1fr)]">
              <dt className="text-small text-app-muted">{k}</dt>
              <dd className="text-small text-app-text">{v}</dd>
            </div>
          ))}
        </dl>
        {c.isDemo ? <Alert tone="warning">Demo number: messages are recorded in MECGURA but never delivered to WhatsApp. Use the demo tools on the report to simulate delivery, reads, replies and opt-outs.</Alert> : null}
        {errors.length ? (
          <Alert tone="danger" title={errors[0]}>
            {errors.length > 1 ? <ul className="list-disc pl-4">{errors.slice(1).map((e) => <li key={e}>{e}</li>)}</ul> : null}
          </Alert>
        ) : null}
        <Checkbox
          label="I confirm every recipient gave us permission to message them on WhatsApp"
          description="Required by WhatsApp's Business Messaging Policy. Your confirmation is saved in the audit log."
          checked={confirm}
          onChange={(e) => setConfirm(e.target.checked)}
        />
        <StepFooter onBack={onBack}>
          <Button onClick={() => run(launch)} loading={busy} disabled={!confirm || !c.review?.canSend}>
            <Rocket aria-hidden="true" /> {later ? "Schedule campaign" : `Send to ${formatNumber(c.review?.eligible ?? 0)} contacts`}
          </Button>
        </StepFooter>
        <p className="flex items-center gap-1.5 text-caption text-app-subtle">
          <Users className="size-3.5" aria-hidden="true" /> Replies land in the Inbox; opt-outs (STOP) are honoured automatically.
        </p>
      </CardBody>
    </Card>
  );
}
