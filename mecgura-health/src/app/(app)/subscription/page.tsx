import type { Metadata } from "next";
import Link from "next/link";
import { BillingProfileForm, CancelBox, CheckStatusButton, PayButton, PlanPicker } from "@/components/subscription/subscription-client";
import { STATUS_TONE, label, rupees, when } from "@/components/subscription/format";
import { UsageMeters } from "@/components/subscription/usage-meters";
import { Alert, Card, StatusBadge } from "@/components/ui";
import { requireTenantPagePermission } from "@/lib/auth/context";
import { clinicOverview } from "@/lib/services/sub-core";
import { selectablePlans } from "@/lib/services/sub-plans";

export const metadata: Metadata = { title: "Subscription" };
export const dynamic = "force-dynamic";
const H = ({ id, children }: { id: string; children: React.ReactNode }) => <h2 id={id} className="type-section-title mb-3">{children}</h2>;

export default async function SubscriptionPage() {
  const ctx = await requireTenantPagePermission("subscription.view"); const tz = ctx.tenant.timezone;
  const [o, plans] = await Promise.all([clinicOverview(ctx), selectablePlans(ctx.tenantId)]);
  const s = o.subscription; const canManage = o.canManage; const open = o.invoices.find((i) => i.id === o.openInvoice) ?? null;
  return (
    <div className="space-y-section">
      <div><h1 className="type-page-title">Subscription</h1><p className="type-secondary mt-1">Your MECGURA HEALTH plan, usage, invoices and billing details. Patient bills are separate and live under Billing.</p></div>

      {!o.managed && <Alert tone="info" title="No active plan yet">{o.legacyPlanName ? `This workspace runs on the “${o.legacyPlanName}” setup with no usage limits. ` : ""}Choose a plan below to start a subscription.</Alert>}
      {s && (
        <Card className="p-card">
          <div className="flex flex-wrap items-center gap-3"><h2 className="type-card-title">{s.planName}</h2><StatusBadge tone={STATUS_TONE[s.status] ?? "neutral"}>{s.statusLabel}</StatusBadge>{s.cancelAtPeriodEnd && <StatusBadge tone="warning">Ends {when(s.currentPeriodEnd, tz)}</StatusBadge>}</div>
          <dl className="mt-3 grid gap-x-8 gap-y-2 sm:grid-cols-2 lg:grid-cols-4">
            <div><dt className="type-caption">Price</dt><dd>{s.priceMinor === 0 ? "Free" : `${rupees(s.priceMinor, s.currency)} / ${s.interval === "YEARLY" ? "year" : "month"}`}</dd></div>
            {s.status === "TRIAL" ? <div><dt className="type-caption">Trial ends</dt><dd>{when(s.trialEnd, tz)} ({s.trialDaysLeft} days left)</dd></div> : <div><dt className="type-caption">Current period</dt><dd>{when(s.currentPeriodStart, tz)} – {when(s.currentPeriodEnd, tz)}</dd></div>}
            <div><dt className="type-caption">{s.cancelAtPeriodEnd ? "Access until" : "Next invoice"}</dt><dd>{when(s.cancelAtPeriodEnd ? s.currentPeriodEnd : s.nextBillingDate, tz)}</dd></div>
            <div><dt className="type-caption">Times shown in</dt><dd>{tz}</dd></div>
          </dl>
          {s.status === "TRIAL" && <p className="type-secondary mt-3">Your trial does not charge you automatically. Pick a paid plan before it ends to continue; otherwise the workspace becomes read-only and your data is kept.</p>}
          {s.scheduledChange && <Alert tone="info" title="Change scheduled" className="mt-3">Switches to {s.scheduledChange.planName} ({label(s.scheduledChange.interval)}) on {when(s.scheduledChange.effectiveAt, tz)}.</Alert>}
          {s.status === "GRACE" && <Alert tone="danger" title="Grace period" className="mt-3">Pay by {when(s.gracePeriodEnd, tz)} to avoid suspension.</Alert>}
          {s.status === "SUSPENDED" && <Alert tone="danger" title="Suspended" className="mt-3">Pay the open invoice to restore access. Your data is safe.</Alert>}
        </Card>
      )}

      {open && (
        <Card className="p-card">
          <H id="due-h">Payment due</H>
          <p className="type-body"><strong>{open.number}</strong> — {rupees(open.outstandingMinor)} due {when(open.dueAt, tz)} <StatusBadge tone={STATUS_TONE[open.status]}>{label(open.status)}</StatusBadge></p>
          {canManage && <div className="mt-3 flex flex-wrap gap-4"><PayButton invoiceId={open.id} disabledReason={o.onlinePayments.available ? null : o.onlinePayments.hint} /><CheckStatusButton invoiceId={open.id} /></div>}
          <p className="type-caption mt-2">You pay on the payment provider&apos;s own secure page. We never see or store card details.</p>
        </Card>
      )}

      {s && <Card className="p-card"><H id="usage-h">Usage</H><UsageMeters rows={o.usage} windowStart={o.usageWindowStart} /></Card>}

      {canManage || plans.length ? <Card className="p-card"><PlanPicker plans={plans} currentPlanId={s && !["CANCELLED", "EXPIRED"].includes(s.status) ? s.planId : null} currentInterval={s?.interval ?? null} status={s?.status ?? null} canManage={canManage} tz={tz} /></Card> : null}

      <Card><div className="p-card pb-0"><H id="inv-h">Invoices</H></div>
        <div className="relative overflow-x-auto"><table className="w-full text-left"><caption className="sr-only">Subscription invoices</caption>
          <thead><tr className="type-caption border-b border-line bg-surface-muted"><th scope="col" className="p-3">Invoice</th><th scope="col" className="p-3">Date</th><th scope="col" className="p-3">Period</th><th scope="col" className="p-3 text-right">Total</th><th scope="col" className="p-3 text-right">Balance</th><th scope="col" className="p-3">Status</th><th scope="col" className="p-3"><span className="sr-only">Open</span></th></tr></thead>
          <tbody>{o.invoices.map((i) => <tr key={i.id} className="border-b border-line last:border-0"><th scope="row" className="p-3 text-left font-medium">{i.number}</th><td className="p-3">{when(i.issuedAt, tz)}</td><td className="p-3">{when(i.periodStart, tz)} – {when(i.periodEnd, tz)}</td><td className="p-3 text-right">{rupees(i.totalMinor)}</td><td className="p-3 text-right">{rupees(i.outstandingMinor)}</td><td className="p-3"><StatusBadge tone={STATUS_TONE[i.status]}>{label(i.status)}</StatusBadge></td><td className="p-3"><Link href={`/subscription/documents/invoice/${i.id}`}>View<span className="sr-only"> {i.number}</span></Link></td></tr>)}</tbody></table>
          {!o.invoices.length && <p className="type-secondary p-6 text-center">No invoices yet.</p>}</div></Card>

      <Card><div className="p-card pb-0"><H id="pay-h">Payments</H></div>
        <div className="relative overflow-x-auto"><table className="w-full text-left"><caption className="sr-only">Subscription payments</caption>
          <thead><tr className="type-caption border-b border-line bg-surface-muted"><th scope="col" className="p-3">Receipt</th><th scope="col" className="p-3">Date</th><th scope="col" className="p-3">Method</th><th scope="col" className="p-3 text-right">Amount</th><th scope="col" className="p-3">Status</th></tr></thead>
          <tbody>{o.payments.map((p) => <tr key={p.id} className="border-b border-line last:border-0"><th scope="row" className="p-3 text-left font-medium">{p.receiptNumber ? <Link href={`/subscription/documents/receipt/${p.id}`}>{p.receiptNumber}</Link> : "—"}</th><td className="p-3">{when(p.paidAt ?? p.createdAt, tz, true)}</td><td className="p-3">{label(p.method)}</td><td className="p-3 text-right">{rupees(p.amountMinor)}</td><td className="p-3"><StatusBadge tone={STATUS_TONE[p.status]}>{label(p.status)}</StatusBadge>{p.failureReason && <span className="type-caption block">{p.failureReason}</span>}</td></tr>)}</tbody></table>
          {!o.payments.length && <p className="type-secondary p-6 text-center">No payments yet.</p>}</div></Card>

      <Card className="p-card"><H id="bill-h">Billing details</H><p className="type-secondary mb-3">Printed on future invoices. Past invoices never change.</p><BillingProfileForm profile={o.profile} canManage={canManage} defaults={{ name: ctx.tenant.legalName ?? ctx.tenant.name, email: ctx.tenant.contactEmail ?? ctx.user.email }} /></Card>

      {s && canManage && ["ACTIVE", "TRIAL", "PENDING_PAYMENT", "PAST_DUE", "GRACE"].includes(s.status) && <Card className="p-card"><H id="cancel-h">Cancel subscription</H><CancelBox reasons={o.cancelReasons} scheduled={s.cancelAtPeriodEnd} accessUntil={s.currentPeriodEnd?.toISOString() ?? null} tz={tz} /></Card>}

      {o.events.length > 0 && <Card className="p-card"><H id="hist-h">History</H><ul className="space-y-1">{o.events.map((e) => <li key={e.id} className="type-secondary">{when(e.at, tz, true)} — {label(e.type.replace("STATUS_", ""))}{e.from && e.to ? ` (${label(e.from)} → ${label(e.to)})` : ""}</li>)}</ul></Card>}
      <p className="type-caption">Need help with billing? {o.support.email ? `Email ${o.support.email}` : "Contact your MECGURA representative"}{o.support.phone ? ` · ${o.support.phone}` : ""}{o.support.hours ? ` · ${o.support.hours}` : ""}.</p>
    </div>
  );
}
