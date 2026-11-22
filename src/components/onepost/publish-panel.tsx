"use client";

import * as React from "react";
import { AlertTriangle, ExternalLink, RefreshCw, Rocket, XCircle } from "lucide-react";
import { Alert, Badge, Button, Card, CardBody, CardHeader, ConfirmationDialog, Input, LoadingState, useToast } from "@/components/ds";
import { apiFetch } from "@/lib/client-api";
import { DELIVERY_LABELS, DELIVERY_TONES, PUBLISH_LABELS, dateToIstInput, type DeliveryStatus, type PublishChannel } from "@/lib/onepost-publish";
import type { DeliveryDto } from "@/services/onepost/delivery";
import type { PostDetail } from "@/services/onepost/posts";

type Option = { channel: PublishChannel; label: string; target: string; problem: string; state: DeliveryStatus | ""; note: string };
type Data = { options: Option[]; deliveries: DeliveryDto[]; canQueue: boolean };

const dt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

/** Publish or schedule an approved post. Everything is shown before it goes out, and the result of every channel is kept. */
export function PublishPanel({ orgId, post, onChanged }: { orgId: string; post: PostDetail; onChanged: () => void }) {
  const base = `/api/organizations/${orgId}/onepost/posts/${post.id}`;
  const toast = useToast();
  const [data, setData] = React.useState<Data | null>(null);
  const [picked, setPicked] = React.useState<Set<PublishChannel>>(new Set());
  const [mode, setMode] = React.useState<"now" | "later">("now");
  const [when, setWhen] = React.useState(() => dateToIstInput(new Date(Date.now() + 3600_000)));
  const [busy, setBusy] = React.useState("");
  const [problems, setProblems] = React.useState<string[]>([]);
  const [confirm, setConfirm] = React.useState(false);

  const load = React.useCallback(async () => {
    const r = await apiFetch<Data>(`${base}/publish`);
    if (r.ok) setData(r.data);
  }, [base]);
  React.useEffect(() => {
    const id = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(id);
  }, [load, post.status, post.updatedAt]);

  if (!data) return <LoadingState label="Loading publishing…" />;
  const canPublish = post.can.publish && data.canQueue;
  const waiting = data.deliveries.filter((d) => d.status === "queued");
  const failed = data.deliveries.filter((d) => d.status === "failed");
  const choosable = data.options.filter((o) => !o.problem && !o.state);

  async function submit() {
    setConfirm(false);
    setBusy("publish");
    setProblems([]);
    const r = await apiFetch<Data>(`${base}/publish`, { method: "POST", body: { channels: [...picked], scheduledAt: mode === "later" ? when : "" } });
    setBusy("");
    if (!r.ok) {
      setProblems(r.details ? Object.entries(r.details).flatMap(([ch, msgs]) => msgs.map((m) => (ch === "scheduledAt" ? m : `${PUBLISH_LABELS[ch as PublishChannel] ?? ch}: ${m}`))) : [r.error]);
      return;
    }
    setData(r.data);
    setPicked(new Set());
    toast(mode === "later" ? "Scheduled" : "Sent to your channels. Check the result below.", "success");
    onChanged();
  }

  async function act(kind: "cancel" | "retry") {
    setBusy(kind);
    const r = await apiFetch<Data>(`${base}/${kind === "cancel" ? "publish" : "retry"}`, { method: kind === "cancel" ? "DELETE" : "POST", body: kind === "retry" ? {} : undefined });
    setBusy("");
    if (!r.ok) return toast(r.error, "error");
    setData(r.data);
    onChanged();
  }

  const toggle = (c: PublishChannel) => setPicked((s) => { const n = new Set(s); if (n.has(c)) n.delete(c); else n.add(c); return n; });

  return (
    <Card>
      <CardHeader title="Publish" description="Only an approved post can go out, and only to the channels you tick. Nothing is sent until you confirm." />
      <CardBody className="space-y-5">
        {!data.canQueue ? <Alert tone="info">{post.status === "published" ? "This post is published." : "Publishing opens once an owner has approved the post."}</Alert> : null}
        {data.canQueue && !post.can.publish ? <Alert tone="info">Owners and managers publish and schedule approved posts.</Alert> : null}

        {data.canQueue ? (
          <ul className="space-y-2" aria-label="Channels">
            {data.options.map((o) => {
              const blocked = Boolean(o.problem) || Boolean(o.state);
              return (
                <li key={o.channel} className="rounded-[var(--radius-control)] border border-app-border p-3">
                  <label className={`flex items-start gap-3 ${blocked || !canPublish ? "opacity-70" : "cursor-pointer"}`}>
                    <input type="checkbox" className="mt-1 size-4 accent-[var(--color-app-primary)]" disabled={blocked || !canPublish} checked={picked.has(o.channel)} onChange={() => toggle(o.channel)} />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2 text-body font-medium text-app-text">
                        {o.label}
                        {o.target ? <span className="text-small font-normal text-app-muted">to {o.target}</span> : null}
                        {o.state ? <Badge tone={DELIVERY_TONES[o.state]} dot>{DELIVERY_LABELS[o.state]}</Badge> : null}
                      </span>
                      {o.problem ? <span className="mt-0.5 flex gap-1.5 text-caption text-amber-200"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />{o.problem}</span> : null}
                      {!o.problem && o.note ? <span className="mt-0.5 block text-caption text-app-subtle">{o.note}</span> : null}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        ) : null}

        {canPublish ? (
          <>
            <fieldset className="space-y-3">
              <legend className="mb-1 text-small font-medium text-app-text">When</legend>
              <div className="flex flex-wrap gap-4">
                <label className="flex items-center gap-2 text-body text-app-text"><input type="radio" name="when" checked={mode === "now"} onChange={() => setMode("now")} className="accent-[var(--color-app-primary)]" /> Publish now</label>
                <label className="flex items-center gap-2 text-body text-app-text"><input type="radio" name="when" checked={mode === "later"} onChange={() => setMode("later")} className="accent-[var(--color-app-primary)]" /> Schedule</label>
              </div>
              {mode === "later" ? (
                <div className="max-w-xs">
                  <label htmlFor="op-when" className="mb-1.5 block text-small font-medium text-app-text">Date and time (India time)</label>
                  <Input id="op-when" type="datetime-local" value={when} min={dateToIstInput(new Date())} onChange={(e) => setWhen(e.target.value)} />
                </div>
              ) : null}
            </fieldset>
            {problems.length ? (
              <Alert tone="danger" title="Nothing was sent">
                <ul className="list-disc pl-4">{problems.map((p, i) => <li key={i}>{p}</li>)}</ul>
              </Alert>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button disabled={!picked.size || (mode === "later" && !when)} loading={busy === "publish"} onClick={() => setConfirm(true)}>
                <Rocket aria-hidden="true" /> {mode === "now" ? "Publish now" : "Schedule"}
              </Button>
              {waiting.length ? <Button variant="secondary" loading={busy === "cancel"} onClick={() => void act("cancel")}><XCircle aria-hidden="true" /> Cancel waiting posts</Button> : null}
              {failed.length ? <Button variant="secondary" loading={busy === "retry"} onClick={() => void act("retry")}><RefreshCw aria-hidden="true" /> Retry failed</Button> : null}
            </div>
            {!choosable.length && !data.deliveries.length ? <p className="text-small text-app-muted">No channel is ready yet. Connect accounts in Connections and write the versions first.</p> : null}
          </>
        ) : null}

        {data.deliveries.length ? (
          <div>
            <h3 className="mb-2 text-small font-semibold text-app-text">What happened</h3>
            <ul className="space-y-2">
              {data.deliveries.map((d) => (
                <li key={d.id} className="flex flex-wrap items-start justify-between gap-2 rounded-[var(--radius-control)] border border-app-border p-3 text-small">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 font-medium text-app-text">
                      {d.label}
                      <Badge tone={DELIVERY_TONES[d.status]} dot>{DELIVERY_LABELS[d.status]}</Badge>
                    </p>
                    <p className="text-caption text-app-subtle">
                      {d.status === "published" && d.publishedAt ? `Published ${dt.format(new Date(d.publishedAt))}` : d.status === "queued" ? `Goes out ${dt.format(new Date(d.nextAttemptAt))} IST` : `Planned ${dt.format(new Date(d.scheduledAt))}`}
                      {d.attempts > 1 ? ` · ${d.attempts} attempts` : ""}
                    </p>
                    {d.error ? <p className="mt-1 break-words text-caption text-amber-200">{d.error}</p> : null}
                  </div>
                  {d.url ? (
                    <a href={d.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-app-primary hover:underline">
                      View <ExternalLink className="size-3.5" aria-hidden="true" />
                    </a>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardBody>

      <ConfirmationDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={() => void submit()}
        tone="primary"
        title={mode === "now" ? "Publish now?" : "Schedule this post?"}
        description={`${mode === "now" ? "This posts publicly right away to" : `This will post publicly at ${when.replace("T", " ")} IST to`}: ${[...picked].map((c) => PUBLISH_LABELS[c]).join(", ")}. The wording is exactly what was approved.`}
        confirmLabel={mode === "now" ? "Publish" : "Schedule"}
        loading={busy === "publish"}
      />
    </Card>
  );
}
