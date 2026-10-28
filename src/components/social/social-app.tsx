"use client";

import * as React from "react";
import Link from "next/link";
import { CalendarClock, CheckCircle2, ChevronLeft, ChevronRight, ImagePlus, Plus, Send, Trash2 } from "lucide-react";
import { Alert, Badge, Button, Card, CardBody, CardHeader, Checkbox, Field, Input, Modal, PageHeader, Textarea, useToast } from "@/components/ds";
import { apiFetch } from "@/lib/client-api";

type Channel = "facebook" | "instagram";
type Post = {
  id: string;
  caption: string;
  channels: Channel[];
  hasImage: boolean;
  imageUrl: string | null;
  scheduledAt: string | null;
  status: "draft" | "scheduled" | "publishing" | "published" | "failed";
  publishedAt: string | null;
  results: Partial<Record<Channel, { id?: string; error?: string }>> & { manual?: boolean };
};
type Accounts = { facebook: { name: string } | null; instagram: { name: string } | null };
type Festival = { name: string; emoji: string; start: string };

const TZ = "Asia/Kolkata";
const dayKey = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const timeFmt = new Intl.DateTimeFormat("en-IN", { timeZone: TZ, hour: "numeric", minute: "2-digit" });
const monthFmt = new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
const STATUS: Record<Post["status"], { label: string; tone: "neutral" | "info" | "success" | "danger" | "warning" }> = {
  draft: { label: "Draft", tone: "neutral" },
  scheduled: { label: "Scheduled", tone: "info" },
  publishing: { label: "Publishing…", tone: "warning" },
  published: { label: "Published", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
};
function Facebook({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true"><path d="M13.5 21v-7.5h2.6l.4-3h-3V8.6c0-.9.3-1.5 1.6-1.5h1.6V4.4c-.3 0-1.2-.1-2.3-.1-2.3 0-3.9 1.4-3.9 4v2.2H8v3h2.6V21h2.9z" /></svg>
  );
}
function Instagram({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className} aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.5" cy="6.5" r="1" fill="currentColor" /></svg>
  );
}

const WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Month grid (Monday first) for a YYYY-MM month, as YYYY-MM-DD strings (with leading/trailing days). */
function monthDays(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const start = new Date(first);
  start.setUTCDate(1 - ((first.getUTCDay() + 6) % 7));
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    return d.toISOString().slice(0, 10);
  });
}
const shiftMonth = (ym: string, n: number) => {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
};

async function shrink(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1440 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  for (const q of [0.9, 0.8, 0.7, 0.6]) {
    const url = canvas.toDataURL("image/jpeg", q);
    if (url.length < 3_000_000) return url;
  }
  throw new Error("Image is too large.");
}

/** Social Media: content calendar, composer and publishing to Facebook / Instagram. */
export function SocialApp({ orgId, festivals }: { orgId: string; festivals: Festival[] }) {
  const toast = useToast();
  const base = `/api/organizations/${orgId}/social/posts`;
  const [month, setMonth] = React.useState(() => dayKey(new Date()).slice(0, 7));
  const [data, setData] = React.useState<{ posts: Post[]; accounts: Accounts } | null>(null);
  const [editing, setEditing] = React.useState<Post | "new" | null>(null);
  const [newDay, setNewDay] = React.useState<string>("");

  const load = React.useCallback(async () => {
    const days = monthDays(month);
    const from = new Date(`${days[0]}T00:00:00+05:30`).toISOString();
    const to = new Date(`${days[41]}T23:59:59+05:30`).toISOString();
    const r = await apiFetch<{ posts: Post[]; accounts: Accounts }>(`${base}?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
    if (!r.ok) return toast(r.error, "error");
    setData(r.data);
  }, [base, month, toast]);
  React.useEffect(() => {
    const t = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(t);
  }, [load]);

  const days = monthDays(month);
  const today = dayKey(new Date());
  const byDay = new Map<string, Post[]>();
  for (const p of data?.posts ?? []) {
    const when = p.publishedAt ?? p.scheduledAt;
    if (!when) continue;
    const k = dayKey(new Date(when));
    byDay.set(k, [...(byDay.get(k) ?? []), p]);
  }
  const drafts = (data?.posts ?? []).filter((p) => !p.scheduledAt && !p.publishedAt);
  const festByDay = new Map(festivals.map((f) => [f.start, f]));
  const upcoming = festivals.filter((f) => f.start >= today).slice(0, 4);

  return (
    <>
      <PageHeader
        title="Social Media"
        description="Plan, schedule and publish Facebook and Instagram posts from one calendar."
        actions={
          <Button onClick={() => { setNewDay(""); setEditing("new"); }}>
            <Plus aria-hidden="true" /> New post
          </Button>
        }
      />
      {data && !data.accounts.facebook && !data.accounts.instagram ? (
        <Alert tone="info" title="Connect your Facebook Page or Instagram to publish automatically" className="mb-4">
          Add them in <Link href="/channels" className="underline">Channels</Link> (Messenger = your Facebook Page). Until then you can plan posts here and mark them as posted after posting from your phone.
        </Alert>
      ) : data ? (
        <p className="mb-4 flex flex-wrap gap-2 text-small text-app-muted">
          Publishing to:
          {data.accounts.facebook ? <Badge tone="info"><Facebook className="size-3" aria-hidden="true" /> {data.accounts.facebook.name}</Badge> : null}
          {data.accounts.instagram ? <Badge tone="info"><Instagram className="size-3" aria-hidden="true" /> {data.accounts.instagram.name}</Badge> : null}
        </p>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[1fr_18rem]">
        <Card>
          <CardHeader
            title={monthFmt.format(new Date(`${month}-01T00:00:00Z`))}
            action={
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" aria-label="Previous month" onClick={() => setMonth((m) => shiftMonth(m, -1))}><ChevronLeft /></Button>
                <Button size="sm" variant="secondary" onClick={() => setMonth(today.slice(0, 7))}>Today</Button>
                <Button size="sm" variant="ghost" aria-label="Next month" onClick={() => setMonth((m) => shiftMonth(m, 1))}><ChevronRight /></Button>
              </div>
            }
          />
          <CardBody className="overflow-x-auto">
            <div className="grid min-w-[42rem] grid-cols-7 gap-1">
              {WEEK.map((d) => <div key={d} className="px-1 pb-1 text-caption font-semibold text-app-muted">{d}</div>)}
              {days.map((d) => {
                const posts = byDay.get(d) ?? [];
                const fest = festByDay.get(d);
                const inMonth = d.startsWith(month);
                return (
                  <div key={d} className={`group min-h-24 rounded-lg border p-1.5 ${d === today ? "border-app-primary" : "border-app-border"} ${inMonth ? "" : "opacity-40"}`}>
                    <div className="flex items-center justify-between">
                      <span className="text-caption font-semibold text-app-text">{Number(d.slice(8))}</span>
                      {d >= today ? (
                        <button type="button" aria-label={`New post on ${d}`} onClick={() => { setNewDay(d); setEditing("new"); }} className="rounded p-0.5 text-app-subtle opacity-0 hover:bg-app-hover hover:text-app-text focus:opacity-100 group-hover:opacity-100">
                          <Plus className="size-3.5" aria-hidden="true" />
                        </button>
                      ) : null}
                    </div>
                    {fest ? <p className="mt-0.5 truncate rounded bg-amber-500/15 px-1 text-[10px] font-semibold text-amber-300" title={fest.name}>{fest.emoji} {fest.name}</p> : null}
                    <div className="mt-1 space-y-1">
                      {posts.map((p) => (
                        <button key={p.id} type="button" onClick={() => setEditing(p)} className="flex w-full items-center gap-1 truncate rounded bg-app-hover px-1 py-0.5 text-left text-[11px] text-app-text hover:ring-1 hover:ring-app-primary">
                          <span className={`size-1.5 shrink-0 rounded-full ${p.status === "published" ? "bg-emerald-400" : p.status === "failed" ? "bg-red-400" : "bg-sky-400"}`} aria-hidden="true" />
                          <span className="shrink-0 text-app-muted">{timeFmt.format(new Date(p.publishedAt ?? p.scheduledAt!))}</span>
                          <span className="truncate">{p.caption || "Image post"}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardBody>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Drafts" description="Ideas not scheduled yet." />
            <CardBody>
              {drafts.length ? (
                <ul className="space-y-2">
                  {drafts.map((p) => (
                    <li key={p.id}>
                      <button type="button" onClick={() => setEditing(p)} className="w-full rounded-lg border border-app-border p-2 text-left text-small hover:bg-app-hover">
                        <span className="line-clamp-2 text-app-text">{p.caption || "Image post"}</span>
                        <span className="mt-1 flex items-center gap-2 text-caption text-app-subtle"><Badge tone={STATUS[p.status].tone}>{STATUS[p.status].label}</Badge> {p.channels.join(" + ")}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-small text-app-muted">No drafts.</p>
              )}
            </CardBody>
          </Card>
          {upcoming.length ? (
            <Card>
              <CardHeader title="Coming festivals" description="Plan festive posts early." />
              <CardBody>
                <ul className="space-y-2 text-small">
                  {upcoming.map((f) => (
                    <li key={f.start + f.name} className="flex items-center justify-between gap-2">
                      <span className="truncate text-app-text">{f.emoji} {f.name}</span>
                      <Button size="sm" variant="ghost" onClick={() => { setNewDay(f.start); setEditing("new"); }}>Plan</Button>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          ) : null}
        </div>
      </div>

      {editing ? (
        <Composer
          key={editing === "new" ? `new-${newDay}` : editing.id}
          base={base}
          post={editing === "new" ? null : editing}
          day={newDay}
          festival={newDay ? festByDay.get(newDay) : undefined}
          accounts={data?.accounts ?? { facebook: null, instagram: null }}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void load(); }}
        />
      ) : null}
    </>
  );
}

function Composer({ base, post, day, festival, accounts, onClose, onSaved }: { base: string; post: Post | null; day: string; festival?: Festival; accounts: Accounts; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const locked = post?.status === "published" || post?.status === "publishing";
  const initialWhen = post?.scheduledAt ? new Date(post.scheduledAt) : null;
  const [caption, setCaption] = React.useState(post?.caption ?? (festival ? `${festival.emoji} Happy ${festival.name}! ` : ""));
  const [channels, setChannels] = React.useState<Channel[]>(post?.channels ?? ["facebook", "instagram"]);
  const [date, setDate] = React.useState(initialWhen ? dayKey(initialWhen) : day);
  const [time, setTime] = React.useState(initialWhen ? new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(initialWhen) : "10:00");
  const [image, setImage] = React.useState<string | undefined>(undefined); // undefined = unchanged
  const [preview, setPreview] = React.useState<string | null>(post?.imageUrl ?? null);
  const [busy, setBusy] = React.useState("");
  const fileRef = React.useRef<HTMLInputElement>(null);

  const toggle = (c: Channel) => setChannels((xs) => (xs.includes(c) ? xs.filter((x) => x !== c) : [...xs, c]));
  const whenIso = date ? new Date(`${date}T${time || "10:00"}:00+05:30`).toISOString() : "";

  async function pick(file?: File) {
    if (!file) return;
    try {
      const url = await shrink(file);
      setImage(url);
      setPreview(url);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not use that image.", "error");
    }
  }

  async function save(status: "draft" | "scheduled") {
    setBusy(status);
    const body = { caption, channels, scheduledAt: status === "scheduled" ? whenIso : date ? whenIso : "", status, ...(image !== undefined ? { image } : {}) };
    const r = await apiFetch<{ post: Post }>(post ? `${base}/${post.id}` : base, { method: post ? "PUT" : "POST", body });
    setBusy("");
    if (!r.ok) return toast(Object.values(r.details ?? {}).flat()[0] ?? r.error, "error");
    toast(status === "scheduled" ? "Scheduled. It will be published automatically." : "Draft saved.");
    onSaved();
  }

  async function act(path: "publish" | "posted") {
    if (!post) return;
    setBusy(path);
    const r = await apiFetch<{ post: Post }>(`${base}/${post.id}/${path}`, { method: "POST" });
    setBusy("");
    if (!r.ok) return toast(r.error, "error");
    const errs = Object.entries(r.data.post.results).filter(([, v]) => typeof v === "object" && v?.error);
    if (r.data.post.status === "failed") toast(errs.map(([k, v]) => `${k}: ${(v as { error: string }).error}`).join(" · ") || "Publishing failed.", "error");
    else toast(errs.length ? `Published with problems: ${errs.map(([k]) => k).join(", ")}` : "Published!");
    onSaved();
  }

  async function remove() {
    if (!post || !window.confirm("Delete this post?")) return;
    const r = await apiFetch(`${base}/${post.id}`, { method: "DELETE" });
    if (!r.ok) return toast(r.error, "error");
    onSaved();
  }

  const connected = (c: Channel) => Boolean(accounts[c]);
  return (
    <Modal open onClose={onClose} size="lg" title={post ? (locked ? "Published post" : "Edit post") : "New post"} description={festival ? `${festival.emoji} ${festival.name}` : undefined}
      footer={
        locked ? (
          <Button variant="secondary" onClick={onClose}>Close</Button>
        ) : (
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            <div className="flex gap-2">
              {post ? <Button variant="ghost" onClick={() => void remove()} aria-label="Delete post"><Trash2 /></Button> : null}
              {post ? <Button variant="ghost" loading={busy === "posted"} onClick={() => void act("posted")}><CheckCircle2 /> Mark as posted</Button> : null}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" loading={busy === "draft"} onClick={() => void save("draft")}>Save draft</Button>
              {post ? <Button variant="secondary" loading={busy === "publish"} onClick={() => void act("publish")}><Send /> Publish now</Button> : null}
              <Button loading={busy === "scheduled"} disabled={!date} onClick={() => void save("scheduled")}><CalendarClock /> Schedule</Button>
            </div>
          </div>
        )
      }
    >
      <div className="space-y-4">
        {post?.status === "failed" ? (
          <Alert tone="danger" title="Last publish failed">
            {Object.entries(post.results).map(([k, v]) => (typeof v === "object" && v?.error ? <span key={k} className="block">{k}: {v.error}</span> : null))}
          </Alert>
        ) : null}
        {locked && post ? (
          <Alert tone="success" title="Published">
            {post.results.manual ? "Marked as posted by hand." : Object.entries(post.results).map(([k, v]) => <span key={k} className="block">{k}: {typeof v === "object" && v?.id ? "posted ✓" : typeof v === "object" ? v?.error : ""}</span>)}
          </Alert>
        ) : null}
        <Field id="sp-caption" label="Caption" hint={`${caption.length}/2200 · tip: 3–5 hashtags work best`}>
          <Textarea rows={6} value={caption} disabled={locked} maxLength={2200} onChange={(e) => setCaption(e.target.value)} placeholder="Write your post… #YourBrand" />
        </Field>
        <div>
          <p className="mb-1.5 text-small font-medium text-app-text">Image {channels.includes("instagram") ? "(needed for Instagram)" : "(optional)"}</p>
          <div className="flex flex-wrap items-center gap-3">
            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview} alt="Post image" className="h-28 w-28 rounded-lg object-cover ring-1 ring-app-border" />
            ) : (
              <div className="grid h-28 w-28 place-items-center rounded-lg border border-dashed border-app-border text-app-subtle"><ImagePlus aria-hidden="true" /></div>
            )}
            {!locked ? (
              <div className="flex flex-col gap-2">
                <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => void pick(e.target.files?.[0])} />
                <Button size="sm" variant="secondary" onClick={() => fileRef.current?.click()}>{preview ? "Change image" : "Add image"}</Button>
                {preview ? <Button size="sm" variant="ghost" onClick={() => { setImage(""); setPreview(null); }}>Remove</Button> : null}
              </div>
            ) : null}
          </div>
        </div>
        <fieldset disabled={locked} className="space-y-2">
          <legend className="mb-1 text-small font-medium text-app-text">Post to</legend>
          <Checkbox checked={channels.includes("facebook")} onChange={() => toggle("facebook")} label={<span className="inline-flex items-center gap-1.5"><Facebook className="size-4" aria-hidden="true" /> Facebook Page</span>} description={connected("facebook") ? accounts.facebook!.name : "Not connected: plan only"} />
          <Checkbox checked={channels.includes("instagram")} onChange={() => toggle("instagram")} label={<span className="inline-flex items-center gap-1.5"><Instagram className="size-4" aria-hidden="true" /> Instagram</span>} description={connected("instagram") ? accounts.instagram!.name : "Not connected: plan only"} />
        </fieldset>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="sp-date" label="Date">
            <Input type="date" value={date} disabled={locked} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field id="sp-time" label="Time (India)" hint="Evenings 7–9 pm usually get the most reach.">
            <Input type="time" value={time} disabled={locked} onChange={(e) => setTime(e.target.value)} />
          </Field>
        </div>
      </div>
    </Modal>
  );
}
