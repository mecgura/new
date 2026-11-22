"use client";

import * as React from "react";
import Link from "next/link";
import { Copy, ExternalLink, FileDown, Link2, Mail, MessageCircle } from "lucide-react";
import { Alert, Badge, Button, Card, CardBody, CardHeader, ConfirmationDialog, Input, LoadingState, Select, useToast } from "@/components/ds";
import { apiFetch } from "@/lib/client-api";
import type { PostDetail } from "@/services/onepost/posts";
import type { ContactDto } from "@/services/onepost/pr";

const dt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });
const PUBLISHABLE = ["approved", "scheduled", "failed", "published"];

type LinkRow = { id: string; createdAt: string; expiresAt: string; status: "active" | "expired" | "decided" | "revoked" | "stale"; decision: string; decidedBy: string; decisionNote: string };
const LINK_TONE = { active: "info", expired: "neutral", decided: "success", revoked: "neutral", stale: "warning" } as const;
const LINK_LABEL = { active: "Waiting for the client", expired: "Expired", decided: "Answered", revoked: "Cancelled", stale: "Post changed, make a new link" } as const;

/** A private review link for a client who has no login. */
function ClientReview({ base, canManage }: { base: string; canManage: boolean }) {
  const toast = useToast();
  const [links, setLinks] = React.useState<LinkRow[] | null>(null);
  const [fresh, setFresh] = React.useState("");
  const [days, setDays] = React.useState("7");
  const [busy, setBusy] = React.useState(false);
  const load = React.useCallback(async () => {
    const r = await apiFetch<{ links: LinkRow[] }>(`${base}/review-links`);
    if (r.ok) setLinks(r.data.links);
  }, [base]);
  React.useEffect(() => {
    const id = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(id);
  }, [load]);
  async function make() {
    setBusy(true);
    const r = await apiFetch<{ link: { url: string } }>(`${base}/review-links`, { method: "POST", body: { days: Number(days) } });
    setBusy(false);
    if (!r.ok) return toast(r.error, "error");
    setFresh(r.data.link.url);
    void load();
  }
  async function revoke(id: string) {
    const r = await apiFetch(`${base}/review-links/${id}`, { method: "DELETE" });
    if (!r.ok) return toast(r.error, "error");
    void load();
  }
  return (
    <Card>
      <CardHeader title="Client review link" description="Send your client a private link to read the post and approve it or ask for changes. They don't need a login." />
      <CardBody className="space-y-3">
        {canManage ? (
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label htmlFor="op-days" className="mb-1.5 block text-small font-medium text-app-text">Link works for</label>
              <Select id="op-days" value={days} onChange={(e) => setDays(e.target.value)} className="w-36">
                {["1", "3", "7", "14", "30"].map((d) => (
                  <option key={d} value={d}>{d} day{d === "1" ? "" : "s"}</option>
                ))}
              </Select>
            </div>
            <Button loading={busy} onClick={() => void make()}><Link2 aria-hidden="true" /> Create link</Button>
          </div>
        ) : null}
        {fresh ? (
          <Alert tone="success" title="Link ready. Copy it now, it is not shown again.">
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <code className="break-all text-caption">{fresh}</code>
              <Button size="sm" variant="secondary" onClick={() => void navigator.clipboard.writeText(fresh).then(() => toast("Copied", "success"))}><Copy aria-hidden="true" /> Copy</Button>
            </div>
          </Alert>
        ) : null}
        {links?.length ? (
          <ul className="space-y-2">
            {links.map((l) => (
              <li key={l.id} className="flex flex-wrap items-start justify-between gap-2 rounded-[var(--radius-control)] border border-app-border p-3 text-small">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-app-text">
                    <Badge tone={LINK_TONE[l.status]} dot>{LINK_LABEL[l.status]}</Badge>
                    {l.decision ? <span className="font-medium">{l.decision === "approved" ? "Approved" : "Asked for changes"}{l.decidedBy ? ` by ${l.decidedBy}` : ""}</span> : null}
                  </p>
                  <p className="text-caption text-app-subtle">Made {dt.format(new Date(l.createdAt))} · valid until {dt.format(new Date(l.expiresAt))}</p>
                  {l.decisionNote ? <p className="mt-1 break-words text-app-muted">“{l.decisionNote}”</p> : null}
                </div>
                {canManage && l.status === "active" ? <Button size="sm" variant="ghost" onClick={() => void revoke(l.id)}>Cancel link</Button> : null}
              </li>
            ))}
          </ul>
        ) : null}
      </CardBody>
    </Card>
  );
}

/** Turns the approved WhatsApp text into a DRAFT template. It is never submitted to Meta or sent from here. */
function WhatsAppHandoff({ base }: { base: string }) {
  const toast = useToast();
  const [busy, setBusy] = React.useState(false);
  const [made, setMade] = React.useState<{ id: string; name: string }[]>([]);
  async function go() {
    setBusy(true);
    const r = await apiFetch<{ id: string; name: string }>(`${base}/handoff/whatsapp`, { method: "POST", body: {} });
    setBusy(false);
    if (!r.ok) return toast(r.error, "error");
    setMade((m) => [r.data, ...m]);
    toast("Draft template created. Review and submit it in WhatsApp → Templates.", "success");
  }
  return (
    <Card>
      <CardHeader title="WhatsApp" description="Creates a draft message template from the approved WhatsApp text. Nothing is submitted to Meta or sent to anyone from here." />
      <CardBody className="space-y-3">
        <Button variant="secondary" loading={busy} onClick={() => void go()}><MessageCircle aria-hidden="true" /> Create WhatsApp draft</Button>
        {made.map((m) => (
          <p key={m.id} className="text-small text-app-muted">
            Draft <span className="font-medium text-app-text">{m.name}</span> created. <Link href={`/templates/${m.id}`} className="text-app-primary hover:underline">Open it <ExternalLink className="inline size-3.5" aria-hidden="true" /></Link>
          </p>
        ))}
      </CardBody>
    </Card>
  );
}

type Pitch = { id: string; contact: string; outlet: string; status: string; error: string; sentAt: string | null; openedAt: string | null; openCount: number; coverageUrl: string; coverageNote: string };

/** Export the press release and email it (with the pitch) to chosen journalists. */
function PressDesk({ base, orgBase, canSend, approved }: { base: string; orgBase: string; canSend: boolean; approved: boolean }) {
  const toast = useToast();
  const [contacts, setContacts] = React.useState<ContactDto[] | null>(null);
  const [pitches, setPitches] = React.useState<Pitch[]>([]);
  const [picked, setPicked] = React.useState<Set<string>>(new Set());
  const [confirm, setConfirm] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [cov, setCov] = React.useState<Record<string, string>>({});
  const load = React.useCallback(async () => {
    const [c, p] = await Promise.all([apiFetch<{ contacts: ContactDto[] }>(`${orgBase}/pr/contacts`), apiFetch<{ pitches: Pitch[] }>(`${base}/pitches`)]);
    if (c.ok) setContacts(c.data.contacts);
    if (p.ok) setPitches(p.data.pitches);
  }, [base, orgBase]);
  React.useEffect(() => {
    const id = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(id);
  }, [load]);
  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  async function send() {
    setConfirm(false);
    setBusy(true);
    const r = await apiFetch<{ sent: number; failed: number; skipped: { name: string; reason: string }[] }>(`${base}/pitches`, { method: "POST", body: { contactIds: [...picked] } });
    setBusy(false);
    if (!r.ok) return toast(r.error, "error");
    toast(`${r.data.sent} sent${r.data.failed ? `, ${r.data.failed} failed` : ""}${r.data.skipped.length ? `, ${r.data.skipped.length} skipped` : ""}`, r.data.failed ? "error" : "success");
    setPicked(new Set());
    void load();
  }
  async function saveCoverage(p: Pitch) {
    const r = await apiFetch(`${base}/pitches/${p.id}`, { method: "PATCH", body: { coverageUrl: cov[p.id] ?? p.coverageUrl, coverageNote: p.coverageNote } });
    if (!r.ok) return toast(r.error, "error");
    toast("Saved", "success");
    void load();
  }
  const sendable = (contacts ?? []).filter((c) => !c.optedOut);
  return (
    <Card>
      <CardHeader title="Press release and journalists" description="Download the press release, or email it with your pitch to journalists you choose. Only approved posts can be emailed." />
      <CardBody className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <a className="inline-flex" href={`${base}/press/export?format=pdf`}><Button variant="secondary" type="button" tabIndex={-1}><FileDown aria-hidden="true" /> PDF</Button></a>
          <a className="inline-flex" href={`${base}/press/export?format=docx`}><Button variant="secondary" type="button" tabIndex={-1}><FileDown aria-hidden="true" /> Word</Button></a>
        </div>
        <p className="text-caption text-app-subtle">PDF supports English text only. For Hindi or Punjabi, use the Word file.</p>

        {!approved ? <Alert tone="info">Emailing opens once the post is approved.</Alert> : !contacts ? <LoadingState label="Loading contacts…" /> : !sendable.length ? (
          <p className="text-small text-app-muted">No media contacts yet. Add journalists in the PR tab of OnePost.</p>
        ) : canSend ? (
          <div className="space-y-2">
            <p className="text-small font-medium text-app-text">Send to</p>
            <ul className="max-h-56 space-y-1 overflow-auto rounded-[var(--radius-control)] border border-app-border p-2">
              {sendable.map((c) => (
                <li key={c.id}>
                  <label className="flex cursor-pointer items-center gap-2 py-1 text-small text-app-text">
                    <input type="checkbox" className="size-4 accent-[var(--color-app-primary)]" checked={picked.has(c.id)} onChange={() => toggle(c.id)} disabled={picked.size >= 25 && !picked.has(c.id)} />
                    <span>{c.name}</span><span className="text-app-muted">{c.outlet ? `· ${c.outlet}` : ""} · {c.email}</span>
                  </label>
                </li>
              ))}
            </ul>
            <Button disabled={!picked.size} loading={busy} onClick={() => setConfirm(true)}><Mail aria-hidden="true" /> Email {picked.size || ""} journalist{picked.size === 1 ? "" : "s"}</Button>
          </div>
        ) : null}

        {pitches.length ? (
          <div>
            <h3 className="mb-2 text-small font-semibold text-app-text">Sent</h3>
            <ul className="space-y-2">
              {pitches.map((p) => (
                <li key={p.id} className="rounded-[var(--radius-control)] border border-app-border p-3 text-small">
                  <p className="flex flex-wrap items-center gap-2 font-medium text-app-text">
                    {p.contact}{p.outlet ? <span className="font-normal text-app-muted">· {p.outlet}</span> : null}
                    <Badge tone={p.status === "sent" ? "success" : "danger"} dot>{p.status === "sent" ? "Sent" : "Failed"}</Badge>
                    {p.openedAt ? <Badge tone="info">Opened {p.openCount}×</Badge> : null}
                  </p>
                  {p.error ? <p className="mt-1 text-caption text-amber-200">{p.error}</p> : null}
                  {p.status === "sent" && canSend ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Input aria-label={`Link to the story by ${p.contact}`} placeholder="Link to the published story (https://…)" value={cov[p.id] ?? p.coverageUrl} onChange={(e) => setCov({ ...cov, [p.id]: e.target.value })} className="min-w-0 flex-1" />
                      <Button size="sm" variant="secondary" onClick={() => void saveCoverage(p)}>Save</Button>
                    </div>
                  ) : p.coverageUrl ? <a href={p.coverageUrl} target="_blank" rel="noopener noreferrer" className="text-app-primary hover:underline">Story</a> : null}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-caption text-app-subtle">“Opened” is a rough signal: some email apps block it, others load it automatically.</p>
          </div>
        ) : null}
      </CardBody>
      <ConfirmationDialog open={confirm} onClose={() => setConfirm(false)} onConfirm={() => void send()} tone="primary" title={`Email ${picked.size} journalist${picked.size === 1 ? "" : "s"}?`} description="Each person gets one email with your pitch and the press release, and an unsubscribe link. Contacts who unsubscribed or already received this release are skipped." confirmLabel="Send emails" loading={busy} />
    </Card>
  );
}

/** Extra cards under a post: client review link, WhatsApp draft, press desk. Each shows only when it applies. */
export function PostExtras({ orgId, post }: { orgId: string; post: PostDetail }) {
  const orgBase = `/api/organizations/${orgId}/onepost`;
  const base = `${orgBase}/posts/${post.id}`;
  const has = (c: string) => post.versions.some((v) => v.channel === c);
  const approved = PUBLISHABLE.includes(post.status);
  return (
    <>
      {post.status === "in_review" && post.versions.length ? <ClientReview base={base} canManage={post.can.publish} /> : null}
      {approved && has("whatsapp") && post.can.publish ? <WhatsAppHandoff base={base} /> : null}
      {has("press_release") ? <PressDesk base={base} orgBase={orgBase} canSend={post.can.publish} approved={approved && has("pitch_email")} /> : null}
    </>
  );
}
