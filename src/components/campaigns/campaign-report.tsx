"use client";

import * as React from "react";
import Link from "next/link";
import { AlertTriangle, BookOpenCheck, CheckCheck, FlaskConical, Info, MessageSquareReply, Pause, Play, Send, ShieldAlert, ShieldCheck, UserX, XCircle } from "lucide-react";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmationDialog,
  Field,
  Input,
  LoadingState,
  PageHeader,
  Pagination,
  Select,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  useToast,
} from "@/components/ds";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/client-api";
import { formatNumber } from "@/lib/catalog";
import { useRealtime } from "@/components/inbox/use-realtime";
import { ComplianceView } from "@/components/campaigns/campaign-wizard";
import { CAMPAIGN_STATUS, istFmt, pct, type CampaignStats, type CampaignView } from "@/components/campaigns/types";

type Signal = { level: "ok" | "info" | "warn" | "danger"; title: string; detail: string };
type Recipient = { id: string; contactId: string | null; name: string; phone: string; status: string; error: string; sentAt: string | null; deliveredAt: string | null; readAt: string | null; repliedAt: string | null; optedOutAt: string | null };
type Analytics = {
  stats: CampaignStats;
  rates: { delivered: number; read: number; failed: number; replies: number; optOuts: number };
  signals: Signal[];
  errors: { error: string; count: number }[];
  recipients: Recipient[];
  recipientTotal: number;
  page: number;
  pageSize: number;
};

const SIGNAL_STYLE: Record<Signal["level"], { icon: React.ElementType; cls: string; label: string }> = {
  ok: { icon: ShieldCheck, cls: "text-emerald-400", label: "Good" },
  info: { icon: Info, cls: "text-sky-400", label: "Info" },
  warn: { icon: AlertTriangle, cls: "text-amber-400", label: "Warning" },
  danger: { icon: ShieldAlert, cls: "text-red-400", label: "Problem" },
};

const RECIPIENT_STATUS: Record<string, string> = { queued: "Queued", sending: "Sending", sent: "Sent", delivered: "Delivered", read: "Read", failed: "Failed", skipped: "Skipped" };

export function CampaignReport({ orgId, campaign, canManage }: { orgId: string; campaign: CampaignView; canManage: boolean }) {
  const toast = useToast();
  const [c, setC] = React.useState(campaign);
  const [a, setA] = React.useState<Analytics | null>(null);
  const [filter, setFilter] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [cancelOpen, setCancelOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const base = `/api/organizations/${orgId}/campaigns/${c.id}`;

  const load = React.useCallback(async () => {
    const [cr, ar] = await Promise.all([
      apiFetch<{ campaign: CampaignView }>(base),
      apiFetch<Analytics>(`${base}/analytics?${new URLSearchParams({ status: filter, page: String(page) })}`),
    ]);
    if (cr.ok) setC(cr.data.campaign);
    if (ar.ok) setA(ar.data);
  }, [base, filter, page]);
  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch + filter changes
    void load();
  }, [load]);

  // Live progress over SSE, coalesced to one refetch per 1.5 s.
  const timer = React.useRef<number | null>(null);
  const live = useRealtime(
    orgId,
    (e) => {
      if (e.type !== "campaign.updated" || e.campaignId !== c.id || timer.current) return;
      timer.current = window.setTimeout(() => {
        timer.current = null;
        void load();
      }, 1500);
    },
    load
  );

  async function act(action: "pause" | "resume" | "cancel") {
    setBusy(true);
    const r = await apiFetch<{ campaign: CampaignView }>(`${base}/actions`, { method: "POST", body: { action } });
    setBusy(false);
    setCancelOpen(false);
    if (!r.ok) return toast(r.error, "error");
    setC(r.data.campaign);
    toast(action === "pause" ? "Campaign paused" : action === "resume" ? "Campaign resumed" : "Campaign cancelled");
    void load();
  }

  const s = a?.stats ?? c.stats;
  const st = CAMPAIGN_STATUS[c.status] ?? { label: c.status, tone: "neutral" as const };
  const done = s.sent + s.failed + s.skipped;
  const progress = c.totalRecipients ? Math.min(100, Math.round((done / c.totalRecipients) * 100)) : 0;

  const cards = [
    { label: "Sent", value: s.sent, hint: `of ${formatNumber(c.totalRecipients)} recipients`, icon: Send },
    { label: "Delivered", value: s.delivered, hint: pct(s.delivered, s.sent), icon: CheckCheck },
    { label: "Read", value: s.read, hint: pct(s.read, s.sent), icon: BookOpenCheck },
    { label: "Failed", value: s.failed, hint: pct(s.failed, s.sent + s.failed), icon: XCircle },
    { label: "Replies", value: s.replies, hint: pct(s.replies, s.delivered), icon: MessageSquareReply },
    { label: "Opt-outs", value: s.optOuts, hint: pct(s.optOuts, s.delivered), icon: UserX },
  ];

  return (
    <>
      <PageHeader
        title={c.name}
        breadcrumb={[{ label: "Campaigns", href: "/campaigns" }, { label: c.name }]}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={st.tone} dot>{st.label}</Badge>
            {c.isDemo ? <Badge tone="warning">Demo</Badge> : null}
            {c.template ? <span className="font-mono">{c.template.name}</span> : null}
            {c.account ? <span>· {c.account.displayName}</span> : null}
            <span className="inline-flex items-center gap-1 text-caption">
              <span className={cn("size-1.5 rounded-full", live ? "bg-emerald-400" : "bg-app-subtle")} aria-hidden="true" /> {live ? "Live" : "Offline"}
            </span>
          </span>
        }
        actions={
          canManage ? (
            <>
              {c.status === "sending" || c.status === "scheduled" ? (
                <Button variant="secondary" onClick={() => act("pause")} loading={busy}>
                  <Pause aria-hidden="true" /> Pause
                </Button>
              ) : null}
              {c.status === "paused" ? (
                <Button onClick={() => act("resume")} loading={busy}>
                  <Play aria-hidden="true" /> Resume
                </Button>
              ) : null}
              {["scheduled", "sending", "paused"].includes(c.status) ? (
                <Button variant="danger" onClick={() => setCancelOpen(true)} disabled={busy}>
                  Cancel
                </Button>
              ) : null}
            </>
          ) : null
        }
      />

      {c.statusReason && (c.status === "paused" || c.status === "failed") ? <Alert tone="warning" className="mb-4">{c.statusReason}</Alert> : null}
      {c.status === "scheduled" && c.scheduledAt ? <Alert tone="info" className="mb-4">Scheduled for {istFmt.format(new Date(c.scheduledAt))} IST · {formatNumber(c.totalRecipients)} recipients. Consent is re-checked for each contact when it sends.</Alert> : null}

      {c.status === "sending" || (c.status === "paused" && done < c.totalRecipients) ? (
        <Card className="mb-4">
          <CardBody>
            <div className="mb-2 flex justify-between text-small">
              <span className="text-app-muted">Sending progress</span>
              <span className="tabular-nums text-app-text">{formatNumber(done)} / {formatNumber(c.totalRecipients)}</span>
            </div>
            <div className="h-2 rounded-full bg-app-elevated" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} aria-label="Sending progress">
              <div className="h-full rounded-full bg-app-primary transition-all" style={{ width: `${progress}%` }} />
            </div>
          </CardBody>
        </Card>
      ) : null}

      <section aria-label="Campaign results" className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {cards.map((k) => (
          <Card key={k.label} className="p-4">
            <p className="flex items-center gap-1.5 text-small text-app-muted">
              <k.icon className="size-4" aria-hidden="true" /> {k.label}
            </p>
            <p className="mt-1 text-h2 tabular-nums text-app-text">{formatNumber(k.value)}</p>
            <p className="text-caption text-app-subtle">{k.hint}</p>
          </Card>
        ))}
      </section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-4">
          <Card>
            <CardHeader
              title="Recipients"
              action={
                <Select aria-label="Filter recipients" value={filter} onChange={(e) => { setFilter(e.target.value); setPage(1); }} className="h-9 w-44 text-small">
                  <option value="">Everyone</option>
                  {["queued", "sent", "delivered", "read", "failed", "skipped"].map((x) => (
                    <option key={x} value={x}>{RECIPIENT_STATUS[x]}</option>
                  ))}
                  <option value="replied">Replied</option>
                  <option value="opted_out">Opted out</option>
                </Select>
              }
            />
            {!a ? (
              <LoadingState />
            ) : !a.recipients.length ? (
              <p className="px-5 py-6 text-small text-app-muted">No recipients in this view.</p>
            ) : (
              <>
                <Table caption="Campaign recipients" className="min-w-[640px]">
                  <THead>
                    <tr>
                      <TH>Contact</TH>
                      <TH>Status</TH>
                      <TH>Engagement</TH>
                      <TH>Sent</TH>
                    </tr>
                  </THead>
                  <TBody>
                    {a.recipients.map((r) => (
                      <TR key={r.id}>
                        <TD>
                          {r.contactId ? <Link href={`/contacts/${r.contactId}`} className="hover:text-app-primary-hover">{r.name || "Unnamed"}</Link> : r.name || "Deleted contact"}
                          <p className="font-mono text-caption text-app-subtle">{r.phone}</p>
                        </TD>
                        <TD>
                          <Badge tone={r.status === "failed" ? "danger" : r.status === "read" ? "success" : r.status === "skipped" ? "neutral" : "info"}>{RECIPIENT_STATUS[r.status] ?? r.status}</Badge>
                          {r.error ? <p className="mt-0.5 max-w-[16rem] truncate text-caption text-red-300" title={r.error}>{r.error}</p> : null}
                        </TD>
                        <TD className="space-x-1">
                          {r.repliedAt ? <Badge tone="primary">Replied</Badge> : null}
                          {r.optedOutAt ? <Badge tone="danger">Opted out</Badge> : null}
                          {!r.repliedAt && !r.optedOutAt ? <span className="text-app-subtle">—</span> : null}
                        </TD>
                        <TD className="whitespace-nowrap text-small text-app-muted">{r.sentAt ? istFmt.format(new Date(r.sentAt)) : "—"}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
                <Pagination page={a.page} pageSize={a.pageSize} total={a.recipientTotal} onPageChange={setPage} />
              </>
            )}
          </Card>
          {c.review ? (
            <Card>
              <CardHeader title="Compliance review at launch" description="What was checked and removed before this campaign was sent." />
              <CardBody>
                <ComplianceView review={c.review} />
              </CardBody>
            </Card>
          ) : null}
        </div>

        <aside className="min-w-0 space-y-4">
          <Card>
            <CardHeader title="Quality signals" />
            <CardBody>
              {!a ? (
                <LoadingState />
              ) : (
                <ul className="space-y-3">
                  {a.signals.map((sg) => {
                    const S = SIGNAL_STYLE[sg.level];
                    return (
                      <li key={sg.title} className="flex gap-2.5">
                        <S.icon className={cn("mt-0.5 size-4 shrink-0", S.cls)} aria-hidden="true" />
                        <div>
                          <p className="text-small font-medium text-app-text">
                            <span className="sr-only">{S.label}: </span>
                            {sg.title}
                          </p>
                          <p className="text-caption text-app-muted">{sg.detail}</p>
                        </div>
                      </li>
                    );
                  })}
                  {!a.signals.length ? <li className="text-small text-app-muted">No signals yet — they appear as results come in.</li> : null}
                </ul>
              )}
            </CardBody>
          </Card>
          {a?.errors.length ? (
            <Card>
              <CardHeader title="Failure reasons" />
              <ul className="divide-y divide-app-border">
                {a.errors.map((e) => (
                  <li key={e.error} className="flex justify-between gap-3 px-5 py-2.5 text-small">
                    <span className="min-w-0 text-app-muted">{e.error}</span>
                    <span className="tabular-nums text-app-text">{formatNumber(e.count)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
          {c.isDemo && canManage && c.status !== "scheduled" ? <DemoSimulator orgId={orgId} campaignId={c.id} onDone={load} stats={s} /> : null}
        </aside>
      </div>

      <ConfirmationDialog
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        onConfirm={() => act("cancel")}
        loading={busy}
        title="Cancel this campaign?"
        description="Messages not yet sent are dropped. Messages already sent can't be recalled."
        confirmLabel="Cancel campaign"
      />
    </>
  );
}

function DemoSimulator({ orgId, campaignId, onDone, stats }: { orgId: string; campaignId: string; onDone: () => void; stats: CampaignStats }) {
  const toast = useToast();
  const [n, setN] = React.useState({ delivered: 0, read: 0, failed: 0, replies: 0, optOuts: 0 });
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    // Sensible defaults once messages are sent: most delivered, about half read, a couple of replies, one opt-out.
    if (stats.sent && !n.delivered && !n.read) {
      const delivered = Math.max(stats.sent - stats.delivered - Math.ceil(stats.sent * 0.05), 0);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time defaults from loaded stats
      setN({ delivered, read: Math.ceil(stats.sent / 2), failed: stats.sent >= 5 ? 1 : 0, replies: Math.max(1, Math.floor(stats.sent * 0.3)), optOuts: stats.sent > 2 ? 1 : 0 });
    }
  }, [stats.sent, stats.delivered, n.delivered, n.read]);
  async function run() {
    setBusy(true);
    const r = await apiFetch<{ applied: typeof n }>(`/api/organizations/${orgId}/campaigns/${campaignId}/demo`, { method: "POST", body: n });
    setBusy(false);
    if (!r.ok) return toast(r.error, "error");
    const x = r.data.applied;
    toast(`Simulated: ${x.delivered} delivered, ${x.read} read, ${x.failed} failed, ${x.replies} replies, ${x.optOuts} opt-outs`);
    onDone();
  }
  const fields: [keyof typeof n, string][] = [["delivered", "Delivered"], ["read", "Read"], ["failed", "Failed"], ["replies", "Replies"], ["optOuts", "Opt-outs (STOP)"]];
  return (
    <Card>
      <CardHeader title={<span className="flex items-center gap-2"><FlaskConical className="size-4" aria-hidden="true" /> Demo simulator</span>} description="Feeds fake receipts and customer replies through the same code a live Meta webhook uses. Demo campaigns only." />
      <CardBody className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          {fields.map(([k, label]) => (
            <Field key={k} id={`sim-${k}`} label={label}>
              <Input type="number" min={0} max={10000} value={n[k]} onChange={(e) => setN((x) => ({ ...x, [k]: Math.max(0, Number(e.target.value) || 0) }))} />
            </Field>
          ))}
        </div>
        <Button onClick={run} loading={busy} className="w-full" disabled={!stats.sent}>
          Simulate outcomes
        </Button>
        {!stats.sent ? <p className="text-caption text-app-subtle">Available once messages are sent.</p> : null}
      </CardBody>
    </Card>
  );
}
