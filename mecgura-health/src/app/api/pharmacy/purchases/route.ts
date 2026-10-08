import { apiRoute, readJson } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { createPurchase, listPurchases } from "@/lib/services/pharmacy-inventory";
export const dynamic = "force-dynamic";
export const GET = apiRoute<TenantRequestContext>({ tenant: true }, async ({ req, ctx }) => { const s = new URL(req.url).searchParams; return listPurchases(ctx, { status: s.get("status") ?? undefined, supplierId: s.get("supplierId") ?? undefined, medicineId: s.get("medicineId") ?? undefined, q: s.get("q") ?? undefined, from: s.get("from") ?? undefined, to: s.get("to") ?? undefined, page: Number(s.get("page") ?? 1) }); });
export const POST = apiRoute<TenantRequestContext>({ tenant: true }, async ({ req, ctx }) => createPurchase(ctx, await readJson(req)));
