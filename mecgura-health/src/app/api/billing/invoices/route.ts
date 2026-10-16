import { apiRoute, readJson } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { createInvoice, listInvoices } from "@/lib/services/billing-invoices";

export const dynamic = "force-dynamic";
export const GET = apiRoute<TenantRequestContext>({ tenant: true }, async ({ req, ctx }) => { const s = new URL(req.url).searchParams; return listInvoices(ctx, { status: s.get("status") ?? undefined, q: s.get("q") ?? undefined, from: s.get("from") ?? undefined, to: s.get("to") ?? undefined, doctorId: s.get("doctorId") ?? undefined, method: s.get("method") ?? undefined, serviceId: s.get("serviceId") ?? undefined, staffId: s.get("staffId") ?? undefined, patientId: s.get("patientId") ?? undefined, outstanding: s.get("outstanding") === "1", page: Number(s.get("page")) || 1 }); });
export const POST = apiRoute<TenantRequestContext>({ tenant: true }, async ({ req, ctx }) => createInvoice(ctx, await readJson(req)));
