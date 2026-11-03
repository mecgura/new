"use client";

import * as React from "react";
import { ImageOff, Sparkles, Upload } from "lucide-react";
import { Alert, Badge, Button, Card, CardBody, CardHeader, Field, Input, LoadingState, Select, Switch, Textarea, useToast } from "@/components/ds";
import { apiFetch } from "@/lib/client-api";

type Slide = { id: string; category: string; business: string; headline: string; description: string; photoHint: string; photoUrl: string | null; enabled: boolean };
type Img = { id: string; prompt: string; url: string };

const MAX_UPLOAD = 25 * 1024 * 1024;
/** Shrinks a photo in the browser to at most 1400 px (JPEG) so even a phone photo fits the server's upload limit. */
async function shrink(f: File): Promise<string> {
  const bmp = await createImageBitmap(f);
  const scale = Math.min(1, 1400 / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * scale);
  c.height = Math.round(bmp.height * scale);
  c.getContext("2d")?.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  return c.toDataURL("image/jpeg", 0.88);
}

/** Admin → Website: the six home page hero slides (photo, headline, description, on/off). */
export function HeroEditor() {
  const toast = useToast();
  const [slides, setSlides] = React.useState<Slide[] | null>(null);
  const [gallery, setGallery] = React.useState<Img[]>([]);
  const [busy, setBusy] = React.useState("");
  const [dirty, setDirty] = React.useState(false);

  const load = React.useCallback(async () => {
    const [h, g] = await Promise.all([apiFetch<{ slides: Slide[] }>("/api/admin/site-hero"), apiFetch<{ images: Img[] }>("/api/admin/marketing/images")]);
    if (h.ok) setSlides(h.data.slides);
    else toast(h.error, "error");
    if (g.ok) setGallery(g.data.images);
  }, [toast]);
  React.useEffect(() => {
    const t = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(t);
  }, [load]);

  const edit = (id: string, patch: Partial<Slide>) => {
    setSlides((s) => s?.map((x) => (x.id === id ? { ...x, ...patch } : x)) ?? s);
    setDirty(true);
  };

  async function saveText() {
    if (!slides) return;
    setBusy("text");
    const r = await apiFetch<{ slides: Slide[] }>("/api/admin/site-hero", { method: "PUT", body: { slides: Object.fromEntries(slides.map((s) => [s.id, { headline: s.headline, description: s.description, enabled: s.enabled }])) } });
    setBusy("");
    if (!r.ok) return toast(r.error, "error");
    setSlides(r.data.slides);
    setDirty(false);
    toast("Hero saved. It shows on the home page now.");
  }

  async function setPhoto(slide: string, body: { upload?: string; imageId?: string }) {
    setBusy(`photo-${slide}`);
    const r = await apiFetch<{ slides: Slide[] }>("/api/admin/site-hero/photo", { method: "PUT", body: { slide, ...body } });
    setBusy("");
    if (!r.ok) return toast(r.error, "error");
    // Keep unsaved text edits; only the photos come from the server.
    setSlides((cur) => cur?.map((x) => ({ ...x, photoUrl: r.data.slides.find((y) => y.id === x.id)?.photoUrl ?? null })) ?? r.data.slides);
    toast(body.upload || body.imageId ? "Photo set" : "Photo removed");
  }

  async function onFile(slide: string, f: File | undefined) {
    if (!f) return;
    if (f.size > MAX_UPLOAD) return toast("Please use a photo under 25 MB.", "error");
    let upload = "";
    try {
      upload = await shrink(f);
    } catch {
      return toast("Couldn't read that photo. Try a JPG or PNG.", "error");
    }
    await setPhoto(slide, { upload });
  }

  if (!slides) return <LoadingState label="Loading hero…" />;

  return (
    <Card>
      <CardHeader
        title="Home page hero"
        description="Six businesses take turns at the top of mecgura.tech: headline, owner photo and a WhatsApp chat change together. Use real photos (yours, a client's with permission, or AI studio images) of Indian business owners in a similar light."
        action={
          <Button loading={busy === "text"} disabled={!dirty} onClick={() => void saveText()}>
            Save text
          </Button>
        }
      />
      <CardBody className="space-y-4">
        {slides.some((s) => !s.photoUrl) ? (
          <Alert tone="info" title="Slides without a photo show a green card with the business name">
            Upload a portrait photo (at least 900×1125, faces in good light) or pick one you made in Marketing → AI studio. Photos are resized and compressed automatically.
          </Alert>
        ) : null}
        <ul className="grid gap-4 xl:grid-cols-2">
          {slides.map((s) => (
            <li key={s.id} className="flex gap-4 rounded-[var(--radius-card)] border border-app-border p-3">
              <div className="w-28 shrink-0 sm:w-32">
                <div className="aspect-[4/5] overflow-hidden rounded-lg border border-app-border bg-app-elevated">
                  {s.photoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- our own small WebP
                    <img src={s.photoUrl} alt={`${s.category} photo`} className="size-full object-cover" />
                  ) : (
                    <div className="grid size-full place-items-center text-app-subtle">
                      <ImageOff className="size-6" aria-hidden="true" />
                    </div>
                  )}
                </div>
                <label className="mt-2 flex cursor-pointer items-center justify-center gap-1 rounded-md border border-app-border px-2 py-1 text-caption text-app-muted hover:text-app-text">
                  <Upload className="size-3.5" aria-hidden="true" /> {busy === `photo-${s.id}` ? "Saving…" : "Upload"}
                  <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" disabled={Boolean(busy)} onChange={(e) => void onFile(s.id, e.target.files?.[0])} />
                </label>
                {gallery.length ? (
                  <Select aria-label={`AI image for ${s.category}`} className="mt-1.5 h-8 text-caption" value="" disabled={Boolean(busy)} onChange={(e) => e.target.value && void setPhoto(s.id, { imageId: e.target.value })}>
                    <option value="">From AI studio…</option>
                    {gallery.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.prompt.slice(0, 40)}
                      </option>
                    ))}
                  </Select>
                ) : null}
                {s.photoUrl ? (
                  <button type="button" onClick={() => void setPhoto(s.id, {})} className="mt-1.5 w-full text-caption text-app-subtle hover:text-red-300">
                    Remove photo
                  </button>
                ) : null}
              </div>
              <div className="min-w-0 flex-1 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <Badge tone="primary">{s.category}</Badge>
                  <label className="flex items-center gap-2 text-caption text-app-muted">
                    Show
                    <Switch label={`Show ${s.category} slide`} checked={s.enabled} onCheckedChange={(v) => edit(s.id, { enabled: v })} />
                  </label>
                </div>
                <Field id={`h-${s.id}`} label="Headline">
                  <Input value={s.headline} maxLength={90} onChange={(e) => edit(s.id, { headline: e.target.value })} />
                </Field>
                <Field id={`d-${s.id}`} label="Description">
                  <Textarea rows={2} value={s.description} maxLength={220} onChange={(e) => edit(s.id, { description: e.target.value })} />
                </Field>
                <p className="flex items-start gap-1.5 text-caption text-app-subtle">
                  <Sparkles className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" /> Photo idea: {s.photoHint}. Chat shown: {s.business}.
                </p>
              </div>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}
