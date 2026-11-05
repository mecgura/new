"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, Megaphone, Sparkles } from "lucide-react";
import Link from "next/link";
import { Alert, Button, Card, CardBody, CardHeader, Checkbox, Field, Input, PageHeader, Radio, Select, Textarea, useToast } from "@/components/ds";
import { apiFetch } from "@/lib/client-api";
import { QUICK_DEFAULTS, type QuickFlowInput } from "@/lib/quick-flow";
import { MediaField } from "@/components/automations/media-field";

type Account = { id: string; displayName: string; phoneNumber: string; isDemo: boolean };
type Ad = { adId: string; name: string; leads: number; status: string };

/** One form → a complete automation: welcome image, brochure, price list, call booking and team hand-over. */
export function EasySetup({ orgId, accounts, activeAccountId }: { orgId: string; accounts: Account[]; activeAccountId: string }) {
  const router = useRouter();
  const toast = useToast();
  const [f, setF] = React.useState<QuickFlowInput & { name: string; whatsappAccountId: string }>({ ...QUICK_DEFAULTS, name: "Ad leads – easy flow", whatsappAccountId: activeAccountId || accounts[0]?.id || "" });
  const [ads, setAds] = React.useState<Ad[] | null>(null);
  const [kw, setKw] = React.useState(QUICK_DEFAULTS.keywords.join(", "));
  const [busy, setBusy] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));

  React.useEffect(() => {
    void apiFetch<{ ads: Ad[] }>(`/api/organizations/${orgId}/automations/ad-sources`).then((r) => setAds(r.ok ? r.data.ads : []));
  }, [orgId]);

  async function save() {
    setBusy(true);
    setErrors({});
    const body = { ...f, whatsappAccountId: f.whatsappAccountId || null, keywords: kw.split(",").map((x) => x.trim()).filter(Boolean) };
    const r = await apiFetch<{ automation: { id: string } }>(`/api/organizations/${orgId}/automations/quick`, { method: "POST", body });
    setBusy(false);
    if (!r.ok) {
      setErrors(Object.fromEntries(Object.entries(r.details ?? {}).map(([k, v]) => [k, Array.isArray(v) ? String(v[0]) : String(v)])));
      return toast(r.error, "error");
    }
    toast("Automation is live ✅");
    router.push(`/automations/${r.data.automation.id}`);
  }

  const step = (n: number, title: string, description?: string) => (
    <CardHeader title={<span className="flex items-center gap-2"><span className="grid size-6 place-items-center rounded-full bg-app-primary text-caption font-bold text-white">{n}</span>{title}</span>} description={description} />
  );

  return (
    <>
      <PageHeader
        title={<span className="flex items-center gap-2"><Sparkles className="size-6 text-app-primary" aria-hidden="true" /> Easy setup</span>}
        description="Fill this one page — we build the full WhatsApp flow for you. You can edit any step later."
        actions={<Link href="/automations" className="inline-flex items-center gap-1 text-small text-app-primary hover:underline"><ArrowLeft className="size-4" aria-hidden="true" /> Automations</Link>}
      />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-5">
          <Card>
            {step(1, "Who gets this?", "Pick the ads — only people who tap them get this flow.")}
            <CardBody className="space-y-3">
              <div className="flex flex-wrap gap-4">
                <Radio name="start" label="People who tap my ads" checked={f.start === "ad_click"} onChange={() => set({ start: "ad_click" })} />
                <Radio name="start" label="Every new WhatsApp contact" checked={f.start === "new_contact"} onChange={() => set({ start: "new_contact" })} />
                <Radio name="start" label="When a message has a keyword" checked={f.start === "keyword"} onChange={() => set({ start: "keyword" })} />
              </div>
              {f.start === "ad_click" ? (
                <fieldset className="space-y-1.5 rounded-lg border border-app-border p-3">
                  <legend className="px-1 text-small font-medium text-app-text"><Megaphone className="mr-1 inline size-4" aria-hidden="true" /> Which ads?</legend>
                  {ads === null ? <p className="text-caption text-app-subtle">Loading ads…</p> : ads.length ? ads.map((a) => (
                    <Checkbox key={a.adId} label={`${a.name}${a.leads ? ` · ${a.leads} lead${a.leads === 1 ? "" : "s"}` : ""}`} checked={f.adIds.includes(a.adId)} onChange={(e) => set({ adIds: e.target.checked ? [...f.adIds, a.adId] : f.adIds.filter((x) => x !== a.adId) })} />
                  )) : <p className="text-caption text-app-subtle">No ads seen yet — it will run for <strong>any</strong> ad. You can pick ads later in the trigger.</p>}
                  <p className="text-caption text-app-subtle">None ticked = any of your ads.</p>
                </fieldset>
              ) : null}
              {f.start === "keyword" ? (
                <Field id="qs-kw" label="Keywords" hint="Comma separated. Runs when a message contains one of them." error={errors.keywords}>
                  <Input value={kw} onChange={(e) => setKw(e.target.value)} />
                </Field>
              ) : null}
              {accounts.length > 1 ? (
                <Field id="qs-acc" label="WhatsApp number">
                  <Select value={f.whatsappAccountId} onChange={(e) => set({ whatsappAccountId: e.target.value })}>
                    {accounts.map((a) => <option key={a.id} value={a.id}>{a.displayName} ({a.phoneNumber}){a.isDemo ? " · demo" : ""}</option>)}
                  </Select>
                </Field>
              ) : null}
            </CardBody>
          </Card>

          <Card>
            {step(2, "Welcome message", "First thing they see. Add your poster / offer image.")}
            <CardBody className="space-y-3">
              <MediaField orgId={orgId} accept="image" value={f.welcomeImage} onChange={(m) => set({ welcomeImage: m })} label="Welcome image (optional)" />
              <Field id="qs-welcome" label="Welcome text" error={errors.welcomeText}>
                <Textarea rows={3} maxLength={1024} value={f.welcomeText} onChange={(e) => set({ welcomeText: e.target.value })} />
              </Field>
            </CardBody>
          </Card>

          <Card>
            {step(3, "Brochure (PDF)", "Sent right after the welcome. Skip it if you don't have one.")}
            <CardBody className="space-y-3">
              <MediaField orgId={orgId} accept="document" value={f.brochure} onChange={(m) => set({ brochure: m })} label="Brochure (optional)" />
              {f.brochure.url ? (
                <Field id="qs-bro" label="Text with the brochure">
                  <Input maxLength={1024} value={f.brochureText} onChange={(e) => set({ brochureText: e.target.value })} />
                </Field>
              ) : null}
            </CardBody>
          </Card>

          <Card>
            {step(4, "Buttons", "Three buttons under the welcome. Names up to 20 letters.")}
            <CardBody className="grid gap-3 sm:grid-cols-3">
              <Field id="qs-b1" label="Price button"><Input maxLength={20} value={f.buttons.price} onChange={(e) => set({ buttons: { ...f.buttons, price: e.target.value } })} /></Field>
              <Field id="qs-b2" label="Call button"><Input maxLength={20} value={f.buttons.call} onChange={(e) => set({ buttons: { ...f.buttons, call: e.target.value } })} /></Field>
              <Field id="qs-b3" label="Team button"><Input maxLength={20} value={f.buttons.team} onChange={(e) => set({ buttons: { ...f.buttons, team: e.target.value } })} /></Field>
            </CardBody>
          </Card>

          <Card>
            {step(5, "Price list", "Sent when they tap the price button. Write your real prices.")}
            <CardBody className="space-y-3">
              <MediaField orgId={orgId} accept="image" value={f.priceImage} onChange={(m) => set({ priceImage: m })} label="Price list image (optional)" />
              <Field id="qs-price" label="Price text" error={errors.priceText} hint="Use *stars* for bold on WhatsApp.">
                <Textarea rows={6} maxLength={1024} value={f.priceText} onChange={(e) => set({ priceText: e.target.value })} />
              </Field>
              {f.priceText.includes("₹____") ? <Alert tone="warning">Replace ₹____ with your real prices before going live.</Alert> : null}
            </CardBody>
          </Card>

          <Card>
            {step(6, "Talk to the team", "Sent when they want to chat. The chat is assigned to your team.")}
            <CardBody>
              <Field id="qs-team" label="Message">
                <Textarea rows={2} maxLength={1024} value={f.teamText} onChange={(e) => set({ teamText: e.target.value })} />
              </Field>
            </CardBody>
          </Card>

          <Card>
            <CardBody className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <Field id="qs-name" label="Automation name" className="sm:w-80"><Input maxLength={80} value={f.name} onChange={(e) => set({ name: e.target.value })} /></Field>
              <Button onClick={() => void save()} disabled={busy || !f.welcomeText.trim() || !f.priceText.trim()}>
                <Check aria-hidden="true" /> {busy ? "Creating…" : "Create & go live"}
              </Button>
            </CardBody>
          </Card>
        </div>

        <aside className="lg:sticky lg:top-4 lg:self-start">
          <Card>
            <CardHeader title="What the customer gets" />
            <CardBody>
              <ol className="space-y-2 text-small text-app-muted">
                {[
                  f.welcomeImage.url ? "🖼️ Welcome image + text" : "💬 Welcome text",
                  f.brochure.url ? "📄 Your brochure (PDF)" : null,
                  `🔘 Buttons: ${f.buttons.price} · ${f.buttons.call} · ${f.buttons.team}`,
                  `💰 ${f.buttons.price} → price list${f.priceImage.url ? " + image" : ""} → Call / Team / Later`,
                  `📞 ${f.buttons.call} → name + call time → tagged “Call requested”, assigned to your team`,
                  `👥 ${f.buttons.team} → tagged “Hot lead”, assigned to your team`,
                  "🔕 No reply → tagged “No reply”, nothing more is sent",
                ].filter(Boolean).map((x) => <li key={x as string} className="rounded-md bg-app-hover px-3 py-2">{x}</li>)}
              </ol>
              <p className="mt-3 text-caption text-app-subtle">Customers who say “English nahi aati” are handed to your team automatically.</p>
            </CardBody>
          </Card>
        </aside>
      </div>
    </>
  );
}
