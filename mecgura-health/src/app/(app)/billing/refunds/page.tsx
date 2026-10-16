import type { Metadata } from "next";
import { Field, Select } from "@/components/ui";
import { RefundsBoard } from "@/components/billing/refunds-board";
import { REFUND_STATUS_LABEL } from "@/components/billing/billing-ui";
import { requireTenantPagePermission } from "@/lib/auth/context";
import { listRefunds } from "@/lib/services/billing-payments";

export const metadata: Metadata = { title: "Refunds" };
export const dynamic = "force-dynamic";

export default async function RefundsPage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string; page?: string }> }) {
  const ctx = await requireTenantPagePermission("billing.view");
  const sp = await searchParams;
  const data = await listRefunds(ctx, { status: sp.status, q: sp.q, page: Math.max(1, Number(sp.page) || 1) });
  return (
    <div className="space-y-section">
      <p className="type-secondary">A refund is requested, approved by an authorised person and then processed. Nothing is returned until it is processed.</p>
      <form method="get" action="/billing/refunds" className="flex flex-wrap items-end gap-3" aria-label="Filter refunds">
        <Field label="Search" hint="Refund no., invoice no. or patient"><input name="q" defaultValue={sp.q ?? ""} maxLength={60} className="type-body min-h-control w-full min-w-56 rounded-md border border-line-strong bg-surface px-3" /></Field>
        <Field label="Status"><Select name="status" defaultValue={sp.status ?? ""} placeholder="Any status" options={Object.entries(REFUND_STATUS_LABEL).map(([value, label]) => ({ value, label }))} /></Field>
        <button type="submit" className="type-button min-h-control rounded-md border border-line-strong px-4 hover:bg-surface-muted">Apply</button>
      </form>
      <RefundsBoard rows={data.rows} page={data.page} pageCount={Math.max(1, Math.ceil(data.total / data.pageSize))} query={{ status: sp.status, q: sp.q }} />
    </div>
  );
}
