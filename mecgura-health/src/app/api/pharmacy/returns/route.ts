import { apiRoute, readJson } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { listReturns, requestReturn } from "@/lib/services/pharmacy-dispensing";
export const dynamic = "force-dynamic";
export const GET = apiRoute<TenantRequestContext>({ tenant: true }, async ({ req, ctx }) => { const s = new URL(req.url).searchParams; return listReturns(ctx, { status: s.get("status") ?? undefined, type: s.get("type") ?? undefined, medicineId: s.get("medicineId") ?? undefined, page: Number(s.get("page") ?? 1) }); });
export const POST = apiRoute<TenantRequestContext>({ tenant: true }, async ({ req, ctx }) => requestReturn(ctx, await readJson(req)));
