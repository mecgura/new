import { apiRoute, readJson } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { createOrder, listOrders } from "@/lib/services/orders";

export const dynamic = "force-dynamic";
export const GET = apiRoute<TenantRequestContext>({ tenant: true }, async ({ ctx, params }) => listOrders(ctx, { consultationId: params.id }));
export const POST = apiRoute<TenantRequestContext>({ tenant: true }, async ({ req, ctx, params }) => createOrder(ctx, params.id, await readJson(req)));
