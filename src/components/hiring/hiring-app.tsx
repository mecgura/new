"use client";

import * as React from "react";
import Link from "next/link";
import { Briefcase, Copy, ExternalLink, FileText, MessageCircle, Pencil, Plus, Star, Trash2, UserPlus } from "lucide-react";
import { Badge, Button, Card, CardHeader, EmptyState, Field, Input, LoadingState, Modal, PageHeader, Select, Textarea, useToast } from "@/components/ds";
import { apiFetch, apiUpload } from "@/lib/client-api";
import { JOB_TYPE_LABELS, STAGE_LABELS } from "@/components/hiring/labels";

const STAGES = ["applied", "screening", "interview", "offer", "hired", "rejected"] as const;
type Stage = (typeof STAGES)[number];
type Job = { id: string; title: string; department: string; location: string; type: string; salary: string; description: string; status: "open" | "closed"; slug: string; counts: Record<Stage, number> };
type Candidate = { id: string; jobId: string; name: string; phone: string; email: string; stage: Stage; rating: number; source: string; notes: string; experience: string; resumeName: string; contactId: string | null; createdAt: string };

const total = (j: Job) => STAGES.reduce((n, s) => n + (j.counts[s] ?? 0), 0);
const dateFmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
const STAGE_TONE: Record<Stage, "neutral" | "info" | "warning" | "success" | "danger" | "primary"> = { applied: "neutral", screening: "info", interview: "warning", offer: "primary", hired: "success", rejected: "danger" };

/** ATS: job openings on the left, the selected job's candidate pipeline on the right. */
export function HiringApp({ orgId }: { orgId: string }) {
  const toast = useToast();
  const base = `/api/organizations/${orgId}/hiring`;
  const [data, setData] = React.useState<{ jobs: Job[]; careersPath: string } | null>(null);
  const [jobId, setJobId] = React.useState<string | null>(null);
  const [candidates, setCandidates] = React.useState<Candidate[] | null>(null);
  const [jobModal, setJobModal] = React.useState<Job | "new" | null>(null);
  const [addOpen, setAddOpen] = React.useState(false);
  const [open, setOpen] = React.useState<Candidate | null>(null);

  const loadJobs = React.useCallback(async () => {
    const r = await apiFetch<{ jobs: Job[]; careersPath: string }>(`${base}/jobs`);
    if (!r.ok) return toast(r.error, "error");
    setData(r.data);
    setJobId((cur) => cur ?? r.data.jobs[0]?.id ?? null);
  }, [base, toast]);
  const loadCandidates = React.useCallback(async () => {
    if (!jobId) return setCandidates([]);
    const r = await apiFetch<{ candidates: Candidate[] }>(`${base}/jobs/${jobId}/candidates`);
    if (r.ok) setCandidates(r.data.candidates);
  }, [base, jobId]);
  React.useEffect(() => {
    const t = window.setTimeout(() => void loadJobs(), 0);
    return () => window.clearTimeout(t);
  }, [loadJobs]);
  React.useEffect(() => {
    const t = window.setTimeout(() => void loadCandidates(), 0);
    return () => window.clearTimeout(t);
  }, [loadCandidates]);

  async function move(c: Candidate, stage: Stage) {
    setCandidates((xs) => xs?.map((x) => (x.id === c.id ? { ...x, stage } : x)) ?? null);
    const r = await apiFetch(`${base}/candidates/${c.id}`, { method: "PATCH", body: { stage } });
    if (!r.ok) toast(r.error, "error");
    void loadJobs();
  }

  if (!data) return <LoadingState label="Loading hiring…" />;
  const job = data.jobs.find((j) => j.id === jobId) ?? null;
  const careersUrl = typeof window !== "undefined" ? `${window.location.origin}${data.careersPath}` : data.careersPath;
  const jobUrl = job ? `${careersUrl}/${job.slug}` : careersUrl;

  return (
    <>
      <PageHeader
        title="Hiring"
        description="Post jobs, share your careers page and move candidates from applied to hired."
        actions={
          <>
            <Button variant="secondary" onClick={() => void navigator.clipboard.writeText(careersUrl).then(() => toast("Careers page link copied"))}>
              <Copy aria-hidden="true" /> Careers page link
            </Button>
            <Button onClick={() => setJobModal("new")}><Plus aria-hidden="true" /> New job</Button>
          </>
        }
      />
      {!data.jobs.length ? (
        <Card>
          <EmptyState icon={Briefcase} title="No jobs yet" description="Create your first opening. It appears on your careers page, where people apply with their phone number and resume." action={<Button onClick={() => setJobModal("new")}><Plus /> New job</Button>} />
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
          <Card>
            <ul className="divide-y divide-app-border">
              {data.jobs.map((j) => (
                <li key={j.id}>
                  <button type="button" onClick={() => setJobId(j.id)} className={`w-full px-4 py-3 text-left hover:bg-app-hover ${j.id === jobId ? "bg-app-primary/10" : ""}`}>
                    <span className="block truncate font-medium text-app-text">{j.title}</span>
                    <span className="flex items-center gap-2 text-caption text-app-subtle">
                      {j.status === "open" ? <Badge tone="success" dot>Open</Badge> : <Badge tone="neutral">Closed</Badge>} {total(j)} applicant{total(j) === 1 ? "" : "s"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </Card>

          {job ? (
            <div className="min-w-0 space-y-4">
              <Card>
                <CardHeader
                  title={job.title}
                  description={[JOB_TYPE_LABELS[job.type], job.department, job.location, job.salary].filter(Boolean).join(" · ")}
                  action={
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="secondary" onClick={() => void navigator.clipboard.writeText(jobUrl).then(() => toast("Job link copied. Share it on WhatsApp, Instagram or job groups."))}><Copy /> Job link</Button>
                      <a href={jobUrl} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-control)] border border-app-border px-3 text-small text-app-text hover:bg-app-hover"><ExternalLink className="size-4" aria-hidden="true" /> View</a>
                      <Button size="sm" variant="secondary" onClick={() => setJobModal(job)}><Pencil /> Edit</Button>
                      <Button size="sm" onClick={() => setAddOpen(true)}><UserPlus /> Add candidate</Button>
                    </div>
                  }
                />
              </Card>
              {!candidates ? (
                <LoadingState />
              ) : (
                <div className="overflow-x-auto pb-2">
                  <div className="grid min-w-[75rem] grid-cols-6 gap-3">
                    {STAGES.map((s) => {
                      const list = candidates.filter((c) => c.stage === s);
                      return (
                        <div key={s} className="rounded-xl border border-app-border bg-app-surface/60 p-2">
                          <p className="mb-2 flex items-center justify-between px-1 text-small font-semibold text-app-text">
                            {STAGE_LABELS[s]} <span className="text-caption text-app-subtle">{list.length}</span>
                          </p>
                          <div className="space-y-2">
                            {list.map((c) => (
                              <div key={c.id} className="rounded-lg border border-app-border bg-app-bg/40 p-2">
                                <button type="button" onClick={() => setOpen(c)} className="block w-full text-left">
                                  <span className="block truncate text-small font-medium text-app-text">{c.name}</span>
                                  <span className="block truncate text-caption text-app-subtle">{c.experience || c.phone || c.email}</span>
                                  <span className="mt-1 flex items-center gap-1 text-caption text-app-subtle">
                                    {c.rating ? <span className="text-amber-400">{"★".repeat(c.rating)}</span> : null} {dateFmt.format(new Date(c.createdAt))}
                                  </span>
                                </button>
                                <Select aria-label={`Move ${c.name}`} value={c.stage} onChange={(e) => void move(c, e.target.value as Stage)} className="mt-2 h-8 text-caption">
                                  {STAGES.map((x) => <option key={x} value={x}>{STAGE_LABELS[x]}</option>)}
                                </Select>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </div>
      )}

      {jobModal ? <JobModal base={base} job={jobModal === "new" ? null : jobModal} onClose={() => setJobModal(null)} onSaved={(id) => { setJobModal(null); if (id) setJobId(id); void loadJobs(); }} /> : null}
      {addOpen && job ? <AddCandidate base={base} jobId={job.id} onClose={() => setAddOpen(false)} onSaved={() => { setAddOpen(false); void loadCandidates(); void loadJobs(); }} /> : null}
      {open ? <CandidateModal base={base} candidate={open} onClose={() => setOpen(null)} onSaved={() => { setOpen(null); void loadCandidates(); void loadJobs(); }} /> : null}
    </>
  );
}

function JobModal({ base, job, onClose, onSaved }: { base: string; job: Job | null; onClose: () => void; onSaved: (id?: string) => void }) {
  const toast = useToast();
  const [f, setF] = React.useState({ title: job?.title ?? "", department: job?.department ?? "", location: job?.location ?? "", type: job?.type ?? "full_time", salary: job?.salary ?? "", description: job?.description ?? "", status: job?.status ?? "open" });
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF((x) => ({ ...x, [k]: e.target.value }));

  async function save() {
    setBusy(true);
    const r = await apiFetch<{ job: Job }>(job ? `${base}/jobs/${job.id}` : `${base}/jobs`, { method: job ? "PUT" : "POST", body: f });
    setBusy(false);
    if (!r.ok) {
      setErrors(Object.fromEntries(Object.entries(r.details ?? {}).map(([k, v]) => [k, v?.[0] ?? ""])));
      return toast(r.error, "error");
    }
    toast(job ? "Job updated" : "Job created. Share the job link to get applicants.");
    onSaved(r.data.job.id);
  }

  async function remove() {
    if (!job || !window.confirm(`Delete "${job.title}" and all its candidates?`)) return;
    const r = await apiFetch(`${base}/jobs/${job.id}`, { method: "DELETE" });
    if (!r.ok) return toast(r.error, "error");
    onSaved();
  }

  return (
    <Modal open onClose={onClose} size="lg" title={job ? "Edit job" : "New job"}
      footer={
        <div className="flex w-full justify-between gap-2">
          {job ? <Button variant="ghost" onClick={() => void remove()}><Trash2 /> Delete</Button> : <span />}
          <Button loading={busy} onClick={() => void save()}>Save</Button>
        </div>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="j-title" label="Job title" error={errors.title} className="sm:col-span-2"><Input value={f.title} onChange={set("title")} placeholder="Sales Executive" /></Field>
        <Field id="j-dept" label="Department"><Input value={f.department} onChange={set("department")} placeholder="Sales" /></Field>
        <Field id="j-loc" label="Location"><Input value={f.location} onChange={set("location")} placeholder="Ludhiana / Remote" /></Field>
        <Field id="j-type" label="Type">
          <Select value={f.type} onChange={set("type")}>{Object.entries(JOB_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
        </Field>
        <Field id="j-sal" label="Salary (optional)"><Input value={f.salary} onChange={set("salary")} placeholder="₹15,000 – ₹25,000 / month" /></Field>
        <Field id="j-desc" label="Description" hint="Role, requirements, timings, benefits." className="sm:col-span-2"><Textarea rows={7} value={f.description} onChange={set("description")} /></Field>
        <Field id="j-status" label="Status">
          <Select value={f.status} onChange={set("status")}><option value="open">Open (on careers page)</option><option value="closed">Closed</option></Select>
        </Field>
      </div>
    </Modal>
  );
}

function AddCandidate({ base, jobId, onClose, onSaved }: { base: string; jobId: string; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const formRef = React.useRef<HTMLFormElement>(null);

  async function save() {
    if (!formRef.current) return;
    const fd = new FormData(formRef.current);
    fd.set("jobId", jobId);
    setBusy(true);
    const r = await apiUpload(`${base}/candidates`, fd);
    setBusy(false);
    if (!r.ok) {
      setErrors(Object.fromEntries(Object.entries(r.details ?? {}).map(([k, v]) => [k, v?.[0] ?? ""])));
      return toast(r.error, "error");
    }
    toast("Candidate added");
    onSaved();
  }

  return (
    <Modal open onClose={onClose} title="Add candidate" footer={<Button loading={busy} onClick={() => void save()}>Add</Button>}>
      <form ref={formRef} className="grid gap-4" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <Field id="c-name" label="Name" error={errors.name}><Input name="name" /></Field>
        <Field id="c-phone" label="Mobile" error={errors.phone}><Input name="phone" type="tel" /></Field>
        <Field id="c-email" label="Email" error={errors.email}><Input name="email" type="email" /></Field>
        <Field id="c-exp" label="Experience"><Input name="experience" placeholder="2 years" /></Field>
        <Field id="c-src" label="Source">
          <Select name="source" defaultValue="manual"><option value="manual">Added by team</option><option value="referral">Referral</option></Select>
        </Field>
        <Field id="c-resume" label="Resume (optional)" error={errors.resume}><Input name="resume" type="file" accept=".pdf,.doc,.docx,image/jpeg,image/png" /></Field>
      </form>
    </Modal>
  );
}

function CandidateModal({ base, candidate: c, onClose, onSaved }: { base: string; candidate: Candidate; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [stage, setStage] = React.useState<Stage>(c.stage);
  const [rating, setRating] = React.useState(c.rating);
  const [notes, setNotes] = React.useState(c.notes);
  const [busy, setBusy] = React.useState(false);

  async function save() {
    setBusy(true);
    const r = await apiFetch(`${base}/candidates/${c.id}`, { method: "PATCH", body: { stage, rating, notes } });
    setBusy(false);
    if (!r.ok) return toast(r.error, "error");
    onSaved();
  }
  async function remove() {
    if (!window.confirm(`Delete ${c.name}?`)) return;
    const r = await apiFetch(`${base}/candidates/${c.id}`, { method: "DELETE" });
    if (!r.ok) return toast(r.error, "error");
    onSaved();
  }

  const digits = c.phone.replace(/\D/g, "");
  return (
    <Modal open onClose={onClose} size="lg" title={c.name} description={<Badge tone={STAGE_TONE[c.stage]}>{STAGE_LABELS[c.stage]}</Badge>}
      footer={
        <div className="flex w-full justify-between gap-2">
          <Button variant="ghost" onClick={() => void remove()}><Trash2 /> Delete</Button>
          <Button loading={busy} onClick={() => void save()}>Save</Button>
        </div>
      }
    >
      <div className="space-y-4">
        <dl className="grid gap-x-6 gap-y-2 text-small sm:grid-cols-2">
          <div><dt className="text-caption text-app-muted">Mobile</dt><dd className="text-app-text">{c.phone || "—"}</dd></div>
          <div><dt className="text-caption text-app-muted">Email</dt><dd className="break-all text-app-text">{c.email || "—"}</dd></div>
          <div><dt className="text-caption text-app-muted">Experience</dt><dd className="text-app-text">{c.experience || "—"}</dd></div>
          <div><dt className="text-caption text-app-muted">Source</dt><dd className="text-app-text">{c.source === "careers_page" ? "Careers page" : c.source === "referral" ? "Referral" : "Added by team"}</dd></div>
        </dl>
        <div className="flex flex-wrap gap-2">
          {c.resumeName ? <a href={`${base}/candidates/${c.id}/resume`} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-control)] border border-app-border px-3 text-small text-app-text hover:bg-app-hover"><FileText className="size-4" aria-hidden="true" /> Resume</a> : null}
          {c.contactId ? <Link href={`/contacts/${c.contactId}`} className="inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-control)] border border-app-border px-3 text-small text-app-text hover:bg-app-hover"><MessageCircle className="size-4" aria-hidden="true" /> Open in CRM / chat</Link> : null}
          {digits ? <a href={`https://wa.me/${digits}`} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-control)] border border-app-border px-3 text-small text-app-text hover:bg-app-hover"><MessageCircle className="size-4" aria-hidden="true" /> WhatsApp from phone</a> : null}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="cm-stage" label="Stage">
            <Select value={stage} onChange={(e) => setStage(e.target.value as Stage)}>{STAGES.map((x) => <option key={x} value={x}>{STAGE_LABELS[x]}</option>)}</Select>
          </Field>
          <div>
            <p className="mb-1.5 text-small font-medium text-app-text">Rating</p>
            <div className="flex gap-1" role="radiogroup" aria-label="Rating">
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} type="button" role="radio" aria-checked={rating === n} aria-label={`${n} star${n === 1 ? "" : "s"}`} onClick={() => setRating(rating === n ? 0 : n)} className="p-0.5">
                  <Star className={`size-6 ${n <= rating ? "fill-amber-400 text-amber-400" : "text-app-subtle"}`} aria-hidden="true" />
                </button>
              ))}
            </div>
          </div>
        </div>
        <Field id="cm-notes" label="Notes" hint="Interview feedback, salary expectation, notice period…"><Textarea rows={5} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}
