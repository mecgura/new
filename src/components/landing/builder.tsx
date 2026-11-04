"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowDown, ArrowLeft, ArrowUp, BarChart3, Copy, ExternalLink, GripVertical, ImageUp, Monitor, Plus, QrCode, Settings2, Smartphone, Trash2 } from "lucide-react";
import { Alert, Badge, Button, Card, CardBody, CardHeader, Field, Input, LoadingState, Modal, Select, Switch, Tabs, Textarea, useToast } from "@/components/ds";
import { apiFetch } from "@/lib/client-api";
import { BLOCK_LABELS, BLOCK_TYPES, defaultBlock, newBlockId, type Block, type BlockType, type Theme } from "@/lib/landing";
import { cn } from "@/lib/utils";
import { PageView } from "./page-view";

type Page = { id: string; title: string; slug: string; status: string; blocks: Block[]; theme: Theme; seoTitle: string; seoDescription: string; noIndex: boolean; url: string; unpublishedChanges: boolean };
type Analytics = { views: number; visitors: number; leads: number; conversion: number | null; clicks: Record<string, number>; sources: { source: string; views: number; leads: number; conversion: number | null }[]; daily: { day: string; views: number; leads: number }[]; submissions: { id: string; contactId: string | null; data: { name: string; phone: string; email: string; message: string }; consent: boolean; utmSource: string; createdAt: string }[] };

async function shrink(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  for (const q of [0.88, 0.8, 0.7, 0.6]) {
    const url = canvas.toDataURL("image/jpeg", q);
    if (url.length < 4_000_000) return url;
  }
  throw new Error("Image is too large.");
}

/** The landing page builder: blocks on the left, live preview in the middle, settings on the right. */
export function Builder({ orgId, pageId, business, canManage }: { orgId: string; pageId: string; business: string; canManage: boolean }) {
  const base = `/api/organizations/${orgId}/pages`;
  const toast = useToast();
  const [page, setPage] = React.useState<Page | null>(null);
  const [saved, setSaved] = React.useState("");
  const [sel, setSel] = React.useState<string | null>(null);
  const [panel, setPanel] = React.useState("block");
  const [device, setDevice] = React.useState<"desktop" | "mobile">("desktop");
  const [busy, setBusy] = React.useState(false);
  const [drag, setDrag] = React.useState<number | null>(null);
  const [adding, setAdding] = React.useState(false);
  const [stats, setStats] = React.useState(false);
  const [problems, setProblems] = React.useState<string[]>([]);

  React.useEffect(() => {
    const t = window.setTimeout(async () => {
      const r = await apiFetch<{ page: Page }>(`${base}/${pageId}`);
      if (!r.ok) return toast(r.error, "error");
      setPage(r.data.page);
      setSaved(JSON.stringify(r.data.page));
      setSel(r.data.page.blocks[0]?.id ?? null);
    }, 0);
    return () => clearTimeout(t);
  }, [base, pageId, toast]);

  const dirty = page ? JSON.stringify(page) !== saved : false;
  React.useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  if (!page) return <LoadingState label="Opening builder…" />;
  const blocks = page.blocks;
  const selected = blocks.find((b) => b.id === sel) ?? null;
  const set = (p: Partial<Page>) => setPage((x) => (x ? { ...x, ...p } : x));
  const setBlocks = (next: Block[]) => set({ blocks: next });
  const updateBlock = (id: string, patch: Partial<Block>) => setBlocks(blocks.map((b) => (b.id === id ? ({ ...b, ...patch } as Block) : b)));
  const move = (from: number, to: number) => {
    if (to < 0 || to >= blocks.length || from === to) return;
    const n = [...blocks];
    const [x] = n.splice(from, 1);
    n.splice(to, 0, x);
    setBlocks(n);
  };

  async function save(): Promise<boolean> {
    if (!page) return false;
    setBusy(true);
    const r = await apiFetch<{ page: Page }>(`${base}/${pageId}`, { method: "PATCH", body: { title: page.title, slug: page.slug, blocks: page.blocks, theme: page.theme, seoTitle: page.seoTitle, seoDescription: page.seoDescription, noIndex: page.noIndex } });
    setBusy(false);
    if (!r.ok) {
      toast(r.error, "error");
      return false;
    }
    setPage(r.data.page);
    setSaved(JSON.stringify(r.data.page));
    return true;
  }
  async function publish(on: boolean) {
    if (dirty && !(await save())) return;
    setBusy(true);
    const r = await apiFetch<{ page: Page }>(`${base}/${pageId}/publish`, { method: "POST", body: { publish: on } });
    setBusy(false);
    if (!r.ok) {
      setProblems(r.details?.page ?? [r.error]);
      return toast(r.error, "error");
    }
    setProblems([]);
    setPage(r.data.page);
    setSaved(JSON.stringify(r.data.page));
    toast(on ? "Published. Your page is live." : "Page taken offline.");
  }
  async function copyLink() {
    try {
      await navigator.clipboard.writeText(page!.url);
      toast("Link copied.");
    } catch {
      toast(page!.url, "info");
    }
  }

  return (
    <div className="flex min-h-[calc(100dvh-7rem)] flex-col gap-3">
      <header className="flex flex-wrap items-center gap-2">
        <Link href="/pages" className="text-app-muted hover:text-app-text" aria-label="Back to pages"><ArrowLeft className="size-5" /></Link>
        <h1 className="mr-2 min-w-0 truncate text-h3 font-semibold text-app-text">{page.title}</h1>
        <Badge tone={page.status === "published" ? "success" : "neutral"}>{page.status === "published" ? "Live" : "Draft"}</Badge>
        {dirty ? <Badge tone="warning">Unsaved</Badge> : page.unpublishedChanges ? <Badge tone="info">Saved, not published</Badge> : null}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="flex rounded-[var(--radius-control)] border border-app-border p-0.5" role="group" aria-label="Preview size">
            <button type="button" aria-pressed={device === "desktop"} onClick={() => setDevice("desktop")} className={cn("rounded px-2 py-1", device === "desktop" ? "bg-app-elevated text-app-text" : "text-app-muted")} aria-label="Desktop preview"><Monitor className="size-4" /></button>
            <button type="button" aria-pressed={device === "mobile"} onClick={() => setDevice("mobile")} className={cn("rounded px-2 py-1", device === "mobile" ? "bg-app-elevated text-app-text" : "text-app-muted")} aria-label="Mobile preview"><Smartphone className="size-4" /></button>
          </div>
          <Button size="sm" variant="secondary" onClick={() => setStats(true)}><BarChart3 className="size-4" aria-hidden="true" /> Analytics</Button>
          {page.status === "published" ? (
            <>
              <Button size="sm" variant="secondary" onClick={() => void copyLink()}><Copy className="size-4" aria-hidden="true" /> Link</Button>
              <a href={`${base}/${pageId}/qr`}><Button size="sm" variant="secondary"><QrCode className="size-4" aria-hidden="true" /> QR</Button></a>
              <a href={page.url} target="_blank" rel="noopener noreferrer"><Button size="sm" variant="secondary"><ExternalLink className="size-4" aria-hidden="true" /> View</Button></a>
            </>
          ) : null}
          {canManage ? (
            <>
              <Button size="sm" variant="secondary" disabled={!dirty} loading={busy && dirty} onClick={() => void save().then((ok) => ok && toast("Saved."))}>Save</Button>
              {page.status === "published" && !dirty && !page.unpublishedChanges ? (
                <Button size="sm" variant="ghost" onClick={() => void publish(false)}>Unpublish</Button>
              ) : (
                <Button size="sm" loading={busy} onClick={() => void publish(true)}>{page.status === "published" ? "Publish changes" : "Publish"}</Button>
              )}
            </>
          ) : null}
        </div>
      </header>
      {problems.length ? <Alert tone="warning" title="Fix before publishing"><ul className="list-disc pl-4">{problems.map((p) => <li key={p}>{p}</li>)}</ul></Alert> : null}

      <div className="grid flex-1 gap-3 lg:grid-cols-[15rem_1fr_20rem]">
        <Card className="lg:max-h-[calc(100dvh-10rem)] lg:overflow-y-auto">
          <CardBody className="space-y-1 p-2">
            <p className="px-2 pb-1 text-caption font-medium uppercase tracking-wide text-app-subtle">Blocks</p>
            <ol aria-label="Page blocks">
              {blocks.map((b, i) => (
                <li
                  key={b.id}
                  draggable={canManage}
                  onDragStart={() => setDrag(i)}
                  onDragOver={(e) => {
                    if (drag !== null) e.preventDefault();
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (drag !== null) move(drag, i);
                    setDrag(null);
                  }}
                  onDragEnd={() => setDrag(null)}
                  className={cn("group flex items-center gap-1 rounded-[var(--radius-control)] px-1 py-1.5", sel === b.id ? "bg-app-primary-soft" : "hover:bg-app-hover", drag === i && "opacity-50")}
                >
                  {canManage ? <GripVertical className="size-4 shrink-0 cursor-grab text-app-subtle" aria-hidden="true" /> : null}
                  <button type="button" onClick={() => { setSel(b.id); setPanel("block"); }} className="min-w-0 flex-1 truncate text-left text-small text-app-text">{BLOCK_LABELS[b.type].split(" (")[0]}<span className="block truncate text-caption text-app-subtle">{"heading" in b && b.heading ? b.heading : ""}</span></button>
                  {canManage ? (
                    <span className="flex shrink-0 opacity-60 group-hover:opacity-100">
                      <button type="button" aria-label="Move up" onClick={() => move(i, i - 1)} className="p-0.5 text-app-muted hover:text-app-text"><ArrowUp className="size-3.5" /></button>
                      <button type="button" aria-label="Move down" onClick={() => move(i, i + 1)} className="p-0.5 text-app-muted hover:text-app-text"><ArrowDown className="size-3.5" /></button>
                    </span>
                  ) : null}
                </li>
              ))}
            </ol>
            {canManage ? <Button size="sm" variant="secondary" className="mt-2 w-full" disabled={blocks.length >= 40} onClick={() => setAdding(true)}><Plus className="size-4" aria-hidden="true" /> Add block</Button> : null}
          </CardBody>
        </Card>

        <div className="relative overflow-hidden rounded-[var(--radius-card)] border border-app-border bg-app-elevated">
          <div className={cn("mx-auto h-[calc(100dvh-10rem)] min-h-[32rem] overflow-y-auto bg-white transition-[width]", device === "mobile" ? "my-4 w-[390px] max-w-full rounded-[2rem] border-8 border-black/80" : "w-full")}>
            <div className="relative">
              <PageView pageId={null} preview title={page.title} business={business} blocks={blocks} theme={page.theme} selectedId={sel} onSelect={(id) => { setSel(id); setPanel("block"); }} />
            </div>
          </div>
        </div>

        <Card className="lg:max-h-[calc(100dvh-10rem)] lg:overflow-y-auto">
          <CardBody className="space-y-4">
            <Tabs label="Editor" value={panel} onValueChange={setPanel} items={[{ id: "block", label: "Block" }, { id: "page", label: "Page settings" }]} />
            {panel === "block" ? (
              selected ? (
                <BlockEditor key={selected.id} block={selected} disabled={!canManage} orgId={orgId} onChange={(p) => updateBlock(selected.id, p)} onDuplicate={() => { const i = blocks.findIndex((b) => b.id === selected.id); const copy = { ...structuredClone(selected), id: newBlockId() }; setBlocks([...blocks.slice(0, i + 1), copy, ...blocks.slice(i + 1)]); setSel(copy.id); }} onDelete={() => { setBlocks(blocks.filter((b) => b.id !== selected.id)); setSel(null); }} />
              ) : <p className="text-small text-app-muted">Click a block in the preview or the list to edit it.</p>
            ) : (
              <PageSettings page={page} disabled={!canManage} onChange={set} />
            )}
          </CardBody>
        </Card>
      </div>

      {adding ? (
        <Modal open onClose={() => setAdding(false)} title="Add a block" size="lg">
          <div className="grid gap-2 sm:grid-cols-2">
            {BLOCK_TYPES.map((t) => (
              <button key={t} type="button" onClick={() => { const nb = defaultBlock(t as BlockType); const i = sel ? blocks.findIndex((b) => b.id === sel) : blocks.length - 1; setBlocks([...blocks.slice(0, i + 1), nb, ...blocks.slice(i + 1)]); setSel(nb.id); setPanel("block"); setAdding(false); }} className="rounded-[var(--radius-control)] border border-app-border p-3 text-left text-small text-app-text hover:bg-app-hover">
                {BLOCK_LABELS[t]}
              </button>
            ))}
          </div>
        </Modal>
      ) : null}
      {stats ? <AnalyticsModal url={`${base}/${pageId}/analytics`} onClose={() => setStats(false)} /> : null}
    </div>
  );
}

function PageSettings({ page, disabled, onChange }: { page: Page; disabled: boolean; onChange: (p: Partial<Page>) => void }) {
  const theme = (p: Partial<Theme>) => onChange({ theme: { ...page.theme, ...p } });
  return (
    <div className="space-y-4">
      <Field id="ps-title" label="Page name"><Input value={page.title} disabled={disabled} maxLength={120} onChange={(e) => onChange({ title: e.target.value })} /></Field>
      <Field id="ps-slug" label="Address" hint={page.url.replace(/[^/]+$/, "") + page.slug}><Input value={page.slug} disabled={disabled} maxLength={60} onChange={(e) => onChange({ slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-") })} /></Field>
      <Field id="ps-accent" label="Colour">
        <Select value={page.theme.accent} disabled={disabled} onChange={(e) => theme({ accent: e.target.value as Theme["accent"] })}>
          {["emerald", "saffron", "rose", "blue", "violet", "slate"].map((c) => <option key={c} value={c}>{c}</option>)}
        </Select>
      </Field>
      <Field id="ps-wa" label="WhatsApp number" hint="With country code, e.g. 919876543210. WhatsApp buttons open a chat with this number."><Input value={page.theme.whatsapp} disabled={disabled} inputMode="numeric" maxLength={16} onChange={(e) => theme({ whatsapp: e.target.value.replace(/[^\d]/g, "") })} /></Field>
      <Field id="ps-watext" label="WhatsApp message" hint="Typed in for the visitor. Leave empty for “Hi! I saw your page …”."><Input value={page.theme.whatsappText} disabled={disabled} maxLength={200} onChange={(e) => theme({ whatsappText: e.target.value })} /></Field>
      <Switch checked={page.theme.floatingWhatsApp} disabled={disabled} onCheckedChange={(v) => theme({ floatingWhatsApp: v })} label="Floating WhatsApp button" />
      <hr className="border-app-border" />
      <p className="text-small font-semibold text-app-text">Search engines (SEO)</p>
      <Field id="ps-seot" label="Title" hint={`${page.seoTitle.length}/70`}><Input value={page.seoTitle} disabled={disabled} maxLength={70} onChange={(e) => onChange({ seoTitle: e.target.value })} /></Field>
      <Field id="ps-seod" label="Description" hint={`${page.seoDescription.length}/170 · shown under the title in Google`}><Textarea value={page.seoDescription} disabled={disabled} maxLength={170} rows={3} onChange={(e) => onChange({ seoDescription: e.target.value })} /></Field>
      <Switch checked={page.noIndex} disabled={disabled} onCheckedChange={(v) => onChange({ noIndex: v })} label="Hide from Google (ads-only page)" />
      <p className="text-caption text-app-subtle">Own domain (e.g. offers.yourshop.in): ask MECGURA to connect it.</p>
    </div>
  );
}

function ListEditor<T extends Record<string, unknown>>({ items, max, disabled, blank, onChange, render }: { items: T[]; max: number; disabled: boolean; blank: T; onChange: (items: T[]) => void; render: (it: T, set: (p: Partial<T>) => void) => React.ReactNode }) {
  return (
    <div className="space-y-2">
      {items.map((it, i) => (
        <div key={i} className="space-y-2 rounded-[var(--radius-control)] border border-app-border p-2">
          {render(it, (p) => onChange(items.map((x, j) => (j === i ? { ...x, ...p } : x))))}
          {!disabled ? (
            <div className="flex justify-end gap-1">
              <Button size="sm" variant="ghost" aria-label="Move up" onClick={() => { if (i) { const n = [...items]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; onChange(n); } }}><ArrowUp className="size-3.5" /></Button>
              <Button size="sm" variant="ghost" aria-label="Remove" onClick={() => onChange(items.filter((_, j) => j !== i))}><Trash2 className="size-3.5" /></Button>
            </div>
          ) : null}
        </div>
      ))}
      {!disabled && items.length < max ? <Button size="sm" variant="secondary" onClick={() => onChange([...items, blank])}><Plus className="size-4" aria-hidden="true" /> Add</Button> : null}
    </div>
  );
}

function ImageInput({ orgId, value, disabled, onChange }: { orgId: string; value: string; disabled: boolean; onChange: (url: string) => void }) {
  const toast = useToast();
  const [busy, setBusy] = React.useState(false);
  const ref = React.useRef<HTMLInputElement>(null);
  async function upload(f: File) {
    setBusy(true);
    try {
      const data = await shrink(f);
      const r = await apiFetch<{ url: string }>(`/api/organizations/${orgId}/pages/images`, { method: "POST", body: { upload: data } });
      if (!r.ok) toast(r.error, "error");
      else onChange(r.data.url);
    } catch {
      toast("Couldn't read that image.", "error");
    }
    setBusy(false);
  }
  return (
    <div className="space-y-2">
      {value ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={value} alt="" className="h-28 w-full rounded-[var(--radius-control)] object-cover" />
      ) : null}
      <div className="flex gap-2">
        <Button size="sm" variant="secondary" loading={busy} disabled={disabled} onClick={() => ref.current?.click()}><ImageUp className="size-4" aria-hidden="true" /> {value ? "Replace" : "Upload photo"}</Button>
        {value && !disabled ? <Button size="sm" variant="ghost" onClick={() => onChange("")}>Remove</Button> : null}
      </div>
      <input ref={ref} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ""; }} />
      <p className="text-caption text-app-subtle">Use your own photos, or free ones you have the right to use. Don&apos;t show people as customers unless they are.</p>
    </div>
  );
}

function ActionFields({ b, disabled, onChange, allowLink = true }: { b: { action: "whatsapp" | "form" | "link"; link?: string; buttonLabel: string }; disabled: boolean; onChange: (p: Record<string, unknown>) => void; allowLink?: boolean }) {
  return (
    <>
      <Field id="be-btn" label="Button text"><Input value={b.buttonLabel} disabled={disabled} maxLength={40} onChange={(e) => onChange({ buttonLabel: e.target.value })} /></Field>
      <Field id="be-act" label="Button opens">
        <Select value={b.action} disabled={disabled} onChange={(e) => onChange({ action: e.target.value })}>
          <option value="whatsapp">WhatsApp chat</option>
          <option value="form">The lead form on this page</option>
          {allowLink ? <option value="link">Another link</option> : null}
        </Select>
      </Field>
      {b.action === "link" && allowLink ? <Field id="be-link" label="Link"><Input value={b.link ?? ""} disabled={disabled} placeholder="https://" onChange={(e) => onChange({ link: e.target.value })} /></Field> : null}
    </>
  );
}

function BlockEditor({ block: b, disabled, orgId, onChange, onDuplicate, onDelete }: { block: Block; disabled: boolean; orgId: string; onChange: (p: Partial<Block>) => void; onDuplicate: () => void; onDelete: () => void }) {
  const ch = onChange as (p: Record<string, unknown>) => void;
  const heading = "heading" in b ? <Field id="be-h" label="Heading"><Input value={b.heading} disabled={disabled} maxLength={120} onChange={(e) => ch({ heading: e.target.value })} /></Field> : null;
  let body: React.ReactNode = null;
  switch (b.type) {
    case "hero":
      body = <>{heading}<Field id="be-sub" label="Subheading"><Textarea value={b.subheading} rows={3} disabled={disabled} maxLength={300} onChange={(e) => ch({ subheading: e.target.value })} /></Field><ActionFields b={b} disabled={disabled} onChange={ch} /><ImageInput orgId={orgId} value={b.imageUrl} disabled={disabled} onChange={(u) => ch({ imageUrl: u })} /></>;
      break;
    case "text":
      body = <>{heading}<Field id="be-body" label="Text"><Textarea value={b.body} rows={8} disabled={disabled} maxLength={3000} onChange={(e) => ch({ body: e.target.value })} /></Field></>;
      break;
    case "features":
      body = <>{heading}<ListEditor items={b.items} max={12} disabled={disabled} blank={{ title: "", text: "" }} onChange={(items) => ch({ items })} render={(it, set) => <><Input aria-label="Title" placeholder="Title" value={it.title} disabled={disabled} maxLength={80} onChange={(e) => set({ title: e.target.value })} /><Input aria-label="Text" placeholder="Short text" value={it.text} disabled={disabled} maxLength={300} onChange={(e) => set({ text: e.target.value })} /></>} /></>;
      break;
    case "services":
      body = <>{heading}<ListEditor items={b.items} max={20} disabled={disabled} blank={{ title: "", text: "", price: "" }} onChange={(items) => ch({ items })} render={(it, set) => <><Input aria-label="Service" placeholder="Service" value={it.title} disabled={disabled} maxLength={80} onChange={(e) => set({ title: e.target.value })} /><Input aria-label="Price" placeholder="₹" value={it.price} disabled={disabled} maxLength={40} onChange={(e) => set({ price: e.target.value })} /><Input aria-label="Details" placeholder="Details (optional)" value={it.text} disabled={disabled} maxLength={300} onChange={(e) => set({ text: e.target.value })} /></>} /></>;
      break;
    case "pricing":
      body = <>{heading}<ActionFields b={b} disabled={disabled} onChange={ch} allowLink={false} /><ListEditor items={b.plans} max={4} disabled={disabled} blank={{ name: "Plan", price: "₹", period: "", features: [], highlight: false }} onChange={(plans) => ch({ plans })} render={(it, set) => <><Input aria-label="Plan name" value={it.name} disabled={disabled} maxLength={60} onChange={(e) => set({ name: e.target.value })} /><div className="grid grid-cols-2 gap-2"><Input aria-label="Price" value={it.price} disabled={disabled} maxLength={40} onChange={(e) => set({ price: e.target.value })} /><Input aria-label="Period" placeholder="/month" value={it.period} disabled={disabled} maxLength={30} onChange={(e) => set({ period: e.target.value })} /></div><Textarea aria-label="Features, one per line" rows={3} value={it.features.join("\n")} disabled={disabled} onChange={(e) => set({ features: e.target.value.split("\n").slice(0, 12) })} /><Switch checked={it.highlight} disabled={disabled} onCheckedChange={(v) => set({ highlight: v })} label="Highlight as most popular" /></>} /></>;
      break;
    case "image":
      body = <><ImageInput orgId={orgId} value={b.url} disabled={disabled} onChange={(u) => ch({ url: u })} /><Field id="be-alt" label="Describe the photo" hint="Read out by screen readers"><Input value={b.alt} disabled={disabled} maxLength={160} onChange={(e) => ch({ alt: e.target.value })} /></Field><Field id="be-cap" label="Caption"><Input value={b.caption} disabled={disabled} maxLength={200} onChange={(e) => ch({ caption: e.target.value })} /></Field></>;
      break;
    case "video":
      body = <>{heading}<Field id="be-yt" label="YouTube link"><Input value={b.youtubeUrl} disabled={disabled} placeholder="https://youtu.be/..." onChange={(e) => ch({ youtubeUrl: e.target.value })} /></Field></>;
      break;
    case "testimonials":
      body = <>{heading}<Alert tone="info">Only real quotes from your customers, with their permission.</Alert><ListEditor items={b.items} max={9} disabled={disabled} blank={{ quote: "", name: "" }} onChange={(items) => ch({ items })} render={(it, set) => <><Textarea aria-label="Quote" rows={2} value={it.quote} disabled={disabled} maxLength={400} onChange={(e) => set({ quote: e.target.value })} /><Input aria-label="Name" placeholder="Name, area" value={it.name} disabled={disabled} maxLength={60} onChange={(e) => set({ name: e.target.value })} /></>} /></>;
      break;
    case "faq":
      body = <>{heading}<ListEditor items={b.items} max={15} disabled={disabled} blank={{ q: "", a: "" }} onChange={(items) => ch({ items })} render={(it, set) => <><Input aria-label="Question" placeholder="Question" value={it.q} disabled={disabled} maxLength={200} onChange={(e) => set({ q: e.target.value })} /><Textarea aria-label="Answer" rows={2} placeholder="Answer" value={it.a} disabled={disabled} maxLength={800} onChange={(e) => set({ a: e.target.value })} /></>} /></>;
      break;
    case "form":
      body = (
        <>
          {heading}
          <Field id="be-ft" label="Text above the form"><Input value={b.text} disabled={disabled} maxLength={300} onChange={(e) => ch({ text: e.target.value })} /></Field>
          <Switch checked={b.askEmail} disabled={disabled} onCheckedChange={(v) => ch({ askEmail: v })} label="Ask for email" />
          <Switch checked={b.askMessage} disabled={disabled} onCheckedChange={(v) => ch({ askMessage: v })} label="Ask for a message" />
          {b.askMessage ? <Field id="be-ml" label="Message label"><Input value={b.messageLabel} disabled={disabled} maxLength={60} onChange={(e) => ch({ messageLabel: e.target.value })} /></Field> : null}
          <Field id="be-sl" label="Button text"><Input value={b.submitLabel} disabled={disabled} maxLength={40} onChange={(e) => ch({ submitLabel: e.target.value })} /></Field>
          <Field id="be-ct" label="Consent checkbox text" hint="Ticking it records WhatsApp opt-in on the contact. Unticked forms still arrive, without opt-in."><Textarea value={b.consentText} rows={2} disabled={disabled} maxLength={300} onChange={(e) => ch({ consentText: e.target.value })} /></Field>
          <Field id="be-ok" label="Thank-you message"><Input value={b.successMessage} disabled={disabled} maxLength={300} onChange={(e) => ch({ successMessage: e.target.value })} /></Field>
          <Field id="be-tag" label="Tag new contacts" hint="Start an automation with “Tag added”."><Input value={b.tag} disabled={disabled} maxLength={40} onChange={(e) => ch({ tag: e.target.value })} /></Field>
          <Switch checked={b.createDeal} disabled={disabled} onCheckedChange={(v) => ch({ createDeal: v })} label="Also create a deal in Deals" />
        </>
      );
      break;
    case "cta":
      body = <>{heading}<Field id="be-ctat" label="Text"><Input value={b.text} disabled={disabled} maxLength={300} onChange={(e) => ch({ text: e.target.value })} /></Field><ActionFields b={b} disabled={disabled} onChange={ch} /></>;
      break;
    case "qr":
      body = <>{heading}<Field id="be-qrt" label="Text under the code"><Input value={b.text} disabled={disabled} maxLength={200} onChange={(e) => ch({ text: e.target.value })} /></Field><p className="text-caption text-app-subtle">Scans are counted as source “qr”. Download a print-quality QR from the top bar once published.</p></>;
      break;
    case "contact":
      body = <>{heading}<Field id="be-addr" label="Address"><Textarea value={b.address} rows={2} disabled={disabled} maxLength={300} onChange={(e) => ch({ address: e.target.value })} /></Field><Field id="be-time" label="Timings"><Textarea value={b.timings} rows={2} disabled={disabled} maxLength={300} onChange={(e) => ch({ timings: e.target.value })} /></Field><Field id="be-map" label="Google Maps link"><Input value={b.mapsUrl} disabled={disabled} placeholder="https://maps.app.goo.gl/..." onChange={(e) => ch({ mapsUrl: e.target.value })} /></Field><Field id="be-ph" label="Phone to call"><Input value={b.phone} disabled={disabled} maxLength={20} onChange={(e) => ch({ phone: e.target.value })} /></Field></>;
      break;
  }
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-small font-semibold text-app-text"><Settings2 className="size-4" aria-hidden="true" /> {BLOCK_LABELS[b.type]}</p>
        {!disabled ? (
          <span className="flex gap-1">
            <Button size="sm" variant="ghost" aria-label="Duplicate block" onClick={onDuplicate}><Copy className="size-4" /></Button>
            <Button size="sm" variant="ghost" aria-label="Delete block" onClick={onDelete}><Trash2 className="size-4" /></Button>
          </span>
        ) : null}
      </div>
      {body}
    </div>
  );
}

function AnalyticsModal({ url, onClose }: { url: string; onClose: () => void }) {
  const [a, setA] = React.useState<Analytics | null>(null);
  React.useEffect(() => {
    const t = window.setTimeout(async () => {
      const r = await apiFetch<Analytics>(url);
      if (r.ok) setA(r.data);
    }, 0);
    return () => clearTimeout(t);
  }, [url]);
  const max = Math.max(1, ...(a?.daily.map((d) => d.views) ?? [1]));
  const fmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });
  return (
    <Modal open onClose={onClose} size="lg" title="Page analytics" description="Last 30 days. Add ?utm_source=instagram (or facebook, google…) to links you share to see where leads come from.">
      {!a ? <LoadingState /> : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[["Views", a.views], ["Visitors", a.visitors], ["Leads", a.leads], ["Conversion", a.conversion === null ? "—" : `${a.conversion}%`]].map(([l, v]) => (
              <div key={String(l)} className="rounded-[var(--radius-control)] border border-app-border p-3"><p className="text-caption text-app-muted">{l}</p><p className="text-h3 font-semibold text-app-text">{v}</p></div>
            ))}
          </div>
          <div className="flex h-24 items-end gap-0.5" role="img" aria-label="Daily views">
            {a.daily.map((d) => <span key={d.day} title={`${d.day}: ${d.views} views, ${d.leads} leads`} className="flex-1 rounded-t bg-app-primary/60" style={{ height: `${(d.views / max) * 100}%`, minHeight: d.views ? 2 : 0 }} />)}
          </div>
          <Card>
            <CardHeader title="Where visitors come from" />
            <CardBody className="p-0">
              {!a.sources.length ? <p className="px-4 py-3 text-small text-app-muted">No visits yet.</p> : (
                <table className="w-full text-small"><thead className="text-left text-caption text-app-muted"><tr className="border-b border-app-border"><th className="px-4 py-2 font-medium">Source</th><th className="px-4 py-2 font-medium">Views</th><th className="px-4 py-2 font-medium">Leads</th><th className="px-4 py-2 font-medium">Conversion</th></tr></thead>
                  <tbody>{a.sources.map((s) => <tr key={s.source} className="border-b border-app-border last:border-0"><td className="px-4 py-2 text-app-text">{s.source}</td><td className="px-4 py-2">{s.views}</td><td className="px-4 py-2">{s.leads}</td><td className="px-4 py-2">{s.conversion === null ? "—" : `${s.conversion}%`}</td></tr>)}</tbody></table>
              )}
            </CardBody>
          </Card>
          {Object.keys(a.clicks).length ? <p className="text-small text-app-muted">Button clicks: {Object.entries(a.clicks).map(([k, v]) => `${k} ${v}`).join(" · ")}</p> : null}
          <Card>
            <CardHeader title="Latest form entries" />
            <CardBody className="p-0">
              {!a.submissions.length ? <p className="px-4 py-3 text-small text-app-muted">No entries yet.</p> : (
                <ul className="divide-y divide-app-border">
                  {a.submissions.map((s) => (
                    <li key={s.id} className="px-4 py-2 text-small">
                      <span className="font-semibold text-app-text">{s.contactId ? <Link href={`/contacts/${s.contactId}`} className="hover:text-app-primary">{s.data.name}</Link> : s.data.name}</span> <span className="text-app-muted">{s.data.phone}</span>
                      <span className="block text-caption text-app-subtle">{fmt.format(new Date(s.createdAt))}{s.utmSource ? ` · ${s.utmSource}` : ""}{s.consent ? " · opted in" : ""}</span>
                      {s.data.message ? <span className="block text-app-text">{s.data.message}</span> : null}
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>
      )}
    </Modal>
  );
}
