import type { Metadata } from "next";
import { AuditTable } from "@/components/platform/audit-table";
import { requirePagePermission } from "@/lib/auth/context";
import { auditCenter } from "@/lib/services/platform-admin";
import { Pagination } from "@/components/ui";

export const metadata: Metadata = { title: "Clinic · Audit" };
export const dynamic = "force-dynamic";
export default async function ClinicAuditPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ page?: string }> }) {
  const ctx = await requirePagePermission("platform.manage"); const { id } = await params; const page = Math.max(1, Number((await searchParams).page) || 1);
  const r = await auditCenter(ctx, { tenantId: id, page });
  return <div className="space-y-3"><AuditTable rows={r.rows} /><Pagination page={r.page} pageCount={Math.ceil(r.total / r.pageSize)} hrefFor={(p) => `/platform/clinics/${id}/audit?page=${p}`} /></div>;
}
