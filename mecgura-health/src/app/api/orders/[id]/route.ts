import { apiRoute, readJson } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { updateOrderStatus } from "@/lib/services/orders";

export const dynamic = "force-dynamic";
export const PATCH = apiRoute<TenantRequestContext>({ tenant: true }, async ({ req, ctx, params }) => updateOrderStatus(ctx, params.id, await readJson(req)));
