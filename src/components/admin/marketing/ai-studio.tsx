"use client";

import * as React from "react";
import Link from "next/link";
import { Copy, Download, ImagePlus, Sparkles, Trash2, Wand2 } from "lucide-react";
import { Alert, Badge, Button, Card, CardBody, CardHeader, ConfirmationDialog, EmptyState, Field, Input, LoadingState, Select, Switch, Textarea, useToast } from "@/components/ds";
import { apiFetch } from "@/lib/client-api";
import { cn } from "@/lib/utils";

type Providers = { gemini: boolean; openai: boolean };
type Img = { id: string; provider: string; prompt: string; aspect: string; createdAt: string; url: string };
type AdCopy = { headlines: string[]; primaryTexts: string[]; cta: string; hashtags: string[] };

const PROVIDER_LABEL: Record<string, string> = { gemini: "Google Gemini", openai: "OpenAI" };
const STYLES = [
  { id: "ad_photo", label: "Ad photo" },
  { id: "people", label: "Shop owner + phone" },
  { id: "product", label: "Product shot" },
  { id: "festival", label: "Festival" },
  { id: "illustration", label: "Illustration" },
] as const;
const ASPECTS = [
  { id: "post", label: "Post 4:5" },
  { id: "square", label: "Square 1:1" },
  { id: "story", label: "Story 9:16" },
  { id: "landscape", label: "Wide 16:9" },
] as const;
const IDEAS = [
  "A sweet shop owner in Punjab smiling at a WhatsApp order notification on his phone, sweets boxes in the background",
  "A modern salon reception with a phone showing an automatic appointment reminder on WhatsApp",
  "A busy clothing boutique owner relaxing while a phone answers customer messages automatically",
  "Diwali sale scene in a small electronics shop with glowing diyas and a smartphone on the counter",
];
const ASPECT_CLASS: Record<string, string> = { post: "aspect-[4/5]", square: "aspect-square", story: "aspect-[9/16]", landscape: "aspect-video" };

export function AiStudio() {
  const toast = useToast();
  const [providers, setProviders] = React.useState<Providers | null>(null);
  const [images, setImages] = React.useState<Img[]>([]);
  const [form, setForm] = React.useState({ provider: "gemini", prompt: "", style: "ad_photo", aspect: "post", brand: true });
  const [busy, setBusy] = React.useState(false);
  const [removing, setRemoving] = React.useState<Img | null>(null);

  const load = React.useCallback(async () => {
    const r = await apiFetch<{ providers: Providers; images: Img[] }>("/api/admin/marketing/images");
    if (!r.ok) return toast(r.error, "error");
    setProviders(r.data.providers);
    setImages(r.data.images);
    setForm((f) => (r.data.providers[f.provider as keyof Providers] ? f : { ...f, provider: r.data.providers.openai && !r.data.providers.gemini ? "openai" : "gemini" }));
  }, [toast]);
  React.useEffect(() => {
    const t = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(t);
  }, [load]);

  async function generate() {
    setBusy(true);
    const r = await apiFetch<{ image: Img }>("/api/admin/marketing/images", { method: "POST", body: form });
    setBusy(false);
    if (!r.ok) return toast(r.error, "error");
    setImages((p) => [r.data.image, ...p]);
    toast("Image ready");
  }
  async function remove(img: Img) {
    const r = await apiFetch(`/api/admin/marketing/images/${img.id}`, { method: "DELETE" });
    setRemoving(null);
    if (!r.ok) return toast(r.error, "error");
    setImages((p) => p.filter((x) => x.id !== img.id));
  }

  if (!providers) return <LoadingState label="Loading AI studio…" />;
  const none = !providers.gemini && !providers.openai;

  return (
    <div className="space-y-4">
      {none || !providers.gemini || !providers.openai ? (
        <Alert tone={none ? "warning" : "info"} title={none ? "Connect an AI provider to start" : `${providers.gemini ? "OpenAI" : "Google Gemini"} isn't connected yet`}>
          <ol className="mt-1 list-decimal space-y-1 pl-5">
            {!providers.gemini ? (
              <li>
                Google Gemini: open <b>aistudio.google.com</b> → Get API key → Create API key. Turn on billing in Google Cloud for image generation.
              </li>
            ) : null}
            {!providers.openai ? (
              <li>
                OpenAI: open <b>platform.openai.com</b> → API keys → Create new secret key, and add some credit under Billing.
              </li>
            ) : null}
            <li>
              In Vercel → mecgura-wa → Settings → Environment Variables add <code>GEMINI_API_KEY</code> and/or <code>OPENAI_API_KEY</code> (Sensitive), then redeploy. Never paste keys in chat.
            </li>
          </ol>
        </Alert>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
        <Card>
          <CardHeader title={<span className="flex items-center gap-2"><Wand2 className="size-5 text-app-primary" aria-hidden="true" /> Make an image</span>} description="Describe the picture. Add your text, logo and button afterwards in Creative maker." />
          <CardBody className="space-y-4">
            <Field id="ai-provider" label="AI">
              <Select value={form.provider} onChange={(e) => setForm((f) => ({ ...f, provider: e.target.value }))}>
                <option value="gemini" disabled={!providers.gemini}>
                  Google Gemini{providers.gemini ? "" : " (not connected)"}
                </option>
                <option value="openai" disabled={!providers.openai}>
                  OpenAI{providers.openai ? "" : " (not connected)"}
                </option>
              </Select>
            </Field>
            <Field id="ai-prompt" label="What should the image show?" hint="Who, where, what they are doing, mood. English works best.">
              <Textarea rows={4} value={form.prompt} onChange={(e) => setForm((f) => ({ ...f, prompt: e.target.value }))} maxLength={1000} placeholder="A sweet shop owner smiling at a WhatsApp order on his phone…" />
            </Field>
            <div className="flex flex-wrap gap-1.5">
              {IDEAS.map((idea) => (
                <button key={idea} type="button" onClick={() => setForm((f) => ({ ...f, prompt: idea }))} className="rounded-full border border-app-border px-2.5 py-1 text-caption text-app-muted hover:border-app-primary/40 hover:text-app-text">
                  {idea.split(" ").slice(0, 4).join(" ")}…
                </button>
              ))}
            </div>
            <fieldset>
              <legend className="mb-1.5 text-small font-medium text-app-text">Style</legend>
              <div className="flex flex-wrap gap-1.5">
                {STYLES.map((s) => (
                  <button key={s.id} type="button" aria-pressed={form.style === s.id} onClick={() => setForm((f) => ({ ...f, style: s.id }))} className={cn("rounded-full border px-3 py-1 text-small", form.style === s.id ? "border-app-primary/50 bg-app-primary/15 text-app-text" : "border-app-border text-app-muted hover:text-app-text")}>
                    {s.label}
                  </button>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend className="mb-1.5 text-small font-medium text-app-text">Shape</legend>
              <div className="flex flex-wrap gap-1.5">
                {ASPECTS.map((a) => (
                  <button key={a.id} type="button" aria-pressed={form.aspect === a.id} onClick={() => setForm((f) => ({ ...f, aspect: a.id }))} className={cn("rounded-full border px-3 py-1 text-small", form.aspect === a.id ? "border-app-primary/50 bg-app-primary/15 text-app-text" : "border-app-border text-app-muted hover:text-app-text")}>
                    {a.label}
                  </button>
                ))}
              </div>
            </fieldset>
            <label htmlFor="ai-brand" className="flex items-center justify-between gap-3 text-small text-app-text">
              MECGURA green colour accents
              <Switch id="ai-brand" label="MECGURA green colour accents" checked={form.brand} onCheckedChange={(v) => setForm((f) => ({ ...f, brand: v }))} />
            </label>
            <Button className="w-full" loading={busy} disabled={none || form.prompt.trim().length < 5} onClick={() => void generate()}>
              <Sparkles /> {busy ? "Creating… (10–40 seconds)" : "Create image"}
            </Button>
            <p className="text-caption text-app-subtle">Each image costs a few rupees on your Google or OpenAI bill. Up to 60 a day.</p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Your AI images" description="Download, or open in Creative maker to add the headline, logo and WhatsApp button." />
          <CardBody>
            {images.length ? (
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {images.map((img) => (
                  <li key={img.id} className="overflow-hidden rounded-lg border border-app-border bg-black/30">
                    {/* eslint-disable-next-line @next/next/no-img-element -- private admin image served by our own route */}
                    <img src={img.url} alt={img.prompt} loading="lazy" className={cn("w-full object-cover", ASPECT_CLASS[img.aspect] ?? "aspect-square")} />
                    <div className="space-y-2 p-2">
                      <p className="line-clamp-2 text-caption text-app-muted" title={img.prompt}>
                        {img.prompt}
                      </p>
                      <div className="flex flex-wrap items-center justify-between gap-1">
                        <Badge tone="neutral">{PROVIDER_LABEL[img.provider] ?? img.provider}</Badge>
                        <span className="flex gap-0.5">
                          <a href={`${img.url}?download=1`} className="rounded p-1.5 text-app-muted hover:bg-app-hover hover:text-app-text" aria-label="Download">
                            <Download className="size-4" />
                          </a>
                          <Link href={`/admin/marketing?tab=creatives&img=${img.id}`} className="rounded p-1.5 text-app-muted hover:bg-app-hover hover:text-app-text" aria-label="Use in Creative maker" title="Use in Creative maker">
                            <ImagePlus className="size-4" />
                          </Link>
                          <button type="button" onClick={() => setRemoving(img)} className="rounded p-1.5 text-app-muted hover:bg-app-hover hover:text-red-300" aria-label="Delete">
                            <Trash2 className="size-4" />
                          </button>
                        </span>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState icon={ImagePlus} title="No AI images yet" description="Describe a picture on the left and press Create image." />
            )}
          </CardBody>
        </Card>
      </div>

      <AdCopyCard providers={providers} />
      <ConfirmationDialog open={Boolean(removing)} onClose={() => setRemoving(null)} onConfirm={() => removing && void remove(removing)} title="Delete this image?" description="It is removed from the gallery." confirmLabel="Delete" />
    </div>
  );
}

function AdCopyCard({ providers }: { providers: Providers }) {
  const toast = useToast();
  const [f, setF] = React.useState({ provider: providers.gemini ? "gemini" : "openai", product: "WhatsApp automation for local shops: auto replies, broadcasts and lead follow-up, set up by our team", audience: "small business owners in Punjab", offer: "", language: "hinglish" });
  const [copy, setCopy] = React.useState<AdCopy | null>(null);
  const [busy, setBusy] = React.useState(false);
  const none = !providers.gemini && !providers.openai;
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((p) => ({ ...p, [k]: e.target.value }));
  async function write() {
    setBusy(true);
    const r = await apiFetch<{ copy: AdCopy }>("/api/admin/marketing/ad-copy", { method: "POST", body: f });
    setBusy(false);
    if (!r.ok) return toast(r.error, "error");
    setCopy(r.data.copy);
  }
  const copyText = (t: string) => void navigator.clipboard.writeText(t).then(() => toast("Copied"));
  return (
    <Card>
      <CardHeader title={<span className="flex items-center gap-2"><Sparkles className="size-5 text-app-primary" aria-hidden="true" /> Ad copy</span>} description="Headlines and text for Facebook and Instagram ads, in the language your customers read." />
      <CardBody className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2">
          <Field id="ac-product" label="What are you advertising?" className="md:col-span-2">
            <Input value={f.product} onChange={set("product")} maxLength={300} />
          </Field>
          <Field id="ac-audience" label="For whom">
            <Input value={f.audience} onChange={set("audience")} maxLength={200} />
          </Field>
          <Field id="ac-offer" label="Offer (optional)">
            <Input value={f.offer} onChange={set("offer")} maxLength={200} placeholder="Free setup this week" />
          </Field>
          <Field id="ac-lang" label="Language">
            <Select value={f.language} onChange={set("language")}>
              <option value="hinglish">Hinglish</option>
              <option value="punjabi_roman">Punjabi (Roman)</option>
              <option value="english">English</option>
              <option value="hindi">Hindi</option>
            </Select>
          </Field>
          <Field id="ac-provider" label="AI">
            <Select value={f.provider} onChange={set("provider")}>
              <option value="gemini" disabled={!providers.gemini}>Google Gemini</option>
              <option value="openai" disabled={!providers.openai}>OpenAI</option>
            </Select>
          </Field>
        </div>
        <Button loading={busy} disabled={none} onClick={() => void write()}>
          <Wand2 /> Write ad copy
        </Button>
        {copy ? (
          <div className="grid gap-4 md:grid-cols-2">
            <section>
              <h3 className="mb-2 text-small font-semibold text-app-text">Headlines</h3>
              <ul className="space-y-2">
                {copy.headlines.map((h) => (
                  <li key={h} className="flex items-start justify-between gap-2 rounded-lg border border-app-border p-2.5 text-small text-app-text">
                    {h}
                    <button type="button" onClick={() => copyText(h)} className="shrink-0 text-app-subtle hover:text-app-text" aria-label="Copy headline">
                      <Copy className="size-4" />
                    </button>
                  </li>
                ))}
              </ul>
              {copy.cta ? <p className="mt-3 text-small text-app-muted">Call to action: <span className="text-app-text">{copy.cta}</span></p> : null}
              {copy.hashtags.length ? (
                <p className="mt-2 text-small text-app-primary">
                  {copy.hashtags.join(" ")}{" "}
                  <button type="button" onClick={() => copyText(copy.hashtags.join(" "))} className="ml-1 text-app-subtle hover:text-app-text" aria-label="Copy hashtags">
                    <Copy className="inline size-3.5" />
                  </button>
                </p>
              ) : null}
            </section>
            <section>
              <h3 className="mb-2 text-small font-semibold text-app-text">Primary text</h3>
              <ul className="space-y-2">
                {copy.primaryTexts.map((t) => (
                  <li key={t} className="flex items-start justify-between gap-2 whitespace-pre-line rounded-lg border border-app-border p-2.5 text-small text-app-text">
                    {t}
                    <button type="button" onClick={() => copyText(t)} className="shrink-0 text-app-subtle hover:text-app-text" aria-label="Copy text">
                      <Copy className="size-4" />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        ) : null}
        <p className="text-caption text-app-subtle">Check every line before you publish: the AI can get facts or prices wrong. Meta rejects ads that promise guaranteed results.</p>
      </CardBody>
    </Card>
  );
}
