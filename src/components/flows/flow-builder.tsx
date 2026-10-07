"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Archive, CheckCircle2, ChevronDown, ClipboardCheck, Copy, Database, Download, FileJson, Flag, LayoutList, ListChecks, Play, Plus, Rocket, Save, Send, Trash2, X } from "lucide-react";
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
  Field,
  IconButton,
  Input,
  LoadingState,
  PageHeader,
  Pagination,
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
import {
  CATEGORY_LABELS,
  FIELD_LABELS,
  FLOW_CATEGORIES,
  INPUT_TYPES,
  LIMITS,
  SELECTION_TYPES,
  allFields,
  answerText,
  isSelection,
  validateFlow,
  type Answers,
  type FieldType,
  type FlowCategory,
  type FlowDefinition,
  type FlowField,
  type FlowScreen,
} from "@/lib/flows";
import { istFmt } from "@/components/campaigns/types";
import { FLOW_STATUS } from "@/components/flows/flows-app";

export type FlowView = {
  id: string;
  name: string;
  category: FlowCategory;
  status: string;
  definition: FlowDefinition;
  metaFlowId: string | null;
  metaStatus: string;
  validationErrors: string[];
  isDemo: boolean;
  submissions: number;
  publishedAt: string | null;
  updatedAt: string;
  waba: { id: string; name: string; isDemo: boolean; accounts: { id: string; displayName: string; phoneNumber: string }[] } | null;
};

type StepKey = "start" | `screen:${number}` | "confirm" | "submit" | "crm";

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/^(\d)/, "f_$1").slice(0, 40) || "field";

export function FlowBuilder({ orgId, flow, canManage }: { orgId: string; flow: FlowView; canManage: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const base = `/api/organizations/${orgId}/flows/${flow.id}`;
  const [f, setF] = React.useState(flow);
  const [def, setDef] = React.useState<FlowDefinition>(flow.definition);
  const [name, setName] = React.useState(flow.name);
  const [category, setCategory] = React.useState<FlowCategory>(flow.category);
  const [step, setStep] = React.useState<StepKey>("screen:0");
  const [tab, setTab] = React.useState("builder");
  const [saved, setSaved] = React.useState(JSON.stringify({ def: flow.definition, name: flow.name, category: flow.category }));
  const [busy, setBusy] = React.useState("");
  const [serverErrors, setServerErrors] = React.useState<string[]>(flow.validationErrors);
  const [confirm, setConfirm] = React.useState<"" | "retire" | "delete">("");
  const editable = canManage && f.status === "draft";
  const dirty = JSON.stringify({ def, name, category }) !== saved;
  const errors = React.useMemo(() => validateFlow(def), [def]);

  const patchDef = (fn: (d: FlowDefinition) => FlowDefinition) => setDef((d) => fn(structuredClone(d)));

  async function save(): Promise<boolean> {
    setBusy("save");
    const r = await apiFetch<{ flow: FlowView }>(base, { method: "PATCH", body: { name, category, definition: def } });
    setBusy("");
    if (!r.ok) {
      toast(Object.values(r.details ?? {})[0]?.[0] ?? r.error, "error");
      return false;
    }
    setF(r.data.flow);
    setSaved(JSON.stringify({ def, name, category }));
    return true;
  }
  async function publish() {
    if (errors.length) return toast(`Fix ${errors.length} problem(s) first`, "error");
    if (dirty && !(await save())) return;
    setBusy("publish");
    const r = await apiFetch<{ flow: FlowView }>(`${base}/publish`, { method: "POST" });
    setBusy("");
    if (!r.ok) {
      setServerErrors((r.details?.flow as string[] | undefined) ?? [r.error]);
      return toast(r.error, "error");
    }
    setF(r.data.flow);
    setServerErrors([]);
    toast(r.data.flow.isDemo ? "Published (demo) — test it from the Test tab" : "Published on WhatsApp");
  }
  async function act(kind: "duplicate" | "retire" | "delete") {
    setBusy(kind);
    const r =
      kind === "delete"
        ? await apiFetch(base, { method: "DELETE" })
        : await apiFetch<{ flow: FlowView }>(`${base}/${kind === "retire" ? "deprecate" : "duplicate"}`, { method: "POST" });
    setBusy("");
    setConfirm("");
    if (!r.ok) return toast(r.error, "error");
    if (kind === "delete") return router.push("/flows");
    const nf = (r.data as { flow: FlowView }).flow;
    if (kind === "duplicate") return router.push(`/flows/${nf.id}`);
    setF(nf);
    toast("Flow retired");
  }

  const status = FLOW_STATUS[f.status] ?? { label: f.status, tone: "neutral" as const };
  const TABS = [
    { id: "builder", label: "Builder", icon: LayoutList },
    { id: "submissions", label: `Submissions${f.submissions ? ` (${f.submissions})` : ""}`, icon: Database },
    { id: "test", label: "Test", icon: Play },
    { id: "json", label: "Flow JSON", icon: FileJson },
  ];

  return (
    <>
      <PageHeader
        title={f.name}
        breadcrumb={[{ label: "Flows", href: "/flows" }, { label: f.name }]}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={status.tone} dot>{status.label}</Badge>
            {f.isDemo ? <Badge tone="warning">Demo account — not on Meta</Badge> : null}
            <span>{CATEGORY_LABELS[f.category]}</span>
            {f.metaStatus ? <span className="text-caption text-app-subtle">Meta: {f.metaStatus}</span> : null}
            {dirty ? <span className="text-caption text-amber-300">Unsaved changes</span> : null}
          </span>
        }
        actions={
          canManage ? (
            <>
              {editable ? (
                <>
                  <Button variant="secondary" onClick={() => void save().then((ok) => ok && toast("Saved"))} loading={busy === "save"} disabled={!dirty}>
                    <Save aria-hidden="true" /> Save
                  </Button>
                  <Button onClick={publish} loading={busy === "publish"}>
                    <Rocket aria-hidden="true" /> Publish
                  </Button>
                </>
              ) : null}
              <Button variant="secondary" onClick={() => act("duplicate")} loading={busy === "duplicate"}>
                <Copy aria-hidden="true" /> Duplicate
              </Button>
              {f.status === "published" ? (
                <Button variant="secondary" onClick={() => setConfirm("retire")}>
                  <Archive aria-hidden="true" /> Retire
                </Button>
              ) : (
                <Button variant="ghost" onClick={() => setConfirm("delete")} aria-label="Delete flow">
                  <Trash2 aria-hidden="true" />
                </Button>
              )}
            </>
          ) : null
        }
      />
      <nav aria-label="Flow sections" className="mb-4 flex gap-1 overflow-x-auto border-b border-app-border">
        {TABS.map((t) => (
          <button key={t.id} type="button" onClick={() => setTab(t.id)} aria-current={tab === t.id ? "page" : undefined} className={cn("flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-small", tab === t.id ? "border-app-primary text-app-text" : "border-transparent text-app-muted hover:text-app-text")}>
            <t.icon className="size-4" aria-hidden="true" /> {t.label}
          </button>
        ))}
      </nav>

      {tab === "builder" ? (
        <>
          {f.status !== "draft" ? (
            <Alert tone="info" className="mb-4">
              {f.status === "published" ? "Published Flows are locked (Meta doesn't allow editing them). Duplicate it to make changes, then publish the copy." : "This Flow is retired and can't be sent anymore."}
            </Alert>
          ) : null}
          {serverErrors.length ? (
            <Alert tone="danger" title="Meta found problems" className="mb-4">
              <ul className="list-disc pl-4">{serverErrors.map((e) => <li key={e}>{e}</li>)}</ul>
            </Alert>
          ) : null}
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[15rem_minmax(0,1fr)_19rem]">
            <Outline def={def} step={step} setStep={setStep} errors={errors.length} editable={editable} onAddScreen={() => { patchDef((d) => ({ ...d, screens: [...d.screens, { title: `Step ${d.screens.length + 1}`, intro: "", fields: [], buttonLabel: "Continue" }] })); setStep(`screen:${def.screens.length}`); }} />
            <fieldset disabled={!editable} className="min-w-0 space-y-4">
              {step === "start" ? <StartEditor def={def} patchDef={patchDef} name={name} setName={setName} category={category} setCategory={setCategory} /> : null}
              {step.startsWith("screen:") ? <ScreenEditor index={Number(step.split(":")[1])} def={def} patchDef={patchDef} setStep={setStep} /> : null}
              {step === "confirm" ? <ConfirmEditor def={def} patchDef={patchDef} /> : null}
              {step === "submit" ? <SubmitEditor def={def} patchDef={patchDef} /> : null}
              {step === "crm" ? <CrmEditor def={def} patchDef={patchDef} /> : null}
              {errors.length ? (
                <Card>
                  <CardBody>
                    <p className="mb-2 text-small font-medium text-red-300">{errors.length} thing(s) to fix before publishing</p>
                    <ul className="list-disc space-y-1 pl-4 text-caption text-app-muted">{errors.map((e) => <li key={e}>{e}</li>)}</ul>
                  </CardBody>
                </Card>
              ) : (
                <p className="flex items-center gap-1.5 text-caption text-emerald-300"><CheckCircle2 className="size-4" aria-hidden="true" /> Ready to publish.</p>
              )}
            </fieldset>
            <div className="min-w-0 xl:sticky xl:top-4 xl:self-start">
              <PhonePreview def={def} step={step} />
            </div>
          </div>
        </>
      ) : null}
      {tab === "submissions" ? <Submissions orgId={orgId} flow={f} /> : null}
      {tab === "test" ? <TestPanel orgId={orgId} flow={f} /> : null}
      {tab === "json" ? <JsonPanel url={`${base}/json`} /> : null}

      <ConfirmationDialog
        open={confirm === "retire"}
        onClose={() => setConfirm("")}
        onConfirm={() => act("retire")}
        loading={busy === "retire"}
        title="Retire this flow?"
        description="Customers who already have it open can't submit any more, and it can't be sent again. Submissions are kept."
        confirmLabel="Retire flow"
      />
      <ConfirmationDialog open={confirm === "delete"} onClose={() => setConfirm("")} onConfirm={() => act("delete")} loading={busy === "delete"} title="Delete this flow?" description="The flow and its submissions are deleted. Contact updates already made stay." confirmLabel="Delete" />
    </>
  );
}

// ---------------------------------------------------------------------------
// Outline: Start → Screens (inputs/selections) → Confirmation → Submit → CRM Action
// ---------------------------------------------------------------------------

function Outline({ def, step, setStep, errors, editable, onAddScreen }: { def: FlowDefinition; step: StepKey; setStep: (s: StepKey) => void; errors: number; editable: boolean; onAddScreen: () => void }) {
  const item = (k: StepKey, icon: React.ElementType, title: string, sub: string) => <OutlineItem k={k} icon={icon} title={title} sub={sub} active={step === k} onSelect={setStep} />;
  return (
    <nav aria-label="Flow steps" className="min-w-0">
      {item("start", Flag, "Start", def.start.cta ? `Button “${def.start.cta}”` : "Message & button")}
      {def.screens.map((s, i) => {
        const inputs = s.fields.filter((x) => !isSelection(x.type)).length;
        const sels = s.fields.length - inputs;
        return (
          <React.Fragment key={i}>
            <OutlineArrow />
            {item(`screen:${i}`, LayoutList, `Screen ${i + 1}: ${s.title || "Untitled"}`, `${inputs} input${inputs === 1 ? "" : "s"} · ${sels} selection${sels === 1 ? "" : "s"}`)}
          </React.Fragment>
        );
      })}
      {editable && def.screens.length < LIMITS.screens ? (
        <Button size="sm" variant="ghost" className="mt-1 w-full" onClick={onAddScreen}>
          <Plus aria-hidden="true" /> Add screen
        </Button>
      ) : null}
      <OutlineArrow />
      {item("confirm", ClipboardCheck, "Confirmation", def.confirmation.enabled ? "Review answers before submit" : "Off")}
      <OutlineArrow />
      {item("submit", Send, "Submit", `“${def.submit.label}”`)}
      <OutlineArrow />
      {item("crm", Database, "CRM action", `${Object.values(def.crm.fieldMap).filter((v) => v !== "ignore").length} fields → contact${def.crm.tags.length ? ` · ${def.crm.tags.length} tag(s)` : ""}`)}
      <p className={cn("mt-3 text-caption", errors ? "text-red-300" : "text-emerald-300")}>{errors ? `${errors} problem(s)` : "No problems"}</p>
    </nav>
  );
}

function OutlineItem({ k, icon: Icon, title, sub, active, onSelect }: { k: StepKey; icon: React.ElementType; title: string; sub: string; active: boolean; onSelect: (s: StepKey) => void }) {
  return (
    <button type="button" onClick={() => onSelect(k)} aria-current={active ? "step" : undefined} className={cn("flex w-full items-start gap-2.5 rounded-xl border p-2.5 text-left", active ? "border-app-primary bg-app-primary-soft" : "border-app-border bg-app-elevated hover:border-app-border-strong")}>
      <Icon className="mt-0.5 size-4 shrink-0 text-app-primary" aria-hidden="true" />
      <span className="min-w-0">
        <span className="block truncate text-small font-medium text-app-text">{title}</span>
        <span className="block text-caption text-app-subtle">{sub}</span>
      </span>
    </button>
  );
}

function OutlineArrow() {
  return <ChevronDown className="mx-auto my-0.5 size-4 text-app-subtle" aria-hidden="true" />;
}

type PatchDef = (fn: (d: FlowDefinition) => FlowDefinition) => void;

function StartEditor({ def, patchDef, name, setName, category, setCategory }: { def: FlowDefinition; patchDef: PatchDef; name: string; setName: (v: string) => void; category: FlowCategory; setCategory: (c: FlowCategory) => void }) {
  return (
    <Card>
      <CardHeader title="Start" description="The WhatsApp message that opens the form." />
      <CardBody className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="fs-name" label="Flow name">
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
          </Field>
          <Field id="fs-cat" label="Category (Meta)">
            <Select value={category} onChange={(e) => setCategory(e.target.value as FlowCategory)}>
              {FLOW_CATEGORIES.map((c) => (
                <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
              ))}
            </Select>
          </Field>
        </div>
        <Field id="fs-body" label="Message text">
          <Textarea value={def.start.body} onChange={(e) => patchDef((d) => ({ ...d, start: { ...d.start, body: e.target.value } }))} rows={3} maxLength={LIMITS.body} />
        </Field>
        <Field id="fs-cta" label="Button text" hint={`Max ${LIMITS.cta} characters.`}>
          <Input value={def.start.cta} onChange={(e) => patchDef((d) => ({ ...d, start: { ...d.start, cta: e.target.value } }))} maxLength={LIMITS.cta} />
        </Field>
      </CardBody>
    </Card>
  );
}

function ScreenEditor({ index, def, patchDef, setStep }: { index: number; def: FlowDefinition; patchDef: PatchDef; setStep: (s: StepKey) => void }) {
  const s = def.screens[index];
  if (!s) return <EmptyState icon={LayoutList} title="Screen not found" />;
  const setScreen = (patch: Partial<FlowScreen>) => patchDef((d) => ({ ...d, screens: d.screens.map((x, i) => (i === index ? { ...x, ...patch } : x)) }));
  const setField = (fi: number, patch: Partial<FlowField>) => setScreen({ fields: s.fields.map((x, j) => (j === fi ? { ...x, ...patch } : x)) });
  const used = new Set(allFields(def).map((x) => x.name));
  const addField = (type: FieldType) => {
    const label = FIELD_LABELS[type];
    let key = slug(label);
    for (let i = 2; used.has(key); i++) key = `${slug(label)}_${i}`;
    setScreen({ fields: [...s.fields, { name: key, type, label, required: type !== "optin", options: type === "dropdown" || type === "radio" || type === "checkbox" ? ["Option 1", "Option 2"] : [] }] });
  };
  const move = (fi: number, dir: -1 | 1) => {
    const arr = [...s.fields];
    const [x] = arr.splice(fi, 1);
    arr.splice(fi + dir, 0, x);
    setScreen({ fields: arr });
  };
  return (
    <Card>
      <CardHeader
        title={`Screen ${index + 1}`}
        description="Inputs (text, email, date…) and selections (dropdown, choices, consent)."
        action={
          def.screens.length > 1 ? (
            <Button size="sm" variant="ghost" onClick={() => { patchDef((d) => ({ ...d, screens: d.screens.filter((_, i) => i !== index) })); setStep("screen:0"); }}>
              <Trash2 aria-hidden="true" /> Remove screen
            </Button>
          ) : null
        }
      />
      <CardBody className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id={`sc-title-${index}`} label="Screen title">
            <Input value={s.title} onChange={(e) => setScreen({ title: e.target.value })} maxLength={LIMITS.title} />
          </Field>
          <Field id={`sc-btn-${index}`} label="Button" hint={index === def.screens.length - 1 && !def.confirmation.enabled ? "Last screen — the Submit label is used." : undefined}>
            <Input value={s.buttonLabel} onChange={(e) => setScreen({ buttonLabel: e.target.value })} maxLength={LIMITS.cta} />
          </Field>
        </div>
        <Field id={`sc-intro-${index}`} label="Intro text (optional)">
          <Input value={s.intro} onChange={(e) => setScreen({ intro: e.target.value })} maxLength={300} />
        </Field>
        <ul className="space-y-3">
          {s.fields.map((fl, fi) => (
            <li key={fi} className="rounded-xl border border-app-border p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <Badge tone={isSelection(fl.type) ? "info" : "primary"}>{isSelection(fl.type) ? "Selection" : "Input"} · {FIELD_LABELS[fl.type]}</Badge>
                <span className="flex">
                  <IconButton label="Move up" disabled={fi === 0} onClick={() => move(fi, -1)}><ArrowUp aria-hidden="true" /></IconButton>
                  <IconButton label="Move down" disabled={fi === s.fields.length - 1} onClick={() => move(fi, 1)}><ArrowDown aria-hidden="true" /></IconButton>
                  <IconButton label={`Remove ${fl.label}`} onClick={() => setScreen({ fields: s.fields.filter((_, j) => j !== fi) })}><X aria-hidden="true" /></IconButton>
                </span>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field id={`fl-l-${index}-${fi}`} label="Label">
                  <Input value={fl.label} onChange={(e) => setField(fi, { label: e.target.value })} maxLength={LIMITS.label} />
                </Field>
                <Field id={`fl-k-${index}-${fi}`} label="Key" hint="Used in submissions & CRM">
                  <Input value={fl.name} onChange={(e) => setField(fi, { name: slug(e.target.value) })} className="font-mono" />
                </Field>
                <Field id={`fl-t-${index}-${fi}`} label="Type">
                  <Select value={fl.type} onChange={(e) => setField(fi, { type: e.target.value as FieldType })}>
                    <optgroup label="Inputs">{INPUT_TYPES.map((t) => <option key={t} value={t}>{FIELD_LABELS[t]}</option>)}</optgroup>
                    <optgroup label="Selections">{SELECTION_TYPES.map((t) => <option key={t} value={t}>{FIELD_LABELS[t]}</option>)}</optgroup>
                  </Select>
                </Field>
              </div>
              {fl.type === "dropdown" || fl.type === "radio" || fl.type === "checkbox" ? (
                <Field id={`fl-o-${index}-${fi}`} label="Options (one per line)" className="mt-3">
                  <Textarea value={fl.options.join("\n")} onChange={(e) => setField(fi, { options: e.target.value.split("\n").slice(0, LIMITS.options + 5) })} rows={Math.min(8, Math.max(3, fl.options.length))} />
                </Field>
              ) : null}
              <Checkbox className="mt-2" label="Required" checked={fl.required} onChange={(e) => setField(fi, { required: e.target.checked })} />
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2">
          <AddMenu label="Input" types={INPUT_TYPES} onAdd={addField} disabled={s.fields.length >= LIMITS.fieldsPerScreen} />
          <AddMenu label="Selection" types={SELECTION_TYPES} onAdd={addField} disabled={s.fields.length >= LIMITS.fieldsPerScreen} />
        </div>
      </CardBody>
    </Card>
  );
}

function AddMenu({ label, types, onAdd, disabled }: { label: string; types: readonly FieldType[]; onAdd: (t: FieldType) => void; disabled: boolean }) {
  const [value, setValue] = React.useState("");
  return (
    <Select
      aria-label={`Add ${label.toLowerCase()}`}
      value={value}
      disabled={disabled}
      onChange={(e) => {
        if (e.target.value) onAdd(e.target.value as FieldType);
        setValue("");
      }}
      className="h-9 w-auto text-small"
    >
      <option value="">+ Add {label.toLowerCase()}…</option>
      {types.map((t) => (
        <option key={t} value={t}>{FIELD_LABELS[t]}</option>
      ))}
    </Select>
  );
}

function ConfirmEditor({ def, patchDef }: { def: FlowDefinition; patchDef: PatchDef }) {
  const c = def.confirmation;
  const set = (p: Partial<typeof c>) => patchDef((d) => ({ ...d, confirmation: { ...d.confirmation, ...p } }));
  return (
    <Card>
      <CardHeader title="Confirmation" description="Shows the answers so the customer can check them before submitting." />
      <CardBody className="space-y-4">
        <Checkbox label="Show a confirmation screen" checked={c.enabled} onChange={(e) => set({ enabled: e.target.checked, title: c.title || "Confirm" })} />
        {c.enabled ? (
          <>
            <Field id="cf-title" label="Title">
              <Input value={c.title} onChange={(e) => set({ title: e.target.value })} maxLength={LIMITS.title} />
            </Field>
            <Field id="cf-body" label="Text above the summary (optional)">
              <Textarea value={c.body} onChange={(e) => set({ body: e.target.value })} rows={2} maxLength={300} />
            </Field>
            <p className="text-caption text-app-subtle">Multiple-choice and consent answers aren&apos;t repeated on this screen (WhatsApp shows text answers only).</p>
          </>
        ) : null}
      </CardBody>
    </Card>
  );
}

function SubmitEditor({ def, patchDef }: { def: FlowDefinition; patchDef: PatchDef }) {
  const s = def.submit;
  const set = (p: Partial<typeof s>) => patchDef((d) => ({ ...d, submit: { ...d.submit, ...p } }));
  return (
    <Card>
      <CardHeader title="Submit" description="The final button, and the WhatsApp reply sent after a submission." />
      <CardBody className="space-y-4">
        <Field id="sb-label" label="Submit button">
          <Input value={s.label} onChange={(e) => set({ label: e.target.value })} maxLength={LIMITS.cta} />
        </Field>
        <Field id="sb-thanks" label="Thank-you message (sent in the chat)" hint="Leave empty to send nothing.">
          <Textarea value={s.thankYou} onChange={(e) => set({ thankYou: e.target.value })} rows={3} maxLength={1000} />
        </Field>
      </CardBody>
    </Card>
  );
}

function CrmEditor({ def, patchDef }: { def: FlowDefinition; patchDef: PatchDef }) {
  const c = def.crm;
  const set = (p: Partial<typeof c>) => patchDef((d) => ({ ...d, crm: { ...d.crm, ...p } }));
  const fields = allFields(def);
  const optins = fields.filter((x) => x.type === "optin");
  const dates = fields.filter((x) => x.type === "date");
  return (
    <Card>
      <CardHeader title="CRM action" description="Each submission is saved (contact, answers, time, flow, source) and creates or updates the contact." />
      <CardBody className="space-y-5">
        <div>
          <p className="mb-2 text-small font-medium text-app-text">Save answers to the contact</p>
          <ul className="divide-y divide-app-border rounded-xl border border-app-border">
            {fields.map((fl) => (
              <li key={fl.name} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <span className="text-small">{fl.label} <span className="font-mono text-caption text-app-subtle">{fl.name}</span></span>
                <Select aria-label={`Map ${fl.label}`} value={c.fieldMap[fl.name] ?? "ignore"} onChange={(e) => set({ fieldMap: { ...c.fieldMap, [fl.name]: e.target.value as "ignore" } })} className="h-8 w-44 text-small">
                  <option value="ignore">Submission only</option>
                  <option value="name">Contact name</option>
                  {fl.type === "email" ? <option value="email">Contact email</option> : null}
                  <option value="custom">Custom field “{fl.name}”</option>
                </Select>
              </li>
            ))}
          </ul>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="crm-life" label="Set type">
            <Select value={c.lifecycle} onChange={(e) => set({ lifecycle: e.target.value as "" })}>
              <option value="">Don&apos;t change</option>
              <option value="lead">Lead</option>
              <option value="customer">Customer</option>
            </Select>
          </Field>
          <Field id="crm-ls" label="Set lead status">
            <Select value={c.leadStatus} onChange={(e) => set({ leadStatus: e.target.value as "" })} className="capitalize">
              <option value="">Don&apos;t change</option>
              {["new", "contacted", "qualified", "proposal", "won", "lost"].map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
          </Field>
          <Field id="crm-tags" label="Add tags" hint="Comma separated">
            <Input value={c.tags.join(", ")} onChange={(e) => set({ tags: e.target.value.split(",").map((t) => t.trimStart()).filter((t, i, a) => t || i === a.length - 1).slice(0, 10) })} />
          </Field>
          <Field id="crm-assign" label="Route the chat">
            <Select value={c.assign} onChange={(e) => set({ assign: e.target.value as "none" })}>
              <option value="none">Don&apos;t assign</option>
              <option value="auto">Assign to the least busy agent</option>
            </Select>
          </Field>
          <Field id="crm-consent" label="Record WhatsApp opt-in from" hint={optins.length ? "Ticking it records consent with evidence." : "Add a consent checkbox to use this."}>
            <Select value={c.consentField} onChange={(e) => set({ consentField: e.target.value })} disabled={!optins.length}>
              <option value="">None</option>
              {optins.map((o) => <option key={o.name} value={o.name}>{o.label}</option>)}
            </Select>
          </Field>
        </div>
        <div className="space-y-3 rounded-xl border border-app-border p-3">
          <Checkbox label="Create an appointment request" description="Shows under AI agent → Appointments for the team to confirm." checked={c.appointment.enabled} disabled={!dates.length} onChange={(e) => set({ appointment: { ...c.appointment, enabled: e.target.checked, dateField: c.appointment.dateField || dates[0]?.name || "" } })} />
          {c.appointment.enabled ? (
            <div className="grid gap-3 sm:grid-cols-3">
              {(["serviceField", "dateField", "timeField"] as const).map((k) => (
                <Field key={k} id={`crm-ap-${k}`} label={k === "serviceField" ? "Service" : k === "dateField" ? "Date" : "Time"}>
                  <Select value={c.appointment[k]} onChange={(e) => set({ appointment: { ...c.appointment, [k]: e.target.value } })}>
                    <option value="">{k === "dateField" ? "Choose…" : "None"}</option>
                    {(k === "dateField" ? dates : fields).map((x) => <option key={x.name} value={x.name}>{x.label}</option>)}
                  </Select>
                </Field>
              ))}
            </div>
          ) : !dates.length ? <p className="text-caption text-app-subtle">Add a Date input to enable appointments.</p> : null}
        </div>
        <Checkbox label="Add the answers as a note on the contact" checked={c.addNote} onChange={(e) => set({ addNote: e.target.checked })} />
      </CardBody>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Phone preview
// ---------------------------------------------------------------------------

function PreviewField({ fl }: { fl: FlowField }) {
  const req = fl.required ? "" : " (optional)";
  if (fl.type === "dropdown") return <div className="rounded-lg border border-white/15 px-3 py-2 text-caption text-white/70">{fl.label}{req} <ChevronDown className="float-right size-3.5" aria-hidden="true" /></div>;
  if (fl.type === "radio" || fl.type === "checkbox")
    return (
      <fieldset>
        <legend className="mb-1 text-caption font-medium text-white/80">{fl.label}{req}</legend>
        {fl.options.filter(Boolean).slice(0, 6).map((o) => (
          <p key={o} className="flex items-center gap-2 py-0.5 text-caption text-white/70">
            <span className={cn("inline-block size-3 border border-white/40", fl.type === "radio" ? "rounded-full" : "rounded-sm")} aria-hidden="true" /> {o}
          </p>
        ))}
      </fieldset>
    );
  if (fl.type === "optin") return <p className="flex items-start gap-2 text-caption text-white/70"><span className="mt-0.5 inline-block size-3 shrink-0 rounded-sm border border-white/40" aria-hidden="true" /> {fl.label}</p>;
  return <div className={cn("rounded-lg border border-white/15 px-3 text-caption text-white/50", fl.type === "textarea" ? "h-14 py-2" : "py-2")}>{fl.label}{req}</div>;
}

function PhonePreview({ def, step }: { def: FlowDefinition; step: StepKey }) {
  const idx = step.startsWith("screen:") ? Number(step.split(":")[1]) : step === "start" ? -1 : def.screens.length;
  const screen = idx >= 0 && idx < def.screens.length ? def.screens[idx] : null;
  const isLast = screen && idx === def.screens.length - 1 && !def.confirmation.enabled;
  return (
    <div className="rounded-[2rem] border border-app-border bg-[#0b1410] p-3" aria-label="WhatsApp preview">
      <p className="mb-2 text-center text-caption text-app-subtle">Preview</p>
      {step === "start" ? (
        <div className="max-w-[16rem] rounded-xl rounded-tl-sm bg-app-elevated text-small">
          <p className="whitespace-pre-wrap px-3 py-2.5">{def.start.body || "Message…"}</p>
          <p className="border-t border-app-border py-2 text-center text-sky-300">📋 {def.start.cta || "Open"}</p>
        </div>
      ) : step === "crm" ? (
        <div className="space-y-2 rounded-xl bg-app-elevated p-3 text-caption text-app-muted">
          <p className="text-small font-medium text-app-text">After submit</p>
          <p>✓ Saved: contact, answers, time, flow, source</p>
          {Object.values(def.crm.fieldMap).some((v) => v !== "ignore") ? <p>✓ Contact fields updated</p> : null}
          {def.crm.tags.length ? <p>✓ Tags: {def.crm.tags.join(", ")}</p> : null}
          {def.crm.leadStatus ? <p>✓ Lead status → {def.crm.leadStatus}</p> : null}
          {def.crm.appointment.enabled ? <p>✓ Appointment request</p> : null}
          {def.crm.assign === "auto" ? <p>✓ Assigned to an agent</p> : null}
          {def.submit.thankYou ? <p>✓ Reply: “{def.submit.thankYou.slice(0, 60)}…”</p> : null}
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl bg-[#1f2c33] text-white">
          <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2 text-small font-medium">
            <X className="size-4" aria-hidden="true" /> {screen ? screen.title : def.confirmation.enabled && step === "confirm" ? def.confirmation.title : "Submit"}
          </div>
          <div className="min-h-[18rem] space-y-3 p-3">
            {screen ? (
              <>
                {screen.intro ? <p className="text-caption text-white/80">{screen.intro}</p> : null}
                {screen.fields.map((fl) => <PreviewField key={fl.name} fl={fl} />)}
              </>
            ) : step === "confirm" && def.confirmation.enabled ? (
              <>
                {def.confirmation.body ? <p className="text-caption text-white/80">{def.confirmation.body}</p> : null}
                {allFields(def).filter((x) => x.type !== "checkbox" && x.type !== "optin").map((x) => (
                  <div key={x.name}>
                    <p className="text-[10px] uppercase tracking-wide text-white/50">{x.label}</p>
                    <p className="text-caption text-white/80">…</p>
                  </div>
                ))}
              </>
            ) : (
              <p className="text-caption text-white/70">{step === "confirm" ? "Confirmation is off — the last screen submits." : `After “${def.submit.label}”, the form closes and we reply: “${def.submit.thankYou || "(nothing)"}”`}</p>
            )}
          </div>
          <div className="p-3">
            <p className="rounded-full bg-[#00a884] py-2 text-center text-small font-medium text-[#0b141a]">{screen ? (isLast ? def.submit.label : screen.buttonLabel) : def.submit.label}</p>
            <p className="mt-2 text-center text-[10px] text-white/40">Managed by the business · WhatsApp Flows</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Submissions / Test / JSON
// ---------------------------------------------------------------------------

type Sub = { id: string; contact: { id: string; name: string; phone: string } | null; answers: Answers; source: string; crmResult: { updated?: string[]; tags?: string[]; consent?: boolean; appointmentId?: string | null; assignedTo?: string | null; errors?: string[] }; conversationId: string | null; createdAt: string };

function Submissions({ orgId, flow }: { orgId: string; flow: FlowView }) {
  const [page, setPage] = React.useState(1);
  const [data, setData] = React.useState<{ submissions: Sub[]; total: number; page: number; pageSize: number } | null>(null);
  React.useEffect(() => {
    void apiFetch<{ submissions: Sub[]; total: number; page: number; pageSize: number }>(`/api/organizations/${orgId}/flows/${flow.id}/submissions?page=${page}`).then((r) => r.ok && setData(r.data));
  }, [orgId, flow.id, page]);
  const fields = allFields(flow.definition).slice(0, 4);
  return (
    <Card>
      <CardHeader
        title="Submissions"
        description="Contact, answers, time, flow and source — and what the CRM action changed."
        action={
          <a href={`/api/organizations/${orgId}/flows/${flow.id}/submissions/export`} className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-control)] border border-app-border px-3 text-small text-app-text hover:bg-app-hover">
            <Download className="size-4" aria-hidden="true" /> Export CSV
          </a>
        }
      />
      {!data ? (
        <LoadingState />
      ) : !data.submissions.length ? (
        <EmptyState icon={ListChecks} title="No submissions yet" description={flow.status === "published" ? (flow.isDemo ? "Use the Test tab to submit as a customer." : "Send the flow from the Inbox to start collecting answers.") : "Publish the flow first."} />
      ) : (
        <>
          <Table caption="Flow submissions" className="min-w-[760px]">
            <THead>
              <tr>
                <TH>Submitted</TH>
                <TH>Contact</TH>
                {fields.map((x) => <TH key={x.name}>{x.label}</TH>)}
                <TH>CRM</TH>
              </tr>
            </THead>
            <TBody>
              {data.submissions.map((s) => (
                <TR key={s.id}>
                  <TD className="whitespace-nowrap text-small">
                    {istFmt.format(new Date(s.createdAt))}
                    <span className="block"><Badge tone={s.source === "demo" ? "warning" : "success"}>{s.source}</Badge></span>
                  </TD>
                  <TD>{s.contact ? <Link href={`/contacts/${s.contact.id}`} className="hover:text-app-primary-hover">{s.contact.name || s.contact.phone}</Link> : "—"}</TD>
                  {fields.map((x) => <TD key={x.name} className="max-w-[10rem] truncate text-small">{answerText(s.answers[x.name] ?? "") || "—"}</TD>)}
                  <TD className="text-caption text-app-muted">
                    {[s.crmResult.updated?.length ? `${s.crmResult.updated.length} field(s)` : "", s.crmResult.tags?.length ? "tagged" : "", s.crmResult.consent ? "opt-in" : "", s.crmResult.appointmentId ? "appointment" : "", s.crmResult.assignedTo ? `→ ${s.crmResult.assignedTo}` : ""].filter(Boolean).join(" · ") || "—"}
                    {s.crmResult.errors?.length ? <span className="block text-red-300" title={s.crmResult.errors.join("\n")}>{s.crmResult.errors.length} issue(s)</span> : null}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPageChange={setPage} />
        </>
      )}
    </Card>
  );
}

function TestPanel({ orgId, flow }: { orgId: string; flow: FlowView }) {
  const toast = useToast();
  const fields = allFields(flow.definition);
  const [phone, setPhone] = React.useState("+91 98765 00011");
  const [name, setName] = React.useState("Demo Customer");
  const [answers, setAnswers] = React.useState<Answers>({});
  const [result, setResult] = React.useState<{ conversationId: string | null; submissionId: string | null } | null>(null);
  const [errors, setErrors] = React.useState<string[]>([]);
  const [busy, setBusy] = React.useState(false);
  if (!flow.isDemo)
    return (
      <Alert tone="info" title="Test on WhatsApp">
        This flow is on a live number. Publish it, then open a chat with your own WhatsApp in the <Link href="/inbox" className="underline">Inbox</Link> and use <strong>Send flow</strong>. Submissions show up in the Submissions tab.
      </Alert>
    );
  if (flow.status !== "published") return <Alert tone="info">Publish the flow (demo) to test it.</Alert>;
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const r = await apiFetch<{ conversationId: string | null; submissionId: string | null }>(`/api/organizations/${orgId}/flows/${flow.id}/demo-submit`, { method: "POST", body: { phone, name, answers } });
    setBusy(false);
    if (!r.ok) return setErrors((r.details?.answers as string[] | undefined) ?? [r.error]);
    setErrors([]);
    setResult(r.data);
    toast("Submitted as a customer (demo)");
  }
  return (
    <Card>
      <CardHeader title="Test as a customer (demo)" description="Fills the form exactly as WhatsApp would send it back — the submission, CRM action and thank-you message all run for real in MECGURA." />
      <CardBody>
        <form onSubmit={submit} className="grid gap-4 md:grid-cols-2">
          {errors.length ? <Alert tone="danger" className="md:col-span-2"><ul className="list-disc pl-4">{errors.map((x) => <li key={x}>{x}</li>)}</ul></Alert> : null}
          <Field id="tp-phone" label="Customer phone">
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
          <Field id="tp-name" label="WhatsApp profile name">
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          {fields.map((fl) => (
            <div key={fl.name} className={fl.type === "textarea" || fl.type === "checkbox" ? "md:col-span-2" : ""}>
              {fl.type === "optin" ? (
                <Checkbox label={fl.label} checked={answers[fl.name] === true} onChange={(e) => setAnswers((a) => ({ ...a, [fl.name]: e.target.checked }))} />
              ) : fl.type === "checkbox" ? (
                <fieldset>
                  <legend className="mb-1 text-small font-medium">{fl.label}</legend>
                  <div className="flex flex-wrap gap-3">
                    {fl.options.map((o) => {
                      const cur = (answers[fl.name] as string[] | undefined) ?? [];
                      return <Checkbox key={o} label={o} checked={cur.includes(o)} onChange={(e) => setAnswers((a) => ({ ...a, [fl.name]: e.target.checked ? [...cur, o] : cur.filter((x) => x !== o) }))} />;
                    })}
                  </div>
                </fieldset>
              ) : fl.type === "dropdown" || fl.type === "radio" ? (
                <Field id={`tp-${fl.name}`} label={fl.label}>
                  <Select value={String(answers[fl.name] ?? "")} onChange={(e) => setAnswers((a) => ({ ...a, [fl.name]: e.target.value }))}>
                    <option value="">Choose…</option>
                    {fl.options.map((o) => <option key={o} value={o}>{o}</option>)}
                  </Select>
                </Field>
              ) : fl.type === "textarea" ? (
                <Field id={`tp-${fl.name}`} label={fl.label}>
                  <Textarea value={String(answers[fl.name] ?? "")} onChange={(e) => setAnswers((a) => ({ ...a, [fl.name]: e.target.value }))} rows={2} />
                </Field>
              ) : (
                <Field id={`tp-${fl.name}`} label={fl.label}>
                  <Input type={fl.type === "date" ? "date" : fl.type === "number" ? "number" : fl.type === "email" ? "email" : "text"} value={String(answers[fl.name] ?? "")} onChange={(e) => setAnswers((a) => ({ ...a, [fl.name]: e.target.value }))} />
                </Field>
              )}
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-3 md:col-span-2">
            <Button type="submit" loading={busy}>
              <Send aria-hidden="true" /> Submit as customer (demo)
            </Button>
            {result?.conversationId ? <Link href={`/inbox?c=${result.conversationId}`} className="text-small text-app-primary underline">Open the chat in the Inbox</Link> : null}
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

function JsonPanel({ url }: { url: string }) {
  const toast = useToast();
  const [json, setJson] = React.useState<string | null>(null);
  const [error, setError] = React.useState("");
  React.useEffect(() => {
    void apiFetch<Record<string, unknown>>(url).then((r) => (r.ok ? setJson(JSON.stringify(r.data, null, 2)) : setError(r.details?.flow ? (r.details.flow as string[]).join(" · ") : r.error)));
  }, [url]);
  return (
    <Card>
      <CardHeader
        title="Flow JSON"
        description="What MECGURA sends to Meta when you publish (for developers / WhatsApp Manager)."
        action={json ? <Button size="sm" variant="secondary" onClick={() => void navigator.clipboard?.writeText(json).then(() => toast("Copied"))}><Copy aria-hidden="true" /> Copy</Button> : null}
      />
      <CardBody>
        {error ? <Alert tone="warning">{error}</Alert> : !json ? <LoadingState /> : <pre className="app-scroll max-h-[32rem] overflow-auto rounded-lg bg-app-bg p-3 font-mono text-caption text-app-muted">{json}</pre>}
      </CardBody>
    </Card>
  );
}
