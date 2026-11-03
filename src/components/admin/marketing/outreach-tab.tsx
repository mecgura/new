"use client";

import * as React from "react";
import { Download, ExternalLink, Mail, MapPin, MessageCircle, Search, ShieldCheck, Star, UserPlus } from "lucide-react";
import { Alert, Badge, Button, Card, CardBody, CardHeader, EmptyState, Field, Input, LoadingState, Select, Textarea, useToast } from "@/components/ds";
import { apiFetch } from "@/lib/client-api";
import { fillTemplate } from "@/lib/marketing";
import { cn } from "@/lib/utils";

type Prospect = { placeId: string; name: string; phone: string; address: string; website: string; rating: number | null; reviews: number; mapsUrl: string; category: string; open: boolean; alreadyLead: boolean };
type QueueLead = { id: string; name: string; business: string; city: string; phone: string; email: string; website: string; category: string };
type Settings = { whatsappTemplate: string; emailSubject: string; emailBody: string; senderDetails: string; dailyWhatsApp: number; dailyEmail: number };
type Overview = { categories: string[]; mapsReady: boolean; emailReady: boolean; settings: Settings; queue: QueueLead[]; whatsappToday: number; whatsappLeft: number; emailToday: number; emailLeft: number; emailable: number };

const csvCell = (v: string | number | null) => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function OutreachTab() {
  const toast = useToast();
  const [ov, setOv] = React.useState<Overview | null>(null);
  const load = React.useCallback(async () => {
    const r = await apiFetch<Overview>("/api/admin/outreach");
    if (r.ok) setOv(r.data);
    else toast(r.error, "error");
  }, [toast]);
  React.useEffect(() => {
    const t = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(t);
  }, [load]);

  if (!ov) return <LoadingState label="Loading outreach…" />;
  return (
    <div className="space-y-4">
      <Alert tone="info" title="Reach out the safe way">
        Businesses found on Maps never asked to hear from you. Message them one at a time from your own phone (up to {ov.settings.dailyWhatsApp} a day), make it easy to say no, and never add them to WhatsApp broadcasts or campaigns. Bulk WhatsApp to strangers gets numbers banned by Meta.
      </Alert>
      <FinderCard ov={ov} onAdded={() => void load()} />
      <WhatsAppQueue ov={ov} onChanged={() => void load()} />
      <EmailCard ov={ov} onSent={() => void load()} />
      <SettingsCard settings={ov.settings} onSaved={() => void load()} />
    </div>
  );
}

function FinderCard({ ov, onAdded }: { ov: Overview; onAdded: () => void }) {
  const toast = useToast();
  const [form, setForm] = React.useState({ category: "Salon", query: "", city: "" });
  const [results, setResults] = React.useState<Prospect[]>([]);
  const [next, setNext] = React.useState("");
  const [picked, setPicked] = React.useState<Set<string>>(new Set());
  const [emails, setEmails] = React.useState<Record<string, string[]>>({});
  const [busy, setBusy] = React.useState("");

  async function search(more = false) {
    setBusy(more ? "more" : "search");
    const r = await apiFetch<{ results: Prospect[]; nextPageToken: string }>("/api/admin/outreach/search", { method: "POST", body: { ...form, pageToken: more ? next : "" } });
    setBusy("");
    if (!r.ok) return toast(r.error, "error");
    setResults((p) => (more ? [...p, ...r.data.results] : r.data.results));
    setNext(r.data.nextPageToken);
    if (!more) setPicked(new Set(r.data.results.filter((x) => x.phone && !x.alreadyLead && x.open).map((x) => x.placeId)));
    if (!r.data.results.length) toast("Nothing found. Try another category or a bigger area.");
  }
  async function findEmail(p: Prospect) {
    setBusy(`email-${p.placeId}`);
    const r = await apiFetch<{ emails: string[] }>("/api/admin/outreach/emails", { method: "POST", body: { website: p.website } });
    setBusy("");
    if (!r.ok) return toast(r.error, "error");
    setEmails((e) => ({ ...e, [p.placeId]: r.data.emails }));
    if (!r.data.emails.length) toast("No public email on their website.");
  }
  async function findAllEmails() {
    for (const p of results.filter((x) => picked.has(x.placeId) && x.website && !emails[x.placeId])) await findEmail(p);
  }
  async function add() {
    const chosen = results.filter((x) => picked.has(x.placeId));
    setBusy("add");
    const r = await apiFetch<{ added: number; existing: number; skipped: string[] }>("/api/admin/outreach/add", {
      method: "POST",
      body: { city: form.city, prospects: chosen.map((p) => ({ placeId: p.placeId, name: p.name, phone: p.phone, website: p.website, email: emails[p.placeId]?.[0] ?? "", category: p.category, rating: p.rating, reviews: p.reviews })) },
    });
    setBusy("");
    if (!r.ok) return toast(r.error, "error");
    toast(`${r.data.added} added to Leads${r.data.existing ? `, ${r.data.existing} were already there` : ""}${r.data.skipped.length ? `, ${r.data.skipped.length} without a mobile number skipped` : ""}`);
    setResults((rs) => rs.map((x) => (picked.has(x.placeId) && x.phone ? { ...x, alreadyLead: true } : x)));
    setPicked(new Set());
    onAdded();
  }
  function csv() {
    const rows = results.filter((x) => picked.has(x.placeId));
    const lines = [["Business", "Phone", "Email", "Website", "Rating", "Reviews", "Address", "Maps link"], ...rows.map((p) => [p.name, p.phone, (emails[p.placeId] ?? []).join(" "), p.website, p.rating ?? "", p.reviews, p.address, p.mapsUrl])];
    const blob = new Blob([lines.map((l) => l.map(csvCell).join(",")).join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `prospects-${(form.query || form.category).toLowerCase().replace(/\W+/g, "-")}-${form.city.toLowerCase().replace(/\W+/g, "-")}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  const toggle = (id: string) => setPicked((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });

  return (
    <Card>
      <CardHeader title={<span className="flex items-center gap-2"><MapPin className="size-5 text-app-primary" aria-hidden="true" /> Find businesses on Google Maps</span>} description="Pick a niche and a city. You get name, phone, website, rating and a Maps link. Results aren't saved until you add them to Leads." />
      <CardBody className="space-y-4">
        {!ov.mapsReady ? (
          <Alert tone="warning" title="Connect Google Maps to search">
            In Google Cloud: create a project, turn on billing, enable <b>Places API (New)</b>, then Credentials → Create API key (restrict it to Places API). Add it in Vercel → Settings → Environment Variables as <code>GOOGLE_MAPS_API_KEY</code> (Sensitive) and redeploy. Never paste the key in chat.
          </Alert>
        ) : null}
        <form
          className="grid gap-3 md:grid-cols-[1fr_1fr_1fr_auto]"
          onSubmit={(e) => {
            e.preventDefault();
            void search();
          }}
        >
          <Field id="o-cat" label="Niche">
            <Select value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}>
              {ov.categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="o-q" label="Or your own words (optional)">
            <Input value={form.query} onChange={(e) => setForm((f) => ({ ...f, query: e.target.value }))} placeholder="e.g. bridal makeup artist" maxLength={120} />
          </Field>
          <Field id="o-city" label="City or area">
            <Input value={form.city} onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))} placeholder="e.g. Model Town, Ludhiana" maxLength={80} required />
          </Field>
          <div className="flex items-end">
            <Button type="submit" loading={busy === "search"} disabled={!ov.mapsReady || form.city.trim().length < 2} className="w-full">
              <Search /> Search
            </Button>
          </div>
        </form>

        {results.length ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-small text-app-muted">
                {results.length} found · {picked.size} selected
              </p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="ghost" onClick={() => setPicked(new Set(results.filter((x) => x.phone && !x.alreadyLead).map((x) => x.placeId)))}>Select all with phone</Button>
                <Button size="sm" variant="ghost" onClick={() => setPicked(new Set())}>Clear</Button>
                <Button size="sm" variant="secondary" disabled={!picked.size || busy.startsWith("email")} onClick={() => void findAllEmails()}><Mail /> Find emails</Button>
                <Button size="sm" variant="secondary" disabled={!picked.size} onClick={csv}><Download /> CSV</Button>
                <Button size="sm" loading={busy === "add"} disabled={!picked.size} onClick={() => void add()}><UserPlus /> Add {picked.size || ""} to Leads</Button>
              </div>
            </div>
            <div className="overflow-x-auto rounded-lg border border-app-border">
              <table className="w-full min-w-[56rem] text-small">
                <thead className="bg-white/[0.03] text-left text-caption uppercase tracking-wide text-app-subtle">
                  <tr>
                    <th className="w-10 p-2.5"><span className="sr-only">Select</span></th>
                    <th className="p-2.5">Business</th>
                    <th className="p-2.5">Phone</th>
                    <th className="p-2.5">Rating</th>
                    <th className="p-2.5">Website / email</th>
                    <th className="p-2.5">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-app-border">
                  {results.map((p) => (
                    <tr key={p.placeId} className={cn(picked.has(p.placeId) && "bg-app-primary/[0.05]")}>
                      <td className="p-2.5 align-top">
                        <input type="checkbox" aria-label={`Select ${p.name}`} checked={picked.has(p.placeId)} onChange={() => toggle(p.placeId)} className="size-4 accent-emerald-500" />
                      </td>
                      <td className="p-2.5 align-top">
                        <p className="font-medium text-app-text">{p.name}</p>
                        <p className="text-caption text-app-subtle">{p.category} · {p.address}</p>
                        {p.mapsUrl ? (
                          <a href={p.mapsUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-caption text-app-primary hover:underline">
                            Maps <ExternalLink className="size-3" aria-hidden="true" />
                          </a>
                        ) : null}
                      </td>
                      <td className="whitespace-nowrap p-2.5 align-top text-app-text">{p.phone || <span className="text-app-subtle">No mobile</span>}</td>
                      <td className="whitespace-nowrap p-2.5 align-top">
                        {p.rating ? (
                          <span className="inline-flex items-center gap-1 text-app-text">
                            <Star className="size-3.5 fill-amber-400 text-amber-400" aria-hidden="true" /> {p.rating} <span className="text-app-subtle">({p.reviews})</span>
                          </span>
                        ) : (
                          <span className="text-app-subtle">—</span>
                        )}
                      </td>
                      <td className="max-w-[16rem] p-2.5 align-top">
                        {p.website ? (
                          <>
                            <a href={p.website} target="_blank" rel="noreferrer" className="block truncate text-app-primary hover:underline">{p.website.replace(/^https?:\/\/(www\.)?/, "")}</a>
                            {emails[p.placeId] ? (
                              <p className="truncate text-caption text-app-muted">{emails[p.placeId].length ? emails[p.placeId].join(", ") : "No email found"}</p>
                            ) : (
                              <button type="button" onClick={() => void findEmail(p)} disabled={busy === `email-${p.placeId}`} className="text-caption text-app-muted underline hover:text-app-text">
                                {busy === `email-${p.placeId}` ? "Looking…" : "Find email"}
                              </button>
                            )}
                          </>
                        ) : (
                          <span className="text-app-subtle">No website</span>
                        )}
                      </td>
                      <td className="p-2.5 align-top">
                        {p.alreadyLead ? <Badge tone="info">In Leads</Badge> : !p.open ? <Badge tone="danger">Closed</Badge> : <Badge tone="neutral">New</Badge>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {next ? (
              <Button variant="ghost" loading={busy === "more"} onClick={() => void search(true)}>
                Load 20 more
              </Button>
            ) : null}
          </>
        ) : null}
      </CardBody>
    </Card>
  );
}

function WhatsAppQueue({ ov, onChanged }: { ov: Overview; onChanged: () => void }) {
  const toast = useToast();
  async function message(l: QueueLead) {
    if (ov.whatsappLeft <= 0) return toast("Today's limit is reached. Continue tomorrow so your number stays safe.", "error");
    const text = fillTemplate(ov.settings.whatsappTemplate, { name: l.name, business: l.business, city: l.city, category: l.category.toLowerCase() });
    window.open(`https://wa.me/${l.phone.replace(/\D/g, "")}?text=${encodeURIComponent(text)}`, "_blank", "noopener");
    const r = await apiFetch(`/api/admin/marketing/leads/${l.id}/contacted`, { method: "POST" });
    if (!r.ok) toast(r.error, "error");
    onChanged();
  }
  return (
    <Card>
      <CardHeader
        title={<span className="flex items-center gap-2"><MessageCircle className="size-5 text-app-primary" aria-hidden="true" /> WhatsApp, one at a time</span>}
        description="Opens WhatsApp on your phone or computer with your message ready. Read it, send it yourself, then come back for the next. The lead moves to Contacted."
        action={<Badge tone={ov.whatsappLeft ? "success" : "warning"}>{ov.whatsappToday} sent today · {ov.whatsappLeft} left</Badge>}
      />
      <CardBody>
        {ov.queue.length ? (
          <ul className="divide-y divide-app-border">
            {ov.queue.slice(0, 25).map((l) => (
              <li key={l.id} className="flex flex-wrap items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-app-text">{l.business || l.name || l.phone}</p>
                  <p className="text-caption text-app-subtle">{[l.category, l.city, l.phone].filter(Boolean).join(" · ")}</p>
                </div>
                <Button size="sm" disabled={!ov.whatsappLeft} onClick={() => void message(l)}>
                  <MessageCircle /> WhatsApp
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState icon={MessageCircle} title="Queue is empty" description="Add businesses from the search above. Ones you haven't contacted yet show up here." />
        )}
        {ov.queue.length > 25 ? <p className="mt-2 text-caption text-app-subtle">{ov.queue.length - 25} more waiting. They appear as you go.</p> : null}
      </CardBody>
    </Card>
  );
}

function EmailCard({ ov, onSent }: { ov: Overview; onSent: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = React.useState(false);
  const withEmail = ov.queue.filter((l) => l.email);
  async function send() {
    setBusy(true);
    const r = await apiFetch<{ sent: number; failed: number; skipped: number; left: number }>("/api/admin/outreach/email", { method: "POST", body: { leadIds: withEmail.map((l) => l.id).slice(0, ov.emailLeft) } });
    setBusy(false);
    if (!r.ok) return toast(r.error, "error");
    toast(`${r.data.sent} emails sent${r.data.failed ? `, ${r.data.failed} failed` : ""}${r.data.skipped ? `, ${r.data.skipped} skipped` : ""}. ${r.data.left} left today.`);
    onSent();
  }
  return (
    <Card>
      <CardHeader
        title={<span className="flex items-center gap-2"><Mail className="size-5 text-app-primary" aria-hidden="true" /> Email outreach</span>}
        description="Sends your saved email (below) to new Maps leads that have an email. Every email shows who you are and has a one-click unsubscribe. Nobody gets a second email within 7 days."
        action={<Badge tone={ov.emailLeft ? "success" : "warning"}>{ov.emailToday} sent today · {ov.emailLeft} left</Badge>}
      />
      <CardBody className="space-y-3">
        {!ov.emailReady ? (
          <Alert tone="warning" title="Email isn't set up yet">
            Add <code>RESEND_API_KEY</code> and <code>EMAIL_FROM</code> (an address on your own domain, verified in Resend) in Vercel, then redeploy. Use a separate domain or subdomain for outreach so your main email stays safe.
          </Alert>
        ) : null}
        <p className="text-small text-app-muted">
          {withEmail.length} new lead{withEmail.length === 1 ? "" : "s"} with an email ready.
        </p>
        <Button loading={busy} disabled={!withEmail.length || !ov.emailLeft || !ov.emailReady} onClick={() => void send()}>
          <Mail /> Send to {Math.min(withEmail.length, ov.emailLeft)}
        </Button>
      </CardBody>
    </Card>
  );
}

function SettingsCard({ settings, onSaved }: { settings: Settings; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = React.useState(settings);
  const [busy, setBusy] = React.useState(false);
  const set = (k: keyof Settings) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF((p) => ({ ...p, [k]: e.target.value }));
  async function save() {
    setBusy(true);
    const r = await apiFetch("/api/admin/outreach/settings", { method: "PUT", body: f });
    setBusy(false);
    if (!r.ok) return toast(r.error, "error");
    toast("Outreach settings saved");
    onSaved();
  }
  const preview = { name: "Simran", business: "Glow Studio", city: "Ludhiana", category: "salon" };
  return (
    <Card>
      <CardHeader title={<span className="flex items-center gap-2"><ShieldCheck className="size-5 text-app-primary" aria-hidden="true" /> Messages and limits</span>} description="Use {name}, {business}, {city} and {category}. Keep it short, personal and easy to say no to." action={<Button loading={busy} onClick={() => void save()}>Save</Button>} />
      <CardBody className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3">
          <Field id="s-wa" label="WhatsApp message">
            <Textarea rows={5} value={f.whatsappTemplate} onChange={set("whatsappTemplate")} maxLength={1000} />
          </Field>
          <p className="rounded-lg bg-[#d9fdd3] p-3 text-small text-[#111b21]">{fillTemplate(f.whatsappTemplate, preview)}</p>
          <div className="grid grid-cols-2 gap-3">
            <Field id="s-dwa" label="WhatsApp per day" hint="30–40 is safe">
              <Input type="number" min={1} max={100} value={f.dailyWhatsApp} onChange={set("dailyWhatsApp")} />
            </Field>
            <Field id="s-dem" label="Emails per day" hint="Start with 50–100">
              <Input type="number" min={1} max={300} value={f.dailyEmail} onChange={set("dailyEmail")} />
            </Field>
          </div>
        </div>
        <div className="space-y-3">
          <Field id="s-sub" label="Email subject">
            <Input value={f.emailSubject} onChange={set("emailSubject")} maxLength={150} />
          </Field>
          <Field id="s-body" label="Email">
            <Textarea rows={9} value={f.emailBody} onChange={set("emailBody")} maxLength={4000} />
          </Field>
          <Field id="s-sender" label="Your business details (shown at the bottom of every email)">
            <Input value={f.senderDetails} onChange={set("senderDetails")} maxLength={300} />
          </Field>
        </div>
      </CardBody>
    </Card>
  );
}
