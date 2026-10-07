import { apiRoute } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { listBatches } from "@/lib/services/pharmacy-inventory";
export const dynamic = "force-dynamic";
export const GET = apiRoute<TenantRequestContext>({ tenant: true }, async ({ req, ctx }) => { const s = new URL(req.url).searchParams; return listBatches(ctx, { q: s.get("q") ?? undefined, medicineId: s.get("medicineId") ?? undefined, state: s.get("state") ?? undefined, page: Number(s.get("page") ?? 1) }); });
