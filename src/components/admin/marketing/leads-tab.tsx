"use client";

import * as React from "react";
import Link from "next/link";
import { CalendarClock, Flame, MessageCircle, Plus, Trash2, UserPlus, UsersRound } from "lucide-react";
import { Badge, Button, Card, CardBody, CardHeader, ConfirmationDialog, EmptyState, ErrorState, Field, Input, LoadingState, Modal, SearchBar, Select, Textarea, useToast } from "@/components/ds";
import { apiFetch } from "@/lib/client-api";
import { formatINR } from "@/lib/catalog";
import { SOURCES, SOURCE_LABELS, STAGES, STAGE_LABELS, followUpText, type Source, type Stage } from "@/lib/marketing";
import { cn } from "@/lib/utils";

type Activity = { id: string; kind: string; text: string; createdAt: string };
type Lead = {
  id: string;
  name: string;
  phone: string;
  email: string;
  business: string;
  city: string;
  source: Source;
  medium: string;
  campaign: string;
  ref: string;
  stage: Stage;
  valueRupees: number;
  valuePaise: number;
  lostReason: string;
  nextFollowUpAt: string | null;
  lastContactAt: string | null;
  organizationId: string | null;
  createdAt: string;
  heat: number;
  heatLabel: "hot" | "warm" | "cold";
  activities: Activity[];
  overdue?: boolean;
};

const HEAT: Record<Lead["heatLabel"], { tone: "danger" | "warning" | "neutral"; text: string }> = {
  hot: { tone: "danger", text: "Hot" },
  warm: { tone: "warning", text: "Warm" },
  cold: { tone: "neutral", text: "Cold" },
};
const STAGE_TONE: Record<Stage, "neutral" | "info" | "primary" | "warning" | "success" | "danger"> = { new: "info", contacted: "neutral", demo: "primary", proposal: "warning", won: "success", lost: "danger" };
const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  return m < 60 ? `${Math.max(1, m)} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};
const waLink = (l: Pick<Lead, "phone" | "name" | "stage" | "business" | "source">) => `https://wa.me/${l.phone.replace(/\D/g, "")}?text=${encodeURIComponent(followUpText(l))}`;
/** datetime-local value in India time. */
const toLocalInput = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() + 5.5 * 3_600_000).toISOString().slice(0, 16) : "");
const fromLocalInput = (v: string) => (v ? new Date(`${v}:00+05:30`).toISOString() : "");

export function LeadsTab({ initialLeadId }: { initialLeadId: string | null }) {
  const toast = useToast();
  const [leads, setLeads] = React.useState<Lead[] | null>(null);
  const [today, setToday] = React.useState<Lead[]>([]);
  const [error, setError] = React.useState("");
  const [q, setQ] = React.useState("");
  const [source, setSource] = React.useState("");
  const [openId, setOpenId] = React.useState<string | null>(initialLeadId);
  const [adding, setAdding] = React.useState(false);

  const load = React.useCallback(async () => {
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (source) params.set("source", source);
    const r = await apiFetch<{ leads: Lead[]; today: Lead[] }>(`/api/admin/marketing/leads?${params}`);
    if (!r.ok) return setError(r.error);
    setError("");
    setLeads(r.data.leads);
    setToday(r.data.today);
  }, [q, source]);
  React.useEffect(() => {
    const t = setTimeout(() => void load(), q ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  async function messaged(l: Lead) {
    window.open(waLink(l), "_blank", "noopener");
    const r = await apiFetch(`/api/admin/marketing/leads/${l.id}/contacted`, { method: "POST" });
    if (!r.ok) toast(r.error, "error");
    void load();
  }

  if (error) return <ErrorState title="Couldn't load leads" description={error} onRetry={() => void load()} />;
  if (!leads) return <LoadingState label="Loading leads…" />;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title={
            <span className="flex items-center gap-2">
              <CalendarClock className="size-5 text-app-primary" aria-hidden="true" /> Today&apos;s list
            </span>
          }
          description="New leads nobody has messaged yet and follow-ups due today, hottest first. Tap WhatsApp: a ready message opens and the lead is marked as contacted."
          action={
            <Button size="sm" onClick={() => setAdding(true)}>
              <Plus /> Add lead
            </Button>
          }
        />
        <CardBody>
          {today.length ? (
            <ul className="divide-y divide-app-border">
              {today.map((l) => (
                <li key={l.id} className="flex flex-wrap items-center gap-3 py-2.5">
                  <button type="button" onClick={() => setOpenId(l.id)} className="min-w-0 flex-1 text-left">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-app-text">{l.name || l.phone}</span>
                      <Badge tone={HEAT[l.heatLabel].tone}>
                        <Flame className="size-3" aria-hidden="true" /> {HEAT[l.heatLabel].text} {l.heat}
                      </Badge>
                      {l.overdue ? <Badge tone="warning">Follow-up overdue</Badge> : !l.lastContactAt ? <Badge tone="info">Not contacted</Badge> : null}
                    </span>
                    <span className="mt-0.5 block text-caption text-app-subtle">
                      {SOURCE_LABELS[l.source]} · {STAGE_LABELS[l.stage]} · {l.business || l.phone} · {ago(l.createdAt)}
                    </span>
                  </button>
                  <Button size="sm" onClick={() => void messaged(l)}>
                    <MessageCircle /> WhatsApp
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-small text-app-subtle">All caught up. Nobody is waiting for a call today. 🎉</p>
          )}
        </CardBody>
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        <SearchBar label="Search leads" placeholder="Name, number, business or city" value={q} onChange={(e) => setQ(e.target.value)} className="min-w-[14rem] flex-1" />
        <Select aria-label="Source" value={source} onChange={(e) => setSource(e.target.value)} className="w-48">
          <option value="">All sources</option>
          {SOURCES.map((s) => (
            <option key={s} value={s}>
              {SOURCE_LABELS[s]}
            </option>
          ))}
        </Select>
      </div>

      {leads.length ? (
        <div className="overflow-x-auto pb-2">
          <div className="grid min-w-[66rem] grid-cols-6 gap-3">
            {STAGES.map((stage) => {
              const col = leads.filter((l) => l.stage === stage);
              const value = col.reduce((s, l) => s + l.valuePaise, 0);
              return (
                <section key={stage} aria-label={STAGE_LABELS[stage]} className="rounded-[var(--radius-card)] border border-app-border bg-white/[0.02] p-2">
                  <header className="mb-2 flex items-center justify-between px-1">
                    <Badge tone={STAGE_TONE[stage]}>{STAGE_LABELS[stage]}</Badge>
                    <span className="text-caption text-app-subtle">
                      {col.length}
                      {value ? ` · ${formatINR(value)}` : ""}
                    </span>
                  </header>
                  <ul className="space-y-2">
                    {col.map((l) => (
                      <li key={l.id}>
                        <button type="button" onClick={() => setOpenId(l.id)} className="w-full rounded-lg border border-app-border bg-app-surface p-2.5 text-left hover:border-app-primary/40">
                          <span className="flex items-start justify-between gap-2">
                            <span className="min-w-0 truncate text-small font-medium text-app-text">{l.name || l.phone}</span>
                            <span className={cn("shrink-0 text-caption font-semibold tabular-nums", l.heatLabel === "hot" ? "text-red-300" : l.heatLabel === "warm" ? "text-amber-300" : "text-app-subtle")}>{l.heat}</span>
                          </span>
                          <span className="mt-0.5 block truncate text-caption text-app-subtle">{l.business || l.city || l.phone}</span>
                          <span className="mt-1 block text-caption text-app-subtle">{SOURCE_LABELS[l.source]}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        </div>
      ) : (
        <EmptyState
          icon={UsersRound}
          title={q || source ? "No leads match" : "No leads yet"}
          description="Leads arrive by themselves from the website chat and the first message to your MECGURA WhatsApp number. You can also add one by hand."
          action={
            <Button onClick={() => setAdding(true)}>
              <Plus /> Add lead
            </Button>
          }
        />
      )}

      {adding ? <AddLeadModal onClose={() => setAdding(false)} onSaved={(id) => { setAdding(false); setOpenId(id); void load(); }} /> : null}
      {openId ? <LeadModal id={openId} onClose={() => setOpenId(null)} onChanged={() => void load()} /> : null}
    </div>
  );
}

function AddLeadModal({ onClose, onSaved }: { onClose: () => void; onSaved: (id: string) => void }) {
  const toast = useToast();
  const [f, setF] = React.useState({ name: "", phone: "", business: "", city: "", email: "", source: "manual", note: "" });
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((p) => ({ ...p, [k]: e.target.value }));
  async function save() {
    setBusy(true);
    const r = await apiFetch<{ lead: Lead; created: boolean }>("/api/admin/marketing/leads", { method: "POST", body: f });
    setBusy(false);
    if (!r.ok) {
      setErrors(Object.fromEntries(Object.entries(r.details ?? {}).map(([k, v]) => [k, v?.[0] ?? ""])));
      return toast(r.error, "error");
    }
    toast(r.data.created ? "Lead added" : "This number was already a lead, a note was added");
    onSaved(r.data.lead.id);
  }
  return (
    <Modal open onClose={onClose} title="Add lead" footer={<Button loading={busy} onClick={() => void save()}>Save lead</Button>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="ml-name" label="Name">
          <Input value={f.name} onChange={set("name")} maxLength={80} />
        </Field>
        <Field id="ml-phone" label="Mobile number" error={errors.phone}>
          <Input value={f.phone} onChange={set("phone")} inputMode="tel" placeholder="98140 12345" />
        </Field>
        <Field id="ml-business" label="Business">
          <Input value={f.business} onChange={set("business")} maxLength={120} />
        </Field>
        <Field id="ml-city" label="City">
          <Input value={f.city} onChange={set("city")} maxLength={60} />
        </Field>
        <Field id="ml-email" label="Email (optional)" error={errors.email}>
          <Input type="email" value={f.email} onChange={set("email")} />
        </Field>
        <Field id="ml-source" label="Where they came from">
          <Select value={f.source} onChange={set("source")}>
            {SOURCES.map((s) => (
              <option key={s} value={s}>
                {SOURCE_LABELS[s]}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="ml-note" label="Note" className="sm:col-span-2">
          <Textarea rows={3} value={f.note} onChange={set("note")} maxLength={1000} placeholder="What they need, budget, best time to call…" />
        </Field>
      </div>
    </Modal>
  );
}

function LeadModal({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const [lead, setLead] = React.useState<Lead | null>(null);
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState("");
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [lostReason, setLostReason] = React.useState("");

  React.useEffect(() => {
    void apiFetch<{ lead: Lead }>(`/api/admin/marketing/leads/${id}`).then((r) => {
      if (r.ok) {
        setLead(r.data.lead);
        setLostReason(r.data.lead.lostReason);
      } else {
        toast(r.error, "error");
        onClose();
      }
    });
  }, [id, onClose, toast]);

  async function patch(body: Record<string, unknown>, done?: string) {
    setBusy(Object.keys(body)[0] ?? "save");
    const r = await apiFetch<{ lead: Lead }>(`/api/admin/marketing/leads/${id}`, { method: "PATCH", body });
    setBusy("");
    if (!r.ok) return toast(r.error, "error");
    setLead(r.data.lead);
    if (done) toast(done);
    onChanged();
  }
  async function messaged() {
    if (!lead) return;
    window.open(waLink(lead), "_blank", "noopener");
    const r = await apiFetch<{ lead: Lead }>(`/api/admin/marketing/leads/${id}/contacted`, { method: "POST" });
    if (r.ok) setLead(r.data.lead);
    onChanged();
  }
  async function remove() {
    const r = await apiFetch(`/api/admin/marketing/leads/${id}`, { method: "DELETE" });
    if (!r.ok) return toast(r.error, "error");
    toast("Lead deleted");
    onChanged();
    onClose();
  }
  const quick = (days: number) => {
    const d = new Date(Date.now() + days * 86_400_000);
    d.setUTCHours(5, 0, 0, 0); // 10:30 India time
    void patch({ nextFollowUpAt: d.toISOString() }, `Follow-up set for ${when(d.toISOString())}`);
  };

  return (
    <Modal open onClose={onClose} size="lg" title={lead ? lead.name || lead.phone : "Lead"} description={lead ? `${lead.phone}${lead.business ? ` · ${lead.business}` : ""}${lead.city ? ` · ${lead.city}` : ""}` : undefined}>
      {!lead ? (
        <LoadingState />
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={HEAT[lead.heatLabel].tone}>
              <Flame className="size-3" aria-hidden="true" /> {HEAT[lead.heatLabel].text} · {lead.heat}/100
            </Badge>
            <Badge tone="neutral">{SOURCE_LABELS[lead.source]}</Badge>
            {lead.medium ? <Badge tone="neutral">via {lead.medium}{lead.campaign ? ` · ${lead.campaign}` : ""}</Badge> : null}
            {lead.ref ? <Badge tone="primary">Referred by {lead.ref}</Badge> : null}
            <span className="text-caption text-app-subtle">Added {when(lead.createdAt)}</span>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void messaged()}>
              <MessageCircle /> WhatsApp with ready message
            </Button>
            {lead.stage !== "won" ? (
              <Link href={`/admin/clients/new?name=${encodeURIComponent(lead.business || lead.name)}&owner=${encodeURIComponent(lead.name)}&mobile=${encodeURIComponent(lead.phone)}&email=${encodeURIComponent(lead.email)}`} className="inline-flex h-10 items-center gap-2 rounded-[var(--radius-control)] border border-white/10 bg-white/[0.04] px-4 text-body font-semibold text-app-text hover:bg-white/[0.08]">
                <UserPlus className="size-4" aria-hidden="true" /> Onboard as client
              </Link>
            ) : lead.organizationId ? (
              <Link href={`/admin/clients/${lead.organizationId}`} className="inline-flex h-10 items-center gap-2 rounded-[var(--radius-control)] border border-white/10 bg-white/[0.04] px-4 text-body font-semibold text-app-text hover:bg-white/[0.08]">
                Open client
              </Link>
            ) : null}
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <Field id="ld-stage" label="Stage">
              <Select value={lead.stage} disabled={busy === "stage"} onChange={(e) => void patch({ stage: e.target.value, ...(e.target.value === "lost" ? { lostReason } : {}) }, "Stage updated")}>
                {STAGES.map((s) => (
                  <option key={s} value={s}>
                    {STAGE_LABELS[s]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="ld-value" label="Monthly value (₹)" hint="Expected plan price">
              <Input type="number" min={0} defaultValue={lead.valueRupees || ""} onBlur={(e) => Number(e.target.value) !== lead.valueRupees && void patch({ valueRupees: Number(e.target.value) || 0 }, "Value saved")} />
            </Field>
            <Field id="ld-follow" label="Next follow-up">
              <Input type="datetime-local" defaultValue={toLocalInput(lead.nextFollowUpAt)} onBlur={(e) => e.target.value !== toLocalInput(lead.nextFollowUpAt) && void patch({ nextFollowUpAt: fromLocalInput(e.target.value) }, e.target.value ? "Follow-up set" : "Follow-up cleared")} />
            </Field>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-small">
            <span className="text-app-muted">Remind me:</span>
            <Button size="sm" variant="ghost" onClick={() => quick(1)}>Tomorrow</Button>
            <Button size="sm" variant="ghost" onClick={() => quick(3)}>In 3 days</Button>
            <Button size="sm" variant="ghost" onClick={() => quick(7)}>Next week</Button>
          </div>
          {lead.stage === "lost" ? (
            <Field id="ld-lost" label="Why it was lost">
              <Input value={lostReason} onChange={(e) => setLostReason(e.target.value)} onBlur={() => lostReason !== lead.lostReason && void patch({ lostReason }, "Saved")} placeholder="Price, went with another provider, not ready…" maxLength={200} />
            </Field>
          ) : null}

          <div>
            <Field id="ld-note" label="Add a note">
              <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What you talked about, next step…" maxLength={1000} />
            </Field>
            <Button
              size="sm"
              className="mt-2"
              disabled={!note.trim()}
              loading={busy === "note"}
              onClick={() =>
                void patch({ note: note.trim() }, "Note added").then(() => setNote(""))
              }
            >
              Save note
            </Button>
          </div>

          <section aria-label="Timeline">
            <h3 className="mb-2 text-small font-semibold text-app-text">Timeline</h3>
            <ol className="space-y-2 border-l border-app-border pl-4">
              {lead.activities.map((a) => (
                <li key={a.id} className="text-small">
                  <span className="text-app-text">{a.text}</span>
                  <span className="ml-2 text-caption text-app-subtle">{when(a.createdAt)}</span>
                </li>
              ))}
            </ol>
          </section>

          <div className="flex justify-end border-t border-app-border pt-3">
            <Button variant="danger" size="sm" onClick={() => setConfirmDelete(true)}>
              <Trash2 /> Delete lead
            </Button>
          </div>
          <ConfirmationDialog open={confirmDelete} onClose={() => setConfirmDelete(false)} onConfirm={() => void remove()} title="Delete this lead?" description="Their notes and timeline are deleted too. This can't be undone." confirmLabel="Delete" tone="danger" />
        </div>
      )}
    </Modal>
  );
}
