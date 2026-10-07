import { apiRoute } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { listPayments } from "@/lib/services/billing-payments";

export const dynamic = "force-dynamic";
export const GET = apiRoute<TenantRequestContext>({ tenant: true }, async ({ req, ctx }) => { const s = new URL(req.url).searchParams; return listPayments(ctx, { q: s.get("q") ?? undefined, from: s.get("from") ?? undefined, to: s.get("to") ?? undefined, method: s.get("method") ?? undefined, status: s.get("status") ?? undefined, staffId: s.get("staffId") ?? undefined, patientId: s.get("patientId") ?? undefined, page: Number(s.get("page")) || 1 }); });
