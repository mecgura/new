"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, BadgeCheck, FileText, Gauge, Info, RefreshCw, ScrollText, ShieldAlert, ShieldCheck, Smartphone, UserCheck, UserX, XCircle } from "lucide-react";
import { Alert, Badge, Button, Card, CardBody, CardHeader, PageHeader, Table, TBody, TD, TH, THead, TR, useToast, type BadgeTone } from "@/components/ds";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/client-api";
import { formatNumber, QUALITY_LABELS } from "@/lib/catalog";
import { STATUS_LABELS, type TemplateStatus } from "@/lib/templates";
import { STATUS_TONE } from "@/components/templates/types";
import { istFmt } from "@/components/campaigns/types";

export type QualityData = {
  numbers: {
    id: string;
    displayName: string;
    phoneNumber: string;
    status: string;
    isDemo: boolean;
    verifiedName: string;
    nameStatus: string;
    numberStatus: string;
    quality: string;
    messagingLimitTier: string;
    lastQualityEvent: string;
    lastSyncedAt: string | null;
    accountStatus: string;
    lastAccountEvent: string;
    lastAccountEventAt: string | null;
    connection: { status: string; method: string; webhook: string | null } | null;
  }[];
  consent: { total: number; optedIn: number; optedOut: number; unknown: number; suppressed: number; coverage: number };
  rates: { optOuts30: number; reached30: number; optOutRate: number; outbound30: number; failed30: number; failureRate: number };
  templates: { counts: Record<string, number>; total: number; attention: { id: string; name: string; language: string; status: string; qualityScore: string; reason: string }[] };
  alerts: { level: "ok" | "info" | "warn" | "danger"; title: string; detail: string; link?: string }[];
  logs: { id: string; action: string; label: string; actor: string; targetType: string; metadata: Record<string, unknown>; createdAt: string }[];
};

const QUALITY_TONE: Record<string, BadgeTone> = { GREEN: "success", YELLOW: "warning", RED: "danger", UNKNOWN: "neutral" };
const ALERT_STYLE = {
  danger: { icon: ShieldAlert, cls: "text-red-400", label: "Problem" },
  warn: { icon: AlertTriangle, cls: "text-amber-400", label: "Warning" },
  info: { icon: Info, cls: "text-sky-400", label: "Info" },
  ok: { icon: ShieldCheck, cls: "text-emerald-400", label: "Good" },
} as const;

function rateTone(v: number, warn: number, danger: number) {
  return v >= danger ? "text-red-300" : v >= warn ? "text-amber-300" : "text-emerald-300";
}

function Metric({ icon: Icon, label, value, hint, cls }: { icon: React.ElementType; label: string; value: string; hint: string; cls?: string }) {
  return (
    <Card className="p-4">
      <p className="flex items-center gap-1.5 text-small text-app-muted">
        <Icon className="size-4" aria-hidden="true" /> {label}
      </p>
      <p className={cn("mt-1 text-h2 tabular-nums text-app-text", cls)}>{value}</p>
      <p className="text-caption text-app-subtle">{hint}</p>
    </Card>
  );
}

function summarize(meta: Record<string, unknown>) {
  const pick = ["name", "from", "to", "reason", "event", "eligible", "removed", "recipients", "created", "updated", "category"];
  return pick
    .filter((k) => meta[k] !== undefined && meta[k] !== "")
    .map((k) => `${k}: ${String(meta[k])}`)
    .join(" · ")
    .slice(0, 140);
}

export function QualityCenter({ orgId, data, canRefresh }: { orgId: string; data: QualityData; canRefresh: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = React.useState(false);
  const orgLive = data.numbers.some((n) => !n.isDemo && n.status === "connected");
  const worst = data.alerts.some((a) => a.level === "danger") ? "danger" : data.alerts.some((a) => a.level === "warn") ? "warn" : "ok";

  async function refresh() {
    setBusy(true);
    const r = await apiFetch<{ refreshed: number; errors: string[] }>(`/api/organizations/${orgId}/quality/refresh`, { method: "POST" });
    setBusy(false);
    if (!r.ok) return toast(r.error, "error");
    r.data.errors.forEach((e) => toast(e, "error"));
    toast(`Refreshed ${r.data.refreshed} number(s) from Meta`);
    router.refresh();
  }

  return (
    <>
      <PageHeader
        title="Quality Center"
        description="Your WhatsApp health at a glance — so campaigns stay compliant and your numbers keep their limits."
        breadcrumb={[{ label: "WhatsApp", href: "/dashboard/whatsapp" }, { label: "Quality Center" }]}
        actions={
          canRefresh && orgLive ? (
            <Button variant="secondary" onClick={refresh} loading={busy}>
              <RefreshCw aria-hidden="true" /> Refresh from Meta
            </Button>
          ) : null
        }
      />

      <Alert tone={worst === "danger" ? "danger" : worst === "warn" ? "warning" : "success"} className="mb-4" title={worst === "danger" ? "Action needed" : worst === "warn" ? "Keep an eye on these" : "All clear"}>
        {worst === "ok" ? "No quality problems detected. Keep messaging opted-in customers with relevant content." : `${data.alerts.filter((a) => a.level === "danger" || a.level === "warn").length} alert(s) below.`}
        {" "}This page helps you follow WhatsApp&apos;s rules — it never bypasses limits or restrictions.
      </Alert>

      <section aria-label="Key rates" className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric icon={UserCheck} label="Opt-in coverage" value={`${data.consent.coverage}%`} hint={`${formatNumber(data.consent.optedIn)} of ${formatNumber(data.consent.total)} contacts`} cls={rateTone(100 - data.consent.coverage, 50, 80)} />
        <Metric icon={UserX} label="Opt-out rate (30 d)" value={`${data.rates.optOutRate}%`} hint={`${formatNumber(data.rates.optOuts30)} opt-outs · ${formatNumber(data.rates.reached30)} chats messaged`} cls={rateTone(data.rates.optOutRate, 2, 5)} />
        <Metric icon={XCircle} label="Failure rate (30 d)" value={`${data.rates.failureRate}%`} hint={`${formatNumber(data.rates.failed30)} of ${formatNumber(data.rates.outbound30)} messages`} cls={rateTone(data.rates.failureRate, 10, 25)} />
        <Metric icon={FileText} label="Templates approved" value={`${data.templates.counts.approved ?? 0}`} hint={`${data.templates.total} total · ${(data.templates.counts.rejected ?? 0) + (data.templates.counts.paused ?? 0) + (data.templates.counts.disabled ?? 0)} need attention`} />
      </section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="min-w-0 space-y-4">
          <Card>
            <CardHeader title="Account status & messaging quality" description="Quality rating and messaging limit are reported by Meta for each number." />
            {!data.numbers.length ? (
              <p className="px-5 py-6 text-small text-app-muted">No numbers yet. <Link href="/whatsapp/connect" className="underline">Connect one</Link>.</p>
            ) : (
              <Table caption="WhatsApp numbers" className="min-w-[720px]">
                <THead>
                  <tr>
                    <TH>Number</TH>
                    <TH>Account status</TH>
                    <TH>Messaging quality</TH>
                    <TH>Messaging limit</TH>
                    <TH>Display name</TH>
                  </tr>
                </THead>
                <TBody>
                  {data.numbers.map((n) => (
                    <TR key={n.id}>
                      <TD>
                        <Link href={`/whatsapp/accounts/${n.id}`} className="font-medium hover:text-app-primary-hover">{n.displayName}</Link>
                        <p className="font-mono text-caption text-app-subtle">{n.phoneNumber}</p>
                      </TD>
                      <TD>
                        <span className="flex flex-wrap gap-1">
                          <Badge tone={n.status === "connected" ? "success" : n.status === "demo" ? "warning" : "neutral"} dot>{n.status === "demo" ? "Demo" : n.status === "connected" ? "Connected" : n.status}</Badge>
                          {n.lastAccountEvent ? <Badge tone="danger">{n.lastAccountEvent}</Badge> : null}
                        </span>
                        {n.connection?.webhook ? <p className="mt-0.5 text-caption text-app-subtle">Webhook: {n.connection.webhook}</p> : null}
                      </TD>
                      <TD>
                        {n.isDemo ? (
                          <span className="text-small text-app-subtle">Not rated (demo)</span>
                        ) : (
                          <>
                            <Badge tone={QUALITY_TONE[n.quality] ?? "neutral"} dot>{QUALITY_LABELS[n.quality] ?? n.quality}</Badge>
                            {n.lastQualityEvent ? <p className="mt-0.5 text-caption text-app-subtle">Last event: {n.lastQualityEvent}</p> : null}
                          </>
                        )}
                      </TD>
                      <TD className="text-small">{n.messagingLimitTier ? n.messagingLimitTier.replace("TIER_", "") + " / 24 h" : <span className="text-app-subtle">—</span>}</TD>
                      <TD className="text-small">
                        {n.verifiedName || "—"}
                        {n.nameStatus ? <p className="text-caption text-app-subtle">{n.nameStatus.toLowerCase().replace(/_/g, " ")}</p> : null}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
            <CardBody className="border-t border-app-border text-caption text-app-subtle">
              {data.numbers.some((n) => n.lastSyncedAt && !n.isDemo)
                ? `Last synced from Meta: ${istFmt.format(new Date(data.numbers.filter((n) => n.lastSyncedAt && !n.isDemo).map((n) => n.lastSyncedAt!).sort().at(-1)!))} IST. Meta also pushes quality changes by webhook.`
                : "Quality data appears once a live number is connected. Demo numbers are never rated by Meta."}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Opt-in coverage" description="Campaigns only reach opted-in, non-suppressed contacts." />
            <CardBody className="space-y-3">
              <div className="flex h-3 overflow-hidden rounded-full bg-app-elevated" role="img" aria-label={`Opted in ${data.consent.optedIn}, unknown ${data.consent.unknown}, opted out ${data.consent.optedOut}`}>
                {[
                  { v: data.consent.optedIn, cls: "bg-emerald-500" },
                  { v: data.consent.unknown, cls: "bg-app-border-strong" },
                  { v: data.consent.optedOut, cls: "bg-red-500" },
                ].map((x, i) => (
                  <div key={i} className={x.cls} style={{ width: `${data.consent.total ? (x.v / data.consent.total) * 100 : 0}%` }} />
                ))}
              </div>
              <dl className="grid grid-cols-2 gap-2 text-small sm:grid-cols-4">
                <div><dt className="text-app-muted"><span className="mr-1.5 inline-block size-2 rounded-full bg-emerald-500" aria-hidden="true" />Opted in</dt><dd className="tabular-nums">{formatNumber(data.consent.optedIn)}</dd></div>
                <div><dt className="text-app-muted"><span className="mr-1.5 inline-block size-2 rounded-full bg-app-border-strong" aria-hidden="true" />No consent</dt><dd className="tabular-nums">{formatNumber(data.consent.unknown)}</dd></div>
                <div><dt className="text-app-muted"><span className="mr-1.5 inline-block size-2 rounded-full bg-red-500" aria-hidden="true" />Opted out</dt><dd className="tabular-nums">{formatNumber(data.consent.optedOut)}</dd></div>
                <div><dt className="text-app-muted">Suppressed</dt><dd className="tabular-nums">{formatNumber(data.consent.suppressed)}</dd></div>
              </dl>
              <p className="text-caption text-app-subtle">Every consent change is kept in each contact&apos;s consent history. Customers who send STOP are opted out automatically.</p>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Template status" action={<Link href="/templates" className="text-small text-app-primary hover:text-app-primary-hover">All templates</Link>} />
            <CardBody className="space-y-3">
              <div className="flex flex-wrap gap-2">
                {(["approved", "pending", "draft", "rejected", "paused", "disabled"] as TemplateStatus[]).map((s) => (
                  <Badge key={s} tone={STATUS_TONE[s]}>{STATUS_LABELS[s]}: {data.templates.counts[s] ?? 0}</Badge>
                ))}
              </div>
              {data.templates.attention.length ? (
                <ul className="divide-y divide-app-border rounded-xl border border-app-border">
                  {data.templates.attention.map((t) => (
                    <li key={t.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                      <Link href={`/templates/${t.id}`} className="font-mono text-small hover:text-app-primary-hover">{t.name}</Link>
                      <Badge tone={STATUS_TONE[t.status]}>{STATUS_LABELS[t.status as TemplateStatus] ?? t.status}</Badge>
                      {t.qualityScore === "RED" || t.qualityScore === "YELLOW" ? <Badge tone={QUALITY_TONE[t.qualityScore]}>Quality {QUALITY_LABELS[t.qualityScore]}</Badge> : null}
                      {t.reason ? <span className="w-full text-caption text-app-muted">{t.reason}</span> : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-small text-app-muted">No rejected, paused or low-quality templates.</p>
              )}
            </CardBody>
          </Card>
        </div>

        <aside className="min-w-0 space-y-4">
          <Card>
            <CardHeader title="Campaign & account alerts" />
            <CardBody>
              {!data.alerts.length ? (
                <p className="flex items-center gap-2 text-small text-app-muted"><BadgeCheck className="size-4 text-emerald-400" aria-hidden="true" /> No alerts.</p>
              ) : (
                <ul className="space-y-3">
                  {data.alerts.map((a, i) => {
                    const S = ALERT_STYLE[a.level];
                    return (
                      <li key={`${a.title}-${i}`} className="flex gap-2.5">
                        <S.icon className={cn("mt-0.5 size-4 shrink-0", S.cls)} aria-hidden="true" />
                        <div className="min-w-0">
                          <p className="text-small font-medium text-app-text">
                            <span className="sr-only">{S.label}: </span>
                            {a.link ? <Link href={a.link} className="hover:text-app-primary-hover">{a.title}</Link> : a.title}
                          </p>
                          <p className="text-caption text-app-muted">{a.detail}</p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title={<span className="flex items-center gap-2"><ScrollText className="size-4" aria-hidden="true" /> Audit log</span>} description="Templates, campaigns, consent and number events." />
            {!data.logs.length ? (
              <p className="px-5 pb-5 text-small text-app-muted">Nothing recorded yet.</p>
            ) : (
              <ol className="max-h-[32rem] divide-y divide-app-border overflow-y-auto">
                {data.logs.map((l) => (
                  <li key={l.id} className="px-5 py-2.5">
                    <p className="text-small text-app-text">{l.label}</p>
                    <p className="text-caption text-app-subtle">{l.actor} · {istFmt.format(new Date(l.createdAt))}</p>
                    {summarize(l.metadata) ? <p className="mt-0.5 truncate text-caption text-app-muted" title={summarize(l.metadata)}>{summarize(l.metadata)}</p> : null}
                  </li>
                ))}
              </ol>
            )}
          </Card>
          <Card>
            <CardBody className="space-y-2 text-caption text-app-muted">
              <p className="flex items-center gap-2 text-small font-medium text-app-text"><Gauge className="size-4" aria-hidden="true" /> How to keep quality high</p>
              <p>Message only people who opted in, keep marketing relevant and not too frequent, include an easy opt-out, and stop sending to anyone who blocks or says STOP.</p>
              <p className="flex items-center gap-1.5"><Smartphone className="size-3.5" aria-hidden="true" /> MECGURA uses only the official WhatsApp Cloud API.</p>
            </CardBody>
          </Card>
        </aside>
      </div>
    </>
  );
}
