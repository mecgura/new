import type { Metadata } from "next";
import { AuditTable } from "@/components/platform/audit-table";
import { Button, Card, Field, Pagination, Select } from "@/components/ui";
import { requirePagePermission } from "@/lib/auth/context";
import { auditCenter } from "@/lib/services/platform-admin";
import { db } from "@/lib/db";

export const metadata: Metadata = { title: "Audit logs" };
export const dynamic = "force-dynamic";
type SP = { actorId?: string; tenantId?: string; action?: string; category?: string; severity?: string; from?: string; to?: string; entityType?: string; page?: string };
const input = "type-form min-h-control w-full rounded-md border border-line-strong bg-surface px-3";
export default async function AuditPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requirePagePermission("platform.manage"); const sp = await searchParams; const page = Math.max(1, Number(sp.page) || 1);
  const [r, clinics] = await Promise.all([auditCenter(ctx, { ...sp, page }), db.tenant.findMany({ where: { deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" }, take: 300 })]);
  const href = (p: number) => `/platform/audit?${new URLSearchParams({ ...Object.fromEntries(Object.entries(sp).filter(([k, v]) => v && k !== "page") as [string, string][]), page: String(p) })}`;
  return (
    <div className="space-y-section">
      <div><h1 className="type-page-title">Audit logs</h1><p className="type-secondary mt-1">Append-only record of who did what, where and when. Entries cannot be edited or deleted from the application. Secrets and clinical content are never stored in them.</p></div>
      <Card className="p-card"><form method="get" role="search" aria-label="Filter audit logs" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Clinic"><Select name="tenantId" defaultValue={sp.tenantId ?? ""} placeholder="All clinics" options={clinics.map((c) => ({ value: c.id, label: c.name }))} /></Field>
        <Field label="Category"><Select name="category" defaultValue={sp.category ?? ""} placeholder="All categories" options={r.categories.map((c) => ({ value: c, label: c }))} /></Field>
        <Field label="Severity"><Select name="severity" defaultValue={sp.severity ?? ""} placeholder="All" options={[{ value: "high", label: "High" }, { value: "notice", label: "Notice" }, { value: "info", label: "Info" }]} /></Field>
        <Field label="Action starts with"><input name="action" defaultValue={sp.action ?? ""} placeholder="e.g. platform." className={input} maxLength={60} /></Field>
        <Field label="From"><input type="date" name="from" defaultValue={sp.from ?? ""} className={input} /></Field><Field label="To"><input type="date" name="to" defaultValue={sp.to ?? ""} className={input} /></Field>
        <Field label="Actor ID"><input name="actorId" defaultValue={sp.actorId ?? ""} className={input} maxLength={40} /></Field><Field label="Entity type"><input name="entityType" defaultValue={sp.entityType ?? ""} className={input} maxLength={40} /></Field>
        <div className="flex items-end"><Button type="submit" variant="outline">Apply filters</Button></div>
      </form></Card>
      <p className="type-caption" aria-live="polite">{r.total.toLocaleString("en-IN")} entr{r.total === 1 ? "y" : "ies"}</p>
      <AuditTable rows={r.rows} /><Pagination page={r.page} pageCount={Math.ceil(r.total / r.pageSize)} hrefFor={href} />
    </div>
  );
}
