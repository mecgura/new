import { apiRoute } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { collectionReport, financialReport } from "@/lib/services/billing-reports";

export const dynamic = "force-dynamic";
export const GET = apiRoute<TenantRequestContext>({ tenant: true }, async ({ req, ctx }) => { const s = new URL(req.url).searchParams; const f = { from: s.get("from") ?? undefined, to: s.get("to") ?? undefined, doctorId: s.get("doctorId") ?? undefined, serviceId: s.get("serviceId") ?? undefined, method: s.get("method") ?? undefined }; return s.get("kind") === "collection" ? collectionReport(ctx, f) : financialReport(ctx, f); });
