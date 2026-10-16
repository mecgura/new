import { apiRoute, readJson } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { getMedicine, updateMedicine } from "@/lib/services/pharmacy-master";
export const dynamic = "force-dynamic";
export const GET = apiRoute<TenantRequestContext>({ tenant: true }, async ({ ctx, params }) => getMedicine(ctx, params.id));
export const PUT = apiRoute<TenantRequestContext>({ tenant: true }, async ({ req, ctx, params }) => { const b = (await readJson(req)) as Record<string, unknown>; const { applyToBatches, ...rest } = b ?? {}; return updateMedicine(ctx, params.id, rest, { applyToBatches: applyToBatches === true }); });
