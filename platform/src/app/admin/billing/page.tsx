"use client";

import * as React from "react";
import Link from "next/link";
import { AlertTriangle, CreditCard, FileText, IndianRupee, Pencil, Plus, Receipt, Settings2, Trash2, Users, Wallet } from "lucide-react";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  ConfirmationDialog,
  EmptyState,
  ErrorState,
  Field,
  IconButton,
  Input,
  LoadingState,
  Modal,
  PageHeader,
  Pagination,
  Select,
  StatCard,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Textarea,
  useToast,
  type BadgeTone,
} from "@/components/ds";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/client-api";
import { formatINR, formatNumber } from "@/lib/catalog";
import { FEATURES, FEATURE_KEYS, LIMIT_META, limitLabel, parseFeatures, type FeatureKey, type PlanLimits } from "@/lib/plans";
import { istFmt } from "@/components/campaigns/types";
import { MiniBars } from "@/components/app/mini-bars";

type Plan = {
  id: string;
  name: string;
  slug: string;
  description: string;
  priceMonthly: number;
  maxUsers: number;
  maxWhatsAppNumbers: number;
  maxMonthlyMessages: number;
  maxContacts: number;
  maxCampaigns: number;
  maxAutomations: number;
  maxAiReplies: number;
  maxApiRequests: number;
  features: string;
  isActive: boolean;
  selfServe: boolean;
  sortOrder: number;
  _count: { subscriptions: number };
};
type Invoice = { id: string; number: string; status: string; displayStatus: string; description: string; total: number; issuedAt: string; dueAt: string; paidAt: string | null; paidVia: string; client: { id: string; name: string } };
type Overview = {
  revenue: { thisMonth: number; lastMonth: number; last12Months: number; taxCollected: number; byMonth: { month: string; revenue: number }[] };
  mrr: { contracted: number; invoiced: number; complimentary: number };
  subscriptions: { active: number; invoiced: number; complimentary: number; cancelling: number; pastDue: number; new30d: number; canceled30d: number };
  activePlans: { id: string; name: string; isActive: boolean; subscriptions: number; mrr: number }[];
  receivables: { open: number; openCount: number; overdue: number; overdueCount: number };
  failedPayments: { count30d: number; items: { id: string; createdAt: string; gateway: string; amount: number; reason: string; invoice: string; client: { id: string; name: string } }[] };
  recentInvoices: Invoice[];
  gateways: { known: { id: string; label: string }[]; connected: { id: string; label: string }[] };
};

const TABS = [
  { id: "overview", label: "Overview", icon: Wallet },
  { id: "plans", label: "Plans", icon: CreditCard },
  { id: "invoices", label: "Invoices", icon: Receipt },
  { id: "payments", label: "Payments", icon: AlertTriangle },
  { id: "settings", label: "Settings", icon: Settings2 },
] as const;
const INV_TONE: Record<string, BadgeTone> = { paid: "success", open: "warning", overdue: "danger", payment_failed: "danger", void: "neutral" };

export default function AdminBillingPage() {
  const [tab, setTab] = React.useState<string>("overview");
  return (
    <>
      <PageHeader title="Billing & Plans" description="Plans and their limits, what clients owe and have paid, and the payment gateway." breadcrumb={[{ label: "Admin", href: "/admin" }, { label: "Billing & Plans" }]} />
      <nav aria-label="Billing sections" className="mb-4 flex gap-1 overflow-x-auto border-b border-app-border">
        {TABS.map((t) => (
          <button key={t.id} type="button" onClick={() => setTab(t.id)} aria-current={tab === t.id ? "page" : undefined} className={cn("flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-small", tab === t.id ? "border-app-primary text-app-text" : "border-transparent text-app-muted hover:text-app-text")}>
            <t.icon className="size-4" aria-hidden="true" /> {t.label}
          </button>
        ))}
      </nav>
      {tab === "overview" ? <OverviewTab /> : null}
      {tab === "plans" ? <PlansTab /> : null}
      {tab === "invoices" ? <InvoicesTab /> : null}
      {tab === "payments" ? <PaymentsTab /> : null}
      {tab === "settings" ? <SettingsTab /> : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

function OverviewTab() {
  const [data, setData] = React.useState<Overview | null>(null);
  const [error, setError] = React.useState("");
  const load = React.useCallback(async () => {
    const r = await apiFetch<Overview>("/api/admin/billing/overview");
    if (!r.ok) return setError(r.error);
    setError("");
    setData(r.data);
  }, []);
  React.useEffect(() => {
    const t = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(t);
  }, [load]);
  if (error) return <ErrorState description={error} onRetry={load} />;
  if (!data) return <LoadingState />;
  const delta = data.revenue.lastMonth ? Math.round(((data.revenue.thisMonth - data.revenue.lastMonth) / data.revenue.lastMonth) * 100) : null;
  return (
    <div className="space-y-4">
      {data.gateways.connected.length ? (
        <Alert tone="success" title="Payment gateway connected">{data.gateways.connected.map((g) => g.label).join(", ")} — clients can pay invoices online. Payments are confirmed only by the gateway&apos;s signed webhook.</Alert>
      ) : (
        <Alert tone="warning" title="No payment gateway connected">
          Clients can&apos;t pay online yet. Invoices stay <strong>unpaid</strong> until you record a payment you actually received (Invoices → Mark paid). To connect Razorpay, add the key id in Settings → Razorpay and set RAZORPAY_KEY_SECRET and RAZORPAY_WEBHOOK_SECRET on the server.
        </Alert>
      )}
      <section aria-label="Billing summary" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Revenue collected (this month)" value={formatINR(data.revenue.thisMonth)} icon={IndianRupee} hint={delta === null ? "Paid invoices only" : `${delta >= 0 ? "+" : ""}${delta}% vs last month (${formatINR(data.revenue.lastMonth)})`} />
        <StatCard label="MRR (contracted)" value={formatINR(data.mrr.contracted)} icon={Wallet} hint={`${formatINR(data.mrr.invoiced)} invoiced · ${formatINR(data.mrr.complimentary)} contracted offline`} />
        <StatCard label="Active subscriptions" value={formatNumber(data.subscriptions.active)} icon={Users} hint={`${data.subscriptions.invoiced} invoiced · ${data.subscriptions.complimentary} contracted · ${data.subscriptions.cancelling} cancelling`} />
        <StatCard label="Failed payments (30 days)" value={formatNumber(data.failedPayments.count30d)} icon={AlertTriangle} hint={`${data.subscriptions.pastDue} client(s) overdue`} />
      </section>
      <section aria-label="Receivables" className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Awaiting payment" value={formatINR(data.receivables.open)} icon={Receipt} hint={`${data.receivables.openCount} open invoice(s)`} />
        <StatCard label="Overdue" value={formatINR(data.receivables.overdue)} icon={AlertTriangle} hint={`${data.receivables.overdueCount} invoice(s) past due date`} />
        <StatCard label="Revenue, last 12 months" value={formatINR(data.revenue.last12Months)} icon={IndianRupee} hint={`Tax collected this month: ${formatINR(data.revenue.taxCollected)}`} />
      </section>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Revenue by month" description="Money actually collected (paid invoices, incl. tax)" />
          <CardBody>
            <MiniBars labels={data.revenue.byMonth.map((m) => m.month)} series={[{ name: "Collected (₹)", values: data.revenue.byMonth.map((m) => Math.round(m.revenue / 100)), className: "bg-app-primary" }]} ariaLabel="Revenue by month" />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Active plans" description="Who is on what" />
          <Table caption="Active plans" className="min-w-0">
            <THead>
              <tr>
                <TH>Plan</TH>
                <TH className="text-right">Clients</TH>
                <TH className="text-right">MRR</TH>
              </tr>
            </THead>
            <TBody>
              {data.activePlans.map((p) => (
                <TR key={p.id}>
                  <TD>{p.name} {!p.isActive ? <Badge tone="neutral">inactive</Badge> : null}</TD>
                  <TD className="text-right tabular-nums">{p.subscriptions}</TD>
                  <TD className="text-right tabular-nums">{formatINR(p.mrr)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      </div>
      <Card>
        <CardHeader title="Recent invoices" />
        <InvoiceTable invoices={data.recentInvoices} />
      </Card>
      {data.failedPayments.items.length ? (
        <Card>
          <CardHeader title="Recent failed payments" description="Gateway attempts that didn't go through (the invoice stays unpaid)" />
          <FailedTable items={data.failedPayments.items} />
        </Card>
      ) : null}
    </div>
  );
}

function InvoiceTable({ invoices, onMarkPaid, onVoid }: { invoices: Invoice[]; onMarkPaid?: (i: Invoice) => void; onVoid?: (i: Invoice) => void }) {
  if (!invoices.length) return <EmptyState icon={FileText} title="No invoices" className="py-6" />;
  return (
    <Table caption="Invoices" className="min-w-[860px]">
      <THead>
        <tr>
          <TH>Invoice</TH>
          <TH>Client</TH>
          <TH>Issued</TH>
          <TH>Due</TH>
          <TH className="text-right">Amount</TH>
          <TH>Status</TH>
          {onMarkPaid ? <TH className="text-right"><span className="sr-only">Actions</span></TH> : null}
        </tr>
      </THead>
      <TBody>
        {invoices.map((i) => (
          <TR key={i.id}>
            <TD className="font-medium">{i.number}<p className="text-caption font-normal text-app-subtle">{i.description}</p></TD>
            <TD><Link href={`/admin/clients/${i.client.id}`} className="hover:text-app-primary-hover">{i.client.name}</Link></TD>
            <TD className="whitespace-nowrap text-small text-app-muted">{istFmt.format(new Date(i.issuedAt))}</TD>
            <TD className="whitespace-nowrap text-small text-app-muted">{istFmt.format(new Date(i.dueAt))}</TD>
            <TD className="text-right tabular-nums">{formatINR(i.total)}</TD>
            <TD>
              <Badge tone={INV_TONE[i.displayStatus] ?? "neutral"} dot>{i.displayStatus === "payment_failed" ? "Payment failed" : i.displayStatus === "open" ? "Unpaid" : i.displayStatus[0].toUpperCase() + i.displayStatus.slice(1)}</Badge>
              {i.paidAt ? <p className="text-caption text-app-subtle">{istFmt.format(new Date(i.paidAt))} · {i.paidVia}</p> : null}
            </TD>
            {onMarkPaid ? (
              <TD className="whitespace-nowrap text-right">
                {i.status === "open" ? (
                  <>
                    <Button size="sm" onClick={() => onMarkPaid(i)}>Mark paid</Button>
                    {onVoid ? <Button size="sm" variant="ghost" onClick={() => onVoid(i)}>Void</Button> : null}
                  </>
                ) : null}
              </TD>
            ) : null}
          </TR>
        ))}
      </TBody>
    </Table>
  );
}

function FailedTable({ items }: { items: { id: string; createdAt: string; gateway: string; amount: number; reason: string; invoice: string; client: { id: string; name: string } }[] }) {
  return (
    <Table caption="Failed payments" className="min-w-[700px]">
      <THead>
        <tr>
          <TH>When</TH>
          <TH>Client</TH>
          <TH>Invoice</TH>
          <TH className="text-right">Amount</TH>
          <TH>Reason</TH>
        </tr>
      </THead>
      <TBody>
        {items.map((p) => (
          <TR key={p.id}>
            <TD className="whitespace-nowrap text-small text-app-muted">{istFmt.format(new Date(p.createdAt))}</TD>
            <TD><Link href={`/admin/clients/${p.client.id}`} className="hover:text-app-primary-hover">{p.client.name}</Link></TD>
            <TD>{p.invoice}</TD>
            <TD className="text-right tabular-nums">{formatINR(p.amount)}</TD>
            <TD className="text-small text-red-300">{p.reason} <span className="text-app-subtle">({p.gateway})</span></TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------

const LIMIT_FIELDS = Object.values(LIMIT_META).map((m) => m.field) as (keyof Plan)[];

function PlansTab() {
  const toast = useToast();
  const [plans, setPlans] = React.useState<Plan[] | null>(null);
  const [error, setError] = React.useState("");
  const [editing, setEditing] = React.useState<Plan | "new" | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<Plan | null>(null);
  const [busy, setBusy] = React.useState(false);
  const load = React.useCallback(async () => {
    const r = await apiFetch<{ plans: Plan[] }>("/api/admin/plans");
    if (!r.ok) return setError(r.error);
    setError("");
    setPlans(r.data.plans);
  }, []);
  React.useEffect(() => {
    const t = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(t);
  }, [load]);

  async function toggle(p: Plan) {
    const r = await apiFetch(`/api/admin/plans/${p.id}`, { method: "PATCH", body: { isActive: !p.isActive } });
    if (!r.ok) return toast(r.error, "error");
    toast(`${p.name} ${p.isActive ? "deactivated" : "activated"}`);
    void load();
  }
  async function remove() {
    if (!deleteTarget) return;
    setBusy(true);
    const r = await apiFetch(`/api/admin/plans/${deleteTarget.id}`, { method: "DELETE" });
    setBusy(false);
    if (!r.ok) return toast(r.error, "error");
    toast("Plan deleted");
    setDeleteTarget(null);
    void load();
  }
  if (error) return <ErrorState description={error} onRetry={load} />;
  if (!plans) return <LoadingState />;
  return (
    <>
      <Alert tone="info" className="mb-4">
        Nothing about a plan is fixed in code — price, limits and features all live here and apply to clients <strong>immediately</strong>. Use <code className="font-mono">-1</code> for unlimited. A client&apos;s price is locked when the plan is assigned; changing it here affects new assignments and renewals of new subscriptions.
      </Alert>
      <Card>
        <CardHeader title="Plans" action={<Button onClick={() => setEditing("new")}><Plus aria-hidden="true" /> New plan</Button>} />
        {!plans.length ? (
          <EmptyState icon={CreditCard} title="No plans yet" action={<Button onClick={() => setEditing("new")}>New plan</Button>} />
        ) : (
          <Table caption="Plans" className="min-w-[1180px]">
            <THead>
              <tr>
                <TH>Plan</TH>
                <TH>Price / month</TH>
                <TH>Seats</TH>
                <TH>Numbers</TH>
                <TH>Messages</TH>
                <TH>Contacts</TH>
                <TH>Campaigns</TH>
                <TH>Automations</TH>
                <TH>AI replies</TH>
                <TH>API req.</TH>
                <TH>Features</TH>
                <TH>Clients</TH>
                <TH>Status</TH>
                <TH className="text-right"><span className="sr-only">Actions</span></TH>
              </tr>
            </THead>
            <TBody>
              {plans.map((p) => (
                <TR key={p.id}>
                  <TD>
                    <p className="font-medium">{p.name}</p>
                    <p className="text-caption text-app-subtle">{p.slug}{!p.selfServe ? " · contact sales" : ""}</p>
                  </TD>
                  <TD className="tabular-nums">{formatINR(p.priceMonthly)}</TD>
                  {LIMIT_FIELDS.map((f) => (
                    <TD key={f} className="tabular-nums">{limitLabel(p[f] as number)}</TD>
                  ))}
                  <TD className="text-small text-app-muted">{parseFeatures(p.features).length} of {FEATURE_KEYS.length}</TD>
                  <TD className="tabular-nums">{p._count.subscriptions}</TD>
                  <TD><Badge tone={p.isActive ? "success" : "neutral"} dot>{p.isActive ? "Active" : "Inactive"}</Badge></TD>
                  <TD className="whitespace-nowrap text-right">
                    <Button size="sm" variant="ghost" onClick={() => toggle(p)}>{p.isActive ? "Deactivate" : "Activate"}</Button>
                    <IconButton label={`Edit ${p.name}`} size="sm" onClick={() => setEditing(p)}><Pencil aria-hidden="true" /></IconButton>
                    <IconButton label={`Delete ${p.name}`} size="sm" onClick={() => setDeleteTarget(p)}><Trash2 aria-hidden="true" /></IconButton>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
      <PlanModal plan={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void load(); }} />
      <ConfirmationDialog open={deleteTarget !== null} onClose={() => setDeleteTarget(null)} onConfirm={remove} loading={busy} title="Delete plan?" description={`${deleteTarget?.name ?? ""} can only be deleted if it was never assigned. Otherwise deactivate it.`} confirmLabel="Delete" />
    </>
  );
}

type Form = { name: string; slug: string; description: string; priceMonthly: string; sortOrder: string; isActive: boolean; selfServe: boolean; features: FeatureKey[] } & Record<string, string | boolean | FeatureKey[]>;
const EMPTY: Form = { name: "", slug: "", description: "", priceMonthly: "0", sortOrder: "0", isActive: true, selfServe: true, features: [...FEATURE_KEYS], maxUsers: "3", maxWhatsAppNumbers: "1", maxMonthlyMessages: "1000", maxContacts: "1000", maxCampaigns: "5", maxAutomations: "3", maxAiReplies: "0", maxApiRequests: "0" };

function PlanModal({ plan, onClose, onSaved }: { plan: Plan | "new" | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [form, setForm] = React.useState<Form>(EMPTY);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [saving, setSaving] = React.useState(false);
  const [loadedFor, setLoadedFor] = React.useState<string | null>(null);
  const key = plan === null ? null : plan === "new" ? "new" : plan.id;
  if (key !== loadedFor) {
    setLoadedFor(key);
    setErrors({});
    setForm(
      plan && plan !== "new"
        ? { ...EMPTY, name: plan.name, slug: plan.slug, description: plan.description, priceMonthly: String(plan.priceMonthly / 100), sortOrder: String(plan.sortOrder), isActive: plan.isActive, selfServe: plan.selfServe, features: parseFeatures(plan.features), ...Object.fromEntries(LIMIT_FIELDS.map((f) => [f, String(plan[f])])) }
        : EMPTY
    );
  }
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const isNew = plan === "new";
    const r = await apiFetch(isNew ? "/api/admin/plans" : `/api/admin/plans/${(plan as Plan).id}`, { method: isNew ? "POST" : "PATCH", body: form });
    setSaving(false);
    if (!r.ok) {
      const d = Object.fromEntries(Object.entries(r.details ?? {}).map(([k, v]) => [k, v?.[0] ?? ""]));
      return setErrors({ ...d, form: r.details ? "" : r.error });
    }
    toast(isNew ? "Plan created" : "Plan updated — applies to clients immediately");
    onSaved();
  }
  const num = (k: string, label: string, hint?: string) => (
    <Field id={`plan-${k}`} label={label} hint={hint} error={errors[k]}>
      <Input type="number" min={-1} inputMode="numeric" value={String(form[k])} onChange={set(k)} />
    </Field>
  );
  return (
    <Modal open={plan !== null} onClose={onClose} title={plan === "new" ? "New plan" : "Edit plan"} size="lg">
      <form onSubmit={submit} noValidate className="space-y-4">
        {errors.form ? <Alert tone="danger">{errors.form}</Alert> : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="plan-name" label="Name" error={errors.name}>
            <Input value={form.name} onChange={(e) => { const name = e.target.value; setForm((f) => ({ ...f, name, slug: plan === "new" ? name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") : f.slug })); }} />
          </Field>
          <Field id="plan-slug" label="Slug" error={errors.slug}>
            <Input value={form.slug} onChange={set("slug")} />
          </Field>
        </div>
        <Field id="plan-description" label="Description" error={errors.description}>
          <Textarea value={form.description} onChange={set("description")} className="min-h-16" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field id="plan-priceMonthly" label="Price / month (₹)" error={errors.priceMonthly}>
            <Input type="number" min={0} value={form.priceMonthly} onChange={set("priceMonthly")} />
          </Field>
          {num("sortOrder", "Sort order")}
        </div>
        <fieldset>
          <legend className="mb-2 text-small font-medium text-app-text">Limits <span className="font-normal text-app-subtle">(-1 = unlimited)</span></legend>
          <div className="grid gap-4 sm:grid-cols-3">
            {(Object.keys(LIMIT_META) as (keyof PlanLimits)[]).map((k) => num(LIMIT_META[k].field, `${LIMIT_META[k].label} (${LIMIT_META[k].per})`))}
          </div>
        </fieldset>
        <fieldset>
          <legend className="mb-2 text-small font-medium text-app-text">Features included</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {FEATURE_KEYS.map((f) => (
              <Checkbox key={f} label={FEATURES[f]} checked={form.features.includes(f)} onChange={(e) => setForm((x) => ({ ...x, features: e.target.checked ? [...x.features, f] : x.features.filter((y) => y !== f) }))} />
            ))}
          </div>
        </fieldset>
        <div className="grid gap-2 sm:grid-cols-2">
          <Checkbox label="Active (available for assignment)" checked={form.isActive} onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))} />
          <Checkbox label="Clients can choose it themselves" description="Off = “contact sales” (you assign it)" checked={form.selfServe} onChange={(e) => setForm((f) => ({ ...f, selfServe: e.target.checked }))} />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button type="submit" loading={saving}>{plan === "new" ? "Create plan" : "Save plan"}</Button>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Invoices
// ---------------------------------------------------------------------------

function InvoicesTab() {
  const toast = useToast();
  const [status, setStatus] = React.useState("");
  const [q, setQ] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [data, setData] = React.useState<{ invoices: Invoice[]; total: number } | null>(null);
  const [error, setError] = React.useState("");
  const [paying, setPaying] = React.useState<Invoice | null>(null);
  const [voiding, setVoiding] = React.useState<Invoice | null>(null);
  const [busy, setBusy] = React.useState(false);
  const load = React.useCallback(async () => {
    const r = await apiFetch<{ invoices: Invoice[]; total: number }>(`/api/admin/invoices?status=${status}&q=${encodeURIComponent(q)}&page=${page}&pageSize=20`);
    if (!r.ok) return setError(r.error);
    setError("");
    setData(r.data);
  }, [status, q, page]);
  React.useEffect(() => {
    const t = window.setTimeout(() => void load(), 200);
    return () => window.clearTimeout(t);
  }, [load]);
  async function doVoid() {
    if (!voiding) return;
    setBusy(true);
    const r = await apiFetch(`/api/admin/invoices/${voiding.id}/void`, { method: "POST" });
    setBusy(false);
    setVoiding(null);
    if (!r.ok) return toast(r.error, "error");
    toast("Invoice voided");
    void load();
  }
  return (
    <Card>
      <CardHeader title="Invoices" description="Mark an invoice paid only when the money has actually arrived — a reference is required and logged." />
      <div className="flex flex-wrap gap-2 border-b border-app-border p-3">
        <Select aria-label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="h-9 w-40 text-small">
          <option value="">All</option>
          <option value="open">Unpaid</option>
          <option value="overdue">Overdue</option>
          <option value="paid">Paid</option>
          <option value="void">Void</option>
        </Select>
        <Input aria-label="Search" placeholder="Invoice no. or client…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} className="h-9 w-56 text-small" />
      </div>
      {error ? <ErrorState description={error} onRetry={load} /> : !data ? <LoadingState /> : (
        <>
          <InvoiceTable invoices={data.invoices} onMarkPaid={setPaying} onVoid={setVoiding} />
          <Pagination page={page} pageSize={20} total={data.total} onPageChange={setPage} />
        </>
      )}
      {paying ? <MarkPaidModal invoice={paying} onClose={() => setPaying(null)} onDone={() => { setPaying(null); void load(); }} /> : null}
      <ConfirmationDialog open={!!voiding} onClose={() => setVoiding(null)} onConfirm={doVoid} loading={busy} title={`Void ${voiding?.number ?? ""}?`} description="A voided invoice can't be paid. Use this for invoices raised by mistake." confirmLabel="Void invoice" />
    </Card>
  );
}

function MarkPaidModal({ invoice, onClose, onDone }: { invoice: Invoice; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [ref, setRef] = React.useState("");
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const r = await apiFetch(`/api/admin/invoices/${invoice.id}/mark-paid`, { method: "POST", body: { reference: ref } });
    setBusy(false);
    if (!r.ok) return setError(r.details?.reference?.[0] ?? r.error);
    toast("Payment recorded");
    onDone();
  }
  return (
    <Modal open onClose={onClose} title={`Record payment for ${invoice.number}`} description={`${invoice.client.name} · ${formatINR(invoice.total)}`}>
      <form onSubmit={submit} className="space-y-4">
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <Alert tone="warning">Only record money you have actually received. This marks the invoice paid and, for an upgrade, switches the client&apos;s plan.</Alert>
        <Field id="mp-ref" label="Payment reference" hint="Bank UTR, UPI transaction id, cheque number…">
          <Input value={ref} onChange={(e) => setRef(e.target.value)} maxLength={100} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={busy} disabled={ref.trim().length < 3}>Record payment</Button>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

function PaymentsTab() {
  const [status, setStatus] = React.useState("failed");
  const [page, setPage] = React.useState(1);
  const [data, setData] = React.useState<{ payments: { id: string; gateway: string; status: string; amount: number; reason: string; invoice: string; client: { id: string; name: string }; createdAt: string }[]; total: number } | null>(null);
  const [error, setError] = React.useState("");
  const load = React.useCallback(async () => {
    const r = await apiFetch<NonNullable<typeof data>>(`/api/admin/payments?status=${status}&page=${page}&pageSize=20`);
    if (!r.ok) return setError(r.error);
    setError("");
    setData(r.data);
  }, [status, page]);
  React.useEffect(() => {
    const t = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(t);
  }, [load]);
  return (
    <Card>
      <CardHeader title="Payment attempts" description="Every attempt to collect an invoice, through a gateway or recorded manually" action={<Select aria-label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="h-9 w-40 text-small"><option value="failed">Failed</option><option value="succeeded">Succeeded</option><option value="created">Started</option><option value="">All</option></Select>} />
      {error ? <ErrorState description={error} onRetry={load} /> : !data ? <LoadingState /> : !data.payments.length ? <EmptyState icon={Receipt} title="No payments" className="py-8" /> : (
        <>
          <Table caption="Payments" className="min-w-[760px]">
            <THead>
              <tr>
                <TH>When</TH>
                <TH>Client</TH>
                <TH>Invoice</TH>
                <TH>Gateway</TH>
                <TH className="text-right">Amount</TH>
                <TH>Status</TH>
              </tr>
            </THead>
            <TBody>
              {data.payments.map((p) => (
                <TR key={p.id}>
                  <TD className="whitespace-nowrap text-small text-app-muted">{istFmt.format(new Date(p.createdAt))}</TD>
                  <TD><Link href={`/admin/clients/${p.client.id}`} className="hover:text-app-primary-hover">{p.client.name}</Link></TD>
                  <TD>{p.invoice}</TD>
                  <TD className="text-small">{p.gateway}</TD>
                  <TD className="text-right tabular-nums">{formatINR(p.amount)}</TD>
                  <TD><Badge tone={p.status === "succeeded" ? "success" : p.status === "failed" ? "danger" : "neutral"} dot>{p.status}</Badge>{p.reason ? <p className="text-caption text-red-300">{p.reason}</p> : null}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
          <Pagination page={page} pageSize={20} total={data.total} onPageChange={setPage} />
        </>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

type Settings = { taxPercent: number; dueDays: number; graceDays: number; companyName: string; companyAddress: string; taxId: string; supportEmail: string; footer: string; paymentInstructions: string };

function SettingsTab() {
  const toast = useToast();
  const [form, setForm] = React.useState<Record<string, string> | null>(null);
  const [error, setError] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [cycling, setCycling] = React.useState(false);
  React.useEffect(() => {
    void apiFetch<{ settings: Settings }>("/api/admin/billing/settings").then((r) => {
      if (!r.ok) return setError(r.error);
      setForm(Object.fromEntries(Object.entries(r.data.settings).map(([k, v]) => [k, String(v)])));
    });
  }, []);
  if (error) return <ErrorState description={error} />;
  if (!form) return <LoadingState />;
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f!, [k]: e.target.value }));
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const r = await apiFetch(`/api/admin/billing/settings`, { method: "PUT", body: form });
    setSaving(false);
    toast(r.ok ? "Billing settings saved" : r.error, r.ok ? "success" : "error");
  }
  async function cycle() {
    setCycling(true);
    const r = await apiFetch<{ result: Record<string, number> }>("/api/admin/billing/cycle", { method: "POST" });
    setCycling(false);
    toast(r.ok ? `Billing cycle run: ${Object.entries(r.data.result).map(([k, v]) => `${v} ${k}`).join(", ")}` : r.error, r.ok ? "success" : "error");
  }
  return (
    <form onSubmit={save} className="space-y-4">
      <Card>
        <CardHeader title="Invoice policy" description="Applies to invoices issued from now on" />
        <CardBody className="grid gap-4 sm:grid-cols-3">
          <Field id="bs-tax" label="Tax rate (%)" hint="Added to every invoice. 0 = no tax line."><Input type="number" min={0} max={100} step="0.01" value={form.taxPercent} onChange={set("taxPercent")} /></Field>
          <Field id="bs-due" label="Payment due after (days)"><Input type="number" min={0} max={60} value={form.dueDays} onChange={set("dueDays")} /></Field>
          <Field id="bs-grace" label="Grace after due date (days)" hint="After this, an unpaid client's sending is paused."><Input type="number" min={0} max={90} value={form.graceDays} onChange={set("graceDays")} /></Field>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Invoice details" description="Printed on every invoice (snapshotted when issued)" />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <Field id="bs-name" label="Company name"><Input value={form.companyName} onChange={set("companyName")} maxLength={120} /></Field>
          <Field id="bs-taxid" label="Tax ID (e.g. GSTIN)"><Input value={form.taxId} onChange={set("taxId")} maxLength={40} /></Field>
          <Field id="bs-addr" label="Address" className="sm:col-span-2"><Textarea value={form.companyAddress} onChange={set("companyAddress")} rows={2} maxLength={400} /></Field>
          <Field id="bs-email" label="Billing contact email"><Input value={form.supportEmail} onChange={set("supportEmail")} maxLength={120} /></Field>
          <Field id="bs-footer" label="Footer note"><Input value={form.footer} onChange={set("footer")} maxLength={300} /></Field>
          <Field id="bs-pay" label="How to pay (bank / UPI details)" hint="Shown to clients while no online gateway is connected." className="sm:col-span-2"><Textarea value={form.paymentInstructions} onChange={set("paymentInstructions")} rows={3} maxLength={600} /></Field>
        </CardBody>
      </Card>
      <div className="flex flex-wrap justify-between gap-2">
        <Button variant="secondary" onClick={cycle} loading={cycling}>Run billing cycle now</Button>
        <Button type="submit" loading={saving}>Save settings</Button>
      </div>
      <p className="text-caption text-app-subtle">The cycle (renewals, scheduled downgrades/cancellations, overdue notices) also runs every minute from the scheduler and is safe to run repeatedly.</p>
    </form>
  );
}
