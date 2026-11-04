"use client";

import { ForecastCard } from "@/components/crm/forecast-card";
import * as React from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, Flame, Gauge, IndianRupee, Plus, Settings2, SlidersHorizontal, Target, Trash2, TrendingUp, Trophy } from "lucide-react";
import { Alert, Badge, Button, Card, CardBody, CardHeader, Combobox, ConfirmationDialog, EmptyState, ErrorState, Field, FilterBar, Input, LoadingState, Modal, PageHeader, SearchBar, Select, StatCard, Textarea, useToast } from "@/components/ds";
import { apiFetch } from "@/lib/client-api";
import { SCORE_SIGNALS, SIGNAL_LABELS, type ScoreRule, type ScoringConfig } from "@/lib/lead-scoring";
import { cn } from "@/lib/utils";

type Member = { id: string; name: string };
type Heat = "hot" | "warm" | "cold";
type StageKind = "open" | "won" | "lost";
type DealCard = {
  id: string;
  title: string;
  valueRupees: number;
  status: StageKind;
  daysInStage: number;
  overdue: boolean;
  expectedCloseAt: string | null;
  contact: { id: string; name: string; phone: string };
  owner: { id: string; name: string } | null;
  heat: Heat;
  score: number;
};
type Column = { id: string; name: string; color: string; kind: StageKind; probability: number; count: number; valueRupees: number; deals: DealCard[] };
type Stats = {
  openDeals: number;
  openRupees: number;
  forecastRupees: number;
  wonThisMonth: number;
  wonRupeesThisMonth: number;
  lostThisMonth: number;
  winRate90: number | null;
  avgDaysToWin: number | null;
  stuck: number;
  overdue: number;
  people: { userId: string; name: string; openDeals: number; openRupees: number; wonDeals: number; wonRupees: number }[];
};
type DealDetail = Omit<DealCard, "heat" | "score"> & {
  lostReason: string;
  stage: { id: string; name: string; kind: StageKind };
  activities: { id: string; kind: string; text: string; createdAt: string }[];
  score: { score: number; heat: Heat; reasons: string[] } | null;
  contact: { id: string; name: string; phone: string; email: string };
};
type StageRow = { id?: string; name: string; color: string; probability: number; kind: StageKind };

const COLORS = ["slate", "sky", "violet", "amber", "orange", "emerald", "rose"] as const;
const DOT: Record<string, string> = { slate: "bg-slate-400", sky: "bg-sky-400", violet: "bg-violet-400", amber: "bg-amber-400", orange: "bg-orange-400", emerald: "bg-emerald-400", rose: "bg-rose-400" };
const HEAT: Record<Heat, { label: string; tone: "danger" | "warning" | "neutral" }> = { hot: { label: "Hot", tone: "danger" }, warm: { label: "Warm", tone: "warning" }, cold: { label: "Cold", tone: "neutral" } };
const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const dateFmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
const timeFmt = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });

/** Deals: the sales pipeline as a Kanban board with forecast, scoring and per-salesperson numbers. */
export function DealsApp({ orgId, meId, canWrite, canManage, members }: { orgId: string; meId: string; canWrite: boolean; canManage: boolean; members: Member[] }) {
  const base = `/api/organizations/${orgId}/deals`;
  const toast = useToast();
  const [columns, setColumns] = React.useState<Column[] | null>(null);
  const [stats, setStats] = React.useState<Stats | null>(null);
  const [error, setError] = React.useState("");
  const [q, setQ] = React.useState("");
  const [owner, setOwner] = React.useState("");
  const [openDeal, setOpenDeal] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [editStages, setEditStages] = React.useState(false);
  const [editScoring, setEditScoring] = React.useState(false);
  const [lostMove, setLostMove] = React.useState<{ dealId: string; stageId: string } | null>(null);
  const [dragId, setDragId] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    const qs = new URLSearchParams({ ...(q.trim() ? { q: q.trim() } : {}), ...(owner ? { ownerUserId: owner } : {}) });
    const [b, s] = await Promise.all([apiFetch<{ stages: Column[] }>(`${base}?${qs}`), apiFetch<Stats>(`${base}/stats`)]);
    if (!b.ok) return setError(b.error);
    setError("");
    setColumns(b.data.stages);
    if (s.ok) setStats(s.data);
  }, [base, q, owner]);

  React.useEffect(() => {
    const t = window.setTimeout(() => void load(), q ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  async function move(dealId: string, stageId: string, lostReason?: string) {
    const target = columns?.find((c) => c.id === stageId);
    if (!target) return;
    if (target.kind === "lost" && lostReason === undefined) return setLostMove({ dealId, stageId });
    // Optimistic move so dragging feels instant; the reload brings back the server's numbers.
    setColumns((cols) => {
      if (!cols) return cols;
      const card = cols.flatMap((c) => c.deals).find((d) => d.id === dealId);
      if (!card) return cols;
      return cols.map((c) => ({ ...c, deals: c.id === stageId ? [{ ...card, daysInStage: 0 }, ...c.deals.filter((d) => d.id !== dealId)] : c.deals.filter((d) => d.id !== dealId) }));
    });
    const r = await apiFetch(`${base}/${dealId}`, { method: "PATCH", body: { stageId, ...(lostReason ? { lostReason } : {}) } });
    if (!r.ok) toast(r.error, "error");
    else if (target.kind === "won") toast(`Won! The contact is now a customer. 🎉`);
    void load();
  }

  const total = columns?.reduce((a, c) => a + c.count, 0) ?? 0;

  return (
    <>
      <PageHeader
        title="Deals"
        description="Your sales pipeline: drag a deal to move it, see what's likely to close and who's selling."
        actions={
          <>
            {canManage ? (
              <>
                <Button variant="secondary" onClick={() => setEditScoring(true)}>
                  <Gauge className="size-4" aria-hidden="true" /> Lead scoring
                </Button>
                <Button variant="secondary" onClick={() => setEditStages(true)}>
                  <Settings2 className="size-4" aria-hidden="true" /> Stages
                </Button>
              </>
            ) : null}
            {canWrite ? (
              <Button onClick={() => setCreating(true)}>
                <Plus className="size-4" aria-hidden="true" /> New deal
              </Button>
            ) : null}
          </>
        }
      />

      {stats ? (
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Open pipeline" value={inr(stats.openRupees)} icon={IndianRupee} hint={`${stats.openDeals} open deal${stats.openDeals === 1 ? "" : "s"}`} />
          <StatCard label="Expected revenue" value={inr(stats.forecastRupees)} icon={TrendingUp} hint="Each deal × its stage's win chance" />
          <StatCard label="Won this month" value={inr(stats.wonRupeesThisMonth)} icon={Trophy} hint={`${stats.wonThisMonth} won · ${stats.lostThisMonth} lost`} />
          <StatCard label="Win rate (90 days)" value={stats.winRate90 === null ? null : `${stats.winRate90}%`} icon={Target} hint={stats.avgDaysToWin !== null ? `${stats.avgDaysToWin} days to win on average` : "Close a few deals to see this"} />
        </div>
      ) : null}
      {stats && (stats.stuck || stats.overdue) ? (
        <Alert tone="warning" className="mb-4" title="Needs attention">
          {[stats.stuck ? `${stats.stuck} deal${stats.stuck === 1 ? " hasn't" : "s haven't"} moved in 14+ days` : "", stats.overdue ? `${stats.overdue} past the expected close date` : ""].filter(Boolean).join(" · ")}
        </Alert>
      ) : null}

      <ForecastCard base={base} />

      <FilterBar className="mb-3">
        <SearchBar label="Search deals" placeholder="Search deal, name or phone" value={q} onChange={(e) => setQ(e.target.value)} className="w-full sm:w-72" />
        <Select aria-label="Owner" value={owner} onChange={(e) => setOwner(e.target.value)} className="w-full sm:w-52">
          <option value="">Everyone&apos;s deals</option>
          <option value={meId}>My deals</option>
          {members.filter((m) => m.id !== meId).map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
          <option value="none">No owner</option>
        </Select>
      </FilterBar>

      {error ? <ErrorState title="Couldn't load deals" description={error} onRetry={() => void load()} /> : null}
      {!columns && !error ? <LoadingState label="Loading pipeline…" /> : null}
      {columns && total === 0 && !q && !owner ? (
        <Card className="mb-4">
          <EmptyState icon={Target} title="No deals yet" description="Create a deal for a contact who is interested: add its value and move it across stages as the sale progresses. Winning a deal marks the contact as a customer." action={canWrite ? <Button onClick={() => setCreating(true)}><Plus className="size-4" aria-hidden="true" /> New deal</Button> : undefined} />
        </Card>
      ) : null}

      {columns ? (
        <div className="-mx-4 overflow-x-auto px-4 pb-4 sm:mx-0 sm:px-0" role="list" aria-label="Pipeline stages">
          <div className="flex min-w-max gap-3">
            {columns.map((c) => (
              <section
                key={c.id}
                role="listitem"
                aria-label={`${c.name}: ${c.count} deals`}
                onDragOver={(e) => {
                  if (canWrite && dragId) e.preventDefault();
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragId) void move(dragId, c.id);
                  setDragId(null);
                }}
                className={cn("flex w-72 shrink-0 flex-col rounded-[var(--radius-card)] border border-app-border bg-app-surface/60", dragId && "border-dashed")}
              >
                <header className="border-b border-app-border px-3 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2 text-small font-semibold text-app-text">
                      <span className={cn("size-2.5 rounded-full", DOT[c.color] ?? DOT.slate)} aria-hidden="true" />
                      {c.name}
                    </span>
                    <Badge>{c.count}</Badge>
                  </div>
                  <p className="mt-0.5 text-caption text-app-muted">
                    {inr(c.valueRupees)}
                    {c.kind === "open" ? ` · ${c.probability}% win chance` : c.kind === "won" ? " · last 30 days" : " · last 30 days"}
                  </p>
                </header>
                <div className="flex max-h-[62vh] min-h-24 flex-col gap-2 overflow-y-auto p-2">
                  {c.deals.map((d) => (
                    <article
                      key={d.id}
                      draggable={canWrite}
                      onDragStart={() => setDragId(d.id)}
                      onDragEnd={() => setDragId(null)}
                      className={cn("rounded-[var(--radius-control)] border border-app-border bg-app-elevated p-3 text-left transition-shadow hover:border-app-border-strong", dragId === d.id && "opacity-50")}
                    >
                      <button type="button" onClick={() => setOpenDeal(d.id)} className="block w-full text-left">
                        <span className="flex items-start justify-between gap-2">
                          <span className="text-small font-semibold text-app-text">{d.title}</span>
                          {c.kind === "open" ? <Badge tone={HEAT[d.heat].tone}>{d.heat === "hot" ? <Flame className="size-3" aria-hidden="true" /> : null}{HEAT[d.heat].label}</Badge> : null}
                        </span>
                        <span className="mt-1 block text-caption text-app-muted">{d.contact.name || d.contact.phone}</span>
                        <span className="mt-2 flex items-center justify-between text-caption">
                          <span className="font-semibold text-app-text">{inr(d.valueRupees)}</span>
                          <span className={cn(d.overdue ? "text-red-300" : d.daysInStage > 14 && c.kind === "open" ? "text-amber-300" : "text-app-subtle")}>
                            {d.overdue ? "Overdue" : `${d.daysInStage}d in stage`}
                          </span>
                        </span>
                        {d.owner ? <span className="mt-1 block truncate text-caption text-app-subtle">{d.owner.name}</span> : null}
                      </button>
                      {canWrite ? (
                        <Select aria-label={`Move ${d.title}`} value={c.id} onChange={(e) => void move(d.id, e.target.value)} className="mt-2 h-8 text-caption sm:hidden">
                          {columns.map((s) => (
                            <option key={s.id} value={s.id}>Move to {s.name}</option>
                          ))}
                        </Select>
                      ) : null}
                    </article>
                  ))}
                  {!c.deals.length ? <p className="px-1 py-4 text-center text-caption text-app-subtle">{canWrite ? "Drag a deal here" : "No deals"}</p> : null}
                </div>
              </section>
            ))}
          </div>
        </div>
      ) : null}

      {stats?.people.length ? (
        <Card className="mt-2">
          <CardHeader title="Salesperson performance" description="This month's wins and what each person has open right now." />
          <CardBody className="overflow-x-auto p-0">
            <table className="w-full text-small">
              <thead className="text-left text-caption text-app-muted">
                <tr className="border-b border-app-border">
                  <th className="px-4 py-2 font-medium">Person</th>
                  <th className="px-4 py-2 font-medium">Won this month</th>
                  <th className="px-4 py-2 font-medium">Open deals</th>
                  <th className="px-4 py-2 font-medium">Open value</th>
                </tr>
              </thead>
              <tbody>
                {stats.people.map((p) => (
                  <tr key={p.userId} className="border-b border-app-border last:border-0">
                    <td className="px-4 py-2 text-app-text">{p.name}</td>
                    <td className="px-4 py-2 text-app-text">{inr(p.wonRupees)} <span className="text-app-subtle">({p.wonDeals})</span></td>
                    <td className="px-4 py-2 text-app-muted">{p.openDeals}</td>
                    <td className="px-4 py-2 text-app-muted">{inr(p.openRupees)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardBody>
        </Card>
      ) : null}

      {creating ? <NewDeal orgId={orgId} base={base} columns={columns ?? []} members={members} meId={meId} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); void load(); }} /> : null}
      {openDeal ? <DealDrawer base={base} id={openDeal} columns={columns ?? []} members={members} canWrite={canWrite} canManage={canManage} onClose={() => setOpenDeal(null)} onChanged={() => void load()} /> : null}
      {editStages ? <StagesEditor base={base} onClose={() => setEditStages(false)} onSaved={() => { setEditStages(false); void load(); }} /> : null}
      {editScoring ? <ScoringEditor base={base} onClose={() => setEditScoring(false)} onSaved={() => { setEditScoring(false); void load(); }} /> : null}
      {lostMove ? <LostReason onClose={() => { setLostMove(null); void load(); }} onConfirm={(reason) => { const m = lostMove; setLostMove(null); void move(m.dealId, m.stageId, reason); }} /> : null}
    </>
  );
}

function LostReason({ onClose, onConfirm }: { onClose: () => void; onConfirm: (reason: string) => void }) {
  const [reason, setReason] = React.useState("");
  return (
    <Modal open onClose={onClose} title="Why was it lost?" description="Helps you spot patterns later (price, timing, went with someone else…)." size="sm" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={() => onConfirm(reason.trim() || "Not given")}>Mark lost</Button></>}>
      <Field id="lost-reason" label="Reason">
        <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder="e.g. Price too high" autoFocus />
      </Field>
    </Modal>
  );
}

function NewDeal({ orgId, base, columns, members, meId, onClose, onSaved }: { orgId: string; base: string; columns: Column[]; members: Member[]; meId: string; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [search, setSearch] = React.useState("");
  const [options, setOptions] = React.useState<{ value: string; label: string; description?: string }[]>([]);
  const [f, setF] = React.useState({ contactId: "", title: "", valueRupees: "", stageId: columns.find((c) => c.kind === "open")?.id ?? "", ownerUserId: meId, expectedCloseAt: "" });
  const [errors, setErrors] = React.useState<Record<string, string[]>>({});
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    const t = window.setTimeout(async () => {
      const r = await apiFetch<{ items: { id: string; name: string; phone: string }[] }>(`/api/organizations/${orgId}/contacts?pageSize=20${search.trim() ? `&q=${encodeURIComponent(search.trim())}` : ""}`);
      if (r.ok) setOptions(r.data.items.map((c) => ({ value: c.id, label: c.name || c.phone, description: c.phone })));
    }, 250);
    return () => clearTimeout(t);
  }, [orgId, search]);

  async function save() {
    setSaving(true);
    const r = await apiFetch(base, { method: "POST", body: { contactId: f.contactId, title: f.title, valueRupees: Number(f.valueRupees || 0), stageId: f.stageId || undefined, ownerUserId: f.ownerUserId || null, expectedCloseAt: f.expectedCloseAt } });
    setSaving(false);
    if (!r.ok) {
      setErrors(r.details ?? {});
      return toast(r.error, "error");
    }
    toast("Deal created.");
    onSaved();
  }

  return (
    <Modal open onClose={onClose} title="New deal" description="A sale you're working on with one contact." footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={() => void save()} loading={saving} disabled={!f.contactId || !f.title.trim()}>Create deal</Button></>}>
      <div className="space-y-4">
        <div>
          <label htmlFor="deal-contact" className="mb-1.5 block text-small font-medium text-app-text">Contact</label>
          <div onInput={(e) => setSearch((e.target as HTMLInputElement).value)}>
            <Combobox id="deal-contact" options={options} value={f.contactId || null} onValueChange={(v) => setF((x) => ({ ...x, contactId: v, title: x.title || `${options.find((o) => o.value === v)?.label ?? ""} – ` }))} placeholder="Search name or phone" emptyText="No contact found. Add them in Contacts first." />
          </div>
          {errors.contactId ? <p className="mt-1.5 text-caption text-red-300">{errors.contactId[0]}</p> : null}
        </div>
        <Field id="deal-title" label="Deal name" hint="What are they buying? e.g. “Bridal package”, “2BHK in Model Town”" error={errors.title?.[0]}>
          <Input value={f.title} onChange={(e) => setF((x) => ({ ...x, title: e.target.value }))} maxLength={120} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="deal-value" label="Value (₹)" error={errors.valueRupees?.[0]}>
            <Input type="number" min={0} inputMode="numeric" value={f.valueRupees} onChange={(e) => setF((x) => ({ ...x, valueRupees: e.target.value }))} />
          </Field>
          <Field id="deal-close" label="Expected close">
            <Input type="date" value={f.expectedCloseAt} onChange={(e) => setF((x) => ({ ...x, expectedCloseAt: e.target.value }))} />
          </Field>
          <Field id="deal-stage" label="Stage">
            <Select value={f.stageId} onChange={(e) => setF((x) => ({ ...x, stageId: e.target.value }))}>
              {columns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field id="deal-owner" label="Owner" error={errors.ownerUserId?.[0]}>
            <Select value={f.ownerUserId} onChange={(e) => setF((x) => ({ ...x, ownerUserId: e.target.value }))}>
              <option value="">No owner</option>
              {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </Select>
          </Field>
        </div>
      </div>
    </Modal>
  );
}

function DealDrawer({ base, id, columns, members, canWrite, canManage, onClose, onChanged }: { base: string; id: string; columns: Column[]; members: Member[]; canWrite: boolean; canManage: boolean; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const [deal, setDeal] = React.useState<DealDetail | null>(null);
  const [form, setForm] = React.useState({ title: "", valueRupees: "", ownerUserId: "", expectedCloseAt: "" });
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);

  const load = React.useCallback(async () => {
    const r = await apiFetch<{ deal: DealDetail }>(`${base}/${id}`);
    if (!r.ok) return toast(r.error, "error");
    const d = r.data.deal;
    setDeal(d);
    setForm({ title: d.title, valueRupees: String(d.valueRupees), ownerUserId: d.owner?.id ?? "", expectedCloseAt: d.expectedCloseAt ? new Date(d.expectedCloseAt).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }) : "" });
  }, [base, id, toast]);
  React.useEffect(() => {
    const t = window.setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  async function patch(body: Record<string, unknown>, done: string) {
    setBusy(true);
    const r = await apiFetch<{ deal: DealDetail }>(`${base}/${id}`, { method: "PATCH", body });
    setBusy(false);
    if (!r.ok) return toast(r.error, "error");
    toast(done);
    setNote("");
    await load();
    onChanged();
  }

  async function remove() {
    const r = await apiFetch(`${base}/${id}`, { method: "DELETE" });
    if (!r.ok) return toast(r.error, "error");
    toast("Deal deleted.");
    onChanged();
    onClose();
  }

  return (
    <Modal open onClose={onClose} title={deal?.title ?? "Deal"} size="lg" description={deal ? <>With <Link href={`/contacts/${deal.contact.id}`} className="text-app-primary underline-offset-2 hover:underline">{deal.contact.name || deal.contact.phone}</Link> · {deal.stage.name}</> : undefined}>
      {!deal ? (
        <LoadingState />
      ) : (
        <div className="grid gap-5 md:grid-cols-[1fr_16rem]">
          <div className="space-y-4">
            {deal.status === "lost" && deal.lostReason ? <Alert tone="danger" title="Lost">{deal.lostReason}</Alert> : null}
            <div className="grid gap-3 sm:grid-cols-2">
              <Field id="d-title" label="Deal name">
                <Input value={form.title} onChange={(e) => setForm((x) => ({ ...x, title: e.target.value }))} disabled={!canWrite} maxLength={120} />
              </Field>
              <Field id="d-value" label="Value (₹)">
                <Input type="number" min={0} value={form.valueRupees} onChange={(e) => setForm((x) => ({ ...x, valueRupees: e.target.value }))} disabled={!canWrite} />
              </Field>
              <Field id="d-owner" label="Owner">
                <Select value={form.ownerUserId} onChange={(e) => setForm((x) => ({ ...x, ownerUserId: e.target.value }))} disabled={!canWrite}>
                  <option value="">No owner</option>
                  {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </Select>
              </Field>
              <Field id="d-close" label="Expected close">
                <Input type="date" value={form.expectedCloseAt} onChange={(e) => setForm((x) => ({ ...x, expectedCloseAt: e.target.value }))} disabled={!canWrite} />
              </Field>
            </div>
            {canWrite ? (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" loading={busy} onClick={() => void patch({ title: form.title, valueRupees: Number(form.valueRupees || 0), ownerUserId: form.ownerUserId || null, expectedCloseAt: form.expectedCloseAt }, "Deal saved.")}>Save changes</Button>
                <Select aria-label="Move to stage" value={deal.stage.id} onChange={(e) => { const s = columns.find((c) => c.id === e.target.value); if (s?.kind === "lost") { const reason = window.prompt("Why was it lost?") ?? ""; void patch({ stageId: s.id, lostReason: reason.trim() || "Not given" }, "Moved."); } else void patch({ stageId: e.target.value }, "Moved."); }} className="h-9 w-auto">
                  {columns.map((c) => <option key={c.id} value={c.id}>Stage: {c.name}</option>)}
                </Select>
              </div>
            ) : null}
            {canWrite ? (
              <div>
                <Field id="d-note" label="Add a note">
                  <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={1000} placeholder="Called, will decide by Friday…" />
                </Field>
                <Button size="sm" variant="secondary" className="mt-2" disabled={!note.trim()} loading={busy} onClick={() => void patch({ note: note.trim() }, "Note added.")}>Add note</Button>
              </div>
            ) : null}
            <div>
              <h3 className="mb-2 text-small font-semibold text-app-text">Timeline</h3>
              <ol className="space-y-2">
                {deal.activities.map((a) => (
                  <li key={a.id} className="rounded-[var(--radius-control)] border border-app-border px-3 py-2">
                    <p className="text-small text-app-text">{a.text}</p>
                    <p className="text-caption text-app-subtle">{timeFmt.format(new Date(a.createdAt))}</p>
                  </li>
                ))}
              </ol>
            </div>
          </div>
          <aside className="space-y-3">
            <Card>
              <CardBody className="space-y-1">
                <p className="text-caption text-app-muted">Lead score</p>
                {deal.score ? (
                  <>
                    <p className="flex items-center gap-2 text-h2 text-app-text">{deal.score.score}<Badge tone={HEAT[deal.score.heat].tone}>{HEAT[deal.score.heat].label}</Badge></p>
                    <ul className="text-caption text-app-muted">{deal.score.reasons.length ? deal.score.reasons.map((r) => <li key={r}>{r}</li>) : <li>No scoring signals yet</li>}</ul>
                  </>
                ) : <p className="text-small text-app-muted">—</p>}
              </CardBody>
            </Card>
            <p className="text-caption text-app-muted">{deal.daysInStage} days in this stage{deal.expectedCloseAt ? ` · closes ${dateFmt.format(new Date(deal.expectedCloseAt))}` : ""}</p>
            {canManage ? (
              <Button variant="ghost" size="sm" className="text-red-300" onClick={() => setConfirmDelete(true)}>
                <Trash2 className="size-4" aria-hidden="true" /> Delete deal
              </Button>
            ) : null}
          </aside>
        </div>
      )}
      <ConfirmationDialog open={confirmDelete} onClose={() => setConfirmDelete(false)} onConfirm={() => void remove()} title="Delete this deal?" description="Its timeline is deleted too. The contact stays." confirmLabel="Delete" />
    </Modal>
  );
}

function StagesEditor({ base, onClose, onSaved }: { base: string; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [rows, setRows] = React.useState<StageRow[] | null>(null);
  const [saving, setSaving] = React.useState(false);
  React.useEffect(() => {
    const t = window.setTimeout(async () => {
      const r = await apiFetch<{ stages: StageRow[] }>(`${base}/stages`);
      if (r.ok) setRows(r.data.stages.map(({ id, name, color, probability, kind }) => ({ id, name, color, probability, kind })));
    }, 0);
    return () => clearTimeout(t);
  }, [base]);
  const set = (i: number, p: Partial<StageRow>) => setRows((r) => r && r.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const swap = (i: number, j: number) => setRows((r) => { if (!r || j < 0 || j >= r.length) return r; const n = [...r]; [n[i], n[j]] = [n[j], n[i]]; return n; });

  async function save() {
    if (!rows) return;
    setSaving(true);
    const r = await apiFetch(`${base}/stages`, { method: "PUT", body: { stages: rows } });
    setSaving(false);
    if (!r.ok) return toast(r.error, "error");
    toast("Pipeline saved.");
    onSaved();
  }

  return (
    <Modal open onClose={onClose} size="lg" title="Pipeline stages" description="Name the steps of your sale. Win chance drives the expected-revenue forecast. Keep one Won and one Lost stage." footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={() => void save()} loading={saving} disabled={!rows}>Save stages</Button></>}>
      {!rows ? <LoadingState /> : (
        <div className="space-y-2">
          {rows.map((s, i) => (
            <div key={s.id ?? `new-${i}`} className="grid grid-cols-[auto_1fr] items-center gap-2 rounded-[var(--radius-control)] border border-app-border p-2 sm:grid-cols-[auto_1fr_7rem_6rem_7rem_auto]">
              <div className="flex flex-col">
                <button type="button" aria-label="Move up" onClick={() => swap(i, i - 1)} className="text-app-muted hover:text-app-text"><ArrowUp className="size-4" /></button>
                <button type="button" aria-label="Move down" onClick={() => swap(i, i + 1)} className="text-app-muted hover:text-app-text"><ArrowDown className="size-4" /></button>
              </div>
              <Input aria-label="Stage name" value={s.name} onChange={(e) => set(i, { name: e.target.value })} maxLength={40} />
              <Select aria-label="Colour" value={s.color} onChange={(e) => set(i, { color: e.target.value })}>
                {COLORS.map((c) => <option key={c} value={c}>{c}</option>)}
              </Select>
              <Input aria-label="Win chance %" type="number" min={0} max={100} value={s.kind === "open" ? s.probability : s.kind === "won" ? 100 : 0} disabled={s.kind !== "open"} onChange={(e) => set(i, { probability: Number(e.target.value) })} />
              <Select aria-label="Type" value={s.kind} onChange={(e) => set(i, { kind: e.target.value as StageKind })}>
                <option value="open">Open</option>
                <option value="won">Won</option>
                <option value="lost">Lost</option>
              </Select>
              <Button variant="ghost" size="sm" aria-label={`Remove ${s.name}`} onClick={() => setRows((r) => r && r.filter((_, j) => j !== i))}><Trash2 className="size-4" /></Button>
            </div>
          ))}
          <Button variant="secondary" size="sm" disabled={rows.length >= 15} onClick={() => setRows((r) => r && [...r.slice(0, Math.max(0, r.findIndex((x) => x.kind !== "open"))), { name: "New stage", color: "sky", probability: 50, kind: "open" }, ...r.slice(Math.max(0, r.findIndex((x) => x.kind !== "open")))])}>
            <Plus className="size-4" aria-hidden="true" /> Add stage
          </Button>
        </div>
      )}
    </Modal>
  );
}

function ScoringEditor({ base, onClose, onSaved }: { base: string; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [cfg, setCfg] = React.useState<ScoringConfig | null>(null);
  const [saving, setSaving] = React.useState(false);
  React.useEffect(() => {
    const t = window.setTimeout(async () => {
      const r = await apiFetch<{ scoring: ScoringConfig }>(`${base}/scoring`);
      if (r.ok) setCfg(r.data.scoring);
    }, 0);
    return () => clearTimeout(t);
  }, [base]);
  const setRule = (i: number, p: Partial<ScoreRule>) => setCfg((c) => c && { ...c, rules: c.rules.map((r, j) => (j === i ? { ...r, ...p } : r)) });
  const needsValue = (s: string) => ["tag", "lead_status", "source", "replied_within_days", "open_deal_value"].includes(s);

  async function save() {
    if (!cfg) return;
    setSaving(true);
    const r = await apiFetch(`${base}/scoring`, { method: "PUT", body: cfg });
    setSaving(false);
    if (!r.ok) return toast(r.error, "error");
    toast("Lead scoring saved.");
    onSaved();
  }

  return (
    <Modal open onClose={onClose} size="lg" title="Lead scoring" description="Points add up to a 0–100 score for every contact. Above the Hot line they show as Hot, above Warm as Warm, else Cold." footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={() => void save()} loading={saving} disabled={!cfg}>Save scoring</Button></>}>
      {!cfg ? <LoadingState /> : (
        <div className="space-y-3">
          {cfg.rules.map((r, i) => (
            <div key={i} className="grid grid-cols-2 items-center gap-2 rounded-[var(--radius-control)] border border-app-border p-2 sm:grid-cols-[1fr_9rem_6rem_auto]">
              <Select aria-label="Signal" value={r.signal} onChange={(e) => setRule(i, { signal: e.target.value as ScoreRule["signal"], value: "" })} className="col-span-2 sm:col-span-1">
                {SCORE_SIGNALS.map((s) => <option key={s} value={s}>{SIGNAL_LABELS[s]}</option>)}
              </Select>
              {r.signal === "lead_status" ? (
                <Select aria-label="Status" value={r.value} onChange={(e) => setRule(i, { value: e.target.value })}>
                  <option value="">Pick…</option>
                  {["new", "contacted", "qualified", "proposal", "won", "lost"].map((s) => <option key={s} value={s}>{s}</option>)}
                </Select>
              ) : (
                <Input aria-label="Value" value={r.value} disabled={!needsValue(r.signal)} placeholder={needsValue(r.signal) ? (r.signal === "tag" ? "Tag name" : r.signal === "source" ? "whatsapp" : "Number") : "—"} onChange={(e) => setRule(i, { value: e.target.value })} />
              )}
              <Input aria-label="Points" type="number" min={-100} max={100} value={r.points} onChange={(e) => setRule(i, { points: Number(e.target.value) })} />
              <Button variant="ghost" size="sm" aria-label="Remove rule" onClick={() => setCfg((c) => c && { ...c, rules: c.rules.filter((_, j) => j !== i) })}><Trash2 className="size-4" /></Button>
            </div>
          ))}
          <Button variant="secondary" size="sm" disabled={cfg.rules.length >= 30} onClick={() => setCfg((c) => c && { ...c, rules: [...c.rules, { signal: "tag", value: "", points: 10 }] })}>
            <SlidersHorizontal className="size-4" aria-hidden="true" /> Add rule
          </Button>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="sc-hot" label="Hot from score">
              <Input type="number" min={1} max={100} value={cfg.hot} onChange={(e) => setCfg((c) => c && { ...c, hot: Number(e.target.value) })} />
            </Field>
            <Field id="sc-warm" label="Warm from score">
              <Input type="number" min={0} max={99} value={cfg.warm} onChange={(e) => setCfg((c) => c && { ...c, warm: Number(e.target.value) })} />
            </Field>
          </div>
        </div>
      )}
    </Modal>
  );
}
