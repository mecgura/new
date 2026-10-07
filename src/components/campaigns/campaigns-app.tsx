"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Filter, Megaphone, Plus, Trash2 } from "lucide-react";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  ConfirmationDialog,
  EmptyState,
  ErrorState,
  Field,
  FilterBar,
  IconButton,
  Input,
  LoadingState,
  Modal,
  PageHeader,
  SearchBar,
  Select,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Tabs,
  Textarea,
  useToast,
} from "@/components/ds";
import { apiFetch } from "@/lib/client-api";
import { formatNumber } from "@/lib/catalog";
import { useRealtime } from "@/components/inbox/use-realtime";
import { CAMPAIGN_STATUS, istFmt, pct, type CampaignView, type SegmentView } from "@/components/campaigns/types";

type Account = { id: string; displayName: string; phoneNumber: string; isDemo: boolean };

const TABS = ["all", "draft", "scheduled", "sending", "paused", "completed", "cancelled"];

export function CampaignsApp({ orgId, canManage, accounts, activeAccountId = "" }: { orgId: string; canManage: boolean; accounts: Account[]; activeAccountId?: string }) {
  const [tab, setTab] = React.useState("all");
  const [q, setQ] = React.useState("");
  const [data, setData] = React.useState<{ campaigns: CampaignView[]; counts: Record<string, number> } | null>(null);
  const [error, setError] = React.useState("");
  const [newOpen, setNewOpen] = React.useState(false);
  const qs = new URLSearchParams({ status: tab === "all" ? "" : tab, q }).toString();

  const load = React.useCallback(async () => {
    const r = await apiFetch<{ campaigns: CampaignView[]; counts: Record<string, number> }>(`/api/organizations/${orgId}/campaigns?${qs}`);
    if (!r.ok) return setError(r.error);
    setError("");
    setData(r.data);
  }, [orgId, qs]);
  React.useEffect(() => {
    const t = window.setTimeout(() => void load(), 200);
    return () => window.clearTimeout(t);
  }, [load]);

  // Progress arrives over SSE; refetch at most every 2 s while events stream in.
  const pending = React.useRef<number | null>(null);
  useRealtime(
    orgId,
    (e) => {
      if (e.type !== "campaign.updated" || pending.current) return;
      pending.current = window.setTimeout(() => {
        pending.current = null;
        void load();
      }, 2000);
    },
    load
  );

  return (
    <>
      <PageHeader
        title="Campaigns"
        description="Send approved templates to opted-in contacts — with a compliance review before every send."
        actions={
          canManage && accounts.length ? (
            <Button onClick={() => setNewOpen(true)}>
              <Plus aria-hidden="true" /> New campaign
            </Button>
          ) : null
        }
      />
      {!accounts.length ? (
        <Alert tone="info" title="Connect a WhatsApp number first" className="mb-4">
          Campaigns are sent from a connected (or demo) number. <Link href="/whatsapp/connect" className="underline">Connect a number</Link>.
        </Alert>
      ) : null}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <Card className="min-w-0">
          <Tabs label="Campaign status" items={TABS.map((t) => ({ id: t, label: `${t === "all" ? "All" : CAMPAIGN_STATUS[t].label} ${data?.counts[t] ?? ""}`.trim() }))} value={tab} onValueChange={setTab} className="px-2" />
          <FilterBar>
            <SearchBar label="Search campaigns" placeholder="Search by name…" value={q} onChange={(e) => setQ(e.target.value)} className="sm:w-72" />
          </FilterBar>
          {error ? (
            <ErrorState description={error} onRetry={load} />
          ) : !data ? (
            <LoadingState />
          ) : !data.campaigns.length ? (
            <EmptyState
              icon={Megaphone}
              title={q || tab !== "all" ? "No campaigns match" : "No campaigns yet"}
              description="Build a campaign in 7 steps: details, audience, template, variables, schedule, compliance review and send."
              action={canManage && accounts.length ? <Button onClick={() => setNewOpen(true)}>New campaign</Button> : undefined}
            />
          ) : (
            <Table caption="Campaigns" className="min-w-[860px]">
              <THead>
                <tr>
                  <TH>Campaign</TH>
                  <TH>Status</TH>
                  <TH className="text-right">Recipients</TH>
                  <TH className="text-right">Delivered</TH>
                  <TH className="text-right">Read</TH>
                  <TH className="text-right">Replies</TH>
                  <TH className="text-right">Opt-outs</TH>
                  <TH>When</TH>
                </tr>
              </THead>
              <TBody>
                {data.campaigns.map((c) => (
                  <TR key={c.id}>
                    <TD>
                      <Link href={`/campaigns/${c.id}`} className="font-medium hover:text-app-primary-hover">{c.name}</Link>
                      <p className="text-caption text-app-subtle">
                        {c.template ? <span className="font-mono">{c.template.name}</span> : "No template yet"}
                        {c.account ? ` · ${c.account.displayName}` : ""}
                      </p>
                    </TD>
                    <TD>
                      <span className="flex flex-wrap gap-1">
                        <Badge tone={CAMPAIGN_STATUS[c.status]?.tone ?? "neutral"} dot>{CAMPAIGN_STATUS[c.status]?.label ?? c.status}</Badge>
                        {c.isDemo ? <Badge tone="warning">Demo</Badge> : null}
                      </span>
                    </TD>
                    <TD className="text-right tabular-nums">{c.status === "draft" ? (c.review ? `${formatNumber(c.review.eligible)} eligible` : "—") : formatNumber(c.totalRecipients)}</TD>
                    <TD className="text-right tabular-nums">{c.stats.sent ? pct(c.stats.delivered, c.stats.sent) : "—"}</TD>
                    <TD className="text-right tabular-nums">{c.stats.sent ? pct(c.stats.read, c.stats.sent) : "—"}</TD>
                    <TD className="text-right tabular-nums">{c.stats.sent ? formatNumber(c.stats.replies) : "—"}</TD>
                    <TD className="text-right tabular-nums">{c.stats.sent ? formatNumber(c.stats.optOuts) : "—"}</TD>
                    <TD className="whitespace-nowrap text-small text-app-muted">
                      {c.status === "scheduled" && c.scheduledAt ? `Sends ${istFmt.format(new Date(c.scheduledAt))}` : c.startedAt ? `Sent ${istFmt.format(new Date(c.startedAt))}` : `Edited ${istFmt.format(new Date(c.updatedAt))}`}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
        <SegmentsCard orgId={orgId} canManage={canManage} />
      </div>
      <NewCampaignModal open={newOpen} onClose={() => setNewOpen(false)} orgId={orgId} accounts={accounts} activeAccountId={activeAccountId} />
    </>
  );
}

function SegmentsCard({ orgId, canManage }: { orgId: string; canManage: boolean }) {
  const toast = useToast();
  const [segments, setSegments] = React.useState<SegmentView[] | null>(null);
  const [del, setDel] = React.useState<SegmentView | null>(null);
  const [busy, setBusy] = React.useState(false);
  const load = React.useCallback(async () => {
    const r = await apiFetch<{ segments: SegmentView[] }>(`/api/organizations/${orgId}/segments`);
    if (r.ok) setSegments(r.data.segments);
  }, [orgId]);
  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch
    void load();
  }, [load]);
  async function remove() {
    if (!del) return;
    setBusy(true);
    const r = await apiFetch(`/api/organizations/${orgId}/segments/${del.id}`, { method: "DELETE" });
    setBusy(false);
    setDel(null);
    if (!r.ok) return toast(r.error, "error");
    toast("Segment deleted");
    void load();
  }
  return (
    <Card className="min-w-0 self-start">
      <CardHeader title="Segments" description="Saved audiences, re-evaluated every time a campaign uses them." />
      {!segments ? (
        <LoadingState />
      ) : !segments.length ? (
        <p className="px-5 pb-5 text-small text-app-muted">No segments yet. Save one from a campaign&apos;s Audience step.</p>
      ) : (
        <ul className="divide-y divide-app-border">
          {segments.map((s) => (
            <li key={s.id} className="flex items-start gap-3 px-5 py-3">
              <Filter className="mt-0.5 size-4 shrink-0 text-app-subtle" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-small font-medium text-app-text">{s.name}</p>
                <p className="text-caption text-app-subtle">{formatNumber(s.contacts)} contacts now{s.description ? ` · ${s.description}` : ""}</p>
              </div>
              {canManage ? (
                <IconButton label={`Delete segment ${s.name}`} onClick={() => setDel(s)}>
                  <Trash2 aria-hidden="true" />
                </IconButton>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <ConfirmationDialog open={Boolean(del)} onClose={() => setDel(null)} onConfirm={remove} loading={busy} title="Delete segment?" description={`“${del?.name}” will be removed. Contacts are not affected.`} confirmLabel="Delete" />
    </Card>
  );
}

function NewCampaignModal({ open, onClose, orgId, accounts, activeAccountId }: { open: boolean; onClose: () => void; orgId: string; accounts: Account[]; activeAccountId: string }) {
  const router = useRouter();
  const [f, setF] = React.useState({ name: "", description: "", whatsappAccountId: (accounts.find((a) => a.id === activeAccountId) ?? accounts[0])?.id ?? "" });
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const r = await apiFetch<{ campaign: { id: string } }>(`/api/organizations/${orgId}/campaigns`, { method: "POST", body: f });
    setBusy(false);
    if (!r.ok) return setErrors({ ...Object.fromEntries(Object.entries(r.details ?? {}).map(([k, v]) => [k, v?.[0] ?? ""])), form: r.details ? "" : r.error });
    router.push(`/campaigns/${r.data.campaign.id}`);
  }
  return (
    <Modal open={open} onClose={onClose} title="New campaign" description="Step 1 of 7 — campaign details. You can change these until you send.">
      <form onSubmit={submit} noValidate className="space-y-4">
        {errors.form ? <Alert tone="danger">{errors.form}</Alert> : null}
        <Field id="nc-name" label="Campaign name" error={errors.name}>
          <Input value={f.name} onChange={(e) => setF((x) => ({ ...x, name: e.target.value }))} placeholder="Diwali offer — VIP customers" maxLength={120} />
        </Field>
        <Field id="nc-desc" label="Internal description" hint="Only your team sees this.">
          <Textarea value={f.description} onChange={(e) => setF((x) => ({ ...x, description: e.target.value }))} rows={2} maxLength={500} />
        </Field>
        <Field id="nc-acct" label="Send from" error={errors.whatsappAccountId}>
          <Select value={f.whatsappAccountId} onChange={(e) => setF((x) => ({ ...x, whatsappAccountId: e.target.value }))}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.displayName} · {a.phoneNumber}{a.isDemo ? " (demo)" : ""}</option>
            ))}
          </Select>
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={busy} disabled={!f.name.trim()}>Continue</Button>
        </div>
      </form>
    </Modal>
  );
}
