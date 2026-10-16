import { apiRoute } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { pharmacyReport } from "@/lib/services/pharmacy-reports";
export const dynamic = "force-dynamic";
export const GET = apiRoute<TenantRequestContext>({ tenant: true }, async ({ req, ctx }) => { const s = new URL(req.url).searchParams; return pharmacyReport(ctx, s.get("kind") ?? "", { from: s.get("from") ?? undefined, to: s.get("to") ?? undefined, medicineId: s.get("medicineId") ?? undefined, category: s.get("category") ?? undefined, batchId: s.get("batchId") ?? undefined, supplierId: s.get("supplierId") ?? undefined, userId: s.get("userId") ?? undefined, state: s.get("state") ?? undefined }); });
