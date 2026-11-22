"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarPlus, PenLine, Plus, Trash2, Upload } from "lucide-react";
import { Alert, Badge, Button, Card, CardBody, CardHeader, EmptyState, ErrorState, Field, Input, LoadingState, Modal, PageHeader, Select, TabPanel, Tabs, Textarea, useToast } from "@/components/ds";
import { apiFetch } from "@/lib/client-api";
import { LANGUAGES, MAX_LOGO_BYTES, POST_TYPES, STATUSES, STATUS_LABELS, STATUS_TONES, TONES } from "@/lib/onepost";
import type { BrandDto, PostSummary } from "@/services/onepost/posts";
import { EMPTY_POST, PostForm, type PostFields } from "@/components/onepost/post-form";
import { OnePostCalendar } from "@/components/onepost/calendar";
import { ConnectionsPanel } from "@/components/onepost/connections-panel";
import { PrPanel } from "@/components/onepost/pr-panel";
import { ReportsPanel } from "@/components/onepost/reports-panel";
import { EventCampaignModal } from "@/components/onepost/event-campaign";
import { phaseOf } from "@/lib/onepost-event";

const dateFmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
const TABS = [
  { id: "posts", label: "Posts" },
  { id: "calendar", label: "Calendar" },
  { id: "pr", label: "PR" },
  { id: "reports", label: "Reports" },
  { id: "connections", label: "Connections" },
  { id: "brand", label: "Brand profile" },
];
const readFile = (f: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("Could not read the file."));
    r.readAsDataURL(f);
  });

type BrandForm = Omit<BrandDto, "hasLogo" | "logoUrl">;

export function OnePostApp({ orgId, canBrand, canConnect, canPublish, initialTab = "posts", flash }: { orgId: string; canBrand: boolean; canConnect: boolean; canPublish: boolean; initialTab?: string; flash?: { connected?: string; message?: string; error?: string } }) {
  const base = `/api/organizations/${orgId}/onepost`;
  const router = useRouter();
  const toast = useToast();
  const [tab, setTab] = React.useState(TABS.some((t) => t.id === initialTab) ? initialTab : "posts");
  const [data, setData] = React.useState<{ posts: PostSummary[]; counts: Record<string, number> } | null>(null);
  const [error, setError] = React.useState("");
  const [status, setStatus] = React.useState("");
  const [q, setQ] = React.useState("");
  const [brand, setBrand] = React.useState<BrandDto | null>(null);
  const [brandForm, setBrandForm] = React.useState<BrandForm | null>(null);
  const [brandErrors, setBrandErrors] = React.useState<Record<string, string>>({});
  const [savingBrand, setSavingBrand] = React.useState(false);
  const [creating, setCreating] = React.useState(false);
  const [eventOpen, setEventOpen] = React.useState(false);
  const [draft, setDraft] = React.useState<PostFields>(EMPTY_POST);
  const [draftErrors, setDraftErrors] = React.useState<Record<string, string>>({});
  const [saving, setSaving] = React.useState(false);
  const logoRef = React.useRef<HTMLInputElement>(null);

  const load = React.useCallback(async () => {
    const qs = new URLSearchParams();
    if (status) qs.set("status", status);
    if (q.trim()) qs.set("q", q.trim());
    const r = await apiFetch<{ posts: PostSummary[]; counts: Record<string, number> }>(`${base}/posts?${qs}`);
    if (!r.ok) return setError(r.error);
    setError("");
    setData(r.data);
  }, [base, status, q]);

  React.useEffect(() => {
    const id = window.setTimeout(() => void load(), q ? 250 : 0);
    return () => window.clearTimeout(id);
  }, [load, q]);

  const adoptBrand = React.useCallback((b: BrandDto) => {
    setBrand(b);
    setBrandForm({ businessName: b.businessName, services: b.services, city: b.city, website: b.website, about: b.about, tone: b.tone, language: b.language, defaultHashtags: b.defaultHashtags, contactName: b.contactName, contactEmail: b.contactEmail, contactPhone: b.contactPhone });
  }, []);

  React.useEffect(() => {
    void apiFetch<{ brand: BrandDto }>(`${base}/brand`).then((r) => {
      if (r.ok) adoptBrand(r.data.brand);
    });
  }, [base, adoptBrand]);

  async function create() {
    setSaving(true);
    setDraftErrors({});
    const r = await apiFetch<{ post: { id: string } }>(`${base}/posts`, { method: "POST", body: { ...draft, language: draft.language || brand?.language || "en", tone: draft.tone || brand?.tone || "friendly" } });
    setSaving(false);
    if (!r.ok) {
      setDraftErrors(Object.fromEntries(Object.entries(r.details ?? {}).map(([k, v]) => [k, v[0] ?? ""])));
      return toast(r.details ? "Please fix the highlighted fields." : r.error, "error");
    }
    router.push(`/onepost/${r.data.post.id}`);
  }

  async function saveBrand() {
    if (!brandForm) return;
    setSavingBrand(true);
    setBrandErrors({});
    const r = await apiFetch<{ brand: BrandDto }>(`${base}/brand`, { method: "PUT", body: brandForm });
    setSavingBrand(false);
    if (!r.ok) {
      setBrandErrors(Object.fromEntries(Object.entries(r.details ?? {}).map(([k, v]) => [k, v[0] ?? ""])));
      return toast(r.details ? "Please fix the highlighted fields." : r.error, "error");
    }
    adoptBrand(r.data.brand);
    toast("Brand profile saved", "success");
  }

  async function uploadLogo(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_LOGO_BYTES) return toast("The logo can be up to 1 MB.", "error");
    const r = await apiFetch<{ brand: BrandDto }>(`${base}/brand/logo`, { method: "POST", body: { image: await readFile(file).catch(() => "") } });
    if (logoRef.current) logoRef.current.value = "";
    if (!r.ok) return toast(r.error, "error");
    setBrand(r.data.brand);
    toast("Logo saved", "success");
  }

  async function removeLogo() {
    const r = await apiFetch(`${base}/brand/logo`, { method: "DELETE" });
    if (!r.ok) return toast(r.error, "error");
    setBrand((b) => (b ? { ...b, hasLogo: false, logoUrl: null } : b));
  }

  const setB = (k: keyof BrandForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setBrandForm((f) => (f ? { ...f, [k]: e.target.value } : f));
  const total = data ? Object.values(data.counts).reduce((a, b) => a + b, 0) : 0;
  const brandMissing = brand !== null && !brand.about && !brand.services;

  return (
    <>
      <PageHeader
        title="OnePost"
        description="Write once. Get a ready version for your website, Instagram, Facebook, LinkedIn, YouTube, Google, WhatsApp, ads and press release, then publish or schedule it after approval."
        actions={
          <div className="flex flex-wrap gap-2">
          {canPublish ? <Button variant="secondary" onClick={() => setEventOpen(true)}><CalendarPlus aria-hidden="true" /> Event campaign</Button> : null}
          <Button
            onClick={() => {
              setDraft({ ...EMPTY_POST, language: brand?.language ?? "en", tone: brand?.tone ?? "friendly", city: brand?.city ?? "" });
              setDraftErrors({});
              setCreating(true);
            }}
          >
            <Plus aria-hidden="true" /> New post
          </Button>
          </div>
        }
      />
      <Tabs label="OnePost sections" items={TABS} value={tab} onValueChange={setTab} />

      <TabPanel id="posts" active={tab === "posts"}>
        <div className="mt-5 space-y-4">
          {brandMissing ? (
            <Alert tone="info" title="Fill in your brand profile first">
              Services and an “about” paragraph make every version, especially press releases, sound like you. <button type="button" className="font-semibold underline" onClick={() => setTab("brand")}>Open brand profile</button>
            </Alert>
          ) : null}
          <div className="flex flex-wrap items-end gap-3">
            <Field id="op-filter-q" label="Search" className="min-w-52 flex-1">
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by title or details" />
            </Field>
            <Field id="op-filter-status" label="Status" className="w-52">
              <Select value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">All ({total})</option>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABELS[s]} ({data?.counts[s] ?? 0})
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          {error ? (
            <ErrorState description={error} onRetry={load} />
          ) : !data ? (
            <LoadingState label="Loading posts…" />
          ) : data.posts.length === 0 ? (
            <Card>
              <EmptyState icon={PenLine} title={status || q ? "No posts match" : "No posts yet"} description={status || q ? "Try a different search or status." : "Create your first post. Write the idea once and OnePost prepares every channel version."} action={!status && !q ? <Button onClick={() => setCreating(true)}><Plus aria-hidden="true" /> New post</Button> : undefined} />
            </Card>
          ) : (
            <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {data.posts.map((p) => (
                <li key={p.id}>
                  <Link href={`/onepost/${p.id}`} className="glass block h-full min-w-0 rounded-[var(--radius-card)] p-4 shadow-[var(--shadow-card)] transition-colors hover:border-app-primary/50">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="min-w-0 break-words text-body font-semibold text-app-text">{p.title}</h3>
                      <Badge tone={STATUS_TONES[p.status]} dot>
                        {STATUS_LABELS[p.status]}
                      </Badge>
                    </div>
                    {p.eventName ? <p className="mt-2 text-small text-app-text">{p.eventName}{p.eventPhase ? <span className="text-app-muted"> · {phaseOf(p.eventPhase)?.label ?? p.eventPhase}</span> : null}</p> : null}
                    <p className="mt-2 text-small text-app-muted">
                      {POST_TYPES.find((t) => t.key === p.postType)?.label ?? "General"} · {LANGUAGES.find((l) => l.key === p.language)?.label ?? p.language}
                    </p>
                    <p className="mt-1 text-caption text-app-subtle">
                      {p.versionCount} of 10 versions · {p.mediaCount} photo{p.mediaCount === 1 ? "" : "s"} · Updated {dateFmt.format(new Date(p.updatedAt))}
                    </p>
                    {p.status === "changes_requested" && p.reviewNote ? <p className="mt-2 line-clamp-2 text-caption text-amber-200">Changes requested: {p.reviewNote}</p> : null}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </TabPanel>

      <TabPanel id="calendar" active={tab === "calendar"}>
        {tab === "calendar" ? <OnePostCalendar orgId={orgId} canMove={canPublish} /> : null}
      </TabPanel>

      <TabPanel id="pr" active={tab === "pr"}>
        {tab === "pr" ? <PrPanel orgId={orgId} canManage={canPublish} /> : null}
      </TabPanel>

      <TabPanel id="reports" active={tab === "reports"}>
        {tab === "reports" ? <ReportsPanel orgId={orgId} /> : null}
      </TabPanel>

      <TabPanel id="connections" active={tab === "connections"}>
        {tab === "connections" ? <ConnectionsPanel orgId={orgId} canConnect={canConnect} flash={flash} /> : null}
      </TabPanel>

      <TabPanel id="brand" active={tab === "brand"}>
        <div className="mt-5">
          {!brandForm ? (
            <LoadingState label="Loading brand profile…" />
          ) : (
            <Card>
              <CardHeader title="Brand profile" description="The facts and voice every version is written from. Only what you write here is used. Nothing is made up." />
              <CardBody className="space-y-5">
                {!canBrand ? <Alert tone="info">Only owners and managers can change the brand profile.</Alert> : null}
                <fieldset disabled={!canBrand} className="min-w-0 space-y-4 disabled:opacity-80">
                  <div className="flex flex-wrap items-center gap-4">
                    {brand?.logoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={brand.logoUrl} alt="Your logo" className="size-16 rounded-xl border border-app-border object-cover" />
                    ) : (
                      <span className="flex size-16 items-center justify-center rounded-xl border border-dashed border-app-border text-caption text-app-subtle">No logo</span>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <input ref={logoRef} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" id="onepost-logo" onChange={(e) => void uploadLogo(e.target.files?.[0])} />
                      <Button variant="secondary" onClick={() => logoRef.current?.click()}>
                        <Upload aria-hidden="true" /> {brand?.logoUrl ? "Change logo" : "Upload logo"}
                      </Button>
                      {brand?.logoUrl ? (
                        <Button variant="ghost" onClick={() => void removeLogo()}>
                          <Trash2 aria-hidden="true" /> Remove
                        </Button>
                      ) : null}
                    </div>
                    <p className="text-caption text-app-subtle">PNG, JPG or WebP, up to 1 MB. Used in previews now and as a watermark in a later phase.</p>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field id="b-name" label="Business name" error={brandErrors.businessName}>
                      <Input value={brandForm.businessName} onChange={setB("businessName")} maxLength={120} />
                    </Field>
                    <Field id="b-city" label="City" error={brandErrors.city}>
                      <Input value={brandForm.city} onChange={setB("city")} maxLength={80} />
                    </Field>
                    <Field id="b-site" label="Website" error={brandErrors.website}>
                      <Input value={brandForm.website} onChange={setB("website")} maxLength={300} placeholder="https://" inputMode="url" />
                    </Field>
                    <Field id="b-tags" label="Default hashtags" hint="Separated by spaces. Added where they fit." error={brandErrors.defaultHashtags}>
                      <Input value={brandForm.defaultHashtags} onChange={setB("defaultHashtags")} maxLength={300} placeholder="#YourBrand #YourCity" />
                    </Field>
                  </div>
                  <Field id="b-services" label="Services" hint="What you sell or do, in a few words" error={brandErrors.services}>
                    <Textarea rows={3} value={brandForm.services} onChange={setB("services")} maxLength={600} />
                  </Field>
                  <Field id="b-about" label="About the company" hint="Two or three sentences. Used as the “About” paragraph in press releases." error={brandErrors.about}>
                    <Textarea rows={4} value={brandForm.about} onChange={setB("about")} maxLength={1500} />
                  </Field>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field id="b-tone" label="Default tone">
                      <Select value={brandForm.tone} onChange={setB("tone")}>
                        {TONES.map((t) => (
                          <option key={t.key} value={t.key}>
                            {t.label}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field id="b-lang" label="Default language">
                      <Select value={brandForm.language} onChange={setB("language")}>
                        {LANGUAGES.map((l) => (
                          <option key={l.key} value={l.key}>
                            {l.label}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-3">
                    <Field id="b-cname" label="Media contact name" error={brandErrors.contactName}>
                      <Input value={brandForm.contactName} onChange={setB("contactName")} maxLength={120} />
                    </Field>
                    <Field id="b-cmail" label="Media contact email" error={brandErrors.contactEmail}>
                      <Input value={brandForm.contactEmail} onChange={setB("contactEmail")} maxLength={160} inputMode="email" />
                    </Field>
                    <Field id="b-cphone" label="Media contact phone" error={brandErrors.contactPhone}>
                      <Input value={brandForm.contactPhone} onChange={setB("contactPhone")} maxLength={40} inputMode="tel" />
                    </Field>
                  </div>
                </fieldset>
                {canBrand ? (
                  <div className="flex justify-end">
                    <Button onClick={saveBrand} loading={savingBrand}>
                      Save brand profile
                    </Button>
                  </div>
                ) : null}
              </CardBody>
            </Card>
          )}
        </div>
      </TabPanel>

      <EventCampaignModal orgId={orgId} open={eventOpen} onClose={() => setEventOpen(false)} />
      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        size="lg"
        title="New post"
        description="Write the idea once. You can add photos and write the channel versions on the next screen."
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button onClick={create} loading={saving}>
              Create post
            </Button>
          </>
        }
      >
        <PostForm value={draft} onChange={setDraft} errors={draftErrors} idPrefix="np" />
      </Modal>
    </>
  );
}
