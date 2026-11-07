"use client";

import * as React from "react";
import { ImageIcon, PanelRight, Plus, Send, Trash2 } from "lucide-react";
import { Alert, Button, Card, CardBody, CardHeader, EmptyState, Field, Input, LoadingState, PageHeader, Select, Textarea, useToast } from "@/components/ds";
import { apiFetch } from "@/lib/client-api";
import { AdPreview, PhaseBadge, Sparkline } from "@/components/sponsored/ad-card";
import type { SponsoredAdDto } from "@/services/sponsored/sponsored";

type Form = { id?: string; name: string; headline: string; body: string; ctaLabel: string; linkType: "url" | "whatsapp"; link: string; waMessage: string; startsAt: string; endsAt: string; imageUrl: string | null; image?: string };
const EMPTY: Form = { name: "", headline: "", body: "", ctaLabel: "Learn more", linkType: "url", link: "", waMessage: "", startsAt: "", endsAt: "", imageUrl: null };
const dateOnly = (iso: string | null) => (iso ? iso.slice(0, 10) : "");
const fmt = (iso: string | null) => (iso ? new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }).format(new Date(iso)) : "—");

/** Workspace → Sponsored spot: your card in the Sponsored panel on mecgura.tech. */
export function SponsoredApp({ orgId, orgName, canManage }: { orgId: string; orgName: string; canManage: boolean }) {
  const toast = useToast();
  const base = `/api/organizations/${orgId}/sponsored`;
  const [ads, setAds] = React.useState<SponsoredAdDto[] | null>(null);
  const [form, setForm] = React.useState<Form | null>(null);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);
  const [daily, setDaily] = React.useState<Record<string, { impressions: number; clicks: number }[]>>({});

  const load = React.useCallback(async () => {
    const r = await apiFetch<{ ads: SponsoredAdDto[] }>(base);
    if (!r.ok) return toast(r.error, "error");
    setAds(r.data.ads);
    for (const a of r.data.ads.filter((x) => x.impressions > 0)) {
      void apiFetch<{ daily: { impressions: number; clicks: number }[] }>(`${base}/${a.id}/report`).then((d) => d.ok && setDaily((m) => ({ ...m, [a.id]: d.data.daily })));
    }
  }, [base, toast]);
  React.useEffect(() => {
    const t = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(t);
  }, [load]);

  const set = (p: Partial<Form>) => setForm((f) => (f ? { ...f, ...p } : f));

  function pickImage(file: File) {
    if (file.size > 1024 * 1024) return toast("Image is over 1 MB. Compress it (tinypng.com) and try again.", "error");
    const r = new FileReader();
    r.onload = () => set({ image: String(r.result), imageUrl: String(r.result) });
    r.readAsDataURL(file);
  }

  async function save(sendForReview: boolean) {
    if (!form) return;
    setBusy(true);
    setErrors({});
    const { id, imageUrl, image, ...rest } = form;
    void imageUrl;
    const body = { ...rest, ...(image !== undefined ? { image } : {}) };
    const r = await apiFetch<{ ad: SponsoredAdDto }>(id ? `${base}/${id}` : base, { method: id ? "PUT" : "POST", body });
    if (!r.ok) {
      setBusy(false);
      setErrors(Object.fromEntries(Object.entries(r.details ?? {}).map(([k, v]) => [k, v[0]])));
      return toast(Object.values(r.details ?? {})[0]?.[0] ?? r.error, "error");
    }
    if (sendForReview && ["draft", "rejected"].includes(r.data.ad.status)) {
      const s = await apiFetch(`${base}/${r.data.ad.id}/action`, { method: "POST", body: { action: "submit" } });
      if (!s.ok) toast(s.error, "error");
      else toast("Sent to MECGURA for review ✅");
    } else toast(sendForReview ? "Saved. Changes go to MECGURA for review again." : "Draft saved");
    setBusy(false);
    setForm(null);
    void load();
  }

  async function act(id: string, action: "submit" | "pause" | "resume") {
    const r = await apiFetch(`${base}/${id}/action`, { method: "POST", body: { action } });
    if (!r.ok) return toast(r.error, "error");
    toast(action === "submit" ? "Sent for review ✅" : action === "pause" ? "Paused" : "Live again");
    void load();
  }
  async function remove(id: string) {
    if (!window.confirm("Delete this ad and its numbers?")) return;
    const r = await apiFetch(`${base}/${id}`, { method: "DELETE" });
    if (!r.ok) return toast(r.error, "error");
    toast("Deleted");
    void load();
  }

  if (form) {
    return (
      <>
        <PageHeader title={form.id ? "Edit your ad" : "New ad"} description="This is how it looks on mecgura.tech. MECGURA reviews every ad before it goes live." actions={<Button variant="ghost" onClick={() => setForm(null)}>Cancel</Button>} />
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
          <Card>
            <CardBody className="space-y-4">
              <Field id="sp-name" label="Name (only you see this)" error={errors.name}><Input value={form.name} maxLength={60} onChange={(e) => set({ name: e.target.value })} placeholder="Diwali offer" /></Field>
              <Field id="sp-head" label="Headline" hint={`${form.headline.length}/60`} error={errors.headline}><Input value={form.headline} maxLength={60} onChange={(e) => set({ headline: e.target.value })} placeholder="Flat 20% off on bridal makeup" /></Field>
              <Field id="sp-body" label="Description (optional)" hint={`${form.body.length}/140`} error={errors.body}><Textarea rows={2} value={form.body} maxLength={140} onChange={(e) => set({ body: e.target.value })} /></Field>
              <div>
                <p className="mb-1.5 text-small font-medium text-app-text">Image (optional)</p>
                <div className="flex flex-wrap items-center gap-2">
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-app-border px-3 py-2 text-small hover:bg-app-hover">
                    <ImageIcon className="size-4" aria-hidden="true" /> {form.imageUrl ? "Change image" : "Upload image"}
                    <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) pickImage(f); }} />
                  </label>
                  {form.imageUrl ? <Button size="sm" variant="ghost" onClick={() => set({ image: "", imageUrl: null })}>Remove</Button> : null}
                </div>
                <p className="mt-1 text-caption text-app-subtle">JPG, PNG or WebP up to 1 MB. Wide pictures (1200×628) look best.</p>
                {errors.image ? <p role="alert" className="text-caption text-app-danger">{errors.image}</p> : null}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field id="sp-cta" label="Button text" error={errors.ctaLabel}><Input value={form.ctaLabel} maxLength={24} onChange={(e) => set({ ctaLabel: e.target.value })} /></Field>
                <Field id="sp-lt" label="Button opens">
                  <Select value={form.linkType} onChange={(e) => set({ linkType: e.target.value as Form["linkType"], link: "" })}>
                    <option value="url">My website / page (https link)</option>
                    <option value="whatsapp">My WhatsApp chat</option>
                  </Select>
                </Field>
              </div>
              <Field id="sp-link" label={form.linkType === "url" ? "Link" : "WhatsApp number"} error={errors.link} hint={form.linkType === "url" ? "A public https:// link: your website, landing page or Google Maps." : "With country code, e.g. 91 98765 43210"}>
                <Input value={form.link} maxLength={500} onChange={(e) => set({ link: e.target.value })} placeholder={form.linkType === "url" ? "https://" : "+91 98765 43210"} />
              </Field>
              {form.linkType === "whatsapp" ? <Field id="sp-wa" label="First message (optional)"><Input value={form.waMessage} maxLength={140} onChange={(e) => set({ waMessage: e.target.value })} placeholder="Hi, I saw your ad on MECGURA" /></Field> : null}
              <div className="grid gap-3 sm:grid-cols-2">
                <Field id="sp-s" label="Start date (optional)"><Input type="date" value={form.startsAt} onChange={(e) => set({ startsAt: e.target.value })} /></Field>
                <Field id="sp-e" label="End date (optional)" error={errors.endsAt}><Input type="date" value={form.endsAt} onChange={(e) => set({ endsAt: e.target.value })} /></Field>
              </div>
              <div className="flex flex-wrap gap-2 pt-2">
                <Button onClick={() => void save(true)} disabled={busy}><Send aria-hidden="true" /> {form.id ? "Save & send for review" : "Send for review"}</Button>
                {!form.id ? <Button variant="secondary" onClick={() => void save(false)} disabled={busy}>Save draft</Button> : null}
              </div>
            </CardBody>
          </Card>
          <aside className="lg:sticky lg:top-4 lg:self-start">
            <Card>
              <CardHeader title="Preview" />
              <CardBody><AdPreview headline={form.headline} body={form.body} ctaLabel={form.ctaLabel} advertiser={orgName} imageUrl={form.imageUrl} /></CardBody>
            </Card>
          </aside>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Sponsored spot"
        description="Show your ad in the labelled “Sponsored” panel on mecgura.tech. MECGURA reviews each ad before it goes live."
        actions={canManage ? <Button onClick={() => { setErrors({}); setForm({ ...EMPTY }); }}><Plus aria-hidden="true" /> New ad</Button> : undefined}
      />
      <Alert tone="info" className="mb-4" title="How it works">Write a short ad → send it for review → once approved it appears on MECGURA’s blog pages with a “Sponsored” label. You see views and clicks here. Honest, lawful ads only; MECGURA may reject or pause any ad.</Alert>
      {ads === null ? (
        <LoadingState />
      ) : !ads.length ? (
        <Card><EmptyState icon={PanelRight} title="No ads yet" description="Create your first ad and send it for review." action={canManage ? <Button onClick={() => setForm({ ...EMPTY })}>New ad</Button> : undefined} /></Card>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {ads.map((a) => (
            <Card key={a.id}>
              <CardBody className="flex gap-4">
                <div className="hidden w-40 shrink-0 sm:block">
                  {a.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={a.imageUrl} alt="" className="aspect-[1.91/1] w-full rounded-lg object-cover" />
                  ) : (
                    <div className="grid aspect-[1.91/1] w-full place-items-center rounded-lg bg-app-hover text-caption text-app-subtle">No image</div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2"><h2 className="truncate text-h3 text-app-text">{a.headline}</h2><PhaseBadge phase={a.phase} /></div>
                  <p className="mt-0.5 text-caption text-app-subtle">{a.name} · {fmt(a.startsAt)} → {fmt(a.endsAt)}</p>
                  {a.status === "rejected" && a.reviewNote ? <Alert tone="danger" className="mt-2">MECGURA: {a.reviewNote}</Alert> : null}
                  {a.status === "paused" && a.reviewNote ? <p className="mt-2 text-small text-amber-300">{a.reviewNote}</p> : null}
                  <div className="mt-3 flex items-end justify-between gap-4">
                    <dl className="flex gap-5 text-small">
                      <div><dt className="text-caption text-app-subtle">Views</dt><dd className="font-semibold tabular-nums">{a.impressions.toLocaleString("en-IN")}{a.maxImpressions ? <span className="text-app-subtle"> / {a.maxImpressions.toLocaleString("en-IN")}</span> : null}</dd></div>
                      <div><dt className="text-caption text-app-subtle">Clicks</dt><dd className="font-semibold tabular-nums">{a.clicks.toLocaleString("en-IN")}</dd></div>
                      <div><dt className="text-caption text-app-subtle">CTR</dt><dd className="font-semibold tabular-nums">{a.ctr}%</dd></div>
                    </dl>
                    {daily[a.id] ? <Sparkline values={daily[a.id].map((d) => d.impressions)} label="Views, last 14 days" /> : null}
                  </div>
                  {canManage ? (
                    <div className="mt-4 flex flex-wrap gap-2">
                      <Button size="sm" variant="secondary" onClick={() => { setErrors({}); setForm({ id: a.id, name: a.name, headline: a.headline, body: a.body, ctaLabel: a.ctaLabel, linkType: a.linkType, link: a.linkType === "whatsapp" ? `+${a.link}` : a.link, waMessage: a.waMessage, startsAt: dateOnly(a.startsAt), endsAt: dateOnly(a.endsAt), imageUrl: a.imageUrl }); }}>Edit</Button>
                      {a.status === "draft" || a.status === "rejected" ? <Button size="sm" onClick={() => void act(a.id, "submit")}>Send for review</Button> : null}
                      {a.status === "active" ? <Button size="sm" variant="secondary" onClick={() => void act(a.id, "pause")}>Pause</Button> : null}
                      {a.status === "paused" && !a.reviewNote.startsWith("Paused by MECGURA") ? <Button size="sm" variant="secondary" onClick={() => void act(a.id, "resume")}>Resume</Button> : null}
                      <Button size="sm" variant="ghost" onClick={() => void remove(a.id)}><Trash2 aria-hidden="true" /> Delete</Button>
                    </div>
                  ) : null}
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
