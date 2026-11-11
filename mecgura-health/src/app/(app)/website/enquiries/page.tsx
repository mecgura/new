import type { Metadata } from "next";
import { EnquiryActions } from "@/components/website/enquiry-actions";
import { Button, Card, DataTable, Field, Pagination, SearchInput, Select, StatusBadge, type Column } from "@/components/ui";
import { requireTenantPagePermission } from "@/lib/auth/context";
import { listEnquiries } from "@/lib/services/enquiries";

export const metadata: Metadata = { title: "Website enquiries" };
type Row = Awaited<ReturnType<typeof listEnquiries>>["rows"][number];

export default async function EnquiriesPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; page?: string }> }) {
  const ctx = await requireTenantPagePermission("enquiries.view");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const { rows, total, pageSize } = await listEnquiries(ctx, { q: sp.q?.trim() || undefined, status: sp.status, page });
  const canManage = ctx.permissions.has("enquiries.manage");
  const href = (p: number) => `/website/enquiries?${new URLSearchParams({ ...(sp.q ? { q: sp.q } : {}), ...(sp.status ? { status: sp.status } : {}), page: String(p) })}`;
  const cols: Column<Row>[] = [
    { key: "from", header: "From", cell: (r) => <span className="text-left"><span className="font-semibold">{r.name}</span><span className="type-caption block">{[r.phone, r.email].filter(Boolean).join(" · ")}</span></span> },
    { key: "msg", header: "Message", cell: (r) => <span className="line-clamp-3 max-w-md whitespace-pre-line text-left">{r.message}</span> },
    { key: "status", header: "Status", cell: (r) => <StatusBadge tone={r.status === "NEW" ? "info" : r.status === "READ" ? "success" : "neutral"}>{r.status[0] + r.status.slice(1).toLowerCase()}</StatusBadge> },
    { key: "date", header: "Received", cell: (r) => r.createdAt.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }), hideOnMobile: true },
    { key: "act", header: "Actions", align: "right", cell: (r) => <EnquiryActions id={r.id} status={r.status} canManage={canManage} /> },
  ];
  return (
    <div className="space-y-4">
      <p className="type-secondary">Messages sent through your website&apos;s contact form. Only your clinic can see them.</p>
      <Card className="p-card"><form method="get" className="grid gap-3 sm:grid-cols-[1fr_12rem_auto] sm:items-end">
        <Field label="Search"><SearchInput name="q" defaultValue={sp.q} placeholder="Name, phone, email or message" /></Field>
        <Field label="Status"><Select name="status" defaultValue={sp.status ?? ""} placeholder="All" options={[{ value: "NEW", label: "New" }, { value: "READ", label: "Read" }, { value: "ARCHIVED", label: "Archived" }]} /></Field>
        <Button type="submit" variant="outline">Apply</Button></form></Card>
      <Card className="overflow-hidden"><DataTable caption="Enquiries" columns={cols} rows={rows} rowKey={(r) => r.id} empty={{ title: "No enquiries", description: "Messages from the contact form appear here." }} /></Card>
      <Pagination page={page} pageCount={Math.ceil(total / pageSize)} hrefFor={href} />
    </div>
  );
}
