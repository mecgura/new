import type { Metadata } from "next";
import { Empty, FilterTabs, PageTitle, Pager, RowLink, Section } from "@/components/portal/portal-server";
import { DOC_KIND, dayLabel, docHref } from "@/components/portal/portal-labels";
import { requirePatientContext } from "@/lib/portal/ctx";
import { listDocuments } from "@/lib/services/portal-records";

export const metadata: Metadata = { title: "Documents" };
export const dynamic = "force-dynamic";
export default async function DocumentsPage({ searchParams }: { searchParams: Promise<{ kind?: string; page?: string }> }) {
  const sp = await searchParams; const ctx = await requirePatientContext(); const kind = sp.kind && DOC_KIND[sp.kind] ? sp.kind : ""; const r = await listDocuments(ctx, { kind, page: Number(sp.page) });
  return (
    <div>
      <PageTitle title="Documents" subtitle="Everything you can open, print or download." />
      <FilterTabs base="/portal/documents" param="kind" current={kind} items={[["", "All"], ["prescription", "Prescriptions"], ["report", "Lab reports"], ["invoice", "Bills"], ["receipt", "Receipts"]]} />
      <Section>{!r.rows.length ? <Empty title="No documents yet" /> : <ul className="divide-y divide-line">{r.rows.map((d) => <RowLink key={`${d.kind}-${d.id}`} href={d.kind === "invoice" ? `/portal/billing/invoices/${d.id}/document` : docHref(d.kind, d.id)} title={d.title} meta={`${DOC_KIND[d.kind]} · ${dayLabel(d.date)}${d.subtitle ? ` · ${d.subtitle}` : ""}`} />)}</ul>}</Section>
      <Pager page={r.page} total={r.total} pageSize={r.pageSize} href={(n) => `/portal/documents?${new URLSearchParams({ ...(kind ? { kind } : {}), page: String(n) })}`} />
    </div>
  );
}
