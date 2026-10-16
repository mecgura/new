import { apiRoute, readJson } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { getPurchase, updatePurchase } from "@/lib/services/pharmacy-inventory";
export const dynamic = "force-dynamic";
export const GET = apiRoute<TenantRequestContext>({ tenant: true }, async ({ ctx, params }) => getPurchase(ctx, params.id));
export const PUT = apiRoute<TenantRequestContext>({ tenant: true }, async ({ req, ctx, params }) => updatePurchase(ctx, params.id, await readJson(req)));
