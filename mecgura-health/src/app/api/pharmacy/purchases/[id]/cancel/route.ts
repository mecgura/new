import { apiRoute, readJson } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { cancelPurchase } from "@/lib/services/pharmacy-inventory";
export const dynamic = "force-dynamic";
export const POST = apiRoute<TenantRequestContext>({ tenant: true }, async ({ req, ctx, params }) => cancelPurchase(ctx, params.id, await readJson(req)));
