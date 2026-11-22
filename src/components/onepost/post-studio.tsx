"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { upload } from "@vercel/blob/client";
import { AlertTriangle, Check, Copy, Download, FileDown, Film, Image as ImageIcon, Pencil, RefreshCw, Sparkles, Trash2, Upload, X } from "lucide-react";
import { Alert, Badge, Button, Card, CardBody, CardHeader, ConfirmationDialog, ErrorState, LoadingState, Modal, PageHeader, Textarea, useToast } from "@/components/ds";
import { apiFetch } from "@/lib/client-api";
import { CHANNELS, STATUS_LABELS, STATUS_TONES, MAX_MEDIA_BYTES, MAX_MEDIA_PER_POST, contentToText, downloadName, type Channel, type FlowAction } from "@/lib/onepost";
import type { BrandDto, PostDetail } from "@/services/onepost/posts";
import { ChannelPreview } from "@/components/onepost/previews";
import { VersionEditor } from "@/components/onepost/version-editor";
import { PostForm, type PostFields } from "@/components/onepost/post-form";
import { PublishPanel } from "@/components/onepost/publish-panel";

const MB = 1024 * 1024;
const dateFmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });
const EVENT_LABELS: Record<string, string> = { created: "Created the post", generated: "Wrote versions", version_edited: "Edited a version", submit: "Sent for review", approve: "Approved", request_changes: "Asked for changes", reopen: "Reopened for editing", approval_reset: "Sent back to draft", publish_requested: "Published", scheduled: "Scheduled", schedule_cancelled: "Cancelled scheduled posts", rescheduled: "Moved a scheduled post", published: "Published to", publish_retry: "Will retry", publish_failed: "Could not publish", retry: "Retried" };
const readFile = (f: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("Could not read the file."));
    r.readAsDataURL(f);
  });

function saveText(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/** One post: its idea, photos, every channel version with a preview, and the approval flow. */
export function PostStudio({ orgId, postId }: { orgId: string; postId: string }) {
  const base = `/api/organizations/${orgId}/onepost`;
  const router = useRouter();
  const toast = useToast();
  const [post, setPost] = React.useState<PostDetail | null>(null);
  const [brand, setBrand] = React.useState<BrandDto | null>(null);
  const [error, setError] = React.useState("");
  const [fields, setFields] = React.useState<PostFields | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState("");
  const [editing, setEditing] = React.useState<Channel | null>(null);
  const [redo, setRedo] = React.useState<{ channel: Channel; note: string } | null>(null);
  const [asking, setAsking] = React.useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [copied, setCopied] = React.useState<Channel | null>(null);
  const [pct, setPct] = React.useState(0);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const adopt = React.useCallback((p: PostDetail) => {
    setPost(p);
    setFields({ title: p.title, brief: p.brief, postType: p.postType, language: p.language, tone: p.tone, city: p.city, keywords: p.keywords, spokespersonName: p.spokespersonName, spokespersonQuote: p.spokespersonQuote, videoUrl: p.videoUrl });
  }, []);

  const reload = React.useCallback(async () => {
    const r = await apiFetch<{ post: PostDetail }>(`${base}/posts/${postId}`);
    if (r.ok) adopt(r.data.post);
  }, [base, postId, adopt]);

  React.useEffect(() => {
    let live = true;
    void (async () => {
      const [p, b] = await Promise.all([apiFetch<{ post: PostDetail }>(`${base}/posts/${postId}`), apiFetch<{ brand: BrandDto }>(`${base}/brand`)]);
      if (!live) return;
      if (!p.ok) return setError(p.error);
      adopt(p.data.post);
      if (b.ok) setBrand(b.data.brand);
    })();
    return () => {
      live = false;
    };
  }, [base, postId, adopt]);

  if (error) return <ErrorState description={error} onRetry={() => router.refresh()} />;
  if (!post || !fields) return <LoadingState label="Loading post…" />;

  const versions = new Map(post.versions.map((v) => [v.channel, v]));
  const images = post.media.map((m) => m.url);
  const previewBrand = { businessName: brand?.businessName ?? "", logoUrl: brand?.logoUrl ?? null, website: brand?.website ?? "" };
  const dirty = JSON.stringify(fields) !== JSON.stringify({ title: post.title, brief: post.brief, postType: post.postType, language: post.language, tone: post.tone, city: post.city, keywords: post.keywords, spokespersonName: post.spokespersonName, spokespersonQuote: post.spokespersonQuote, videoUrl: post.videoUrl });

  async function saveDetails() {
    setBusy("save");
    setFieldErrors({});
    const r = await apiFetch<{ post: PostDetail }>(`${base}/posts/${postId}`, { method: "PATCH", body: fields });
    setBusy("");
    if (!r.ok) {
      setFieldErrors(Object.fromEntries(Object.entries(r.details ?? {}).map(([k, v]) => [k, v[0] ?? ""])));
      return toast(r.details ? "Please fix the highlighted fields." : r.error, "error");
    }
    adopt(r.data.post);
    toast("Saved", "success");
  }

  async function generate(channels?: Channel[], instruction?: string) {
    setBusy(channels?.length === 1 ? `gen:${channels[0]}` : "gen");
    const r = await apiFetch<{ post: PostDetail; failures: { channel: Channel; error: string }[] }>(`${base}/posts/${postId}/generate`, { method: "POST", body: { channels, instruction: instruction || undefined } });
    setBusy("");
    if (!r.ok) return toast(r.error, "error");
    adopt(r.data.post);
    if (r.data.failures.length) toast(`${r.data.failures.length} version(s) could not be written. Try those again.`, "error");
    else toast(channels?.length === 1 ? "Version rewritten" : "All versions written", "success");
  }

  async function flow(action: FlowAction, note = "") {
    setBusy(`flow:${action}`);
    const r = await apiFetch<{ post: PostDetail }>(`${base}/posts/${postId}/status`, { method: "POST", body: { action, note } });
    setBusy("");
    if (!r.ok) return toast(r.error, "error");
    adopt(r.data.post);
    setAsking(null);
  }

  async function addFiles(files: FileList | null) {
    if (!files?.length) return;
    setBusy("media");
    for (const f of Array.from(files)) {
      const isVideo = f.type.startsWith("video/");
      if (post!.storage) {
        // Straight from the browser to Blob storage, so large videos never pass through the server.
        if (f.size > (isVideo ? 300 * MB : 8 * MB)) {
          toast(`${f.name} is over ${isVideo ? "300 MB" : "8 MB"}.`, "error");
          continue;
        }
        try {
          setPct(0);
          const b = await upload(`onepost/${orgId}/${postId}/${f.name}`, f, { access: "public", handleUploadUrl: `${base}/posts/${postId}/media/blob`, contentType: f.type, multipart: f.size > 20 * MB, onUploadProgress: (e) => setPct(Math.round(e.percentage)) });
          const r = await apiFetch<{ post: PostDetail }>(`${base}/posts/${postId}/media/register`, { method: "POST", body: { url: b.url, name: f.name } });
          if (!r.ok) {
            toast(r.error, "error");
            break;
          }
          adopt(r.data.post);
        } catch (e) {
          toast(e instanceof Error ? e.message.slice(0, 160) : "Upload failed.", "error");
          break;
        }
        continue;
      }
      if (isVideo) {
        toast("Video upload needs file storage, which is not connected yet.", "error");
        continue;
      }
      if (f.size > MAX_MEDIA_BYTES) {
        toast(`${f.name} is over 3 MB.`, "error");
        continue;
      }
      const r = await apiFetch<{ post: PostDetail }>(`${base}/posts/${postId}/media`, { method: "POST", body: { name: f.name, image: await readFile(f).catch(() => "") } });
      if (!r.ok) {
        toast(r.error, "error");
        break;
      }
      adopt(r.data.post);
    }
    setBusy("");
    setPct(0);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function removeImage(id: string) {
    const r = await apiFetch<{ post: PostDetail }>(`${base}/posts/${postId}/media/${id}`, { method: "DELETE" });
    if (!r.ok) return toast(r.error, "error");
    adopt(r.data.post);
  }

  async function remove() {
    setBusy("delete");
    const r = await apiFetch(`${base}/posts/${postId}`, { method: "DELETE" });
    setBusy("");
    if (!r.ok) return toast(r.error, "error");
    router.push("/onepost");
  }

  async function copy(channel: Channel) {
    const v = versions.get(channel);
    if (!v) return;
    try {
      await navigator.clipboard.writeText(contentToText(channel, v.content));
      setCopied(channel);
      window.setTimeout(() => setCopied((c) => (c === channel ? null : c)), 1500);
    } catch {
      toast("Copy didn't work in this browser. Use Download instead.", "error");
    }
  }

  function downloadAll() {
    const parts = CHANNELS.filter((c) => versions.has(c.key)).map((c) => `# ${c.label}\n\n${contentToText(c.key, versions.get(c.key)!.content)}`);
    saveText(`${downloadName("blog", post!.title).replace(/-blog\.md$/, "")}-all-versions.md`, `${parts.join("\n\n---\n\n")}\n`);
  }

  const canEdit = post.can.edit;
  const hasVersions = post.versions.length > 0;

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: "OnePost", href: "/onepost" }, { label: post.title }]}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {post.title}
            <Badge tone={STATUS_TONES[post.status]} dot>
              {STATUS_LABELS[post.status]}
            </Badge>
          </span>
        }
        description={post.createdByName ? `Created by ${post.createdByName}` : undefined}
        actions={
          <>
            {post.can.actions.map((a) => (
              <Button
                key={a.key}
                variant={a.key === "approve" ? "primary" : a.key === "request_changes" ? "danger" : "secondary"}
                loading={busy === `flow:${a.key}`}
                disabled={Boolean(busy) && busy !== `flow:${a.key}`}
                onClick={() => (a.key === "request_changes" ? setAsking("") : void flow(a.key))}
              >
                {a.key === "approve" ? <Check aria-hidden="true" /> : null}
                {a.label}
              </Button>
            ))}
            {post.can.delete ? (
              <Button variant="ghost" aria-label="Delete post" onClick={() => setConfirmDelete(true)}>
                <Trash2 aria-hidden="true" />
              </Button>
            ) : null}
          </>
        }
      />

      <div className="space-y-5">
        {!post.live ? (
          <Alert tone="warning" title="Demo drafts">
            No AI key is set on this server, so versions are simple drafts built only from your own words. Ask MECGURA to add an AI key for full-length, channel-specific writing.
          </Alert>
        ) : null}
        {post.status === "changes_requested" && post.reviewNote ? (
          <Alert tone="warning" title="Changes requested">
            {post.reviewNote}
          </Alert>
        ) : null}
        {post.status === "approved" ? <Alert tone="success">Approved. Nothing is sent anywhere until you choose channels in Publish below and confirm.</Alert> : null}
        {!canEdit ? <Alert tone="info">You can view this post. {post.status === "approved" || post.status === "in_review" ? "An owner or manager can reopen it for editing." : "Only its creator, a manager or an owner can edit it."}</Alert> : null}

        <div className="grid gap-5 lg:grid-cols-5">
          <Card className="lg:col-span-3">
            <CardHeader title="The idea" description="Write it once. Every channel version is made from this." />
            <CardBody className="space-y-4">
              <fieldset disabled={!canEdit} className="min-w-0 space-y-4 disabled:opacity-80">
                <PostForm value={fields} onChange={setFields} errors={fieldErrors} idPrefix="pd" />
              </fieldset>
              {canEdit ? (
                <div className="flex flex-wrap justify-end gap-2">
                  <Button variant="secondary" disabled={!dirty} onClick={() => adopt(post)}>
                    Undo changes
                  </Button>
                  <Button onClick={saveDetails} loading={busy === "save"} disabled={!dirty}>
                    Save details
                  </Button>
                </div>
              ) : null}
            </CardBody>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader title="Photos and video" description={post.storage ? `Up to ${MAX_MEDIA_PER_POST} files: photos up to 8 MB, videos up to 300 MB. The first photo is used in previews.` : `Up to ${MAX_MEDIA_PER_POST} photos, 3 MB each. Video upload needs file storage, which is not connected yet.`} />
            <CardBody className="space-y-3">
              {post.media.length ? (
                <ul className="grid grid-cols-3 gap-2">
                  {post.media.map((m) => (
                    <li key={m.id} className="relative overflow-hidden rounded-[var(--radius-control)] border border-app-border">
                      {m.kind === "video" ? (
                        <div className="relative">
                          <video src={m.url} preload="metadata" muted className="aspect-square w-full bg-black object-cover" aria-label={m.name} />
                          <span className="absolute bottom-1 left-1 flex items-center gap-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-white"><Film className="size-3" aria-hidden="true" /> Video</span>
                        </div>
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={m.url} alt={m.name} className="aspect-square w-full object-cover" />
                      )}
                      {canEdit ? (
                        <button type="button" aria-label={`Remove ${m.name}`} onClick={() => void removeImage(m.id)} className="absolute right-1 top-1 rounded-full bg-black/70 p-1 text-white hover:bg-black">
                          <X className="size-3.5" aria-hidden="true" />
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="flex flex-col items-center gap-2 rounded-[var(--radius-control)] border border-dashed border-app-border py-8 text-app-muted">
                  <ImageIcon className="size-6" aria-hidden="true" />
                  <p className="text-small">No photos yet</p>
                </div>
              )}
              {canEdit && post.media.length < MAX_MEDIA_PER_POST ? (
                <>
                  <input ref={fileRef} type="file" accept={post.storage ? "image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm" : "image/jpeg,image/png,image/webp"} multiple className="sr-only" id="onepost-files" onChange={(e) => void addFiles(e.target.files)} />
                  <Button variant="secondary" loading={busy === "media"} onClick={() => fileRef.current?.click()}>
                    <Upload aria-hidden="true" /> {busy === "media" && pct ? `Uploading ${pct}%` : post.storage ? "Add photos or video" : "Add photos"}
                  </Button>
                </>
              ) : null}
              {post.videoUrl ? <p className="break-all text-small text-app-muted">Video link: {post.videoUrl}</p> : null}
            </CardBody>
          </Card>
        </div>

        <Card>
          <CardHeader
            title="Channel versions"
            description="Each channel gets its own wording. Edit any version, or rewrite just that one."
            action={
              <div className="flex flex-wrap gap-2">
                {hasVersions ? (
                  <Button variant="secondary" onClick={downloadAll}>
                    <FileDown aria-hidden="true" /> Download all
                  </Button>
                ) : null}
                {canEdit ? (
                  <Button onClick={() => void generate()} loading={busy === "gen"} disabled={Boolean(busy) && busy !== "gen"}>
                    <Sparkles aria-hidden="true" /> {hasVersions ? "Rewrite all versions" : "Write all versions"}
                  </Button>
                ) : null}
              </div>
            }
          />
          <CardBody>
            {busy === "gen" ? <p className="mb-4 text-small text-app-muted">Writing {CHANNELS.length} versions. This can take a minute…</p> : null}
            <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              {CHANNELS.map((ch) => {
                const v = versions.get(ch.key);
                return (
                  <section key={ch.key} aria-label={ch.label} className="flex min-w-0 flex-col gap-3 rounded-[var(--radius-card)] border border-app-border bg-app-elevated/40 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h3 className="text-body font-semibold text-app-text">{ch.label}</h3>
                        <p className="text-caption text-app-subtle">{ch.note}</p>
                      </div>
                      {v ? (
                        <div className="flex shrink-0 flex-col items-end gap-1">
                          {v.model === "demo" ? <Badge tone="warning">Demo draft</Badge> : null}
                          {v.edited ? <Badge tone="info">Edited</Badge> : null}
                        </div>
                      ) : null}
                    </div>

                    {v ? (
                      <>
                        <ChannelPreview channel={ch.key} content={v.content} brand={previewBrand} images={images} />
                        {v.checks.length ? (
                          <ul className="space-y-1.5" aria-label={`Checks for ${ch.label}`}>
                            {v.checks.map((c, i) => (
                              <li key={i} className="flex gap-2 text-caption text-amber-200">
                                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                                <span>{c}</span>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="flex items-center gap-1.5 text-caption text-green-300">
                            <Check className="size-3.5" aria-hidden="true" /> No problems found
                          </p>
                        )}
                        <div className="mt-auto flex flex-wrap gap-2">
                          {canEdit ? (
                            <Button size="sm" variant="secondary" onClick={() => setEditing(ch.key)}>
                              <Pencil aria-hidden="true" /> Edit
                            </Button>
                          ) : null}
                          {canEdit ? (
                            <Button size="sm" variant="secondary" loading={busy === `gen:${ch.key}`} disabled={Boolean(busy) && busy !== `gen:${ch.key}`} onClick={() => setRedo({ channel: ch.key, note: "" })}>
                              <RefreshCw aria-hidden="true" /> Rewrite
                            </Button>
                          ) : null}
                          <Button size="sm" variant="ghost" onClick={() => void copy(ch.key)}>
                            {copied === ch.key ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />} {copied === ch.key ? "Copied" : "Copy"}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => saveText(downloadName(ch.key, post.title), contentToText(ch.key, v.content))}>
                            <Download aria-hidden="true" /> Download
                          </Button>
                        </div>
                      </>
                    ) : (
                      <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-[var(--radius-control)] border border-dashed border-app-border px-3 py-10 text-center">
                        <p className="text-small text-app-muted">Not written yet</p>
                        {canEdit ? (
                          <Button size="sm" variant="secondary" loading={busy === `gen:${ch.key}`} disabled={Boolean(busy) && busy !== `gen:${ch.key}`} onClick={() => void generate([ch.key])}>
                            <Sparkles aria-hidden="true" /> Write this version
                          </Button>
                        ) : null}
                      </div>
                    )}
                  </section>
                );
              })}
            </div>
          </CardBody>
        </Card>

        {hasVersions && ["approved", "scheduled", "failed", "published"].includes(post.status) ? <PublishPanel orgId={orgId} post={post} onChanged={() => void reload()} /> : null}

        <Card>
          <CardHeader title="Activity" />
          <CardBody>
            {post.events.length ? (
              <ol className="space-y-2.5">
                {post.events.map((e) => (
                  <li key={e.id} className="flex flex-wrap gap-x-2 text-small">
                    <span className="text-app-subtle">{dateFmt.format(new Date(e.createdAt))}</span>
                    <span className="text-app-text">
                      {e.actor}: {EVENT_LABELS[e.action] ?? e.action}
                    </span>
                    {e.note ? <span className="text-app-muted">({e.note})</span> : null}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-small text-app-muted">Nothing yet.</p>
            )}
          </CardBody>
        </Card>

        <p className="text-caption text-app-subtle">
          <Link href="/onepost" className="text-app-primary hover:underline">Back to all posts</Link>
        </p>
      </div>

      {editing && versions.get(editing) ? (
        <VersionEditor key={`${editing}-${versions.get(editing)!.generation}-${versions.get(editing)!.updatedAt}`} open onClose={() => setEditing(null)} orgId={orgId} post={post} channel={editing} content={versions.get(editing)!.content} onSaved={adopt} />
      ) : null}

      <Modal
        open={Boolean(redo)}
        onClose={() => setRedo(null)}
        title={redo ? `Rewrite ${CHANNELS.find((c) => c.key === redo.channel)?.label}` : "Rewrite"}
        description="The AI writes this version again. Your edits to it will be replaced."
        footer={
          <>
            <Button variant="ghost" onClick={() => setRedo(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                const r = redo!;
                setRedo(null);
                void generate([r.channel], r.note.trim());
              }}
            >
              <RefreshCw aria-hidden="true" /> Rewrite
            </Button>
          </>
        }
      >
        <label htmlFor="redo-note" className="mb-1.5 block text-small font-medium text-app-text">
          What should change? (optional)
        </label>
        <Textarea id="redo-note" rows={3} maxLength={500} value={redo?.note ?? ""} onChange={(e) => setRedo((r) => (r ? { ...r, note: e.target.value } : r))} placeholder="For example: shorter, mention weekend timings" />
      </Modal>

      <Modal
        open={asking !== null}
        onClose={() => setAsking(null)}
        title="Request changes"
        description="Say what should change. The creator sees this note."
        footer={
          <>
            <Button variant="ghost" onClick={() => setAsking(null)}>
              Cancel
            </Button>
            <Button variant="danger" disabled={!(asking ?? "").trim()} loading={busy === "flow:request_changes"} onClick={() => void flow("request_changes", asking ?? "")}>
              Request changes
            </Button>
          </>
        }
      >
        <label htmlFor="changes-note" className="mb-1.5 block text-small font-medium text-app-text">
          What should change?
        </label>
        <Textarea id="changes-note" rows={4} maxLength={500} value={asking ?? ""} onChange={(e) => setAsking(e.target.value)} />
      </Modal>

      <ConfirmationDialog open={confirmDelete} onClose={() => setConfirmDelete(false)} onConfirm={() => void remove()} loading={busy === "delete"} title="Delete this post?" description="The post, its photos and all channel versions are deleted. This can't be undone." confirmLabel="Delete post" />
    </>
  );
}
