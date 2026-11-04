"use client";

import * as React from "react";
import { ExternalLink, FileText, Plus, Save, Trash2 } from "lucide-react";
import { Alert, Badge, Button, Card, CardBody, CardHeader, EmptyState, Field, Input, LoadingState, PageHeader, Textarea, useToast } from "@/components/ds";
import { apiFetch } from "@/lib/client-api";
import { readingMinutes, renderMarkdown, slugify } from "@/lib/markdown";
import { istFmt } from "@/components/campaigns/types";

type Row = { id: string; slug: string; title: string; excerpt: string; status: string; publishedAt: string | null; updatedAt: string; views: number; tags: string };
type Post = { id?: string; slug: string; title: string; excerpt: string; body: string; tags: string; author: string; coverUrl: string; status: "draft" | "published" };
const EMPTY: Post = { slug: "", title: "", excerpt: "", body: "", tags: "", author: "MECGURA Team", coverUrl: "", status: "draft" };

const HELP = "## Heading · ### Sub-heading · **bold** · _italic_ · - list · 1. list · > quote · [link](https://…) · ---";

/** Admin → Blog: write SEO articles for mecgura.tech/blog. */
export function BlogAdmin() {
  const toast = useToast();
  const [rows, setRows] = React.useState<Row[] | null>(null);
  const [edit, setEdit] = React.useState<Post | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [tab, setTab] = React.useState<"write" | "preview">("write");

  const load = React.useCallback(async () => {
    const r = await apiFetch<{ posts: Row[] }>("/api/admin/blog");
    if (!r.ok) return toast(r.error, "error");
    setRows(r.data.posts);
  }, [toast]);
  React.useEffect(() => {
    const t = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(t);
  }, [load]);

  async function open(id: string) {
    const r = await apiFetch<{ post: Post & { id: string } }>(`/api/admin/blog/${id}`);
    if (!r.ok) return toast(r.error, "error");
    setErrors({});
    setTab("write");
    setEdit(r.data.post);
  }
  async function save(status: "draft" | "published") {
    if (!edit) return;
    setBusy(true);
    const body = { ...edit, status };
    const r = await apiFetch<{ post: Post & { id: string } }>(edit.id ? `/api/admin/blog/${edit.id}` : "/api/admin/blog", { method: edit.id ? "PUT" : "POST", body });
    setBusy(false);
    if (!r.ok) {
      setErrors(Object.fromEntries(Object.entries(r.details ?? {}).map(([k, v]) => [k, v[0]])));
      return toast(Object.values(r.details ?? {})[0]?.[0] ?? r.error, "error");
    }
    setErrors({});
    setEdit(r.data.post);
    toast(status === "published" ? "Published — it's live on the blog" : "Draft saved");
    void load();
  }
  async function remove() {
    if (!edit?.id || !window.confirm("Delete this post? Its link will stop working.")) return;
    const r = await apiFetch(`/api/admin/blog/${edit.id}`, { method: "DELETE" });
    if (!r.ok) return toast(r.error, "error");
    setEdit(null);
    void load();
  }

  if (!rows) return <LoadingState />;
  if (edit) {
    const words = edit.body.trim() ? edit.body.trim().split(/\s+/).length : 0;
    const preview = renderMarkdown(edit.body);
    const set = (p: Partial<Post>) => setEdit({ ...edit, ...p });
    return (
      <>
        <PageHeader
          title={edit.id ? "Edit post" : "New post"}
          description={edit.status === "published" ? `Live at /blog/${edit.slug}` : "Draft — not visible on the site yet."}
          actions={
            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" onClick={() => setEdit(null)}>Back</Button>
              {edit.id ? <Button variant="ghost" onClick={() => void remove()} aria-label="Delete post"><Trash2 aria-hidden="true" /></Button> : null}
              {edit.status === "published" && edit.slug ? <a href={`/blog/${edit.slug}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 px-3 text-small text-app-muted hover:text-app-text"><ExternalLink className="size-4" aria-hidden="true" /> View</a> : null}
              <Button variant="secondary" loading={busy} onClick={() => void save("draft")}><Save aria-hidden="true" /> {edit.status === "published" ? "Unpublish & save" : "Save draft"}</Button>
              <Button loading={busy} onClick={() => void save("published")}>{edit.status === "published" ? "Update live post" : "Publish"}</Button>
            </div>
          }
        />
        <div className="grid gap-4 xl:grid-cols-[1fr_20rem]">
          <Card>
            <CardBody className="space-y-4">
              <Field id="b-title" label="Title" hint={`${edit.title.length}/120 · Put the main search phrase near the start (e.g. “WhatsApp Business API price in India…”).`} error={errors.title}>
                <Input value={edit.title} maxLength={120} onChange={(e) => set({ title: e.target.value, ...(edit.id ? {} : { slug: slugify(e.target.value) }) })} />
              </Field>
              <div className="flex gap-2" role="tablist" aria-label="Editor">
                {(["write", "preview"] as const).map((t) => (
                  <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`rounded-full px-3 py-1 text-small ${tab === t ? "bg-app-primary text-app-on-primary" : "text-app-muted hover:text-app-text"}`}>{t === "write" ? "Write" : "Preview"}</button>
                ))}
                <span className="ml-auto self-center text-caption text-app-subtle">{words} words · {readingMinutes(edit.body)} min read</span>
              </div>
              {tab === "write" ? (
                <Field id="b-body" label="Article (Markdown)" hint={HELP} error={errors.body}>
                  <Textarea rows={24} value={edit.body} onChange={(e) => set({ body: e.target.value })} className="font-mono text-small" placeholder={"Start with a short intro that answers the question directly.\n\n## First section\n\nParagraph…\n\n- point one\n- point two"} />
                </Field>
              ) : (
                // eslint-disable-next-line react/no-danger -- renderMarkdown escapes all text and only emits its own tags
                <article className="blog-prose max-w-none" dangerouslySetInnerHTML={{ __html: preview.html || "<p><em>Nothing to preview yet.</em></p>" }} />
              )}
            </CardBody>
          </Card>
          <div className="space-y-4">
            <Card>
              <CardHeader title="Google listing" description="How the post can look in search results." />
              <CardBody className="space-y-3">
                <div className="rounded-lg border border-app-border p-3">
                  <p className="truncate text-caption text-emerald-300">mecgura.tech › blog › {edit.slug || "…"}</p>
                  <p className="line-clamp-2 text-body text-sky-300">{edit.title || "Post title"} | MECGURA</p>
                  <p className="line-clamp-2 text-caption text-app-muted">{edit.excerpt || "Short description shown under the title."}</p>
                </div>
                <Field id="b-excerpt" label="Description" hint={`${edit.excerpt.length}/160 · one or two sentences with the search phrase`} error={errors.excerpt}>
                  <Textarea rows={3} maxLength={160} value={edit.excerpt} onChange={(e) => set({ excerpt: e.target.value })} />
                </Field>
                <Field id="b-slug" label="Link" hint="Lowercase words with dashes. Changing it later breaks old links." error={errors.slug}>
                  <Input value={edit.slug} maxLength={80} onChange={(e) => set({ slug: slugify(e.target.value) })} />
                </Field>
              </CardBody>
            </Card>
            <Card>
              <CardBody className="space-y-3">
                <Field id="b-tags" label="Tags" hint="Comma-separated, e.g. WhatsApp API, Pricing" error={errors.tags}>
                  <Input value={edit.tags} maxLength={200} onChange={(e) => set({ tags: e.target.value })} />
                </Field>
                <Field id="b-author" label="Author" error={errors.author}>
                  <Input value={edit.author} maxLength={60} onChange={(e) => set({ author: e.target.value })} />
                </Field>
                <Field id="b-cover" label="Cover image link (optional)" hint="https://… or /image.jpg — used when the post is shared." error={errors.coverUrl}>
                  <Input value={edit.coverUrl} maxLength={500} onChange={(e) => set({ coverUrl: e.target.value })} />
                </Field>
              </CardBody>
            </Card>
            <Alert tone="info" title="What helps ranking">
              Answer one real question per post fully (usually 500+ words), use the phrase people search in the title and first lines, add 2–4 sub-headings, and link to another post or the pricing section. Publish regularly.
            </Alert>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Blog" description="Articles on mecgura.tech/blog — they help MECGURA show up on Google." actions={<Button onClick={() => { setErrors({}); setTab("write"); setEdit({ ...EMPTY }); }}><Plus aria-hidden="true" /> New post</Button>} />
      <Card>
        {!rows.length ? (
          <EmptyState icon={FileText} title="No posts yet" description="Write your first article — answer a question your customers ask." />
        ) : (
          <ul className="divide-y divide-app-border">
            {rows.map((p) => (
              <li key={p.id}>
                <button type="button" onClick={() => void open(p.id)} className="flex w-full flex-wrap items-center gap-3 px-5 py-3 text-left hover:bg-app-hover">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-small font-medium text-app-text">{p.title}</span>
                    <span className="block truncate text-caption text-app-muted">/blog/{p.slug} · updated {istFmt.format(new Date(p.updatedAt))}{p.tags ? ` · ${p.tags}` : ""}</span>
                  </span>
                  <span className="text-caption text-app-subtle">{p.views} views</span>
                  <Badge tone={p.status === "published" ? "success" : "neutral"}>{p.status === "published" ? "Published" : "Draft"}</Badge>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <p className="mt-3 text-caption text-app-subtle">Published posts are listed in the sitemap Google reads (mecgura.tech/sitemap.xml).</p>
    </>
  );
}
