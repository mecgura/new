"use client";

import * as React from "react";
import { ChevronDown, ExternalLink, ImagePlus, Play, Plus, Trash2 } from "lucide-react";
import { Badge, Button, Card, CardBody, CardHeader, Input, Label, PageHeader, Select, Switch, Textarea, useToast } from "@/components/ds";
import { apiFetch } from "@/lib/client-api";
import { FestivalEffect, type EffectKind } from "@/components/festival/festival-effect";
import type { Festival, FestivalSettings } from "@/services/site/festivals";

const EFFECTS: { value: EffectKind; label: string }[] = [
  { value: "fireworks", label: "Fireworks (patake)" },
  { value: "diyas", label: "Diyas and sparkles" },
  { value: "petals", label: "Falling flower petals" },
  { value: "colors", label: "Holi colours" },
  { value: "snow", label: "Snow" },
  { value: "confetti", label: "Confetti" },
  { value: "none", label: "No effect" },
];

const THEMES: { value: Festival["theme"]; label: string }[] = [
  { value: "auto", label: "Automatic (from the festival)" },
  { value: "gold", label: "Gold & diya glow" },
  { value: "saffron", label: "Saffron" },
  { value: "maroon", label: "Maroon & rose" },
  { value: "holi", label: "Holi colours" },
  { value: "winter", label: "Winter blue" },
  { value: "green", label: "Crescent green" },
  { value: "tricolour", label: "Tricolour" },
  { value: "none", label: "Keep normal colours" },
];

const slug = (name: string) => `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 26) || "festival"}-${Math.random().toString(36).slice(2, 7)}`;
const addDays = (s: string, n: number) => {
  const d = new Date(`${s}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const fmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** Shrinks a banner photo in the browser (max 1200px wide, JPEG) so it can be stored as text. */
async function shrinkBanner(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1200 / bitmap.width);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not read the photo.");
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  for (const q of [0.85, 0.75, 0.62, 0.5, 0.4]) {
    const url = canvas.toDataURL("image/jpeg", q);
    if (url.length < 400_000) return url;
  }
  throw new Error("Photo is too large. Try a smaller one.");
}

export function FestivalEditor({ initial, today }: { initial: FestivalSettings; today: string }) {
  const toast = useToast();
  const [enabled, setEnabled] = React.useState(initial.enabled);
  const [list, setList] = React.useState<Festival[]>(initial.festivals);
  const [open, setOpen] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [preview, setPreview] = React.useState<EffectKind | null>(null);
  const [photoBust, setPhotoBust] = React.useState<Record<string, number>>({});
  const [dirty, setDirty] = React.useState(false);

  const sorted = [...list].sort((a, b) => a.start.localeCompare(b.start));
  const patch = (id: string, change: Partial<Festival>) => {
    setDirty(true);
    setList((xs) => xs.map((x) => (x.id === id ? { ...x, ...change } : x)));
  };
  const status = (x: Festival) => {
    const end = addDays(x.start, x.days - 1);
    if (x.start <= today && today <= end) return <Badge tone="success">Live today</Badge>;
    if (end < today) return <Badge tone="neutral">Past</Badge>;
    if (x.leadDays && addDays(x.start, -x.leadDays) <= today) return <Badge tone="warning">Advertising now</Badge>;
    return <Badge tone="info">Upcoming</Badge>;
  };

  function add() {
    const f: Festival = { id: slug("festival"), name: "", emoji: "🎉", start: today, days: 1, greeting: "", offer: "", offerCode: "", effect: "confetti", showOnSite: true, showToClients: true, hasPhoto: false, leadDays: 3, discountPercent: 10, applyToPlans: true, theme: "auto" };
    setList((xs) => [...xs, f]);
    setOpen(f.id);
  }

  async function pickPhoto(id: string, file: File | undefined) {
    if (!file) return;
    try {
      const photo = await shrinkBanner(file);
      const r = await apiFetch<{ hasPhoto: boolean }>("/api/admin/festivals/photo", { method: "PUT", body: { id, photo } });
      if (!r.ok) return toast(r.error, "error");
      patch(id, { hasPhoto: true });
      setPhotoBust((b) => ({ ...b, [id]: Date.now() }));
      toast("Photo saved.");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not use that photo.", "error");
    }
  }

  async function removePhoto(id: string) {
    const r = await apiFetch("/api/admin/festivals/photo", { method: "PUT", body: { id, photo: "" } });
    if (!r.ok) return toast(r.error, "error");
    patch(id, { hasPhoto: false });
  }

  async function save() {
    if (list.some((x) => !x.name.trim())) return toast("Every festival needs a name.", "error");
    setSaving(true);
    const r = await apiFetch<FestivalSettings>("/api/admin/festivals", { method: "PUT", body: { enabled, festivals: list } });
    setSaving(false);
    if (!r.ok) return toast(r.details ? Object.values(r.details).flat()[0] ?? r.error : r.error, "error");
    setList(r.data.festivals);
    setDirty(false);
    toast("Saved. The home page and client panels are updated.");
  }

  return (
    <div className="space-y-6">
      {preview ? <FestivalEffect kind={preview} seconds={5} onDone={() => setPreview(null)} /> : null}
      <PageHeader
        title="Festivals"
        description="Greetings, offers, a photo and a screen effect on festival days: on the home page, and a one-time greeting in every client's panel. Dates of lunar festivals change every year, so check them here."
        actions={
          <>
            <a href="/#festivals" target="_blank" rel="noreferrer" className="inline-flex h-10 items-center gap-2 px-3 text-small font-semibold text-app-muted hover:text-app-text">
              <ExternalLink className="size-4" aria-hidden="true" /> View calendar
            </a>
            <Button onClick={save} loading={saving}>Save changes</Button>
          </>
        }
      />

      <Card>
        <CardBody className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-semibold text-app-text">Festival greetings are {enabled ? "on" : "off"}</p>
            <p className="text-small text-app-muted">Turn off to hide every banner, effect, client greeting and the calendar at once.</p>
          </div>
          <Switch checked={enabled} onCheckedChange={setEnabled} label="Festival greetings" />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={`Festival list (${list.length})`} description="Tap a festival to edit it." action={list.length < 60 ? <Button size="sm" variant="secondary" onClick={add}><Plus /> Add festival</Button> : null} />
        <CardBody className="space-y-3">
          {sorted.map((x) => {
            const isOpen = open === x.id;
            return (
              <div key={x.id} className="rounded-[var(--radius-control)] border border-app-border">
                <button type="button" onClick={() => setOpen(isOpen ? null : x.id)} aria-expanded={isOpen} className="flex w-full items-center gap-3 p-3 text-left">
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-app-hover text-xl" aria-hidden="true">{x.emoji || "🎉"}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold text-app-text">{x.name || "New festival"}</span>
                    <span className="block text-small text-app-muted">
                      {fmt.format(new Date(`${x.start}T00:00:00Z`))}{x.days > 1 ? ` · ${x.days} days` : ""}{x.offer ? " · offer" : ""}{x.hasPhoto ? " · photo" : ""}
                    </span>
                  </span>
                  {status(x)}
                  <ChevronDown className={`size-4 shrink-0 text-app-muted transition-transform ${isOpen ? "rotate-180" : ""}`} aria-hidden="true" />
                </button>
                {isOpen ? (
                  <div className="grid gap-4 border-t border-app-border p-4 sm:grid-cols-2">
                    <div>
                      <Label htmlFor={`fn-${x.id}`}>Name</Label>
                      <Input id={`fn-${x.id}`} value={x.name} maxLength={60} placeholder="Diwali" onChange={(e) => patch(x.id, { name: e.target.value })} />
                    </div>
                    <div>
                      <Label htmlFor={`fe-${x.id}`}>Emoji</Label>
                      <Input id={`fe-${x.id}`} value={x.emoji} maxLength={8} onChange={(e) => patch(x.id, { emoji: e.target.value })} />
                    </div>
                    <div>
                      <Label htmlFor={`fs-${x.id}`}>Starts on</Label>
                      <Input id={`fs-${x.id}`} type="date" value={x.start} onChange={(e) => e.target.value && patch(x.id, { start: e.target.value })} />
                    </div>
                    <div>
                      <Label htmlFor={`fd-${x.id}`}>Show for (days)</Label>
                      <Input id={`fd-${x.id}`} type="number" min={1} max={30} value={x.days} onChange={(e) => patch(x.id, { days: Math.min(30, Math.max(1, Number(e.target.value) || 1)) })} />
                    </div>
                    <div className="sm:col-span-2">
                      <Label htmlFor={`fg-${x.id}`}>Greeting</Label>
                      <Textarea id={`fg-${x.id}`} rows={2} value={x.greeting} maxLength={240} onChange={(e) => patch(x.id, { greeting: e.target.value })} />
                    </div>
                    <div>
                      <Label htmlFor={`fo-${x.id}`}>Special offer (optional)</Label>
                      <Input id={`fo-${x.id}`} value={x.offer} maxLength={200} placeholder={x.discountPercent ? `Empty = "${x.discountPercent}% off on all MECGURA plans"` : "Free WhatsApp setup this Diwali"} onChange={(e) => patch(x.id, { offer: e.target.value })} />
                    </div>
                    <div>
                      <Label htmlFor={`fc-${x.id}`}>Offer code (optional)</Label>
                      <Input id={`fc-${x.id}`} value={x.offerCode} maxLength={30} placeholder="DIWALI26" onChange={(e) => patch(x.id, { offerCode: e.target.value.toUpperCase() })} />
                    </div>
                    <div>
                      <Label htmlFor={`fl-${x.id}`}>Start advertising (days before)</Label>
                      <Input id={`fl-${x.id}`} type="number" min={0} max={14} value={x.leadDays} onChange={(e) => patch(x.id, { leadDays: Math.min(14, Math.max(0, Number(e.target.value) || 0)) })} />
                      <p className="mt-1 text-caption text-app-subtle">{x.leadDays ? `Offer bar, popup and theme start on ${fmt.format(new Date(`${addDays(x.start, -x.leadDays)}T00:00:00Z`))}.` : "Only on the festival days."}</p>
                    </div>
                    <div>
                      <Label htmlFor={`fp-${x.id}`}>Festive discount on plans (%)</Label>
                      <Input id={`fp-${x.id}`} type="number" min={0} max={90} value={x.discountPercent} onChange={(e) => patch(x.id, { discountPercent: Math.min(90, Math.max(0, Number(e.target.value) || 0)) })} />
                      <div className="mt-2 flex items-center gap-3"><Switch checked={x.applyToPlans} onCheckedChange={(v) => patch(x.id, { applyToPlans: v })} label="Show festive price on pricing cards" /><span className="text-small text-app-text">Show festive price on pricing cards</span></div>
                    </div>
                    <div>
                      <Label htmlFor={`ft-${x.id}`}>Website theme</Label>
                      <Select id={`ft-${x.id}`} value={x.theme} onChange={(e) => patch(x.id, { theme: e.target.value as Festival["theme"] })}>
                        {THEMES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </Select>
                    </div>
                    <div>
                      <Label htmlFor={`fx-${x.id}`}>Screen effect</Label>
                      <div className="flex gap-2">
                        <Select id={`fx-${x.id}`} value={x.effect} onChange={(e) => patch(x.id, { effect: e.target.value as EffectKind })}>
                          {EFFECTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </Select>
                        <Button size="md" variant="secondary" aria-label="Preview effect" disabled={x.effect === "none"} onClick={() => setPreview(x.effect)}><Play /></Button>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>Show to</Label>
                      <div className="flex items-center gap-3"><Switch checked={x.showOnSite} onCheckedChange={(v) => patch(x.id, { showOnSite: v })} label="Website visitors (banner + calendar)" /><span className="text-small text-app-text">Website visitors (banner + calendar)</span></div>
                      <div className="flex items-center gap-3"><Switch checked={x.showToClients} onCheckedChange={(v) => patch(x.id, { showToClients: v })} label="Client panels (greeting card)" /><span className="text-small text-app-text">Client panels (greeting card)</span></div>
                    </div>
                    <div className="sm:col-span-2 rounded-xl border border-app-border p-3">
                      <Label>Preview on website</Label>
                      <p className="mb-2 text-caption text-app-subtle">{dirty ? "Save first: the preview shows the saved version." : "Opens the home page as visitors will see it. Only you see the preview."}</p>
                      <div className="flex flex-wrap gap-2">
                        {(["pre", "live"] as const).map((ph) => (
                          <a
                            key={ph}
                            href={`/?festivalPreview=${x.id}&phase=${ph}`}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => {
                              if (!dirty) return;
                              e.preventDefault();
                              toast("Save first, then preview.", "error");
                            }}
                            className="inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-control)] border border-app-border px-3 text-small text-app-text hover:bg-app-hover"
                          >
                            <ExternalLink className="size-4" aria-hidden="true" />
                            {ph === "pre" ? `Days before${x.leadDays ? ` (from ${fmt.format(new Date(`${addDays(x.start, -x.leadDays)}T00:00:00Z`))})` : ""}` : "Festival day"}
                          </a>
                        ))}
                      </div>
                    </div>
                    <div className="sm:col-span-2">
                      <Label>Banner photo (optional)</Label>
                      <div className="flex flex-wrap items-center gap-3">
                        {x.hasPhoto ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={`/api/festival-photo/${x.id}?v=${photoBust[x.id] ?? 0}`} alt="" className="h-24 w-40 rounded-lg object-cover ring-1 ring-app-border" />
                        ) : (
                          <span className="grid h-24 w-40 place-items-center rounded-lg bg-app-hover"><ImagePlus className="size-6 text-app-subtle" aria-hidden="true" /></span>
                        )}
                        <label className="cursor-pointer text-small font-semibold text-app-primary hover:underline">
                          {x.hasPhoto ? "Change photo" : "Add photo"}
                          <input type="file" accept="image/*" className="sr-only" onChange={(e) => { void pickPhoto(x.id, e.target.files?.[0]); e.target.value = ""; }} />
                        </label>
                        {x.hasPhoto ? <button type="button" className="text-small text-app-muted hover:underline" onClick={() => removePhoto(x.id)}>Remove photo</button> : null}
                      </div>
                      <p className="mt-1 text-caption text-app-subtle">A wide photo or poster works best. It is resized automatically. The photo saves straight away; other changes need Save.</p>
                    </div>
                    <div className="sm:col-span-2">
                      <Button size="sm" variant="danger" onClick={() => { setList((xs) => xs.filter((y) => y.id !== x.id)); setOpen(null); }}><Trash2 /> Remove festival</Button>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
          {!list.length ? <p className="text-small text-app-muted">No festivals yet.</p> : null}
        </CardBody>
      </Card>

      <div className="flex justify-end">
        <Button onClick={save} loading={saving}>Save changes</Button>
      </div>
    </div>
  );
}
