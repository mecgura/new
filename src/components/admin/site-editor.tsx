"use client";

import * as React from "react";
import { ExternalLink, ImagePlus, Plus, Trash2 } from "lucide-react";
import { Badge, Button, Card, CardBody, CardHeader, Input, Label, PageHeader, Select, Textarea, useToast } from "@/components/ds";
import { apiFetch } from "@/lib/client-api";
import type { HomeContent } from "@/services/site/home-content";

type Team = HomeContent["team"][number];
type Service = HomeContent["services"][number];
type Integration = HomeContent["integrations"][number];

const uid = () => Math.random().toString(36).slice(2, 10);

/** Shrinks a chosen photo to a small square JPEG in the browser so it can be stored as text. */
async function shrinkPhoto(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const size = 360;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not read the photo.");
  const side = Math.min(bitmap.width, bitmap.height);
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size);
  for (const q of [0.82, 0.7, 0.55, 0.4]) {
    const url = canvas.toDataURL("image/jpeg", q);
    if (url.length < 150_000) return url;
  }
  throw new Error("Photo is too detailed. Try another one.");
}

function StateSelect({ value, onChange, label }: { value: "live" | "soon"; onChange: (v: "live" | "soon") => void; label: string }) {
  return (
    <Select aria-label={label} value={value} onChange={(e) => onChange(e.target.value as "live" | "soon")}>
      <option value="live">Live</option>
      <option value="soon">Coming soon</option>
    </Select>
  );
}

type ChatStatus = { enabled: boolean; organization: { id: string; name: string } | null; organizations: { id: string; name: string }[] };

function ChatbotCard() {
  const toast = useToast();
  const [st, setSt] = React.useState<ChatStatus | null>(null);
  const [orgId, setOrgId] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    void apiFetch<ChatStatus>("/api/admin/site-chat").then((r) => {
      if (!r.ok) return;
      setSt(r.data);
      setOrgId(r.data.organization?.id ?? r.data.organizations[0]?.id ?? "");
    });
  }, []);

  async function apply(enabled: boolean) {
    setBusy(true);
    const r = await apiFetch<Omit<ChatStatus, "organizations">>("/api/admin/site-chat", { method: "PUT", body: { enabled, ...(enabled ? { organizationId: orgId } : {}) } });
    setBusy(false);
    if (!r.ok) return toast(r.error, "error");
    setSt((x) => (x ? { ...x, ...r.data } : x));
    toast(enabled ? "Chatbot is on. Leads go to that workspace." : "Chatbot is off. The home page shows quick WhatsApp links.");
  }

  return (
    <Card>
      <CardHeader title="Home page chatbot" description="Visitors leave a name and number, become a lead in the workspace you choose, and an assistant answers common questions. Every chat also shows in that workspace's Channels inbox." action={st ? <Badge tone={st.enabled ? "success" : "neutral"}>{st.enabled ? "On" : "Off"}</Badge> : null} />
      <CardBody className="space-y-3">
        {!st ? <p className="text-small text-app-muted">Loading…</p> : (
          <>
            <div className="max-w-sm">
              <Label htmlFor="chat-org">Send leads to workspace</Label>
              <Select id="chat-org" value={orgId} onChange={(e) => setOrgId(e.target.value)}>
                {st.organizations.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </Select>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" loading={busy} disabled={!orgId} onClick={() => apply(true)}>{st.enabled ? "Update workspace" : "Turn chatbot on"}</Button>
              {st.enabled ? <Button size="sm" variant="secondary" loading={busy} onClick={() => apply(false)}>Turn off</Button> : null}
            </div>
            <p className="text-caption text-app-subtle">Turning it on also switches on the Omnichannel inbox for that workspace.</p>
          </>
        )}
      </CardBody>
    </Card>
  );
}

type WaBot = { accountId: string | null; accounts: { id: string; label: string }[] };

function WhatsAppBotCard() {
  const toast = useToast();
  const [st, setSt] = React.useState<WaBot | null>(null);
  const [sel, setSel] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    void apiFetch<WaBot>("/api/admin/site-chat/whatsapp").then((r) => {
      if (!r.ok) return;
      setSt(r.data);
      setSel(r.data.accountId ?? r.data.accounts[0]?.id ?? "");
    });
  }, []);

  async function apply(accountId: string | null) {
    setBusy(true);
    const r = await apiFetch<{ accountId: string | null }>("/api/admin/site-chat/whatsapp", { method: "PUT", body: { accountId } });
    setBusy(false);
    if (!r.ok) return toast(r.error, "error");
    setSt((x) => (x ? { ...x, accountId: r.data.accountId } : x));
    toast(accountId ? "The assistant now answers on that WhatsApp number." : "The assistant is off for WhatsApp.");
  }

  return (
    <Card>
      <CardHeader title="WhatsApp number assistant" description="Anyone who messages this WhatsApp number gets an automatic reply, becomes a lead, and your team is notified. A person can take over any chat from the inbox, and the assistant then stays quiet." action={st ? <Badge tone={st.accountId ? "success" : "neutral"}>{st.accountId ? "On" : "Off"}</Badge> : null} />
      <CardBody className="space-y-3">
        {!st ? <p className="text-small text-app-muted">Loading…</p> : st.accounts.length === 0 ? <p className="text-small text-app-muted">No connected WhatsApp numbers yet.</p> : (
          <>
            <div className="max-w-md">
              <Label htmlFor="wa-bot-num">WhatsApp number</Label>
              <Select id="wa-bot-num" value={sel} onChange={(e) => setSel(e.target.value)}>
                {st.accounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
              </Select>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" loading={busy} disabled={!sel} onClick={() => apply(sel)}>{st.accountId ? "Update number" : "Turn on"}</Button>
              {st.accountId ? <Button size="sm" variant="secondary" loading={busy} onClick={() => apply(null)}>Turn off</Button> : null}
            </div>
            <p className="text-caption text-app-subtle">Replies use that workspace&apos;s wallet (the usual service fee per reply), so keep some balance in it. If an AI Agent or an automation already answers on the number, the assistant steps aside.</p>
          </>
        )}
      </CardBody>
    </Card>
  );
}

export function SiteEditor({ initial }: { initial: HomeContent }) {
  const toast = useToast();
  const [team, setTeam] = React.useState<Team[]>(initial.team);
  const [services, setServices] = React.useState<Service[]>(initial.services);
  const [integrations, setIntegrations] = React.useState<Integration[]>(initial.integrations);
  const [saving, setSaving] = React.useState(false);

  const patch = <T extends { id: string }>(set: React.Dispatch<React.SetStateAction<T[]>>, id: string, change: Partial<T>) =>
    set((rows) => rows.map((r) => (r.id === id ? { ...r, ...change } : r)));
  const remove = <T extends { id: string }>(set: React.Dispatch<React.SetStateAction<T[]>>, id: string) => set((rows) => rows.filter((r) => r.id !== id));

  async function pickPhoto(id: string, file: File | undefined) {
    if (!file) return;
    try {
      patch(setTeam, id, { photo: await shrinkPhoto(file) });
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not use that photo.", "error");
    }
  }

  async function save() {
    if (team.some((m) => !m.name.trim())) return toast("Every team member needs a name.", "error");
    if (services.some((x) => !x.title.trim())) return toast("Every service needs a title.", "error");
    if (integrations.some((x) => !x.name.trim())) return toast("Every integration needs a name.", "error");
    setSaving(true);
    const r = await apiFetch<{ content: HomeContent }>("/api/admin/site-content", { method: "PUT", body: { team, services, integrations } });
    setSaving(false);
    if (!r.ok) return toast(r.error, "error");
    toast("Saved. The home page is updated.");
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Website"
        description="Edit what the public home page shows: team, services and integrations. Add or remove anything, then press Save."
        actions={
          <>
            <a href="/" target="_blank" rel="noreferrer" className="inline-flex h-10 items-center gap-2 px-3 text-small font-semibold text-app-muted hover:text-app-text">
              <ExternalLink className="size-4" aria-hidden="true" /> View home page
            </a>
            <Button onClick={save} loading={saving}>Save changes</Button>
          </>
        }
      />

      <ChatbotCard />
      <WhatsAppBotCard />

      <Card>
        <CardHeader
          title="Team members"
          description="Shown in the “Our team” section. Leave empty to hide the section. Up to 12."
          action={team.length < 12 ? <Button size="sm" variant="secondary" onClick={() => setTeam((t) => [...t, { id: uid(), name: "", role: "", bio: "", photo: "" }])}><Plus /> Add member</Button> : null}
        />
        <CardBody className="space-y-4">
          {team.length === 0 ? <p className="text-small text-app-muted">No team members yet.</p> : null}
          {team.map((m, i) => (
            <div key={m.id} className="grid gap-4 rounded-[var(--radius-control)] border border-app-border p-4 sm:grid-cols-[7rem_1fr]">
              <div>
                <div className="grid size-24 place-items-center overflow-hidden rounded-full bg-app-hover">
                  {m.photo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={m.photo} alt="" className="size-full object-cover" />
                  ) : (
                    <ImagePlus className="size-6 text-app-subtle" aria-hidden="true" />
                  )}
                </div>
                <label className="mt-2 inline-block cursor-pointer text-small font-semibold text-app-primary hover:underline">
                  {m.photo ? "Change photo" : "Add photo"}
                  <input type="file" accept="image/*" className="sr-only" aria-label={`Photo for member ${i + 1}`} onChange={(e) => { void pickPhoto(m.id, e.target.files?.[0]); e.target.value = ""; }} />
                </label>
                {m.photo ? <button type="button" className="block text-small text-app-muted hover:underline" onClick={() => patch(setTeam, m.id, { photo: "" })}>Remove photo</button> : null}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor={`tn-${m.id}`}>Name</Label>
                  <Input id={`tn-${m.id}`} value={m.name} maxLength={80} onChange={(e) => patch(setTeam, m.id, { name: e.target.value })} />
                </div>
                <div>
                  <Label htmlFor={`tr-${m.id}`}>Role</Label>
                  <Input id={`tr-${m.id}`} value={m.role} maxLength={80} placeholder="Founder" onChange={(e) => patch(setTeam, m.id, { role: e.target.value })} />
                </div>
                <div className="sm:col-span-2">
                  <Label htmlFor={`tb-${m.id}`}>One line about them (optional)</Label>
                  <Textarea id={`tb-${m.id}`} rows={2} value={m.bio} maxLength={200} onChange={(e) => patch(setTeam, m.id, { bio: e.target.value })} />
                </div>
                <div className="sm:col-span-2">
                  <Button size="sm" variant="danger" onClick={() => remove(setTeam, m.id)}><Trash2 /> Remove</Button>
                </div>
              </div>
            </div>
          ))}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Services"
          description="Cards in the “What we do” section. Mark something “Coming soon” until it really works."
          action={services.length < 16 ? <Button size="sm" variant="secondary" onClick={() => setServices((s) => [...s, { id: uid(), title: "", text: "", state: "live" }])}><Plus /> Add service</Button> : null}
        />
        <CardBody className="space-y-4">
          {services.length === 0 ? <p className="text-small text-app-muted">No services. The section will be hidden.</p> : null}
          {services.map((s) => (
            <div key={s.id} className="grid gap-3 rounded-[var(--radius-control)] border border-app-border p-4 sm:grid-cols-[1fr_10rem]">
              <div>
                <Label htmlFor={`st-${s.id}`}>Title</Label>
                <Input id={`st-${s.id}`} value={s.title} maxLength={60} onChange={(e) => patch(setServices, s.id, { title: e.target.value })} />
              </div>
              <div>
                <Label htmlFor={`ss-${s.id}`}>Status</Label>
                <StateSelect label="Status" value={s.state} onChange={(v) => patch(setServices, s.id, { state: v })} />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor={`sx-${s.id}`}>Short description</Label>
                <Textarea id={`sx-${s.id}`} rows={2} value={s.text} maxLength={200} onChange={(e) => patch(setServices, s.id, { text: e.target.value })} />
              </div>
              <div className="sm:col-span-2">
                <Button size="sm" variant="danger" onClick={() => remove(setServices, s.id)}><Trash2 /> Remove</Button>
              </div>
            </div>
          ))}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Integrations"
          description="Channels and tools shown in the “Works with” section (Meta, email, calendar and so on)."
          action={integrations.length < 20 ? <Button size="sm" variant="secondary" onClick={() => setIntegrations((s) => [...s, { id: uid(), name: "", note: "", state: "live" }])}><Plus /> Add integration</Button> : null}
        />
        <CardBody className="space-y-4">
          {integrations.length === 0 ? <p className="text-small text-app-muted">No integrations. The section will be hidden.</p> : null}
          {integrations.map((s) => (
            <div key={s.id} className="grid gap-3 rounded-[var(--radius-control)] border border-app-border p-4 sm:grid-cols-[1fr_1fr_10rem_auto] sm:items-end">
              <div>
                <Label htmlFor={`in-${s.id}`}>Name</Label>
                <Input id={`in-${s.id}`} value={s.name} maxLength={60} onChange={(e) => patch(setIntegrations, s.id, { name: e.target.value })} />
              </div>
              <div>
                <Label htmlFor={`io-${s.id}`}>Note</Label>
                <Input id={`io-${s.id}`} value={s.note} maxLength={100} onChange={(e) => patch(setIntegrations, s.id, { note: e.target.value })} />
              </div>
              <div>
                <Label htmlFor={`is-${s.id}`}>Status</Label>
                <StateSelect label="Status" value={s.state} onChange={(v) => patch(setIntegrations, s.id, { state: v })} />
              </div>
              <Button size="sm" variant="danger" aria-label={`Remove ${s.name || "integration"}`} onClick={() => remove(setIntegrations, s.id)}><Trash2 /></Button>
            </div>
          ))}
        </CardBody>
      </Card>

      <div className="flex items-center justify-end gap-3">
        <Badge tone="neutral">Changes show on the home page after you save</Badge>
        <Button onClick={save} loading={saving}>Save changes</Button>
      </div>
    </div>
  );
}
