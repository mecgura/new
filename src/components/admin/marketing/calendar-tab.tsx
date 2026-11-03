"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight, Copy, Plus, Sparkles, Trash2 } from "lucide-react";
import { Badge, Button, Card, CardBody, ErrorState, Field, Input, LoadingState, Modal, Select, Textarea, useToast } from "@/components/ds";
import { apiFetch } from "@/lib/client-api";
import { cn } from "@/lib/utils";

type Post = { id: string; date: string; channels: string[]; title: string; caption: string; format: string; status: "idea" | "ready" | "posted"; festival: string };
type MonthData = { month: string; posts: Post[]; festivals: { id: string; name: string; emoji: string; date: string }[] };

const CHANNELS: Record<string, string> = { instagram: "Instagram", facebook: "Facebook", whatsapp_status: "WhatsApp status", linkedin: "LinkedIn" };
const FORMATS: Record<string, string> = { post: "Post", story: "Story", reel: "Reel", status: "Status" };
const STATUS: Record<Post["status"], { label: string; tone: "neutral" | "warning" | "success"; dot: string }> = {
  idea: { label: "Idea", tone: "neutral", dot: "bg-white/40" },
  ready: { label: "Ready", tone: "warning", dot: "bg-amber-400" },
  posted: { label: "Posted", tone: "success", dot: "bg-app-primary" },
};
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const istToday = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
const shiftMonth = (m: string, n: number) => {
  const [y, mo] = m.split("-").map(Number);
  const d = new Date(Date.UTC(y, mo - 1 + n, 1));
  return d.toISOString().slice(0, 7);
};
const monthLabel = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });

export function CalendarTab() {
  const toast = useToast();
  const [month, setMonth] = React.useState(istToday().slice(0, 7));
  const [data, setData] = React.useState<MonthData | null>(null);
  const [error, setError] = React.useState("");
  const [editing, setEditing] = React.useState<Post | { date: string } | null>(null);
  const [planning, setPlanning] = React.useState(false);

  const load = React.useCallback(async () => {
    const r = await apiFetch<MonthData>(`/api/admin/marketing/posts?month=${month}`);
    if (r.ok) {
      setData(r.data);
      setError("");
    } else setError(r.error);
  }, [month]);
  React.useEffect(() => {
    const t = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(t);
  }, [load]);

  async function autoPlan() {
    setPlanning(true);
    const r = await apiFetch<MonthData & { added: number }>("/api/admin/marketing/posts/auto-plan", { method: "POST", body: { month } });
    setPlanning(false);
    if (!r.ok) return toast(r.error, "error");
    setData(r.data);
    toast(r.data.added ? `${r.data.added} post ideas added for ${monthLabel(month)}` : "Every planned day already has a post");
  }

  if (error) return <ErrorState title="Couldn't load the calendar" description={error} onRetry={() => void load()} />;

  const [y, m] = month.split("-").map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7; // Monday first
  const today = istToday();
  const cells: (string | null)[] = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`)];
  const counts = data ? { idea: data.posts.filter((p) => p.status === "idea").length, ready: data.posts.filter((p) => p.status === "ready").length, posted: data.posts.filter((p) => p.status === "posted").length } : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Previous month">
            <ChevronLeft />
          </Button>
          <h2 className="min-w-[10rem] text-center text-h3 text-app-text">{monthLabel(month)}</h2>
          <Button variant="ghost" size="sm" onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Next month">
            <ChevronRight />
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {counts ? (
            <span className="text-caption text-app-subtle">
              {counts.posted} posted · {counts.ready} ready · {counts.idea} ideas
            </span>
          ) : null}
          <Button variant="secondary" size="sm" loading={planning} onClick={() => void autoPlan()}>
            <Sparkles /> Auto-plan this month
          </Button>
          <Button size="sm" onClick={() => setEditing({ date: month === today.slice(0, 7) ? today : `${month}-01` })}>
            <Plus /> Add post
          </Button>
        </div>
      </div>

      {!data || data.month !== month ? (
        <LoadingState label="Loading calendar…" />
      ) : (
        <Card>
          <CardBody className="overflow-x-auto p-2 sm:p-3">
            <div className="grid min-w-[52rem] grid-cols-7 gap-1.5">
              {WEEKDAYS.map((d) => (
                <div key={d} className="px-1 pb-1 text-caption font-semibold uppercase tracking-wide text-app-subtle">
                  {d}
                </div>
              ))}
              {cells.map((date, i) => {
                if (!date) return <div key={`b${i}`} />;
                const posts = data.posts.filter((p) => p.date === date);
                const fest = data.festivals.filter((f) => f.date === date);
                return (
                  <div key={date} className={cn("flex min-h-[7.5rem] flex-col rounded-lg border p-1.5", date === today ? "border-app-primary/60 bg-app-primary/[0.06]" : "border-app-border bg-white/[0.02]")}>
                    <div className="mb-1 flex items-center justify-between">
                      <span className={cn("text-caption tabular-nums", date === today ? "font-bold text-app-primary" : "text-app-subtle")}>{Number(date.slice(8))}</span>
                      <button type="button" onClick={() => setEditing({ date })} className="rounded p-0.5 text-app-subtle hover:bg-app-hover hover:text-app-text" aria-label={`Add post on ${date}`}>
                        <Plus className="size-3.5" />
                      </button>
                    </div>
                    {fest.map((f) => (
                      <span key={f.id} className="mb-1 truncate rounded bg-fuchsia-500/15 px-1.5 py-0.5 text-[11px] font-semibold text-fuchsia-200">
                        {f.emoji} {f.name}
                      </span>
                    ))}
                    <ul className="space-y-1">
                      {posts.map((p) => (
                        <li key={p.id}>
                          <button type="button" onClick={() => setEditing(p)} className="flex w-full items-center gap-1.5 rounded bg-app-surface px-1.5 py-1 text-left text-[11px] leading-tight text-app-text ring-1 ring-inset ring-app-border hover:ring-app-primary/50">
                            <span className={cn("size-1.5 shrink-0 rounded-full", STATUS[p.status].dot)} aria-hidden="true" />
                            <span className="line-clamp-2">{p.title}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          </CardBody>
        </Card>
      )}
      <p className="text-caption text-app-subtle">Auto-plan fills only empty days: a tip on Monday, a feature on Wednesday, proof or an offer on Friday, a story on Sunday, plus a teaser 3 days before and a wish on each festival. Make the image in Creative maker, then mark the post as posted.</p>

      {editing ? <PostModal value={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void load(); }} /> : null}
    </div>
  );
}

function PostModal({ value, onClose, onSaved }: { value: Post | { date: string }; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const existing = "id" in value ? value : null;
  const [f, setF] = React.useState({
    date: value.date,
    title: existing?.title ?? "",
    caption: existing?.caption ?? "",
    format: existing?.format ?? "post",
    status: existing?.status ?? "idea",
    channels: existing?.channels ?? ["instagram"],
  });
  const [busy, setBusy] = React.useState("");
  const set = (k: "date" | "title" | "caption" | "format" | "status") => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((p) => ({ ...p, [k]: e.target.value }));

  async function save() {
    setBusy("save");
    const r = existing ? await apiFetch(`/api/admin/marketing/posts/${existing.id}`, { method: "PATCH", body: f }) : await apiFetch("/api/admin/marketing/posts", { method: "POST", body: f });
    setBusy("");
    if (!r.ok) return toast(r.error, "error");
    toast(existing ? "Post saved" : "Post added");
    onSaved();
  }
  async function remove() {
    if (!existing) return;
    setBusy("delete");
    const r = await apiFetch(`/api/admin/marketing/posts/${existing.id}`, { method: "DELETE" });
    setBusy("");
    if (!r.ok) return toast(r.error, "error");
    toast("Post deleted");
    onSaved();
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={existing ? "Edit post" : "Add post"}
      description={existing?.festival ? <Badge tone="primary">For {existing.festival}</Badge> : undefined}
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          {existing ? (
            <Button variant="danger" size="sm" loading={busy === "delete"} onClick={() => void remove()}>
              <Trash2 /> Delete
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="secondary" disabled={!f.caption} onClick={() => void navigator.clipboard.writeText(f.caption).then(() => toast("Caption copied"))}>
              <Copy /> Copy caption
            </Button>
            <Button loading={busy === "save"} onClick={() => void save()}>
              Save
            </Button>
          </div>
        </div>
      }
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Field id="mp-title" label="Title" className="sm:col-span-3">
          <Input value={f.title} onChange={set("title")} maxLength={120} placeholder="e.g. Tip: reply in 5 minutes" />
        </Field>
        <Field id="mp-date" label="Date">
          <Input type="date" value={f.date} onChange={set("date")} />
        </Field>
        <Field id="mp-format" label="Format">
          <Select value={f.format} onChange={set("format")}>
            {Object.entries(FORMATS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="mp-status" label="Status">
          <Select value={f.status} onChange={set("status")}>
            {Object.entries(STATUS).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </Select>
        </Field>
        <fieldset className="sm:col-span-3">
          <legend className="mb-1.5 text-small font-medium text-app-text">Where</legend>
          <div className="flex flex-wrap gap-2">
            {Object.entries(CHANNELS).map(([k, v]) => {
              const on = f.channels.includes(k);
              return (
                <button
                  key={k}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setF((p) => ({ ...p, channels: on ? p.channels.filter((c) => c !== k) : [...p.channels, k] }))}
                  className={cn("rounded-full border px-3 py-1 text-small", on ? "border-app-primary/50 bg-app-primary/15 text-app-text" : "border-app-border text-app-muted hover:text-app-text")}
                >
                  {v}
                </button>
              );
            })}
          </div>
        </fieldset>
        <Field id="mp-caption" label="Caption" className="sm:col-span-3" hint={`${f.caption.length}/2200`}>
          <Textarea rows={8} value={f.caption} onChange={set("caption")} maxLength={2200} />
        </Field>
      </div>
    </Modal>
  );
}
