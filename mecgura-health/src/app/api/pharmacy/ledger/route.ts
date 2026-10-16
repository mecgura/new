import { apiRoute } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { listLedger } from "@/lib/services/pharmacy-inventory";
export const dynamic = "force-dynamic";
export const GET = apiRoute<TenantRequestContext>({ tenant: true }, async ({ req, ctx }) => { const s = new URL(req.url).searchParams; return listLedger(ctx, { from: s.get("from") ?? undefined, to: s.get("to") ?? undefined, medicineId: s.get("medicineId") ?? undefined, batchId: s.get("batchId") ?? undefined, type: s.get("type") ?? undefined, userId: s.get("userId") ?? undefined, page: Number(s.get("page") ?? 1) }); });
