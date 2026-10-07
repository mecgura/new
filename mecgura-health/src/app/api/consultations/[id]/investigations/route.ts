import { apiRoute, readJson } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { createInvestigationOrder, listLabOrders } from "@/lib/services/lab-orders";

export const dynamic = "force-dynamic";
export const GET = apiRoute<TenantRequestContext>({ tenant: true }, async ({ ctx, params }) => listLabOrders(ctx, { tab: "all", consultationId: params.id }));
export const POST = apiRoute<TenantRequestContext>({ tenant: true }, async ({ req, ctx, params }) => createInvestigationOrder(ctx, params.id, await readJson(req)));
