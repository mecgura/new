"use client";

import * as React from "react";
import { Check, ImagePlus, Sparkles, Trash2 } from "lucide-react";
import { Alert, Button, Field, Input, Modal, Select, Switch, Textarea, useToast } from "@/components/ds";
import { apiFetch } from "@/lib/client-api";

export type SocialSettings = { requireApproval: boolean; brandVoice: string; defaultHashtags: string };
export type Asset = { id: string; name: string; mimeType: string; sizeBytes: number; tags: string; url: string; createdAt: string };

/** Approval switch, brand voice and default hashtags. */
export function SettingsModal({ root, settings, canApprove, onClose, onSaved }: { root: string; settings: SocialSettings; canApprove: boolean; onClose: () => void; onSaved: (s: SocialSettings) => void }) {
  const toast = useToast();
  const [s, setS] = React.useState(settings);
  const [busy, setBusy] = React.useState(false);
  async function save() {
    setBusy(true);
    const r = await apiFetch<{ settings: SocialSettings }>(`${root}/settings`, { method: "PUT", body: s });
    setBusy(false);
    if (!r.ok) return toast(r.error, "error");
    toast("Settings saved");
    onSaved(r.data.settings);
  }
  return (
    <Modal open onClose={onClose} title="Social media settings" footer={<div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={() => void save()}>Save</Button></div>}>
      <div className="space-y-4">
        <div className="flex items-start gap-3 rounded-[var(--radius-control)] border border-app-border p-3">
          <div className="min-w-0 flex-1">
            <p className="text-small font-medium text-app-text">Posts need the owner&apos;s approval</p>
            <p className="text-caption text-app-muted">When on, posts scheduled by managers or the MECGURA team wait for the workspace owner. Nothing is published until it&apos;s approved.</p>
            {!canApprove ? <p className="mt-1 text-caption text-amber-300">Only the workspace owner can change this.</p> : null}
          </div>
          <Switch label="Posts need approval" checked={s.requireApproval} disabled={!canApprove} onCheckedChange={(v) => setS({ ...s, requireApproval: v })} />
        </div>
        <Field id="ss-voice" label="Brand voice" hint="Used by AI captions. Example: warm, family-run sweet shop; simple Hinglish; no slang.">
          <Textarea rows={3} maxLength={1000} value={s.brandVoice} onChange={(e) => setS({ ...s, brandVoice: e.target.value })} />
        </Field>
        <Field id="ss-tags" label="Always add these hashtags" hint="Space-separated, e.g. #SharmaSweets #Ludhiana">
          <Input maxLength={300} value={s.defaultHashtags} onChange={(e) => setS({ ...s, defaultHashtags: e.target.value })} />
        </Field>
      </div>
    </Modal>
  );
}

async function toDataUrl(file: File): Promise<string> {
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

/** Media library: browse, upload, delete, and (with onPick) choose an image for a post. */
export function LibraryModal({ root, onClose, onPick }: { root: string; onClose: () => void; onPick?: (a: Asset) => void }) {
  const toast = useToast();
  const [q, setQ] = React.useState("");
  const [data, setData] = React.useState<{ assets: Asset[]; usedBytes: number; maxBytes: number; count: number; maxAssets: number } | null>(null);
  const [busy, setBusy] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const load = React.useCallback(async () => {
    const r = await apiFetch<NonNullable<typeof data>>(`${root}/assets?q=${encodeURIComponent(q)}`);
    if (!r.ok) return toast(r.error, "error");
    setData(r.data);
  }, [root, q, toast]);
  React.useEffect(() => {
    const t = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(t);
  }, [load]);
  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    for (const f of Array.from(files).slice(0, 10)) {
      try {
        const r = await apiFetch(`${root}/assets`, { method: "POST", body: { name: f.name.replace(/\.[^.]+$/, ""), image: await toDataUrl(f) } });
        if (!r.ok) toast(`${f.name}: ${r.error}`, "error");
      } catch (e) {
        toast(`${f.name}: ${e instanceof Error ? e.message : "couldn't read"}`, "error");
      }
    }
    setBusy(false);
    if (fileRef.current) fileRef.current.value = "";
    void load();
  }
  async function remove(a: Asset) {
    if (!window.confirm(`Delete “${a.name}” from the library? Posts that already use it keep their copy.`)) return;
    const r = await apiFetch(`${root}/assets/${a.id}`, { method: "DELETE" });
    if (!r.ok) return toast(r.error, "error");
    void load();
  }
  return (
    <Modal open onClose={onClose} size="lg" title={onPick ? "Choose from media library" : "Media library"} description={data ? `${data.count}/${data.maxAssets} images · ${(data.usedBytes / 1_048_576).toFixed(1)} of ${Math.round(data.maxBytes / 1_048_576)} MB used` : undefined}>
      <div className="mb-3 flex flex-wrap gap-2">
        <Input aria-label="Search images" placeholder="Search by name or tag" value={q} onChange={(e) => setQ(e.target.value)} className="min-w-0 flex-1" />
        <input ref={fileRef} type="file" multiple accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => void upload(e.target.files)} />
        <Button variant="secondary" loading={busy} onClick={() => fileRef.current?.click()}><ImagePlus aria-hidden="true" /> Upload images</Button>
      </div>
      {!data ? null : !data.assets.length ? (
        <p className="py-8 text-center text-small text-app-muted">No images yet. Upload your logo, product photos and festival creatives once and reuse them in posts.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {data.assets.map((a) => (
            <li key={a.id} className="group relative overflow-hidden rounded-lg ring-1 ring-app-border">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={a.url} alt={a.name} className="aspect-square w-full object-cover" loading="lazy" />
              <p className="truncate px-2 py-1 text-caption text-app-text">{a.name}</p>
              <div className="absolute right-1 top-1 flex gap-1">
                {onPick ? (
                  <Button size="sm" onClick={() => onPick(a)} aria-label={`Use ${a.name}`}><Check aria-hidden="true" /> Use</Button>
                ) : null}
                <Button size="sm" variant="secondary" onClick={() => void remove(a)} aria-label={`Delete ${a.name}`}><Trash2 aria-hidden="true" /></Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

type Option = { caption: string; hashtags: string[] };
const LANGS = [
  ["en", "English"],
  ["hinglish", "Hinglish"],
  ["pa-roman", "Punjabi (Roman)"],
  ["pa", "ਪੰਜਾਬੀ (Gurmukhi)"],
  ["hi", "हिंदी"],
] as const;

/** Brief → three caption + hashtag options (Claude). */
export function CaptionHelper({ root, platform, onUse }: { root: string; platform: "instagram" | "facebook" | "both"; onUse: (text: string) => void }) {
  const [brief, setBrief] = React.useState("");
  const [language, setLanguage] = React.useState("en");
  const [tone, setTone] = React.useState("friendly");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [options, setOptions] = React.useState<Option[]>([]);
  async function go() {
    setBusy(true);
    setError("");
    const r = await apiFetch<{ options: Option[] }>(`${root}/ai/captions`, { method: "POST", body: { brief, language, tone, platform } });
    setBusy(false);
    if (!r.ok) return setError(Object.values(r.details ?? {}).flat()[0] ?? r.error);
    setOptions(r.data.options);
  }
  return (
    <div className="space-y-3 rounded-[var(--radius-control)] border border-app-border bg-app-hover/40 p-3">
      <Field id="ai-brief" label="What is this post about?" hint="Include real details: offer, price, dates, location. The AI won't invent offers.">
        <Textarea rows={2} maxLength={1500} value={brief} onChange={(e) => setBrief(e.target.value)} placeholder="Diwali gift boxes, kaju katli + soan papdi, ₹499, order on WhatsApp, delivery in Ludhiana" />
      </Field>
      <div className="flex flex-wrap items-end gap-2">
        <Select aria-label="Language" value={language} onChange={(e) => setLanguage(e.target.value)} className="w-44">
          {LANGS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </Select>
        <Select aria-label="Tone" value={tone} onChange={(e) => setTone(e.target.value)} className="w-36">
          {["friendly", "professional", "festive", "playful", "urgent"].map((t) => <option key={t} value={t}>{t[0].toUpperCase() + t.slice(1)}</option>)}
        </Select>
        <Button loading={busy} disabled={brief.trim().length < 10} onClick={() => void go()}><Sparkles aria-hidden="true" /> Write captions</Button>
      </div>
      {error ? <Alert tone="warning">{error}</Alert> : null}
      {options.length ? (
        <ul className="space-y-2">
          {options.map((o, i) => (
            <li key={i} className="rounded-lg border border-app-border bg-app-surface p-3">
              <p className="whitespace-pre-wrap text-small text-app-text">{o.caption}</p>
              <p className="mt-1 text-caption text-sky-300">{o.hashtags.join(" ")}</p>
              <Button size="sm" variant="secondary" className="mt-2" onClick={() => onUse(`${o.caption}\n\n${o.hashtags.join(" ")}`)}>Use this</Button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

