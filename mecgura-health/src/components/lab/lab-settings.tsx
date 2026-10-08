"use client";
import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Alert, Badge, Button, Card, CardBody, CardHeader, EmptyState, ErrorState, Field, LoadingState, Modal, NumberInput, SearchInput, Select, StatusBadge, TextInput, Textarea, Toggle, useToast } from "@/components/ui";
import { apiFetch } from "@/lib/api/client";
import { CONFIG_KINDS, FLAGS, RESULT_TYPES } from "@/lib/lab/core";
import type { ConfigEntry, InvestigationView } from "@/lib/services/lab-master";

type Cfg = Record<(typeof CONFIG_KINDS)[number], ConfigEntry[]> & { suggested: Record<string, string[]> | null };
const KIND_LABEL: Record<string, string> = { CATEGORY: "Categories", SAMPLE_TYPE: "Sample types", DEPARTMENT: "Departments", REJECTION_REASON: "Sample rejection reasons" };
interface Partner { id: string; name: string; code: string; contact: string | null; address: string | null; integrationType: string; active: boolean }

export function LabSettings({ canConfigure }: { canConfigure: boolean }) {
  const toast = useToast();
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [err, setErr] = useState<string>();
  const [partners, setPartners] = useState<Partner[]>([]);
  const [tests, setTests] = useState<InvestigationView[] | null>(null);
  const [q, setQ] = useState("");
  const [edit, setEdit] = useState<InvestigationView | "new" | null>(null);
  const [pOpen, setPOpen] = useState(false);

  const loadCfg = useCallback(async () => {
    const [c, p] = await Promise.all([apiFetch<Cfg>("/api/lab/config"), apiFetch<{ partners: Partner[] }>("/api/lab/partners")]);
    if (c.ok) { setCfg(c.data); setErr(undefined); } else setErr(c.error.message);
    if (p.ok) setPartners(p.data.partners);
  }, []);
  const loadTests = useCallback(async () => {
    const r = await apiFetch<{ items: InvestigationView[] }>(`/api/lab/investigations?all=1&q=${encodeURIComponent(q)}`);
    if (r.ok) setTests(r.data.items);
  }, [q]);
  useEffect(() => { loadCfg(); }, [loadCfg]);
  useEffect(() => { const t = setTimeout(loadTests, 200); return () => clearTimeout(t); }, [loadTests]);

  if (err && !cfg) return <ErrorState description={err} action={<Button onClick={loadCfg}>Try again</Button>} />;
  if (!cfg) return <LoadingState />;
  return (
    <div className="space-y-section">
      {!canConfigure && <Alert tone="info">You can view the laboratory setup. Only a clinic admin can change it.</Alert>}
      <Card>
        <CardHeader title="Investigations" description="The tests your clinic offers. Reference ranges you enter here are the only source of result flags." action={canConfigure ? <Button size="sm" onClick={() => setEdit("new")}><Plus aria-hidden className="size-4" />Add test</Button> : undefined} />
        <CardBody className="space-y-3">
          <SearchInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or code" aria-label="Search investigations" />
          {tests === null ? <LoadingState /> : !tests.length ? <EmptyState title="No investigations" description={canConfigure ? "Add the first test your clinic offers." : "None configured yet."} /> : (
            <ul className="divide-y divide-line">{tests.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div className="min-w-0"><p className="type-label"><span className="tabular-nums">{t.testCode}</span> · {t.testName}</p><p className="type-caption">{t.category}{t.sampleType ? ` · ${t.sampleType}` : ""} · {t.parameters.length} parameter{t.parameters.length === 1 ? "" : "s"}</p></div>
                <div className="flex items-center gap-2">{!t.active && <Badge>Inactive</Badge>}{canConfigure && <Button size="sm" variant="outline" onClick={() => setEdit(t)}>Edit</Button>}</div>
              </li>))}</ul>
          )}
        </CardBody>
      </Card>

      <div className="grid gap-section lg:grid-cols-2">
        {CONFIG_KINDS.map((k) => <ListCard key={k} kind={k} items={cfg[k]} suggested={cfg.suggested?.[k] ?? []} canConfigure={canConfigure} reload={loadCfg} />)}
      </div>

      <Card>
        <CardHeader title="External laboratories" description="Partner labs you send samples to. Tracking is manual — no laboratory system is connected." action={canConfigure ? <Button size="sm" onClick={() => setPOpen(true)}><Plus aria-hidden className="size-4" />Add partner</Button> : undefined} />
        {!partners.length ? <EmptyState title="No partner laboratories" /> : (
          <ul className="divide-y divide-line">{partners.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 p-card"><div><p className="type-label">{p.name} <span className="type-caption tabular-nums">{p.code}</span></p><p className="type-caption">{[p.contact, p.address].filter(Boolean).join(" · ") || "No contact saved"} · manual tracking</p></div>
              <div className="flex items-center gap-2"><StatusBadge tone={p.active ? "success" : "neutral"}>{p.active ? "Active" : "Inactive"}</StatusBadge>{canConfigure && <Button size="sm" variant="outline" onClick={async () => { const r = await apiFetch(`/api/lab/partners/${p.id}`, { method: "PATCH", body: JSON.stringify({ active: !p.active }) }); if (r.ok) await loadCfg(); else toast({ tone: "danger", title: r.error.message }); }}>{p.active ? "Disable" : "Enable"}</Button>}</div></li>))}</ul>
        )}
      </Card>

      {edit && <TestEditor key={edit === "new" ? "new" : edit.id} test={edit === "new" ? null : edit} categories={cfg.CATEGORY.filter((c) => c.active).map((c) => c.name)} sampleTypes={cfg.SAMPLE_TYPE.filter((c) => c.active).map((c) => c.name)} departments={cfg.DEPARTMENT.filter((c) => c.active).map((c) => c.name)} onClose={() => setEdit(null)} onSaved={async () => { setEdit(null); await loadTests(); }} />}
      {pOpen && <PartnerModal onClose={() => setPOpen(false)} onSaved={async () => { setPOpen(false); await loadCfg(); }} />}
    </div>
  );
}

function ListCard({ kind, items, suggested, canConfigure, reload }: { kind: string; items: ConfigEntry[]; suggested: string[]; canConfigure: boolean; reload: () => Promise<void> }) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  async function add(n: string) {
    setBusy(true);
    const r = await apiFetch("/api/lab/config", { method: "POST", body: JSON.stringify({ kind, name: n }) });
    setBusy(false);
    if (!r.ok) { toast({ tone: "danger", title: r.error.fieldErrors?.name ?? r.error.message }); return; }
    setName(""); await reload();
  }
  const missing = suggested.filter((s) => !items.some((i) => i.name === s));
  return (
    <Card>
      <CardHeader title={KIND_LABEL[kind]} />
      <CardBody className="space-y-3">
        {!items.length ? <p className="type-secondary">Nothing added yet.</p> : (
          <ul className="space-y-1">{items.map((i) => <li key={i.id} className="flex items-center justify-between gap-2"><span className={i.active ? "type-body" : "type-body text-muted line-through"}>{i.name}</span>{canConfigure && <Toggle label={`${i.name} active`} checked={i.active} onChange={async (v) => { const r = await apiFetch(`/api/lab/config/${i.id}`, { method: "PATCH", body: JSON.stringify({ active: v }) }); if (r.ok) await reload(); else toast({ tone: "danger", title: r.error.message }); }} />}</li>)}</ul>
        )}
        {canConfigure && (
          <>
            <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim()) add(name.trim()); }}>
              <Field label="Add" className="flex-1"><TextInput value={name} onChange={(e) => setName(e.target.value)} maxLength={60} /></Field><Button type="submit" loading={busy} disabled={!name.trim()}>Add</Button>
            </form>
            {missing.length > 0 && <div className="flex flex-wrap gap-1.5" aria-label="Suggestions"><span className="type-caption">Suggestions:</span>{missing.map((s) => <button key={s} type="button" className="type-caption rounded-full border border-line px-2 py-0.5 hover:bg-surface-muted" onClick={() => add(s)}>+ {s}</button>)}</div>}
          </>
        )}
      </CardBody>
    </Card>
  );
}

function PartnerModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => Promise<void> }) {
  const [f, setF] = useState({ name: "", code: "", contact: "", address: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true); setErrors({});
    const r = await apiFetch("/api/lab/partners", { method: "POST", body: JSON.stringify(f) });
    setBusy(false);
    if (!r.ok) { setErrors(r.error.fieldErrors ?? { name: r.error.message }); return; }
    await onSaved();
  }
  return (
    <Modal open onClose={onClose} title="Add external laboratory" footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy}>Save</Button></>}>
      <div className="space-y-3">
        <Field label="Name" required error={errors.name}><TextInput value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Code" required error={errors.code} hint="Letters, numbers, dots, dashes."><TextInput value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} maxLength={20} /></Field>
        <Field label="Contact" error={errors.contact}><TextInput value={f.contact} onChange={(e) => setF({ ...f, contact: e.target.value })} /></Field>
        <Field label="Address" error={errors.address}><TextInput value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

interface RangeF { gender: string; minAgeYears: string; maxAgeYears: string; low: string; high: string; criticalLow: string; criticalHigh: string; text: string }
interface ParamF { name: string; resultType: string; unit: string; options: { value: string; flag: string }[]; ranges: RangeF[] }
const emptyRange = (): RangeF => ({ gender: "", minAgeYears: "", maxAgeYears: "", low: "", high: "", criticalLow: "", criticalHigh: "", text: "" });
const s = (v: unknown) => (v == null ? "" : String(v));

function TestEditor({ test, categories, sampleTypes, departments, onClose, onSaved }: { test: InvestigationView | null; categories: string[]; sampleTypes: string[]; departments: string[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const toast = useToast();
  const [f, setF] = useState({ testCode: test?.testCode ?? "", testName: test?.testName ?? "", shortName: test?.shortName ?? "", category: test?.category ?? "", sampleType: test?.sampleType ?? "", department: test?.department ?? "", preparation: test?.preparation ?? "", turnaroundHours: s(test?.turnaroundHours), description: test?.description ?? "", active: test?.active ?? true });
  const [params, setParams] = useState<ParamF[]>(() => (test?.parameters ?? []).map((p) => ({ name: p.name, resultType: p.resultType, unit: p.unit ?? "", options: (p.options ?? []).map((o) => ({ value: o.value, flag: o.flag ?? "" })), ranges: (p.ranges ?? []).map((r) => ({ gender: r.gender ?? "", minAgeYears: s(r.minAgeYears), maxAgeYears: s(r.maxAgeYears), low: s(r.low), high: s(r.high), criticalLow: s(r.criticalLow), criticalHigh: s(r.criticalHigh), text: r.text ?? "" })) })));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const setP = (i: number, patch: Partial<ParamF>) => setParams(params.map((p, n) => (n === i ? { ...p, ...patch } : p)));
  const opts = (list: string[], cur: string) => [...new Set([...(cur ? [cur] : []), ...list])].map((v) => ({ value: v, label: v }));
  async function save() {
    setBusy(true); setErrors({});
    const body = { ...f, parameters: params.map((p) => ({ name: p.name, resultType: p.resultType, unit: p.unit, options: p.resultType === "QUALITATIVE" ? p.options.filter((o) => o.value.trim()) : undefined, ranges: p.resultType === "NUMERIC" ? p.ranges.map((r) => ({ ...r })) : undefined })) };
    const r = await apiFetch(test ? `/api/lab/investigations/${test.id}` : "/api/lab/investigations", { method: test ? "PUT" : "POST", body: JSON.stringify(body) });
    setBusy(false);
    if (!r.ok) { setErrors(r.error.fieldErrors ?? {}); toast({ tone: "danger", title: Object.values(r.error.fieldErrors ?? {})[0] ?? r.error.message }); return; }
    toast({ tone: "success", title: "Test saved" }); await onSaved();
  }
  return (
    <Modal open onClose={onClose} title={test ? `Edit ${test.testCode}` : "Add test"} description="Changes apply to new orders only. Existing orders keep the definition they were ordered with."
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy}>Save test</Button></>}>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Test code" required error={errors.testCode}><TextInput value={f.testCode} onChange={(e) => setF({ ...f, testCode: e.target.value })} maxLength={20} /></Field>
          <Field label="Test name" required error={errors.testName}><TextInput value={f.testName} onChange={(e) => setF({ ...f, testName: e.target.value })} maxLength={120} /></Field>
          <Field label="Short name" error={errors.shortName}><TextInput value={f.shortName} onChange={(e) => setF({ ...f, shortName: e.target.value })} maxLength={30} /></Field>
          <Field label="Category" required error={errors.category}>{categories.length ? <Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} placeholder="Choose" options={opts(categories, f.category)} /> : <TextInput value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} />}</Field>
          <Field label="Sample type" error={errors.sampleType}>{sampleTypes.length ? <Select value={f.sampleType} onChange={(e) => setF({ ...f, sampleType: e.target.value })} placeholder="Not specified" options={opts(sampleTypes, f.sampleType)} /> : <TextInput value={f.sampleType} onChange={(e) => setF({ ...f, sampleType: e.target.value })} />}</Field>
          <Field label="Department" error={errors.department}>{departments.length ? <Select value={f.department} onChange={(e) => setF({ ...f, department: e.target.value })} placeholder="None" options={opts(departments, f.department)} /> : <TextInput value={f.department} onChange={(e) => setF({ ...f, department: e.target.value })} />}</Field>
          <Field label="Turnaround (hours)" error={errors.turnaroundHours}><NumberInput value={f.turnaroundHours} onChange={(e) => setF({ ...f, turnaroundHours: e.target.value })} inputMode="numeric" /></Field>
          <Toggle label="Available to order" checked={f.active} onChange={(v) => setF({ ...f, active: v })} />
        </div>
        <Field label="Preparation instructions" error={errors.preparation}><Textarea rows={2} value={f.preparation} onChange={(e) => setF({ ...f, preparation: e.target.value })} maxLength={500} /></Field>
        <div className="space-y-3">
          <div className="flex items-center justify-between"><p className="type-card-title">Result parameters</p><Button size="sm" variant="outline" onClick={() => setParams([...params, { name: "", resultType: "NUMERIC", unit: "", options: [], ranges: [] }])}><Plus aria-hidden className="size-4" />Add parameter</Button></div>
          {errors.parameters && <Alert tone="danger">{errors.parameters}</Alert>}
          {!params.length && <p className="type-secondary">No parameters: a single free-text result is used.</p>}
          {params.map((p, i) => (
            <fieldset key={i} className="space-y-3 rounded-md border border-line p-3">
              <legend className="type-label px-1">Parameter {i + 1}</legend>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Name" required><TextInput value={p.name} onChange={(e) => setP(i, { name: e.target.value })} maxLength={80} /></Field>
                <Field label="Result type"><Select value={p.resultType} onChange={(e) => setP(i, { resultType: e.target.value })} options={RESULT_TYPES.map((t) => ({ value: t, label: t === "NUMERIC" ? "Number" : t === "TEXT" ? "Text" : "Choice (qualitative)" }))} /></Field>
                <Field label="Unit"><TextInput value={p.unit} onChange={(e) => setP(i, { unit: e.target.value })} maxLength={30} /></Field>
              </div>
              {p.resultType === "NUMERIC" && (
                <div className="space-y-2">
                  <p className="type-caption">Reference ranges (optional). A result is flagged only when a configured range applies to the patient.</p>
                  {p.ranges.map((r, n) => (
                    <div key={n} className="grid grid-cols-2 gap-2 rounded-md bg-surface-muted p-2 sm:grid-cols-4">
                      <Field label="Gender"><Select value={r.gender} onChange={(e) => setP(i, { ranges: p.ranges.map((x, k) => (k === n ? { ...x, gender: e.target.value } : x)) })} placeholder="Any" options={[{ value: "MALE", label: "Male" }, { value: "FEMALE", label: "Female" }, { value: "OTHER", label: "Other" }]} /></Field>
                      {(["minAgeYears", "maxAgeYears", "low", "high", "criticalLow", "criticalHigh"] as const).map((k) => <Field key={k} label={{ minAgeYears: "Min age (y)", maxAgeYears: "Max age (y)", low: "Low", high: "High", criticalLow: "Critical low", criticalHigh: "Critical high" }[k]}><NumberInput value={r[k]} step="any" onChange={(e) => setP(i, { ranges: p.ranges.map((x, j) => (j === n ? { ...x, [k]: e.target.value } : x)) })} /></Field>)}
                      <Field label="Display text (optional)"><TextInput value={r.text} onChange={(e) => setP(i, { ranges: p.ranges.map((x, j) => (j === n ? { ...x, text: e.target.value } : x)) })} maxLength={120} /></Field>
                      <div className="flex items-end"><Button size="sm" variant="ghost" aria-label="Remove range" onClick={() => setP(i, { ranges: p.ranges.filter((_, j) => j !== n) })}><Trash2 aria-hidden className="size-4" />Remove</Button></div>
                    </div>
                  ))}
                  <Button size="sm" variant="outline" onClick={() => setP(i, { ranges: [...p.ranges, emptyRange()] })}>Add range</Button>
                </div>
              )}
              {p.resultType === "QUALITATIVE" && (
                <div className="space-y-2">
                  <p className="type-caption">Allowed values. A flag is shown only if you set one here.</p>
                  {p.options.map((o, n) => (
                    <div key={n} className="grid grid-cols-[1fr_9rem_auto] items-end gap-2">
                      <Field label="Value"><TextInput value={o.value} onChange={(e) => setP(i, { options: p.options.map((x, j) => (j === n ? { ...x, value: e.target.value } : x)) })} maxLength={60} /></Field>
                      <Field label="Flag"><Select value={o.flag} onChange={(e) => setP(i, { options: p.options.map((x, j) => (j === n ? { ...x, flag: e.target.value } : x)) })} placeholder="None" options={FLAGS.map((x) => ({ value: x, label: x[0] + x.slice(1).toLowerCase() }))} /></Field>
                      <Button size="sm" variant="ghost" aria-label="Remove value" onClick={() => setP(i, { options: p.options.filter((_, j) => j !== n) })}><Trash2 aria-hidden className="size-4" /></Button>
                    </div>
                  ))}
                  <Button size="sm" variant="outline" onClick={() => setP(i, { options: [...p.options, { value: "", flag: "" }] })}>Add value</Button>
                </div>
              )}
              <Button size="sm" variant="ghost" onClick={() => setParams(params.filter((_, n) => n !== i))}><Trash2 aria-hidden className="size-4" />Remove parameter</Button>
            </fieldset>
          ))}
        </div>
      </div>
    </Modal>
  );
}
