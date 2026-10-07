"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, Check, CreditCard, FileText, Gauge, Receipt } from "lucide-react";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmationDialog,
  EmptyState,
  ErrorState,
  LoadingState,
  Modal,
  PageHeader,
  Pagination,
  Select,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  UsageMeter,
  useToast,
  type BadgeTone,
} from "@/components/ds";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/client-api";
import { formatINR, formatNumber } from "@/lib/catalog";
import { LIMIT_META, limitLabel, type PlanLimits } from "@/lib/plans";
import { istFmt } from "@/components/campaigns/types";
import { MiniBars } from "@/components/app/mini-bars";
import { openCheckout, type Checkout } from "@/components/billing/checkout";

type PlanView = { id: string; name: string; slug: string; description: string; priceMonthly: number; selfServe: boolean; limits: PlanLimits; features: { key: string; label: string }[]; relation: "current" | "upgrade" | "downgrade" | "new" | "contact" };
type InvoiceView = { id: string; number: string; kind: string; status: string; displayStatus: string; description: string; total: number; issuedAt: string; dueAt: string; paidAt: string | null; paidVia: string; lastPaymentFailure: string | null };
type Overview = {
  subscription: { plan: Omit<PlanView, "relation">; priceMonthly: number; billingMode: string; currentPeriodStart: string | null; nextBillingDate: string | null; endsAt: string | null; cancelAtPeriodEnd: boolean; pendingPlan: { id: string; name: string; takesEffectAt: string | null } | null } | null;
  canceledPlan: { name: string; endedAt: string | null } | null;
  state: "none" | "ok" | "past_due" | "blocked";
  stateMessage: string;
  paymentStatus: "not_billed" | "none" | "paid" | "pending" | "past_due" | "failed";
  openInvoices: InvoiceView[];
  plans: PlanView[];
  gateways: { id: string; label: string }[];
  onlinePaymentsConnected: boolean;
  tax: { percent: number };
  supportEmail: string;
  paymentInstructions: string;
};
type Preview = { plan: Omit<PlanView, "relation">; direction: "upgrade" | "downgrade" | "new"; amount: number; tax: number; total: number; effective: "now" | "on_payment" | "period_end"; effectiveAt: string | null; problems: string[]; blocked: boolean };

const PAYMENT: Record<Overview["paymentStatus"], { label: string; tone: BadgeTone }> = {
  not_billed: { label: "Not billed (contracted)", tone: "neutral" },
  none: { label: "No payments yet", tone: "neutral" },
  paid: { label: "Paid", tone: "success" },
  pending: { label: "Payment due", tone: "warning" },
  past_due: { label: "Overdue", tone: "danger" },
  failed: { label: "Last payment failed", tone: "danger" },
};
const INV_STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  paid: { label: "Paid", tone: "success" },
  open: { label: "Due", tone: "warning" },
  overdue: { label: "Overdue", tone: "danger" },
  payment_failed: { label: "Payment failed", tone: "danger" },
  void: { label: "Void", tone: "neutral" },
};
const TABS = [
  { id: "plan", label: "Plan", icon: CreditCard },
  { id: "usage", label: "Usage", icon: Gauge },
  { id: "invoices", label: "Invoices", icon: Receipt },
] as const;
const dateOnly = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" });
const when = (s: string | null) => (s ? dateOnly.format(new Date(s)) : "—");

export function BillingApp({ orgId, canManage, initialTab }: { orgId: string; canManage: boolean; initialTab: string }) {
  const base = `/api/organizations/${orgId}/billing`;
  const [tab, setTab] = React.useState<string>(TABS.some((t) => t.id === initialTab) ? initialTab : "plan");
  const [data, setData] = React.useState<Overview | null>(null);
  const [error, setError] = React.useState("");
  const load = React.useCallback(async () => {
    const r = await apiFetch<Overview>(base);
    if (!r.ok) return setError(r.error);
    setError("");
    setData(r.data);
  }, [base]);
  React.useEffect(() => {
    const t = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(t);
  }, [load]);
  if (error) return <ErrorState description={error} onRetry={load} />;
  if (!data) return <LoadingState />;
  return (
    <>
      <PageHeader title="Billing" description="Your plan, what you've used, invoices and payments." />
      {data.state === "blocked" ? (
        <Alert tone="danger" title="Sending is paused" className="mb-4">
          {data.stateMessage} Incoming messages still arrive in your inbox.
        </Alert>
      ) : data.state === "past_due" ? (
        <Alert tone="warning" title="Payment overdue" className="mb-4">
          {data.stateMessage} Pay it soon to avoid your sending being paused.
        </Alert>
      ) : null}
      <nav aria-label="Billing sections" className="mb-4 flex gap-1 overflow-x-auto border-b border-app-border">
        {TABS.map((t) => (
          <button key={t.id} type="button" onClick={() => setTab(t.id)} aria-current={tab === t.id ? "page" : undefined} className={cn("flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-small", tab === t.id ? "border-app-primary text-app-text" : "border-transparent text-app-muted hover:text-app-text")}>
            <t.icon className="size-4" aria-hidden="true" /> {t.label}
            {t.id === "invoices" && data.openInvoices.length ? <Badge tone="warning">{data.openInvoices.length}</Badge> : null}
          </button>
        ))}
      </nav>
      {tab === "plan" ? <PlanTab base={base} data={data} canManage={canManage} reload={load} onOpenInvoices={() => setTab("invoices")} /> : null}
      {tab === "usage" ? <UsageTab base={base} /> : null}
      {tab === "invoices" ? <InvoicesTab base={base} data={data} canManage={canManage} reload={load} /> : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Pay (shared)
// ---------------------------------------------------------------------------

function usePay(base: string, data: Overview, reload: () => Promise<void>) {
  const toast = useToast();
  const [busy, setBusy] = React.useState("");
  async function pay(invoiceId: string) {
    const gateway = data.gateways[0];
    if (!gateway) return toast("Online payments aren't connected yet. Pay by bank transfer / UPI and MECGURA will record it.", "error");
    setBusy(invoiceId);
    try {
      const r = await apiFetch<{ checkout: Checkout }>(`${base}/invoices/${invoiceId}/pay`, { method: "POST", body: { gateway: gateway.id } });
      if (!r.ok) return toast(r.error, "error");
      const proof = await openCheckout(r.data.checkout);
      if (proof) {
        const c = await apiFetch(`${base}/payments/${r.data.checkout.paymentId}/confirm`, { method: "POST", body: { data: proof } });
        toast(c.ok ? "Payment received — thank you!" : c.error, c.ok ? "success" : "error");
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : "The payment didn't go through.", "error");
    } finally {
      setBusy("");
      void reload();
    }
  }
  return { pay, busy };
}

function ManualPayNote({ data }: { data: Overview }) {
  if (data.onlinePaymentsConnected) return null;
  return (
    <Alert tone="info" title="Online payment isn't connected yet">
      Pay by bank transfer or UPI using the details on the invoice{data.supportEmail ? ` (questions: ${data.supportEmail})` : ""}. MECGURA records the payment once it arrives, and your plan updates then. Nothing is marked paid automatically.
      {data.paymentInstructions ? <span className="mt-2 block whitespace-pre-line rounded-lg border border-app-border bg-app-bg p-2 text-caption text-app-text">{data.paymentInstructions}</span> : null}
    </Alert>
  );
}

// ---------------------------------------------------------------------------
// Plan tab
// ---------------------------------------------------------------------------

function PlanTab({ base, data, canManage, reload, onOpenInvoices }: { base: string; data: Overview; canManage: boolean; reload: () => Promise<void>; onOpenInvoices: () => void }) {
  const toast = useToast();
  const sub = data.subscription;
  const [pick, setPick] = React.useState<PlanView | null>(null);
  const [cancel, setCancel] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const { pay, busy: paying } = usePay(base, data, reload);

  async function act(path: "cancel" | "resume") {
    setBusy(true);
    const r = await apiFetch(`${base}/${path}`, { method: "POST" });
    setBusy(false);
    setCancel(false);
    if (!r.ok) return toast(r.error, "error");
    toast(path === "cancel" ? "Cancellation recorded" : "Welcome back — your plan continues");
    void reload();
  }

  return (
    <div className="space-y-4">
      {data.openInvoices.length ? (
        <Alert tone="warning" title={`${data.openInvoices.length} invoice(s) waiting for payment`}>
          <ul className="mt-1 space-y-1">
            {data.openInvoices.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span>{i.number} — {formatINR(i.total)} · due {when(i.dueAt)}</span>
                {i.lastPaymentFailure ? <span className="text-red-300">{i.lastPaymentFailure}</span> : null}
                {canManage && data.onlinePaymentsConnected ? (
                  <Button size="sm" onClick={() => pay(i.id)} loading={paying === i.id}>Pay now</Button>
                ) : null}
              </li>
            ))}
          </ul>
          {!data.onlinePaymentsConnected ? <p className="mt-2">Online payment isn&apos;t connected yet — pay by bank transfer / UPI and MECGURA will record it. <button type="button" className="underline" onClick={onOpenInvoices}>See invoices</button></p> : null}
        </Alert>
      ) : null}

      <Card>
        <CardHeader title="Current plan" action={sub && canManage ? sub.cancelAtPeriodEnd || sub.pendingPlan ? <Button variant="secondary" onClick={() => act("resume")} loading={busy}>Keep my plan</Button> : <Button variant="ghost" onClick={() => setCancel(true)}>Cancel subscription</Button> : null} />
        <CardBody>
          {!sub ? (
            <EmptyState icon={CreditCard} title={data.canceledPlan ? "Your subscription has ended" : "No plan yet"} description={data.canceledPlan ? `${data.canceledPlan.name} ended on ${when(data.canceledPlan.endedAt)}. Choose a plan below to start sending again.` : "Choose a plan below. Until then your workspace has no limits set by MECGURA."} className="py-6" />
          ) : (
            <div className="grid gap-5 lg:grid-cols-[1.2fr_1fr]">
              <div>
                <p className="flex flex-wrap items-center gap-2 text-h2 text-app-text">
                  {sub.plan.name}
                  <Badge tone={data.state === "blocked" ? "danger" : data.state === "past_due" ? "warning" : "success"} dot>{data.state === "blocked" ? "Paused" : data.state === "past_due" ? "Overdue" : "Active"}</Badge>
                  {sub.cancelAtPeriodEnd ? <Badge tone="warning">Ends {when(sub.endsAt)}</Badge> : null}
                </p>
                <p className="mt-1 text-body text-app-muted">
                  {formatINR(sub.priceMonthly)} / month{data.tax.percent ? ` + ${data.tax.percent}% tax` : ""}
                  {sub.billingMode === "complimentary" ? " · contracted with MECGURA" : ""}
                </p>
                <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-small">
                  <div>
                    <dt className="text-app-subtle">Payment status</dt>
                    <dd><Badge tone={PAYMENT[data.paymentStatus].tone} dot>{PAYMENT[data.paymentStatus].label}</Badge></dd>
                  </div>
                  <div>
                    <dt className="text-app-subtle">Next billing</dt>
                    <dd className="text-app-text">{sub.cancelAtPeriodEnd ? "None — ends " + when(sub.endsAt) : sub.nextBillingDate ? when(sub.nextBillingDate) : "Not billed automatically"}</dd>
                  </div>
                  <div>
                    <dt className="text-app-subtle">Current period</dt>
                    <dd className="text-app-text">{sub.currentPeriodStart ? `${when(sub.currentPeriodStart)} → ${sub.nextBillingDate || sub.endsAt ? when(sub.nextBillingDate ?? sub.endsAt) : "ongoing"}` : "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-app-subtle">Online payment</dt>
                    <dd className="text-app-text">{data.onlinePaymentsConnected ? data.gateways.map((g) => g.label).join(", ") : "Not connected yet"}</dd>
                  </div>
                </dl>
                {sub.pendingPlan ? <Alert tone="info" className="mt-4">Moving to <strong>{sub.pendingPlan.name}</strong> on {when(sub.pendingPlan.takesEffectAt)}. You keep {sub.plan.name} until then.</Alert> : null}
              </div>
              <PlanFacts limits={sub.plan.limits} features={sub.plan.features} />
            </div>
          )}
        </CardBody>
      </Card>

      <section aria-label="Plans" className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {data.plans.map((p) => (
          <Card key={p.id} className={cn("flex flex-col", p.relation === "current" && "border-app-primary")}>
            <div className="border-b border-app-border p-5">
              <p className="flex items-center justify-between gap-2 text-h4 font-semibold text-app-text">
                {p.name}
                {p.relation === "current" ? <Badge tone="primary">Current</Badge> : null}
              </p>
              <p className="mt-1 text-h2 tabular-nums text-app-text">
                {p.selfServe ? formatINR(p.priceMonthly) : "Custom"}
                {p.selfServe ? <span className="text-small font-normal text-app-muted"> / month</span> : null}
              </p>
              <p className="mt-1 min-h-8 text-caption text-app-muted">{p.description}</p>
            </div>
            <div className="flex-1 p-5">
              <PlanFacts limits={p.limits} features={p.features} compact />
            </div>
            <div className="p-5 pt-0">
              {p.relation === "current" ? (
                <Button variant="secondary" className="w-full" disabled>Your plan</Button>
              ) : p.relation === "contact" ? (
                <Button variant="secondary" className="w-full" disabled>{data.supportEmail ? `Contact ${data.supportEmail}` : "Contact MECGURA"}</Button>
              ) : canManage ? (
                <Button className="w-full" variant={p.relation === "downgrade" ? "secondary" : "primary"} onClick={() => setPick(p)}>
                  {p.relation === "upgrade" ? <ArrowUpRight aria-hidden="true" /> : p.relation === "downgrade" ? <ArrowDownRight aria-hidden="true" /> : null}
                  {p.relation === "upgrade" ? "Upgrade" : p.relation === "downgrade" ? "Downgrade" : "Choose plan"}
                </Button>
              ) : (
                <p className="text-center text-caption text-app-subtle">Only owners can change the plan</p>
              )}
            </div>
          </Card>
        ))}
      </section>

      {pick ? <ChangeModal base={base} data={data} plan={pick} onClose={() => setPick(null)} onDone={() => { setPick(null); void reload(); }} /> : null}
      <ConfirmationDialog
        open={cancel}
        onClose={() => setCancel(false)}
        onConfirm={() => act("cancel")}
        loading={busy}
        title="Cancel your subscription?"
        description={sub && sub.billingMode === "invoiced" ? `You keep ${sub.plan.name} until ${when(sub.endsAt ?? sub.nextBillingDate)}. After that sending stops (incoming messages still arrive). You can change your mind any time before then.` : "Your plan ends now and sending stops (incoming messages still arrive). You can choose a plan again later."}
        confirmLabel="Cancel subscription"
      />
    </div>
  );
}

function PlanFacts({ limits, features, compact = false }: { limits: PlanLimits; features: { key: string; label: string }[]; compact?: boolean }) {
  return (
    <div className={cn("space-y-3", compact && "text-small")}>
      <ul className="space-y-1">
        {(Object.keys(LIMIT_META) as (keyof PlanLimits)[]).map((k) => (
          <li key={k} className="flex justify-between gap-2">
            <span className="text-app-muted">{LIMIT_META[k].label}</span>
            <span className="tabular-nums text-app-text">{limitLabel(limits[k])} <span className="text-caption text-app-subtle">{limits[k] < 0 ? "" : LIMIT_META[k].per}</span></span>
          </li>
        ))}
      </ul>
      <ul className="flex flex-wrap gap-1.5">
        {features.map((f) => (
          <li key={f.key}>
            <Badge tone="neutral"><Check className="size-3" aria-hidden="true" /> {f.label}</Badge>
          </li>
        ))}
        {!features.length ? <li className="text-caption text-app-subtle">Core inbox only</li> : null}
      </ul>
    </div>
  );
}

function ChangeModal({ base, data, plan, onClose, onDone }: { base: string; data: Overview; plan: PlanView; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [pv, setPv] = React.useState<Preview | null>(null);
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [invoice, setInvoice] = React.useState<InvoiceView | null>(null);
  const { pay, busy: paying } = usePay(base, data, async () => onDone());
  React.useEffect(() => {
    let alive = true;
    void apiFetch<{ preview: Preview }>(`${base}/preview?planId=${plan.id}`).then((r) => {
      if (!alive) return;
      if (!r.ok) return setError(r.error);
      setPv(r.data.preview);
    });
    return () => {
      alive = false;
    };
  }, [base, plan.id]);

  async function confirm() {
    setBusy(true);
    const r = await apiFetch<{ result: "changed" | "scheduled" | "invoice"; invoice?: InvoiceView }>(`${base}/change`, { method: "POST", body: { planId: plan.id } });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    if (r.data.result === "invoice" && r.data.invoice) return setInvoice(r.data.invoice);
    toast(r.data.result === "scheduled" ? `Scheduled — ${plan.name} starts at the end of your period` : `You're now on ${plan.name}`);
    onDone();
  }

  return (
    <Modal open onClose={invoice ? onDone : onClose} title={invoice ? "Invoice created" : `${plan.relation === "downgrade" ? "Downgrade" : plan.relation === "upgrade" ? "Upgrade" : "Choose"} ${plan.name}`} size="lg">
      {invoice ? (
        <div className="space-y-4">
          <Alert tone="info" title={`${invoice.number} — ${formatINR(invoice.total)}`}>
            Your plan changes to <strong>{plan.name}</strong> as soon as this invoice is paid. Until then you stay on your current plan.
          </Alert>
          {data.onlinePaymentsConnected ? null : <ManualPayNote data={data} />}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onDone}>Pay later</Button>
            {data.onlinePaymentsConnected ? <Button onClick={() => pay(invoice.id)} loading={paying === invoice.id}>Pay {formatINR(invoice.total)} now</Button> : null}
          </div>
        </div>
      ) : error && !pv ? (
        <Alert tone="danger">{error}</Alert>
      ) : !pv ? (
        <LoadingState className="py-6" />
      ) : (
        <div className="space-y-4">
          {error ? <Alert tone="danger">{error}</Alert> : null}
          <PlanFacts limits={pv.plan.limits} features={pv.plan.features} />
          {pv.problems.length ? (
            <Alert tone={pv.blocked ? "danger" : "warning"} title={pv.blocked ? "You can't move to this plan yet" : "Heads up"}>
              <ul className="list-inside list-disc">
                {pv.problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
              {pv.blocked ? <p className="mt-1">Reduce these first, then try again.</p> : null}
            </Alert>
          ) : null}
          {pv.direction === "downgrade" ? (
            <Alert tone="info">{pv.effective === "period_end" ? `The change happens on ${when(pv.effectiveAt)}, when your current period ends. No refund for the current period.` : "The change happens right away."}</Alert>
          ) : pv.amount > 0 ? (
            <dl className="space-y-1 rounded-xl border border-app-border p-4 text-small">
              <div className="flex justify-between"><dt className="text-app-muted">{pv.direction === "new" ? "First month" : "Prorated difference for the rest of this period"}</dt><dd className="tabular-nums">{formatINR(pv.amount)}</dd></div>
              {pv.tax ? <div className="flex justify-between"><dt className="text-app-muted">Tax ({data.tax.percent}%)</dt><dd className="tabular-nums">{formatINR(pv.tax)}</dd></div> : null}
              <div className="flex justify-between border-t border-app-border pt-1 font-semibold text-app-text"><dt>Due now</dt><dd className="tabular-nums">{formatINR(pv.total)}</dd></div>
              <p className="pt-1 text-caption text-app-subtle">An invoice is created; the new plan starts once it&apos;s paid.</p>
            </dl>
          ) : (
            <Alert tone="success">Nothing to pay — the change happens right away.</Alert>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>Not now</Button>
            <Button onClick={confirm} loading={busy} disabled={pv.blocked}>{pv.amount > 0 ? "Create invoice" : pv.direction === "downgrade" ? "Confirm downgrade" : "Confirm"}</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Usage tab
// ---------------------------------------------------------------------------

type UsageLine = { key: string; label: string; group: string; used: number; limit: number | null; unit: string; note?: string };
type UsageData = { period: string; plan: { id: string; name: string } | null; lines: UsageLine[]; history: { days: string[]; metrics: Record<string, number[]> } };
const GROUPS: Record<string, string> = { messaging: "Messaging", crm: "Contacts & team", automation: "Campaigns & automation", platform: "AI & API" };

function UsageTab({ base }: { base: string }) {
  const [days, setDays] = React.useState("30");
  const [data, setData] = React.useState<UsageData | null>(null);
  const [error, setError] = React.useState("");
  const load = React.useCallback(async () => {
    const r = await apiFetch<UsageData>(`${base}/usage?days=${days}`);
    if (!r.ok) return setError(r.error);
    setError("");
    setData(r.data);
  }, [base, days]);
  React.useEffect(() => {
    const t = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(t);
  }, [load]);
  if (error) return <ErrorState description={error} onRetry={load} />;
  if (!data) return <LoadingState />;
  const m = data.history.metrics;
  return (
    <div className="space-y-4">
      <Alert tone="info">
        {data.plan ? `Plan: ${data.plan.name}. ` : "No plan assigned — no limits apply. "}Monthly allowances count calendar month {data.period} (IST) and reset on the 1st. Demo-number traffic isn&apos;t billable and isn&apos;t counted.
      </Alert>
      {Object.entries(GROUPS).map(([g, title]) => (
        <Card key={g}>
          <CardHeader title={title} />
          <CardBody className="grid gap-6 sm:grid-cols-2">
            {data.lines.filter((l) => l.group === g).map((l) => (
              <div key={l.key}>
                {l.limit === null && l.key !== "messages" ? (
                  <div>
                    <p className="flex items-baseline justify-between text-small"><span className="text-app-muted">{l.label}</span><span className="tabular-nums text-app-text">{formatNumber(l.used)} <span className="text-app-subtle">{l.unit}</span></span></p>
                  </div>
                ) : (
                  <UsageMeter label={`${l.label} (${l.unit})`} used={l.used} limit={l.limit} />
                )}
                {l.note ? <p className="mt-1 text-caption text-app-subtle">{l.note}</p> : null}
              </div>
            ))}
          </CardBody>
        </Card>
      ))}
      <Card>
        <CardHeader title="Daily metered usage" action={<Select aria-label="Period" value={days} onChange={(e) => setDays(e.target.value)} className="h-9 w-36 text-small"><option value="14">Last 14 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option></Select>} />
        <CardBody className="grid gap-6 lg:grid-cols-3">
          {[
            ["messages_sent", "Messages sent", "bg-app-primary"],
            ["ai_replies", "AI replies", "bg-sky-400"],
            ["api_calls", "API requests", "bg-amber-400"],
          ].map(([k, label, cls]) => (
            <div key={k}>
              <p className="mb-2 text-small font-medium text-app-text">{label} <span className="font-normal text-app-subtle">· {formatNumber((m[k] ?? []).reduce((a, b) => a + b, 0))} in period</span></p>
              <MiniBars labels={data.history.days} series={[{ name: label, values: m[k] ?? data.history.days.map(() => 0), className: cls }]} height={96} ariaLabel={`${label} per day`} />
            </div>
          ))}
        </CardBody>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Invoices tab
// ---------------------------------------------------------------------------

function InvoicesTab({ base, data, canManage, reload }: { base: string; data: Overview; canManage: boolean; reload: () => Promise<void> }) {
  const [page, setPage] = React.useState(1);
  const [status, setStatus] = React.useState("");
  const [list, setList] = React.useState<{ invoices: InvoiceView[]; total: number } | null>(null);
  const [error, setError] = React.useState("");
  const load = React.useCallback(async () => {
    const r = await apiFetch<{ invoices: InvoiceView[]; total: number }>(`${base}/invoices?page=${page}&pageSize=15&status=${status}`);
    if (!r.ok) return setError(r.error);
    setError("");
    setList(r.data);
  }, [base, page, status]);
  const { pay, busy } = usePay(base, data, async () => {
    await reload();
    await load();
  });
  React.useEffect(() => {
    const t = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(t);
  }, [load]);
  return (
    <div className="space-y-4">
      <ManualPayNote data={data} />
      <Card>
        <CardHeader title="Invoices" action={<Select aria-label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="h-9 w-36 text-small"><option value="">All</option><option value="open">Unpaid</option><option value="paid">Paid</option><option value="void">Void</option></Select>} />
        {error ? (
          <ErrorState description={error} onRetry={load} />
        ) : !list ? (
          <LoadingState />
        ) : !list.invoices.length ? (
          <EmptyState icon={FileText} title="No invoices yet" description="Invoices appear here when you upgrade or when a billed period renews." />
        ) : (
          <>
            <Table caption="Invoices" className="min-w-[760px]">
              <THead>
                <tr>
                  <TH>Invoice</TH>
                  <TH>Issued</TH>
                  <TH>Due</TH>
                  <TH className="text-right">Amount</TH>
                  <TH>Status</TH>
                  <TH className="text-right"><span className="sr-only">Actions</span></TH>
                </tr>
              </THead>
              <TBody>
                {list.invoices.map((i) => (
                  <TR key={i.id}>
                    <TD>
                      <Link href={`/billing/invoices/${i.id}`} className="font-medium hover:text-app-primary-hover">{i.number}</Link>
                      <p className="text-caption text-app-subtle">{i.description}</p>
                    </TD>
                    <TD className="whitespace-nowrap text-small text-app-muted">{istFmt.format(new Date(i.issuedAt))}</TD>
                    <TD className="whitespace-nowrap text-small text-app-muted">{when(i.dueAt)}</TD>
                    <TD className="text-right tabular-nums">{formatINR(i.total)}</TD>
                    <TD>
                      <Badge tone={INV_STATUS[i.displayStatus]?.tone ?? "neutral"} dot>{INV_STATUS[i.displayStatus]?.label ?? i.displayStatus}</Badge>
                      {i.paidAt ? <p className="text-caption text-app-subtle">{when(i.paidAt)} · {i.paidVia === "manual" ? "recorded by MECGURA" : i.paidVia}</p> : null}
                      {i.lastPaymentFailure && i.status === "open" ? <p className="max-w-[14rem] text-caption text-red-300">{i.lastPaymentFailure}</p> : null}
                    </TD>
                    <TD className="whitespace-nowrap text-right">
                      <Link href={`/billing/invoices/${i.id}`} className="mr-2 text-small underline-offset-4 hover:underline">View</Link>
                      {i.status === "open" && canManage && data.onlinePaymentsConnected ? <Button size="sm" onClick={() => pay(i.id)} loading={busy === i.id}>Pay</Button> : null}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <Pagination page={page} pageSize={15} total={list.total} onPageChange={setPage} />
          </>
        )}
      </Card>
    </div>
  );
}
